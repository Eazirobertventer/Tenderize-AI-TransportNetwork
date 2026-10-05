INSERT INTO source_registry
  (source_key,source_name,authority,source_class,official,legacy)
VALUES
  ('kzn-dot-taxi-routes-2026','KZN Department of Transport Taxi Routes','KwaZulu-Natal Department of Transport','official_gis',true,false);

INSERT INTO taxi_rank
  (canonical_name,province,municipality,verification_status,location)
VALUES
  ('Rank Start','KwaZulu-Natal','Test Municipality','official',ST_SetSRID(ST_MakePoint(30.0,-29.0),4326)),
  ('Rank End','KwaZulu-Natal','Test Municipality','official',ST_SetSRID(ST_MakePoint(30.01,-29.01),4326)),
  ('Far Rank','KwaZulu-Natal','Test Municipality','official',ST_SetSRID(ST_MakePoint(31.0,-30.0),4326));

WITH s AS (SELECT id FROM source_registry WHERE source_key='kzn-dot-taxi-routes-2026')
INSERT INTO source_route_geometry
  (source_id,external_record_id,route_code,province,municipality,geometry,verification_status)
SELECT s.id,'1','TEST-001','KwaZulu-Natal','Test Municipality',
       ST_Multi(ST_MakeLine(ST_SetSRID(ST_MakePoint(30.0,-29.0),4326),ST_SetSRID(ST_MakePoint(30.01,-29.01),4326))),
       'documented'::verification_status
FROM s;
