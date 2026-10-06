# Data source registry — initial connected sources

## City of Ekurhuleni Taxi Ranks

- Authority: City of Ekurhuleni
- Type: official ArcGIS Feature Layer
- Entity: taxi ranks
- Endpoint: `https://gis.ekurhuleni.gov.za/arcgis/rest/services/Ekurhuleni/Ekurhuleni_POI_Map/MapServer/24`
- Useful fields include `TAXI_FACIL`, `REGION`, `LATITUDE`, `LONGITUDE`, `TYPE`, `OWNERSHIP`, `SUBURB`, `TOWN`, up to ten association fields and multiple destination fields.
- Production treatment: official source; preserve the original record as lineage and split repeated association/destination columns into relational records during reconciliation.

## City of Cape Town Taxi Routes

- Authority: City of Cape Town / Western Cape Government
- Type: official ArcGIS Feature Layer
- Entity: taxi route geometry
- Endpoint: `https://citymaps.capetown.gov.za/agsext/rest/services/Theme_Based/Transport/MapServer/5`
- Fields: `OBJECTID`, `ORGN`, `DSTN`, route geometry.
- Production treatment: official geometry. Origin and destination strings still require rank resolution rather than automatic name-based attachment.

## KwaZulu-Natal Taxi Routes

- Authority: KwaZulu-Natal Department of Transport
- Type: ArcGIS Feature Layer
- Entity: route geometry
- Endpoint: `https://gis1.kzntransport.gov.za/arcgisserver/rest/services/KZN_Schools_Health_Facilities/MapServer/7`
- Fields include `OBJECTID`, `ID`, `KZNBRCD` and geometry.
- The surfaced layer is legacy/old data; ingest as documented/legacy evidence, not as proof of current route operation.

## NLTIS / OLAS

Use as the principal source for association identity, registration information, operating-route relationships, route codes and route descriptions where obtainable. The initial prototype includes only documented examples and does not scrape or bulk copy the system.

## Google Places

Use for Place-ID/address/location verification and user navigation links. Google-derived content is enrichment and must comply with Google Maps Platform storage/caching terms. Do not use it as a bulk mirrored national database.
