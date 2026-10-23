BEGIN;

INSERT INTO source_registry (
  source_key,source_name,authority,source_class,source_url,coverage,licence_note,official,legacy,last_checked_at
) VALUES
(
  'kzn-gazette-lawlibrary-mirror',
  'KwaZulu-Natal Provincial Gazette — LawLibrary retrieval mirror',
  'KwaZulu-Natal Provincial Gazette / Government Printing Works',
  'provincial_transport',
  'https://media.lawlibrary.org.za/',
  'KwaZulu-Natal Provincial Gazette documents used for transport operating-licence evidence',
  'Retrieval mirror only; issuing authority remains KwaZulu-Natal Provincial Gazette / Government Printing Works',
  false,false,now()
),
(
  'kzn-gazette-uthukela-mirror',
  'KwaZulu-Natal Provincial Gazette — uThukela retrieval mirror',
  'KwaZulu-Natal Provincial Gazette / Government Printing Works',
  'provincial_transport',
  'https://www.uthukela.gov.za/',
  'KwaZulu-Natal Provincial Gazette documents used for transport operating-licence evidence',
  'Retrieval mirror only; issuing authority remains KwaZulu-Natal Provincial Gazette / Government Printing Works',
  false,false,now()
)
ON CONFLICT (source_key) DO UPDATE SET
  source_name=EXCLUDED.source_name,
  authority=EXCLUDED.authority,
  source_class=EXCLUDED.source_class,
  source_url=EXCLUDED.source_url,
  coverage=EXCLUDED.coverage,
  licence_note=EXCLUDED.licence_note,
  official=EXCLUDED.official,
  legacy=EXCLUDED.legacy,
  last_checked_at=now(),
  updated_at=now();

COMMIT;
