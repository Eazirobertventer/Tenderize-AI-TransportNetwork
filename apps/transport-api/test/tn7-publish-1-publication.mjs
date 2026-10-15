import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createServer } from 'node:http';
import pg from 'pg';

import { handleMobileDiscoveryPublication, MOBILE_DISCOVERY_PUBLICATION_PATH } from '../src/mobile-discovery-route.mjs';
import { validateTransportDiscoveryDocument } from '../src/mobile-discovery-contract.mjs';

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

function b64(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function jwt(payload, secret) {
  const head = b64({ alg: 'HS256', typ: 'JWT' });
  const body = b64(payload);
  const sig = createHmac('sha256', secret).update(head + '.' + body).digest('base64url');
  return head + '.' + body + '.' + sig;
}

const discoverySecret = process.env.DISCOVERY_JWT_SECRET || 'ci-discovery-secret-00000000000000000000000000000000';
const env = {
  DISCOVERY_JWT_SECRET: discoverySecret,
  DISCOVERY_JWT_ISSUER: process.env.DISCOVERY_JWT_ISSUER || 'tenderize-iam',
  DISCOVERY_JWT_AUDIENCE: process.env.DISCOVERY_JWT_AUDIENCE || 'transport-network-discovery'
};

const ids = {
  association: '10000000-0000-4000-8000-000000000001',
  associationBad: '10000000-0000-4000-8000-000000000002',
  origin: '20000000-0000-4000-8000-000000000001',
  destination: '20000000-0000-4000-8000-000000000002',
  noCoordinate: '20000000-0000-4000-8000-000000000003',
  sameLabel1: '20000000-0000-4000-8000-000000000004',
  sameLabel2: '20000000-0000-4000-8000-000000000005',
  conflict: '20000000-0000-4000-8000-000000000006',
  invalidCoordinate: '20000000-0000-4000-8000-000000000007',
  oneSided: '20000000-0000-4000-8000-000000000008',
  route1: '30000000-0000-4000-8000-000000000001',
  route2: '30000000-0000-4000-8000-000000000002',
  route3: '30000000-0000-4000-8000-000000000003',
  routeConflict: '30000000-0000-4000-8000-000000000004',
  routeInvalidCoordinate: '30000000-0000-4000-8000-000000000005',
  routeOneSided: '30000000-0000-4000-8000-000000000006',
  routeLegacy: '30000000-0000-4000-8000-000000000007',
  source: '40000000-0000-4000-8000-000000000001'
};

async function seedBase() {
  await pool.query(
    `INSERT INTO source_registry (id,source_key,source_name,source_class,official)
     VALUES ($1,'tn7-publish-test','TN7 Publish Test','official_gis',true)`,
    [ids.source]
  );

  await pool.query(
    `INSERT INTO taxi_association (id,canonical_name,verification_status)
     VALUES
       ($1,'Example Taxi Association','verified'),
       ($2,'Unverified Association','unverified')`,
    [ids.association, ids.associationBad]
  );

  await pool.query(
    `INSERT INTO taxi_rank (id,canonical_name,aliases,town,location,verification_status)
     VALUES
       ($1,'ORIGIN CANONICAL',ARRAY['Origin Rank'],'Durban',ST_SetSRID(ST_MakePoint(31.0218,-29.8587),4326),'verified'),
       ($2,'DESTINATION CANONICAL',ARRAY['Destination Rank'],'Pinetown',ST_SetSRID(ST_MakePoint(30.8570,-29.8166),4326),'verified'),
       ($3,'NO COORDINATE',ARRAY['No Coordinate Rank'],'Umlazi',NULL,'documented'),
       ($4,'MARKET CANONICAL A',ARRAY['Market Rank'],'Durban',ST_SetSRID(ST_MakePoint(31.01,-29.85),4326),'verified'),
       ($5,'MARKET CANONICAL B',ARRAY['Market Rank'],'Durban',ST_SetSRID(ST_MakePoint(31.02,-29.86),4326),'verified'),
       ($6,'CONFLICT RANK',ARRAY['Conflict Rank'],'Durban',ST_SetSRID(ST_MakePoint(31.03,-29.87),4326),'conflict'),
       ($7,'INVALID COORDINATE',ARRAY['Invalid Coordinate'],'Durban',ST_SetSRID(ST_MakePoint(31.04,95),4326),'verified'),
       ($8,'ONE SIDED',ARRAY['One Sided Rank'],'Durban',ST_SetSRID(ST_MakePoint(31.05,-29.88),4326),'verified')`,
    [ids.origin,ids.destination,ids.noCoordinate,ids.sameLabel1,ids.sameLabel2,ids.conflict,ids.invalidCoordinate,ids.oneSided]
  );

  for (const rankId of [ids.origin,ids.destination,ids.noCoordinate,ids.sameLabel1,ids.sameLabel2,ids.conflict,ids.invalidCoordinate]) {
    await pool.query(
      `INSERT INTO taxi_rank_association (taxi_rank_id,association_id,verification_status,confidence)
       VALUES ($1,$2,'verified',1)`,
      [rankId,ids.association]
    );
  }

  await pool.query(
    `INSERT INTO taxi_rank_association (taxi_rank_id,association_id,verification_status,confidence)
     VALUES ($1,$2,'verified',1)`,
    [ids.oneSided,ids.associationBad]
  );
}

async function seedApprovedRoute({ routeId, originRankId, destinationRankId, routeCode = null, routeName = null }) {
  const suffix = routeId.slice(-12);
  const geometryId = '50000000-0000-4000-8000-' + suffix;
  const candidateId = '60000000-0000-4000-8000-' + suffix;
  const sourceRecordId = '70000000-0000-4000-8000-' + suffix;
  const auditId = '80000000-0000-4000-8000-' + suffix;
  const proposalId = '90000000-0000-4000-8000-' + suffix;
  const promotionId = 'a0000000-0000-4000-8000-' + suffix;

  await pool.query(
    `INSERT INTO source_route_geometry (
       id,source_id,external_record_id,route_code,geometry,verification_status,source_payload
     ) VALUES (
       $1,$2,$3,$4,ST_GeomFromText('MULTILINESTRING((31 -29.8,31.1 -29.9))',4326),'verified','{}'::jsonb
     )`,
    [geometryId,ids.source,'geom-'+suffix,routeCode]
  );

  await pool.query(
    `INSERT INTO route_candidate (
       id,source_route_geometry_id,source_id,external_record_id,route_code,
       origin_rank_id,destination_rank_id,association_id,origin_distance_m,destination_distance_m,
       reconciliation_status,verification_status,confidence
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,0,0,'exact_endpoint_pair','verified',1)`,
    [candidateId,geometryId,ids.source,'candidate-'+suffix,routeCode,originRankId,destinationRankId,ids.association]
  );

  await pool.query(
    `INSERT INTO taxi_route (
       id,association_id,origin_rank_id,destination_rank_id,origin_label,destination_label,
       route_name,national_route_code,board_route_code,source_route_code,verification_status
     ) VALUES ($1,$2,$3,$4,'Origin','Destination',$5,$6,'BOARD-1','SRC-1','verified')`,
    [routeId,ids.association,originRankId,destinationRankId,routeName,routeCode]
  );

  await pool.query(
    `INSERT INTO source_record (
       id,source_id,entity_type,entity_id,external_record_id,source_payload
     ) VALUES ($1,$2,'taxi_route',$3,$4,'{}'::jsonb)`,
    [sourceRecordId,ids.source,routeId,'route-'+suffix]
  );

  await pool.query(
    `INSERT INTO operator_audit_event (
       id,actor_subject,actor_role,action,entity_type,entity_id,request_id,idempotency_key
     ) VALUES ($1,'approver','approver','decision_proposal.approve','operator_decision_proposal',$2,'publish-test',$3)`,
    [auditId,proposalId,'audit-'+suffix]
  );

  await pool.query(
    `INSERT INTO operator_decision_proposal (
       id,action,target_entity_type,target_entity_id,intended_change,before_state,before_state_hash,
       evidence,rationale,proposer_subject,proposer_role,proposal_idempotency_key,status,
       decision_actor_subject,decision_actor_role,decision_rationale,decision_evidence,
       decision_idempotency_key,decided_at,approved_audit_event_id
     ) VALUES (
       $1,'taxi_route.promote','route_candidate',$2,'{}'::jsonb,'{}'::jsonb,
       repeat('a',64),'{}'::jsonb,'approved for publication test','reviewer','reviewer',$3,'approved',
       'approver','approver','approved for publication test','{}'::jsonb,$4,now(),$5
     )`,
    [proposalId,candidateId,'proposal-'+suffix,'decision-'+suffix,auditId]
  );

  await pool.query(
    `INSERT INTO route_candidate_promotion (
       id,candidate_id,source_route_geometry_id,route_id,source_record_id,
       promoted_by_proposal_id,promoted_audit_event_id
     ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [promotionId,candidateId,geometryId,routeId,sourceRecordId,proposalId,auditId]
  );

  await pool.query('UPDATE source_route_geometry SET promoted_route_id=$1 WHERE id=$2',[routeId,geometryId]);
}

async function httpProof() {
  const server = createServer((req,res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname === MOBILE_DISCOVERY_PUBLICATION_PATH) {
      void handleMobileDiscoveryPublication({ req,res,url,pool,env,now:()=>new Date('2026-10-11T12:00:00.000Z') });
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  const address = server.address();
  const origin = 'http://127.0.0.1:' + address.port;
  const now = Math.floor(new Date('2026-10-11T12:00:00.000Z').getTime()/1000);
  const token = jwt({
    iss:'tenderize-iam',
    aud:'transport-network-discovery',
    sub:'mobile-bff-test',
    scope:'transport.discovery.read',
    iat:now-1,
    exp:now+300
  },discoverySecret);

  try {
    const response = await fetch(origin + MOBILE_DISCOVERY_PUBLICATION_PATH,{
      headers:{authorization:'Bearer '+token}
    });
    assert.equal(response.status,200);
    assert.equal(response.headers.get('access-control-allow-origin'),null);
    const body = await response.json();
    assert.equal(validateTransportDiscoveryDocument(body).ok,true);
    assert.deepEqual(body.routes.map(item=>item.routeId),[ids.route1,ids.route2,ids.route3].sort());

    const first = body.routes.find(item=>item.routeId===ids.route1);
    assert.equal(first.routeCode,'NAT-1');
    assert.deepEqual(first.originRank.coordinate,{latitude:-29.8587,longitude:31.0218});

    const noCoordinate = body.routes.find(item=>item.routeId===ids.route2);
    assert.equal('coordinate' in noCoordinate.destinationRank,false);

    const market = body.routes.find(item=>item.routeId===ids.route3);
    assert.equal(market.originRank.name,'Market Rank');
    assert.equal(market.destinationRank.name,'Market Rank');
    assert.notEqual(market.originRank.rankId,market.destinationRank.rankId);

    const queryToken = await fetch(origin + MOBILE_DISCOVERY_PUBLICATION_PATH + '?token=' + encodeURIComponent(token),{
      headers:{authorization:'Bearer '+token}
    });
    assert.equal(queryToken.status,401);
  } finally {
    await new Promise(resolve=>server.close(resolve));
  }
}

try {
  await seedBase();
  await seedApprovedRoute({routeId:ids.route1,originRankId:ids.origin,destinationRankId:ids.destination,routeCode:'NAT-1',routeName:'Origin to Destination'});
  await seedApprovedRoute({routeId:ids.route2,originRankId:ids.origin,destinationRankId:ids.noCoordinate});
  await seedApprovedRoute({routeId:ids.route3,originRankId:ids.sameLabel1,destinationRankId:ids.sameLabel2});

  await seedApprovedRoute({routeId:ids.routeConflict,originRankId:ids.origin,destinationRankId:ids.conflict});
  await seedApprovedRoute({routeId:ids.routeInvalidCoordinate,originRankId:ids.origin,destinationRankId:ids.invalidCoordinate});
  await seedApprovedRoute({routeId:ids.routeOneSided,originRankId:ids.origin,destinationRankId:ids.oneSided});

  await pool.query(
    `INSERT INTO taxi_route (id,association_id,origin_rank_id,destination_rank_id,origin_label,destination_label,verification_status)
     VALUES ($1,$2,$3,$4,'Origin','Destination','verified')`,
    [ids.routeLegacy,ids.association,ids.origin,ids.destination]
  );

  const before = Number((await pool.query('SELECT count(*)::int AS count FROM taxi_route')).rows[0].count);
  await httpProof();
  const after = Number((await pool.query('SELECT count(*)::int AS count FROM taxi_route')).rows[0].count);
  assert.equal(after,before);

  console.log('TN7-PUBLISH-1 disposable PostGIS publication PASS');
} finally {
  await pool.end();
}
