import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const apiKey = process.env.GOOGLE_MAPS_API_KEY;
if (!apiKey) {
  console.error('GOOGLE_MAPS_API_KEY is required. No request was sent.');
  process.exit(2);
}

const root = resolve(new URL('..', import.meta.url).pathname);
const seed = JSON.parse(await readFile(resolve(root, 'prototype/data/seed-network.json'), 'utf8'));
const outDir = resolve(root, 'data/ingested');
await mkdir(outDir, { recursive: true });

function haversineKm(a, b) {
  const R = 6371;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat/2)**2 + Math.cos(toRad(a.lat))*Math.cos(toRad(b.lat))*Math.sin(dLng/2)**2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function normaliseName(v='') {
  return v.toLowerCase().replace(/[^a-z0-9]+/g,' ').replace(/\btaxi\b|\brank\b|\btransport\b|\binterchange\b/g,' ').replace(/\s+/g,' ').trim();
}

function nameScore(a,b) {
  const A = new Set(normaliseName(a).split(' ').filter(Boolean));
  const B = new Set(normaliseName(b).split(' ').filter(Boolean));
  if (!A.size || !B.size) return 0;
  const intersection = [...A].filter(x=>B.has(x)).length;
  const union = new Set([...A,...B]).size;
  return intersection / union;
}

const results = [];
for (const rank of seed.ranks) {
  const textQuery = `${rank.name}, ${rank.town}, ${rank.province}, South Africa`;
  const response = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': 'places.id,places.displayName,places.location'
    },
    body: JSON.stringify({ textQuery, maxResultCount: 5, regionCode: 'ZA' })
  });
  if (!response.ok) {
    results.push({ rankId: rank.id, query: textQuery, placeId: null, status: 'lookup_failed', httpStatus: response.status });
    continue;
  }
  const payload = await response.json();
  const candidates = (payload.places || []).map(p => {
    const distanceKm = p.location ? haversineKm({lat:rank.lat,lng:rank.lng},{lat:p.location.latitude,lng:p.location.longitude}) : null;
    const nScore = nameScore(rank.name, p.displayName?.text || '');
    const dScore = distanceKm == null ? 0 : Math.max(0, 1 - Math.min(distanceKm, 10) / 10);
    return { id: p.id, score: 0.65*nScore + 0.35*dScore, distanceKm };
  }).sort((a,b)=>b.score-a.score);
  const best = candidates[0];
  results.push({
    rankId: rank.id,
    query: textQuery,
    placeId: best?.id || null,
    matchConfidence: best ? Number(best.score.toFixed(4)) : null,
    matchDistanceKm: best?.distanceKm == null ? null : Number(best.distanceKm.toFixed(3)),
    status: best && best.score >= 0.7 ? 'candidate_match' : 'manual_review',
    checkedAt: new Date().toISOString()
  });
}

await writeFile(resolve(outDir, 'google-place-id-candidates.json'), JSON.stringify({
  note: 'Persisted fields intentionally exclude Google place names and coordinates. Place IDs may be stored; refresh IDs older than 12 months.',
  results
}, null, 2));
console.log(`Wrote ${results.length} Google Place ID candidate records.`);
