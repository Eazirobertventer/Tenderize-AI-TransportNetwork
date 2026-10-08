import fs from 'node:fs';
import pg from 'pg';
const {Pool}=pg;
const pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:false,max:2});
if(!process.env.DATABASE_URL) throw new Error('DATABASE_URL required');

for(let i=1;i<=12;i++){
  const p='db/'+String(i).padStart(3,'0')+'_';
  const name=fs.readdirSync('db').find(f=>f.startsWith(String(i).padStart(3,'0')+'_') && f.endsWith('.sql'));
  if(!name) throw new Error('migration_missing_'+i);
  await pool.query(fs.readFileSync('db/'+name,'utf8'));
  console.log('PASS migration '+name);
}

const source='11111111-1111-4111-8111-111111111111';
const ranks=[
 ['10101010-1010-4010-8010-101010101010','ADJ8 Rank One'],
 ['20202020-2020-4020-8020-202020202020','ADJ8 Rank Two'],
 ['30303030-3030-4030-8030-303030303030','ADJ8 Rank Three']
];
await pool.query(`INSERT INTO source_registry(id,source_key,source_name,source_class,official)
VALUES($1,'tn7-adj8-fixture','TN7 ADJ8 Fixture','community',false)`,[source]);
for(const [id,name] of ranks){
  await pool.query(`INSERT INTO taxi_rank(id,canonical_name,province,verification_status)
  VALUES($1,$2,'Gauteng','documented')`,[id,name]);
}

const associations=[
 ['aaaaaaaa-0001-4001-8001-000000000001','Alpha Taxi Association','ALPHA','REG-ALPHA',ARRAY['Alpha Legacy']],
 ['aaaaaaaa-0002-4002-8002-000000000002','Old Alpha Taxi Association','OLD',null,ARRAY['Old Alpha Legacy']],
 ['aaaaaaaa-0003-4003-8003-000000000003','Independent Association','IND',null,[]],
 ['aaaaaaaa-0004-4004-8004-000000000004','Registration Survivor','RS','REG-ONE',[]],
 ['aaaaaaaa-0005-4005-8005-000000000005','Registration Duplicate','RD','REG-TWO',[]],
 ['aaaaaaaa-0006-4006-8006-000000000006','Route Survivor','RTS',null,[]],
 ['aaaaaaaa-0007-4007-8007-000000000007','Route Duplicate','RTD',null,[]],
 ['aaaaaaaa-0008-4008-8008-000000000008','Stale Survivor','SS',null,[]],
 ['aaaaaaaa-0009-4009-8009-000000000009','Stale Duplicate','SD',null,[]],
 ['aaaaaaaa-0010-4010-8010-000000000010','Concurrent Survivor','CS',null,[]],
 ['aaaaaaaa-0011-4011-8011-000000000011','Concurrent Duplicate','CD',null,[]],
 ['aaaaaaaa-0012-4012-8012-000000000012','Atomic Survivor','AS',null,[]],
 ['aaaaaaaa-0013-4013-8013-000000000013','Atomic Duplicate','AD',null,[]],
 ['aaaaaaaa-0014-4014-8014-000000000014','Alias Survivor','ALS',null,[]],
 ['aaaaaaaa-0015-4015-8015-000000000015','Alias Duplicate','ALD',null,ARRAY['Collision Association']],
 ['aaaaaaaa-0016-4016-8016-000000000016','Collision Association','COL',null,[]]
];
for(const a of associations){
  await pool.query(`INSERT INTO taxi_association(id,canonical_name,acronym,registration_number,aliases,province,verification_status)
  VALUES($1,$2,$3,$4,$5::text[],'Gauteng','documented')`,a);
}

const A={validS:associations[0][0],validD:associations[1][0],regS:associations[3][0],regD:associations[4][0],
 routeS:associations[5][0],routeD:associations[6][0],staleS:associations[7][0],staleD:associations[8][0],
 concS:associations[9][0],concD:associations[10][0],atomicS:associations[11][0],atomicD:associations[12][0],
 aliasS:associations[13][0],aliasD:associations[14][0]};
const [r1,r2,r3]=ranks.map(x=>x[0]);

// Valid merge graph: one overlapping and one non-overlapping relationship.
await pool.query(`INSERT INTO taxi_rank_association(taxi_rank_id,association_id,verification_status)
VALUES ($1,$2,'verified'),($1,$3,'verified'),($4,$3,'verified')`,[r1,A.validS,A.validD,r2]);
await pool.query(`INSERT INTO taxi_route(id,association_id,origin_rank_id,destination_rank_id,origin_label,destination_label,route_name,verification_status)
VALUES('bbbbbbbb-0001-4001-8001-000000000001',$1,$2,$3,'R2','R3','ADJ8 Valid Route','documented')`,[A.validD,r2,r3]);

await pool.query(`INSERT INTO data_issue(id,entity_type,entity_id,issue_type,severity,summary,status)
VALUES
('cccccccc-0001-4001-8001-000000000001','taxi_association',$1,'identity','warning','Active issue moves','open'),
('cccccccc-0002-4002-8002-000000000002','taxi_association',$1,'history','info','Resolved issue stays','resolved')`,[A.validD]);
await pool.query(`INSERT INTO source_record(id,source_id,entity_type,entity_id,external_record_id,source_payload)
VALUES('dddddddd-0001-4001-8001-000000000001',$1,'taxi_association',$2,'old-alpha','{"source":"fixture"}')`,[source,A.validD]);

// Projected duplicate route conflict.
await pool.query(`INSERT INTO taxi_route(id,association_id,origin_rank_id,destination_rank_id,origin_label,destination_label,route_name,verification_status)
VALUES
('bbbbbbbb-0002-4002-8002-000000000002',$1,$3,$4,'R1','R2','Survivor duplicate-key route','documented'),
('bbbbbbbb-0003-4003-8003-000000000003',$2,$3,$4,'R1','R2','Duplicate duplicate-key route','documented')`,
[A.routeS,A.routeD,r1,r2]);

// Stale and atomic graphs each have active data.
await pool.query(`INSERT INTO data_issue(id,entity_type,entity_id,issue_type,severity,summary,status)
VALUES
('cccccccc-0003-4003-8003-000000000003','taxi_association',$1,'stale','warning','Stale graph issue','open'),
('cccccccc-0004-4004-8004-000000000004','taxi_association',$2,'atomic','warning','Atomic rollback issue','open')`,
[A.staleD,A.atomicD]);
await pool.query(`INSERT INTO taxi_rank_association(taxi_rank_id,association_id,verification_status)
VALUES($1,$2,'verified')`,[r3,A.atomicD]);
await pool.query(`INSERT INTO taxi_route(id,association_id,origin_rank_id,destination_rank_id,origin_label,destination_label,route_name,verification_status)
VALUES('bbbbbbbb-0004-4004-8004-000000000004',$1,$2,$3,'R3','R1','Atomic route','documented')`,[A.atomicD,r3,r1]);

console.log('TN7_ADJ8_DB_SETUP_PASS');
await pool.end();
