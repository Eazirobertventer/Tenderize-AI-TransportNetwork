import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const file = process.argv[2];
if (!file) throw new Error('Usage: node scripts/build-rank-import-sql.mjs <ingested-json>');

const envelope = JSON.parse(await readFile(file, 'utf8'));
if (!Array.isArray(envelope.records)) throw new Error('Invalid ingestion envelope');

const q = value => value == null ? 'NULL' : "'" + String(value).replaceAll("'", "''") + "'";
const norm = value => String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const validPoint = r => Number.isFinite(r.latitude) && Number.isFinite(r.longitude) &&
  r.latitude >= -36 && r.latitude <= -20 && r.longitude >= 15 && r.longitude <= 34;

console.log('BEGIN;');
console.log(`
INSERT INTO source_registry (source_key,source_name,authority,source_class,source_url,official,legacy,last_checked_at)
VALUES (${q(envelope.source.id)},${q(envelope.source.name)},${q(envelope.source.authority)},'official_gis',${q(envelope.source.url)},
  ${envelope.source.status?.startsWith('official') ? 'true' : 'false'},
  ${envelope.source.status === 'official_legacy' ? 'true' : 'false'},now())
ON CONFLICT (source_key) DO UPDATE SET
  source_name=EXCLUDED.source_name,authority=EXCLUDED.authority,source_url=EXCLUDED.source_url,
  official=EXCLUDED.official,legacy=EXCLUDED.legacy,last_checked_at=now(),updated_at=now();
`);

for (const record of envelope.records) {
  if (record.entityType !== 'taxi_rank' || !record.externalId || !record.canonicalName || !validPoint(record)) continue;

  const payload = JSON.stringify(record).replaceAll("'", "''");
  const checksum = hash(record);

  console.log(`
WITH src AS (
  SELECT id FROM source_registry WHERE source_key=${q(envelope.source.id)}
), existing AS (
  SELECT sr.entity_id FROM source_record sr, src
  WHERE sr.source_id=src.id AND sr.entity_type='taxi_rank' AND sr.external_record_id=${q(record.externalId)}
), upsert_rank AS (
  UPDATE taxi_rank SET
    canonical_name=${q(record.canonicalName)},
    province=${q(record.province)},
    municipality=${q(record.municipality)},
    suburb=${q(record.suburb)},
    town=${q(record.town)},
    rank_type=${q(record.rankType)},
    ownership=${q(record.ownership)},
    location=ST_SetSRID(ST_MakePoint(${record.longitude},${record.latitude}),4326),
    verification_status=${q(record.verificationStatus)}::verification_status,
    last_verified_at=now(),updated_at=now()
  WHERE id IN (SELECT entity_id FROM existing)
  RETURNING id
), chosen AS (
  SELECT id FROM upsert_rank
  UNION ALL
  SELECT id FROM (
    INSERT INTO taxi_rank (canonical_name,province,municipality,suburb,town,rank_type,ownership,location,verification_status,last_verified_at)
    SELECT ${q(record.canonicalName)},${q(record.province)},${q(record.municipality)},${q(record.suburb)},${q(record.town)},
      ${q(record.rankType)},${q(record.ownership)},ST_SetSRID(ST_MakePoint(${record.longitude},${record.latitude}),4326),
      ${q(record.verificationStatus)}::verification_status,now()
    WHERE NOT EXISTS (SELECT 1 FROM existing)
    RETURNING id
  ) inserted
)
INSERT INTO source_record (source_id,entity_type,entity_id,external_record_id,source_payload,source_geometry,checksum,source_last_checked_at)
SELECT src.id,'taxi_rank',chosen.id,${q(record.externalId)},'${payload}'::jsonb,
  ST_SetSRID(ST_MakePoint(${record.longitude},${record.latitude}),4326),${q(checksum)},now()
FROM src,chosen
ON CONFLICT (source_id,entity_type,external_record_id) DO UPDATE SET
  entity_id=EXCLUDED.entity_id,source_payload=EXCLUDED.source_payload,source_geometry=EXCLUDED.source_geometry,
  checksum=EXCLUDED.checksum,source_last_checked_at=now(),source_retrieved_at=now();
`);

  for (const label of record.associations || []) {
    const normalized = norm(label);
    if (!normalized) continue;
    console.log(`
INSERT INTO rank_association_candidate (source_id,source_rank_external_id,taxi_rank_id,association_label,normalized_label)
SELECT s.id,${q(record.externalId)},sr.entity_id,${q(label)},${q(normalized)}
FROM source_registry s
JOIN source_record sr ON sr.source_id=s.id AND sr.entity_type='taxi_rank' AND sr.external_record_id=${q(record.externalId)}
WHERE s.source_key=${q(envelope.source.id)}
ON CONFLICT (source_id,source_rank_external_id,normalized_label) DO UPDATE SET
  taxi_rank_id=EXCLUDED.taxi_rank_id,association_label=EXCLUDED.association_label,last_seen_at=now();
`);
  }

  for (const label of record.destinations || []) {
    const normalized = norm(label);
    if (!normalized) continue;
    console.log(`
INSERT INTO rank_destination_candidate (source_id,source_rank_external_id,taxi_rank_id,destination_label,normalized_label)
SELECT s.id,${q(record.externalId)},sr.entity_id,${q(label)},${q(normalized)}
FROM source_registry s
JOIN source_record sr ON sr.source_id=s.id AND sr.entity_type='taxi_rank' AND sr.external_record_id=${q(record.externalId)}
WHERE s.source_key=${q(envelope.source.id)}
ON CONFLICT (source_id,source_rank_external_id,normalized_label) DO UPDATE SET
  taxi_rank_id=EXCLUDED.taxi_rank_id,destination_label=EXCLUDED.destination_label,last_seen_at=now();
`);
  }
}

console.log('COMMIT;');
