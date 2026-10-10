import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { createAliasProposal } from '../transport-api/src/operator-proposals.mjs';

const {Pool}=pg;
const evidence=JSON.parse(
  await readFile(new URL('./tn7-national-21-evidence.json',import.meta.url),'utf8')
);

async function inventory(pool){
  const r=await pool.query(`
    SELECT
      (SELECT count(*)::int FROM taxi_rank) AS ranks,
      (SELECT count(*)::int FROM taxi_association) AS associations,
      (SELECT count(*)::int FROM taxi_route) AS routes,
      (SELECT count(*)::int FROM rank_association_candidate) AS rank_association_candidates,
      (SELECT count(*)::int FROM route_candidate) AS route_candidates
  `);
  return r.rows[0];
}

export async function executeNational21AliasProposal({
  pool,
  execute=false,
  actor={
    subject:'tn7-national21-source-recovery-review',
    displayName:'TN7 NATIONAL-21 Source Recovery Review',
    roles:['reviewer']
  }
}={}){
  if(!pool) throw new Error('pool_required');

  const before=await inventory(pool);
  const spec={
    entityType:'taxi_rank',
    entityId:evidence.mbazwana.targetRankId,
    alias:evidence.mbazwana.proposedAlias,
    actor,
    idempotencyKey:'tn7-national21-mbazwana-rank-alias',
    rationale:'TN7-NATIONAL-21: municipal taxi-rank evidence and official KZN DoT rank geometry indicate Mbazwana Taxi Rank is a likely identity alias for KRPUMD002; proposal only, independent approval required.',
    evidence:{
      gate:'TN7-NATIONAL-21',
      sourceGate:'TN7-NATIONAL-20',
      mbazwana:evidence.mbazwana,
      automaticApproval:false,
      canonicalMutation:false
    }
  };

  if(!execute){
    return {
      mode:'tn7_national_21_mbazwana_rank_alias_proposal',
      execution:'dry_run',
      before,
      spec:{
        entityType:spec.entityType,
        entityId:spec.entityId,
        alias:spec.alias,
        idempotencyKey:spec.idempotencyKey
      },
      policy:{
        proposalOnly:true,
        automaticApproval:false,
        canonicalMutation:false,
        twoPersonControlRequired:true
      }
    };
  }

  const result=await createAliasProposal(pool,spec);
  const after=await inventory(pool);

  return {
    mode:'tn7_national_21_mbazwana_rank_alias_proposal',
    execution:'proposal_create',
    before,
    after,
    canonicalInventoryUnchanged:JSON.stringify(before)===JSON.stringify(after),
    result:{
      status:result.status,
      replay:Boolean(result.payload?.replay),
      error:result.payload?.error||null,
      proposal:result.payload?.proposal||null
    },
    policy:{
      proposalOnly:true,
      automaticApproval:false,
      canonicalMutation:false,
      twoPersonControlRequired:true
    }
  };
}

if(import.meta.url===`file://${process.argv[1]}`){
  if(!process.env.DATABASE_URL) throw new Error('DATABASE_URL required');
  const pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:false,max:2});
  try{
    const result=await executeNational21AliasProposal({
      pool,
      execute:process.env.NATIONAL21_EXECUTE_ALIAS_PROPOSAL==='true'
    });
    console.log(JSON.stringify({event:'tn7_national_21_alias_result',...result}));
    if(result.execution==='proposal_create'){
      const p=result.result?.proposal;
      const ok=
        [200,201].includes(result.result.status) &&
        p?.action==='taxi_rank.alias.add' &&
        p?.targetEntityId===evidence.mbazwana.targetRankId &&
        p?.intendedChange?.alias===evidence.mbazwana.proposedAlias &&
        p?.status==='proposed' &&
        result.canonicalInventoryUnchanged;
      if(!ok) process.exitCode=1;
    }
  }finally{
    await pool.end();
  }
}
