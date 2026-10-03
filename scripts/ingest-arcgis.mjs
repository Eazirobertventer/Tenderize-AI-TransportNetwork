import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname);
const sources = JSON.parse(await readFile(resolve(root, 'config/sources.json'), 'utf8'));
const requested = process.argv.slice(2).filter(v => !v.startsWith('--'));
const selected = requested.length ? sources.filter(s => requested.includes(s.id)) : sources;
const outputDir = resolve(root, 'data/ingested');
await mkdir(outputDir, { recursive: true });

const clean = value => typeof value === 'string' ? value.trim() || null : value ?? null;
const unique = values => [...new Set(values.map(clean).filter(Boolean))];

async function fetchPage(source, offset) {
  const qs = new URLSearchParams({
    where: '1=1',
    outFields: source.outFields || '*',
    returnGeometry: 'true',
    outSR: '4326',
    f: 'geojson',
    resultOffset: String(offset),
    resultRecordCount: String(source.pageSize || 1000)
  });
  const url = `${source.url}/query?${qs}`;
  const response = await fetch(url, { headers: { 'user-agent': 'TenderizeTransportNetwork/0.1' } });
  if (!response.ok) throw new Error(`${source.id}: ${response.status} ${response.statusText}`);
  const json = await response.json();
  if (!json || !Array.isArray(json.features)) throw new Error(`${source.id}: invalid GeoJSON response`);
  return json;
}

function normalizeRank(source, feature) {
  const a = feature.properties || {};
  const m = source.mapping || {};
  const coord = feature.geometry?.type === 'Point' ? feature.geometry.coordinates : null;
  const associations = unique((source.associationFields || []).map(k => a[k]));
  const destinations = unique((source.destinationFields || []).map(k => a[k]));
  return {
    entityType: 'taxi_rank',
    externalId: String(a[m.external_id] ?? feature.id ?? ''),
    canonicalName: clean(a[m.name]),
    province: clean(m.province) || clean(a[m.province]),
    municipality: clean(m.municipality) || clean(a[m.municipality]),
    region: clean(a[m.region]),
    suburb: clean(a[m.suburb]),
    town: clean(a[m.town]),
    latitude: Number(a[m.latitude] ?? coord?.[1] ?? null),
    longitude: Number(a[m.longitude] ?? coord?.[0] ?? null),
    rankType: clean(a[m.rank_type]),
    ownership: clean(a[m.ownership]),
    associations,
    destinations,
    geometry: feature.geometry || null,
    verificationStatus: 'official',
    sourceId: source.id
  };
}

function normalizeRoute(source, feature) {
  const a = feature.properties || {};
  const m = source.mapping || {};
  return {
    entityType: 'route',
    externalId: String(a[m.external_id] ?? feature.id ?? ''),
    originName: clean(a[m.origin_name]),
    destinationName: clean(a[m.destination_name]),
    boardRouteCode: clean(a[m.board_route_code]),
    province: clean(m.province) || clean(a[m.province]),
    municipality: clean(m.municipality) || clean(a[m.municipality]),
    geometry: feature.geometry || null,
    geometryStatus: feature.geometry ? 'official_geometry' : 'pending',
    verificationStatus: source.status === 'official_legacy' ? 'documented' : 'official',
    sourceId: source.id
  };
}

for (const source of selected) {
  console.log(`Ingesting ${source.id}...`);
  let offset = 0;
  const rawFeatures = [];
  const pageSize = source.pageSize || 1000;
  for (;;) {
    const page = await fetchPage(source, offset);
    rawFeatures.push(...page.features);
    if (page.features.length < pageSize) break;
    offset += pageSize;
  }

  const normalized = rawFeatures.map(feature => source.kind === 'taxi_rank'
    ? normalizeRank(source, feature)
    : normalizeRoute(source, feature));

  const envelope = {
    source: {
      id: source.id,
      name: source.name,
      authority: source.authority,
      url: source.url,
      status: source.status
    },
    retrievedAt: new Date().toISOString(),
    recordCount: normalized.length,
    records: normalized
  };
  await writeFile(resolve(outputDir, `${source.id}.json`), JSON.stringify(envelope, null, 2));
  console.log(`  ${normalized.length} records -> data/ingested/${source.id}.json`);
}
