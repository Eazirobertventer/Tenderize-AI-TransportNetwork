INSERT INTO source_registry
  (source_key,source_name,authority,source_class,official,legacy)
VALUES
  ('ethekwini-bus-taxi-ranks-degraded','eThekwini Bus/Taxi Ranks','eThekwini Municipality','official_gis',true,false);

INSERT INTO taxi_rank
  (canonical_name,province,municipality,verification_status,location)
VALUES
  ('Rank A','KwaZulu-Natal','eThekwini Metropolitan Municipality','official',ST_SetSRID(ST_MakePoint(31.0,-29.8),4326)),
  ('Rank B','KwaZulu-Natal','eThekwini Metropolitan Municipality','official',ST_SetSRID(ST_MakePoint(31.1,-29.9),4326)),
  ('Rank C','KwaZulu-Natal','eThekwini Metropolitan Municipality','official',ST_SetSRID(ST_MakePoint(31.2,-30.0),4326)),
  ('Rank D','KwaZulu-Natal','eThekwini Metropolitan Municipality','official',ST_SetSRID(ST_MakePoint(31.3,-30.1),4326));

WITH s AS (
  SELECT id FROM source_registry WHERE source_key='ethekwini-bus-taxi-ranks-degraded'
)
INSERT INTO rank_association_candidate
  (source_id,source_rank_external_id,taxi_rank_id,association_label,normalized_label,verification_status)
SELECT s.id,'a',r.id,'Clemont & Kwadabeka Taxi Association','clemont kwadabeka taxi association','documented'
FROM s,taxi_rank r WHERE r.canonical_name='Rank A'
UNION ALL
SELECT s.id,'b',r.id,'Kwamashu Taxi Owners Association','kwamashu taxi owners association','documented'
FROM s,taxi_rank r WHERE r.canonical_name='Rank B'
UNION ALL
SELECT s.id,'c',r.id,'Old Dutch & Warwick Taxi Rank Committee','old dutch warwick taxi rank committee','documented'
FROM s,taxi_rank r WHERE r.canonical_name='Rank C'
UNION ALL
SELECT s.id,'d',r.id,'Ningizimu One Region','ningizimu one region','documented'
FROM s,taxi_rank r WHERE r.canonical_name='Rank D';
