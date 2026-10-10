import { readFile } from 'node:fs/promises';
import pg from 'pg';

const {Pool}=pg;
const migrations=[
  '../../../db/005_operator_audit.sql',
  '../../../db/007_two_person_decision_proposals.sql',
  '../../../db/008_transport_entity_aliases.sql',
  '../../../db/013_controlled_association_creation.sql'
];

if(!process.env.DATABASE_URL) throw new Error('DATABASE_URL required');
if(process.env.NATIONAL15_APPLY_SCHEMA!=='true') throw new Error('NATIONAL15_APPLY_SCHEMA must be true');

const pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:false,max:1});
const client=await pool.connect();

async function inventory(){
  const r=await client.query(`
    SELECT
      (SELECT count(*)::int FROM taxi_rank) AS ranks,
      (SELECT count(*)::int FROM taxi_association) AS associations,
      (SELECT count(*)::int FROM taxi_route) AS routes,
      (SELECT count(*)::int FROM rank_association_candidate) AS rank_association_candidates,
      (SELECT count(*)::int FROM route_candidate) AS route_candidates
  `);
  return r.rows[0];
}

try{
  const before=await inventory();
  const applied=[];
  for(const relative of migrations){
    const sql=await readFile(new URL(relative,import.meta.url),'utf8');
    await client.query(sql);
    applied.push(relative.split('/').pop());
  }
  const after=await inventory();
  const preflight=(await client.query(`
    SELECT
      EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='operator_audit_event') AS audit_table,
      EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='operator_decision_proposal') AS proposal_table,
      EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='transport_entity_alias') AS alias_table,
      to_regprocedure('normalize_transport_identity_name(text)') IS NOT NULL AS normalize_function,
      EXISTS(
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='operator_decision_proposal'
          AND column_name='target_entity_id' AND is_nullable='YES'
      ) AS nullable_target,
      EXISTS(SELECT 1 FROM pg_constraint WHERE conname='proposal_target_identity_consistent') AS target_constraint
  `)).rows[0];
  const canonicalInventoryUnchanged=JSON.stringify(before)===JSON.stringify(after);
  console.log(JSON.stringify({
    event:'TN7_NATIONAL_15_SCHEMA_APPLY_PASS',
    applied,
    before,
    after,
    canonicalInventoryUnchanged,
    preflight
  }));
  if(!canonicalInventoryUnchanged || Object.values(preflight).some(v=>v!==true)) process.exitCode=1;
}finally{
  client.release();
  await pool.end();
}
