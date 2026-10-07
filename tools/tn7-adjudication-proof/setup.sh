#!/bin/bash
set -euo pipefail
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TYPE verification_status AS ENUM (
  'official','verified','documented','community_verified',
  'candidate','inferred','conflict','unverified'
);

CREATE TABLE IF NOT EXISTS data_issue (
  id uuid PRIMARY KEY,
  entity_type text NOT NULL,
  entity_id uuid,
  issue_type text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('info','warning','error','blocking')),
  summary text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','reviewing','resolved','deferred')),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);
CREATE TABLE IF NOT EXISTS taxi_association (
  id uuid PRIMARY KEY,
  canonical_name text NOT NULL,
  acronym text,
  registration_number text,
  affiliation text,
  province text,
  district text,
  municipality text,
  address text,
  rank_type text,
  ownership text,
  formal_status text,
  service_types text[] NOT NULL DEFAULT '{}',
  google_place_id text,
  location geometry(Point,4326),
  verification_status text NOT NULL DEFAULT 'unverified',
  confidence numeric(5,4),
  last_verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS taxi_rank (
  id uuid PRIMARY KEY,
  canonical_name text NOT NULL,
  aliases text[] NOT NULL DEFAULT '{}',
  province text,
  district text,
  municipality text,
  suburb text,
  town text,
  address text,
  verification_status text NOT NULL DEFAULT 'unverified',
  updated_at timestamptz NOT NULL DEFAULT now()
);

TRUNCATE taxi_rank,taxi_association;

INSERT INTO taxi_rank (
  id,canonical_name,aliases,province,municipality,town,verification_status
) VALUES
('14141414-1414-4414-8414-141414141414','Central Taxi Rank',ARRAY['CTR','Central Rank'],'Gauteng','City A','Central','verified'),
('15151515-1515-4515-8515-151515151515','West Taxi Rank',ARRAY['West Rank'],'Gauteng','City B','West','verified'),
('16161616-1616-4616-8616-161616161616','North Taxi Rank',ARRAY[]::text[],'Gauteng','City C','North','verified'),
('17171717-1717-4717-8717-171717171717','South Taxi Rank',ARRAY[]::text[],'Gauteng','City D','South','verified'),
('18181818-1818-4818-8818-181818181818','East Taxi Rank',ARRAY[]::text[],'Gauteng','City E','East','verified'),
('19191919-1919-4919-8919-191919191919','Airport Taxi Rank',ARRAY[]::text[],'Gauteng','City F','Airport','verified'),
('20202020-2020-4020-8020-202020202020','Atomic Taxi Rank',ARRAY[]::text[],'Gauteng','City G','Atomic','verified'),
('25252525-2525-4525-8525-252525252525','Reject Taxi Rank',ARRAY[]::text[],'Gauteng','City H','Reject','verified'),
('26262626-2626-4626-8626-262626262626','Multi Association Rank',ARRAY[]::text[],'Gauteng','City I','Multi','verified'),
('27272727-2727-4727-8727-272727272727','Route Rank A',ARRAY[]::text[],'Gauteng','Route City','A','verified'),
('28282828-2828-4828-8828-282828282828','Route Rank B',ARRAY[]::text[],'Gauteng','Route City','B','verified'),
('29292929-2929-4929-8929-292929292929','Route Rank C',ARRAY[]::text[],'Gauteng','Route City','C','verified'),
('30303030-3030-4030-8030-303030303030','Route Rank D',ARRAY[]::text[],'Gauteng','Route City','D','verified'),
('34343434-3434-4434-8434-343434343434','Route Rank E',ARRAY[]::text[],'Gauteng','Route City','E','verified'),
('35353535-3535-4535-8535-353535353535','Route Rank F',ARRAY[]::text[],'Gauteng','Route City','F','verified'),
('36363636-3636-4636-8636-363636363636','Route Rank G',ARRAY[]::text[],'Gauteng','Route City','G','verified'),
('37373737-3737-4737-8737-373737373737','Route Rank H',ARRAY[]::text[],'Gauteng','Route City','H','verified'),
('38383838-3838-4838-8838-383838383838','Route Rank I',ARRAY[]::text[],'Gauteng','Route City','I','verified'),
('39393939-3939-4939-8939-393939393939','Route Rank J',ARRAY[]::text[],'Gauteng','Route City','J','verified'),
('40404040-4040-4040-8040-404040404040','Route Rank K',ARRAY[]::text[],'Gauteng','Route City','K','verified'),
('43434343-aaaa-4343-8343-434343434343','Route Rank L',ARRAY[]::text[],'Gauteng','Route City','L','verified');

INSERT INTO taxi_association (
  id,canonical_name,acronym,registration_number,province,municipality,verification_status
) VALUES
('21212121-2121-4212-8212-212121212121','Alpha Taxi Association','ATA','REG-ALPHA','Gauteng','City A','verified'),
('23232323-2323-4232-8232-232323232323','Beta Taxi Association','BTA','REG-BETA','Gauteng','City B','verified'),
('24242424-2424-4242-8242-242424242424','Gamma Taxi Association','GTA','REG-GAMMA','Gauteng','City C','verified');

CREATE TABLE IF NOT EXISTS source_registry (
  id uuid PRIMARY KEY,
  source_key text UNIQUE NOT NULL,
  source_name text NOT NULL,
  authority text,
  source_class text NOT NULL DEFAULT 'official_gis',
  official boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS rank_association_candidate (
  id uuid PRIMARY KEY,
  source_id uuid NOT NULL REFERENCES source_registry(id) ON DELETE CASCADE,
  source_rank_external_id text NOT NULL,
  taxi_rank_id uuid REFERENCES taxi_rank(id) ON DELETE CASCADE,
  association_label text NOT NULL,
  normalized_label text NOT NULL,
  verification_status text NOT NULL DEFAULT 'documented',
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_id,source_rank_external_id,normalized_label)
);

CREATE TABLE IF NOT EXISTS rank_destination_candidate (
  id uuid PRIMARY KEY,
  source_id uuid NOT NULL REFERENCES source_registry(id) ON DELETE CASCADE,
  source_rank_external_id text NOT NULL,
  taxi_rank_id uuid REFERENCES taxi_rank(id) ON DELETE CASCADE,
  destination_label text NOT NULL,
  normalized_label text NOT NULL,
  verification_status text NOT NULL DEFAULT 'documented',
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_id,source_rank_external_id,normalized_label)
);

CREATE TABLE IF NOT EXISTS taxi_rank_association (
  taxi_rank_id uuid NOT NULL REFERENCES taxi_rank(id) ON DELETE CASCADE,
  association_id uuid NOT NULL REFERENCES taxi_association(id) ON DELETE CASCADE,
  verification_status text NOT NULL DEFAULT 'unverified',
  confidence numeric(5,4),
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (taxi_rank_id,association_id)
);

TRUNCATE rank_association_candidate,source_registry,taxi_rank_association;

INSERT INTO source_registry (id,source_key,source_name,authority,source_class,official) VALUES
('31313131-3131-4131-8131-313131313131','proof-source-a','Proof Source A','Proof Authority A','official_gis',true),
('32323232-3232-4232-8232-323232323232','proof-source-b','Proof Source B','Proof Authority B','municipal_itp',false),
('33333333-aaaa-4333-8333-333333333333','proof-route-source','Proof Route GIS','Proof Route Authority','official_gis',true);

INSERT INTO rank_association_candidate (
  id,source_id,source_rank_external_id,taxi_rank_id,association_label,normalized_label,verification_status
) VALUES
('41414141-4141-4141-8141-414141414141','31313131-3131-4131-8131-313131313131','central-a','14141414-1414-4414-8414-141414141414','Alpha Taxi Association','alpha taxi association','documented'),
('42424242-4242-4242-8242-424242424242','32323232-3232-4232-8232-323232323232','central-b','14141414-1414-4414-8414-141414141414','ATA','ata','documented'),
('43434343-4343-4343-8343-434343434343','31313131-3131-4131-8131-313131313131','west-a','15151515-1515-4515-8515-151515151515','Alpha Taxi Association','alpha taxi association','documented'),
('45454545-4545-4545-8545-454545454545','32323232-3232-4232-8232-323232323232','west-b','15151515-1515-4515-8515-151515151515','Beta Taxi Association','beta taxi association','documented'),
('46464646-4646-4646-8646-464646464646','31313131-3131-4131-8131-313131313131','north-x','16161616-1616-4616-8616-161616161616','Unknown Operators Association','unknown operators association','documented'),
('47474747-4747-4747-8747-474747474747','31313131-3131-4131-8131-313131313131','south-a','17171717-1717-4717-8717-171717171717','Alpha Taxi Association','alpha taxi association','documented'),
('48484848-4848-4848-8848-484848484848','31313131-3131-4131-8131-313131313131','east-a','18181818-1818-4818-8818-181818181818','Alpha Taxi Association','alpha taxi association','documented'),
('49494949-4949-4949-8949-494949494949','31313131-3131-4131-8131-313131313131','airport-g','19191919-1919-4919-8919-191919191919','Gamma Taxi Association','gamma taxi association','documented'),
('50505050-5050-4050-8050-505050505050','31313131-3131-4131-8131-313131313131','atomic-b','20202020-2020-4020-8020-202020202020','Beta Taxi Association','beta taxi association','documented'),
('51515151-5151-4151-8151-515151515151','31313131-3131-4131-8131-313131313131','reject-a','25252525-2525-4525-8525-252525252525','Alpha Taxi Association','alpha taxi association','documented'),
('52525252-5252-4252-8252-525252525252','31313131-3131-4131-8131-313131313131','multi-a','26262626-2626-4626-8626-262626262626','Alpha Taxi Association','alpha taxi association','documented');

INSERT INTO taxi_rank_association (
  taxi_rank_id,association_id,verification_status,confidence
) VALUES
('17171717-1717-4717-8717-171717171717','21212121-2121-4212-8212-212121212121','verified',NULL),
('26262626-2626-4626-8626-262626262626','23232323-2323-4232-8232-232323232323','verified',NULL),
('27272727-2727-4727-8727-272727272727','21212121-2121-4212-8212-212121212121','verified',NULL),
('28282828-2828-4828-8828-282828282828','21212121-2121-4212-8212-212121212121','verified',NULL),
('29292929-2929-4929-8929-292929292929','21212121-2121-4212-8212-212121212121','verified',NULL),
('30303030-3030-4030-8030-303030303030','21212121-2121-4212-8212-212121212121','verified',NULL),
('34343434-3434-4434-8434-343434343434','21212121-2121-4212-8212-212121212121','verified',NULL),
('35353535-3535-4535-8535-353535353535','23232323-2323-4232-8232-232323232323','verified',NULL),
('36363636-3636-4636-8636-363636363636','21212121-2121-4212-8212-212121212121','verified',NULL),
('36363636-3636-4636-8636-363636363636','23232323-2323-4232-8232-232323232323','verified',NULL),
('37373737-3737-4737-8737-373737373737','21212121-2121-4212-8212-212121212121','verified',NULL),
('37373737-3737-4737-8737-373737373737','23232323-2323-4232-8232-232323232323','verified',NULL),
('38383838-3838-4838-8838-383838383838','21212121-2121-4212-8212-212121212121','verified',NULL),
('39393939-3939-4939-8939-393939393939','21212121-2121-4212-8212-212121212121','verified',NULL),
('40404040-4040-4040-8040-404040404040','21212121-2121-4212-8212-212121212121','verified',NULL),
('43434343-aaaa-4343-8343-434343434343','21212121-2121-4212-8212-212121212121','verified',NULL);

CREATE TABLE IF NOT EXISTS taxi_route (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  association_id uuid REFERENCES taxi_association(id),
  origin_rank_id uuid REFERENCES taxi_rank(id),
  destination_rank_id uuid REFERENCES taxi_rank(id),
  origin_label text,
  destination_label text,
  route_name text,
  source_route_code text,
  national_route_code text,
  board_route_code text,
  route_type text,
  street_description text,
  geometry geometry(MultiLineString,4326),
  geometry_status text NOT NULL DEFAULT 'pending',
  distance_km numeric(12,3),
  duration_minutes integer,
  verification_status verification_status NOT NULL DEFAULT 'unverified',
  confidence numeric(5,4),
  last_verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS source_record (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid NOT NULL REFERENCES source_registry(id),
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  external_record_id text,
  source_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_geometry geometry(Geometry,4326),
  source_retrieved_at timestamptz NOT NULL DEFAULT now(),
  source_last_checked_at timestamptz,
  source_confidence numeric(5,4),
  checksum text,
  UNIQUE (source_id,entity_type,external_record_id)
);

CREATE TABLE IF NOT EXISTS source_route_geometry (
  id uuid PRIMARY KEY,
  source_id uuid NOT NULL REFERENCES source_registry(id) ON DELETE CASCADE,
  external_record_id text NOT NULL,
  route_code text,
  province text,
  municipality text,
  district text,
  category text,
  map_title text,
  geometry geometry(MultiLineString,4326) NOT NULL,
  verification_status verification_status NOT NULL DEFAULT 'documented',
  source_date timestamptz,
  source_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  promoted_route_id uuid REFERENCES taxi_route(id),
  UNIQUE (source_id,external_record_id)
);

CREATE TABLE IF NOT EXISTS route_candidate (
  id uuid PRIMARY KEY,
  source_route_geometry_id uuid NOT NULL UNIQUE REFERENCES source_route_geometry(id) ON DELETE CASCADE,
  source_id uuid NOT NULL REFERENCES source_registry(id) ON DELETE CASCADE,
  external_record_id text NOT NULL,
  route_code text,
  origin_rank_id uuid NOT NULL REFERENCES taxi_rank(id),
  destination_rank_id uuid NOT NULL REFERENCES taxi_rank(id),
  association_id uuid REFERENCES taxi_association(id),
  origin_distance_m numeric(10,2) NOT NULL,
  destination_distance_m numeric(10,2) NOT NULL,
  reconciliation_status text NOT NULL,
  verification_status verification_status NOT NULL DEFAULT 'documented',
  confidence numeric(5,4) NOT NULL DEFAULT 1.0,
  provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);

TRUNCATE route_candidate,source_route_geometry,source_record,taxi_route;

INSERT INTO source_route_geometry (
  id,source_id,external_record_id,route_code,province,municipality,category,map_title,geometry,
  verification_status,source_payload
) VALUES
('61616161-6161-4161-8161-616161616161','33333333-aaaa-4333-8333-333333333333','route-good','R-GOOD','Gauteng','Route City','official_route','Good Source Route',ST_GeomFromText('MULTILINESTRING((28.00 -26.00,28.01 -26.01,28.02 -26.02))',4326),'documented','{"kind":"official_path"}'),
('62626262-6262-4262-8262-626262626262','33333333-aaaa-4333-8333-333333333333','route-endpoint','R-END','Gauteng','Route City','endpoint_connector_evidence','Endpoint Connector',ST_GeomFromText('MULTILINESTRING((28.10 -26.00,28.11 -26.01))',4326),'documented','{"notRoutePath":true}'),
('63636363-6363-4363-8363-636363636363','33333333-aaaa-4333-8333-333333333333','route-assoc-conflict','R-ASSOC','Gauteng','Route City','official_route','Association Conflict Route',ST_GeomFromText('MULTILINESTRING((28.20 -26.00,28.21 -26.01))',4326),'documented','{}'),
('64646464-6464-4464-8464-646464646464','33333333-aaaa-4333-8333-333333333333','route-shared-conflict','R-SHARED','Gauteng','Route City','official_route','Shared Conflict Route',ST_GeomFromText('MULTILINESTRING((28.30 -26.00,28.31 -26.01))',4326),'documented','{}'),
('65656565-6565-4565-8565-656565656565','33333333-aaaa-4333-8333-333333333333','route-code-collision','R-COLLIDE','Gauteng','Route City','official_route','Code Collision Route',ST_GeomFromText('MULTILINESTRING((28.40 -26.00,28.41 -26.01))',4326),'documented','{}'),
('66666666-aaaa-4666-8666-666666666666','33333333-aaaa-4333-8333-333333333333','route-stale','R-STALE','Gauteng','Route City','official_route','Stale Route',ST_GeomFromText('MULTILINESTRING((28.50 -26.00,28.51 -26.01))',4326),'documented','{}'),
('67676767-6767-4767-8767-676767676767','33333333-aaaa-4333-8333-333333333333','route-race','R-RACE','Gauteng','Route City','official_route','Concurrent Route',ST_GeomFromText('MULTILINESTRING((28.60 -26.00,28.61 -26.01))',4326),'documented','{}'),
('68686868-6868-4868-8868-686868686868','33333333-aaaa-4333-8333-333333333333','route-atomic','R-ATOMIC','Gauteng','Route City','official_route','Atomic Route',ST_GeomFromText('MULTILINESTRING((28.70 -26.00,28.71 -26.01))',4326),'documented','{}'),
('69696969-6969-4969-8969-696969696969','33333333-aaaa-4333-8333-333333333333','route-source-record','R-SOURCE','Gauteng','Route City','official_route','Source Record Route',ST_GeomFromText('MULTILINESTRING((28.80 -26.00,28.81 -26.01))',4326),'documented','{}');

INSERT INTO route_candidate (
  id,source_route_geometry_id,source_id,external_record_id,route_code,origin_rank_id,destination_rank_id,
  association_id,origin_distance_m,destination_distance_m,reconciliation_status,verification_status,confidence,provenance
) VALUES
('71717171-7171-4171-8171-717171717171','61616161-6161-4161-8161-616161616161','33333333-aaaa-4333-8333-333333333333','route-good','R-GOOD','27272727-2727-4727-8727-272727272727','28282828-2828-4828-8828-282828282828',NULL,0,0,'exact_endpoint_pair','documented',1.0,'{}'),
('72727272-7272-4272-8272-727272727272','62626262-6262-4262-8262-626262626262','33333333-aaaa-4333-8333-333333333333','route-endpoint','R-END','29292929-2929-4929-8929-292929292929','30303030-3030-4030-8030-303030303030',NULL,0,0,'exact_endpoint_pair','documented',1.0,'{"notRoutePath":true}'),
('73737373-7373-4373-8373-737373737373','63636363-6363-4363-8363-636363636363','33333333-aaaa-4333-8333-333333333333','route-assoc-conflict','R-ASSOC','27272727-2727-4727-8727-272727272727','28282828-2828-4828-8828-282828282828','23232323-2323-4232-8232-232323232323',0,0,'exact_endpoint_pair','documented',1.0,'{}'),
('74747474-7474-4474-8474-747474747474','64646464-6464-4464-8464-646464646464','33333333-aaaa-4333-8333-333333333333','route-shared-conflict','R-SHARED','36363636-3636-4636-8636-363636363636','37373737-3737-4737-8737-373737373737',NULL,0,0,'exact_endpoint_pair','documented',1.0,'{}'),
('75757575-7575-4575-8575-757575757575','65656565-6565-4565-8565-656565656565','33333333-aaaa-4333-8333-333333333333','route-code-collision','R-COLLIDE','38383838-3838-4838-8838-383838383838','39393939-3939-4939-8939-393939393939',NULL,0,0,'exact_endpoint_pair','documented',1.0,'{}'),
('76767676-7676-4676-8676-767676767676','66666666-aaaa-4666-8666-666666666666','33333333-aaaa-4333-8333-333333333333','route-stale','R-STALE','38383838-3838-4838-8838-383838383838','40404040-4040-4040-8040-404040404040',NULL,0,0,'exact_endpoint_pair','documented',1.0,'{}'),
('77777777-aaaa-4777-8777-777777777777','67676767-6767-4767-8767-676767676767','33333333-aaaa-4333-8333-333333333333','route-race','R-RACE','39393939-3939-4939-8939-393939393939','40404040-4040-4040-8040-404040404040',NULL,0,0,'exact_endpoint_pair','documented',1.0,'{}'),
('78787878-7878-4878-8878-787878787878','68686868-6868-4868-8868-686868686868','33333333-aaaa-4333-8333-333333333333','route-atomic','R-ATOMIC','34343434-3434-4434-8434-343434343434','43434343-aaaa-4343-8343-434343434343',NULL,0,0,'exact_endpoint_pair','documented',1.0,'{}'),
('79797979-7979-4979-8979-797979797979','69696969-6969-4969-8969-696969696969','33333333-aaaa-4333-8333-333333333333','route-source-record','R-SOURCE','27272727-2727-4727-8727-272727272727','29292929-2929-4929-8929-292929292929',NULL,0,0,'exact_endpoint_pair','documented',1.0,'{}');

INSERT INTO taxi_route (
  id,association_id,origin_rank_id,destination_rank_id,origin_label,destination_label,
  route_name,geometry,geometry_status,verification_status,source_route_code
) VALUES
('81818181-8181-4181-8181-818181818181','21212121-2121-4212-8212-212121212121','34343434-3434-4434-8434-343434343434','35353535-3535-4535-8535-353535353535','Route Rank E','Route Rank F','Existing Code Route',ST_GeomFromText('MULTILINESTRING((29.00 -26.00,29.01 -26.01))',4326),'source_documented','documented','R-COLLIDE');

INSERT INTO source_record (
  id,source_id,entity_type,entity_id,external_record_id,source_payload,source_geometry,source_confidence
) VALUES
('82828282-8282-4282-8282-828282828282','33333333-aaaa-4333-8333-333333333333','taxi_route','81818181-8181-4181-8181-818181818181','route-source-record','{}',ST_GeomFromText('MULTILINESTRING((29.10 -26.00,29.11 -26.01))',4326),1.0);

INSERT INTO taxi_rank (
  id,canonical_name,aliases,province,municipality,town,address,google_place_id,location,verification_status
) VALUES
('90909090-9090-4090-8090-909090909090','Merged Central Rank',ARRAY['MCR'],'Gauteng','Merge City','Central','1 Merge Road','merge-place-1',ST_SetSRID(ST_MakePoint(28.1000,-26.1000),4326),'verified'),
('91919191-9191-4191-8191-919191919191','Old Central Taxi Rank',ARRAY['Old Central','OCR'],'Gauteng','Merge City','Central','1 Old Merge Road','merge-place-1',ST_SetSRID(ST_MakePoint(28.1002,-26.1001),4326),'documented'),
('92929292-9292-4292-8292-929292929292','Merge Route Peer',ARRAY[]::text[],'Gauteng','Merge City','Peer','2 Merge Road',NULL,ST_SetSRID(ST_MakePoint(28.1200,-26.1200),4326),'verified'),
('93939393-9393-4393-8393-939393939393','Google Conflict Survivor',ARRAY[]::text[],'Gauteng','Merge City','GC1',NULL,'google-a',ST_SetSRID(ST_MakePoint(28.2000,-26.2000),4326),'verified'),
('94949494-9494-4494-8494-949494949494','Google Conflict Duplicate',ARRAY[]::text[],'Gauteng','Merge City','GC2',NULL,'google-b',ST_SetSRID(ST_MakePoint(28.2001,-26.2001),4326),'verified'),
('95959595-9595-4595-8595-959595959595','Alias Collision Survivor',ARRAY[]::text[],'Gauteng','Merge City','AC1',NULL,NULL,ST_SetSRID(ST_MakePoint(28.3000,-26.3000),4326),'verified'),
('96969696-9696-4696-8696-969696969696','Alias Collision Duplicate',ARRAY['Third Party Alias'],'Gauteng','Merge City','AC2',NULL,NULL,ST_SetSRID(ST_MakePoint(28.3001,-26.3001),4326),'documented'),
('97979797-9797-4797-8797-979797979797','Third Party Alias',ARRAY[]::text[],'Gauteng','Merge City','Third',NULL,NULL,ST_SetSRID(ST_MakePoint(28.5000,-26.5000),4326),'verified'),
('98989898-9898-4898-8898-989898989898','Self Loop Survivor',ARRAY[]::text[],'Gauteng','Merge City','SL1',NULL,NULL,ST_SetSRID(ST_MakePoint(28.4000,-26.4000),4326),'verified'),
('99999998-9998-4998-8998-999999999998','Self Loop Duplicate',ARRAY[]::text[],'Gauteng','Merge City','SL2',NULL,NULL,ST_SetSRID(ST_MakePoint(28.4001,-26.4001),4326),'documented'),
('a1a1a1a1-a1a1-41a1-81a1-a1a1a1a1a1a1','Atomic Merge Survivor',ARRAY['AMS'],'Gauteng','Merge City','AT1',NULL,NULL,ST_SetSRID(ST_MakePoint(28.6000,-26.6000),4326),'verified'),
('a2a2a2a2-a2a2-42a2-82a2-a2a2a2a2a2a2','Atomic Merge Duplicate',ARRAY['AMD'],'Gauteng','Merge City','AT2',NULL,NULL,ST_SetSRID(ST_MakePoint(28.6001,-26.6001),4326),'documented'),
('a3a3a3a3-a3a3-43a3-83a3-a3a3a3a3a3a3','Concurrent Merge Survivor',ARRAY[]::text[],'Gauteng','Merge City','CC1',NULL,NULL,ST_SetSRID(ST_MakePoint(28.7000,-26.7000),4326),'verified'),
('a4a4a4a4-a4a4-44a4-84a4-a4a4a4a4a4a4','Concurrent Merge Duplicate',ARRAY['CMD'],'Gauteng','Merge City','CC2',NULL,NULL,ST_SetSRID(ST_MakePoint(28.7001,-26.7001),4326),'documented');

INSERT INTO taxi_rank_association (taxi_rank_id,association_id,verification_status,confidence) VALUES
('90909090-9090-4090-8090-909090909090','21212121-2121-4212-8212-212121212121','verified',NULL),
('91919191-9191-4191-8191-919191919191','21212121-2121-4212-8212-212121212121','documented',NULL),
('91919191-9191-4191-8191-919191919191','23232323-2323-4232-8232-232323232323','documented',NULL),
('a2a2a2a2-a2a2-42a2-82a2-a2a2a2a2a2a2','23232323-2323-4232-8232-232323232323','documented',NULL),
('a4a4a4a4-a4a4-44a4-84a4-a4a4a4a4a4a4','24242424-2424-4242-8242-242424242424','documented',NULL);

INSERT INTO taxi_route (
  id,association_id,origin_rank_id,destination_rank_id,origin_label,destination_label,
  route_name,geometry,geometry_status,verification_status,source_route_code
) VALUES
('b1b1b1b1-b1b1-41b1-81b1-b1b1b1b1b1b1','23232323-2323-4232-8232-232323232323','91919191-9191-4191-8191-919191919191','92929292-9292-4292-8292-929292929292','Old Central','Peer','Merge Redirect Route',ST_GeomFromText('MULTILINESTRING((28.1002 -26.1001,28.1200 -26.1200))',4326),'source_documented','documented','MERGE-R1'),
('b2b2b2b2-b2b2-42b2-82b2-b2b2b2b2b2b2','21212121-2121-4212-8212-212121212121','98989898-9898-4898-8898-989898989898','99999998-9998-4998-8998-999999999998','SL1','SL2','Self Loop Conflict',ST_GeomFromText('MULTILINESTRING((28.4000 -26.4000,28.4001 -26.4001))',4326),'source_documented','documented','SL-CONFLICT'),
('b3b3b3b3-b3b3-43b3-83b3-b3b3b3b3b3b3','23232323-2323-4232-8232-232323232323','a2a2a2a2-a2a2-42a2-82a2-a2a2a2a2a2a2','92929292-9292-4292-8292-929292929292','AT2','Peer','Atomic Merge Route',ST_GeomFromText('MULTILINESTRING((28.6001 -26.6001,28.1200 -26.1200))',4326),'source_documented','documented','AT-MERGE'),
('b4b4b4b4-b4b4-44b4-84b4-b4b4b4b4b4b4','24242424-2424-4242-8242-242424242424','a4a4a4a4-a4a4-44a4-84a4-a4a4a4a4a4a4','92929292-9292-4292-8292-929292929292','CC2','Peer','Concurrent Merge Route',ST_GeomFromText('MULTILINESTRING((28.7001 -26.7001,28.1200 -26.1200))',4326),'source_documented','documented','CC-MERGE');

INSERT INTO rank_association_candidate (
  id,source_id,source_rank_external_id,taxi_rank_id,association_label,normalized_label,verification_status
) VALUES
('c1c1c1c1-c1c1-41c1-81c1-c1c1c1c1c1c1','31313131-3131-4131-8131-313131313131','merge-old-alpha','91919191-9191-4191-8191-919191919191','Alpha Taxi Association','alpha taxi association','documented');

INSERT INTO rank_destination_candidate (
  id,source_id,source_rank_external_id,taxi_rank_id,destination_label,normalized_label,verification_status
) VALUES
('c2c2c2c2-c2c2-42c2-82c2-c2c2c2c2c2c2','31313131-3131-4131-8131-313131313131','merge-old-dest','91919191-9191-4191-8191-919191919191','Peer','peer','documented');

INSERT INTO source_record (
  id,source_id,entity_type,entity_id,external_record_id,source_payload,source_confidence
) VALUES
('c3c3c3c3-c3c3-43c3-83c3-c3c3c3c3c3c3','31313131-3131-4131-8131-313131313131','taxi_rank','91919191-9191-4191-8191-919191919191','merge-old-source','{"name":"Old Central Taxi Rank"}',1.0);

INSERT INTO data_issue (id,entity_type,entity_id,issue_type,severity,summary,status) VALUES
('c4c4c4c4-c4c4-44c4-84c4-c4c4c4c4c4c4','taxi_rank','91919191-9191-4191-8191-919191919191','merge-review','warning','Issue follows survivor','open'),
('c5c5c5c5-c5c5-45c5-85c5-c5c5c5c5c5c5','taxi_rank','a2a2a2a2-a2a2-42a2-82a2-a2a2a2a2a2a2','atomic-merge-review','warning','Atomic merge issue','open');

TRUNCATE data_issue;
INSERT INTO data_issue (id,entity_type,issue_type,severity,summary,status) VALUES
('11111111-1111-4111-8111-111111111111','taxi_rank','proof_open','warning','Open proof issue','open'),
('22222222-2222-4222-8222-222222222222','taxi_rank','proof_reviewing','warning','Reviewing proof issue','reviewing'),
('33333333-3333-4333-8333-333333333333','taxi_rank','proof_atomic','warning','Atomic rollback proof issue','open'),
('44444444-4444-4444-8444-444444444444','taxi_rank','proof_concurrent','warning','Concurrent replay proof issue','open'),
('55555555-5555-4555-8555-555555555555','taxi_rank','proof_reject','warning','Reject proof issue','open'),
('66666666-6666-4666-8666-666666666666','taxi_rank','proof_reopen_defer','warning','Reopen deferred proof issue','reviewing'),
('77777777-7777-4777-8777-777777777777','taxi_rank','proof_reopen_reject','warning','Reopen rejected proof issue','open'),
('88888888-8888-4888-8888-888888888888','taxi_rank','proof_reject_atomic','warning','Reject rollback proof issue','open'),
('99999999-9999-4999-8999-999999999999','taxi_rank','proof_reopen_atomic','warning','Reopen rollback proof issue','open'),
('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','taxi_rank','proof_dual_approve','warning','Dual-control approval proof issue','open'),
('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','taxi_rank','proof_dual_self','warning','Self-approval denial proof issue','open'),
('cccccccc-cccc-4ccc-8ccc-cccccccccccc','taxi_rank','proof_dual_stale','warning','Stale proposal proof issue','open'),
('dddddddd-dddd-4ddd-8ddd-dddddddddddd','taxi_rank','proof_dual_reject','warning','Proposal reject proof issue','open'),
('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','taxi_rank','proof_dual_withdraw','warning','Proposal withdraw proof issue','reviewing'),
('ffffffff-ffff-4fff-8fff-ffffffffffff','taxi_rank','proof_dual_atomic','warning','Proposal approval rollback proof issue','open'),
('12121212-1212-4212-8212-121212121212','taxi_rank','proof_dual_concurrent','warning','Concurrent dual-approval proof issue','open'),
('13131313-1313-4313-8313-131313131313','taxi_rank','proof_dual_idempotency_conflict','warning','Proposal idempotency conflict proof issue','open'),
('c4c4c4c4-c4c4-44c4-84c4-c4c4c4c4c4c4','taxi_rank','91919191-9191-4191-8191-919191919191','merge-review','warning','Issue follows survivor','open',now(),NULL),
('c5c5c5c5-c5c5-45c5-85c5-c5c5c5c5c5c5','taxi_rank','a2a2a2a2-a2a2-42a2-82a2-a2a2a2a2a2a2','atomic-merge-review','warning','Atomic merge issue','open',now(),NULL);
SQL
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f /proof/005_operator_audit.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f /proof/006_data_issue_rejected_status.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f /proof/007_two_person_decision_proposals.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f /proof/008_transport_entity_aliases.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f /proof/009_rank_association_promotions.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f /proof/010_route_candidate_promotions.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f /proof/011_taxi_rank_merge_foundation.sql
echo "TN7_ADJ7_DB_SETUP_PASS"
sleep 8
