import { createHash, randomUUID } from 'node:crypto';
import pg from 'pg';
import { createTaxiAssociationCreateProposal } from '../transport-api/src/operator-proposals.mjs';

const {Pool}=pg;

function keyFor(label){
  return 'tn7-national15-'+createHash('sha256')
    .update(String(label).normalize('NFKC').toLowerCase().trim())
    .digest('hex')
    .slice(0,40);
}

async function canonicalInventory(pool){
  const result=await pool.query(`
    SELECT
      (SELECT count(*)::int FROM taxi_rank) AS ranks,
      (SELECT count(*)::int FROM taxi_association) AS associations,
      (SELECT count(*)::int FROM taxi_route) AS routes,
      (SELECT count(*)::int FROM rank_association_candidate) AS rank_association_candidates,
      (SELECT count(*)::int FROM route_candidate) AS route_candidates
  `);
  return result.rows[0];
}

async function proposalSchemaPreflight(pool){
  const result=await pool.query(`
    SELECT
      EXISTS(
        SELECT 1 FROM information_schema.tables
        WHERE table_schema='public' AND table_name='operator_decision_proposal'
      ) AS proposal_table,
      EXISTS(
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public'
          AND table_name='operator_decision_proposal'
          AND column_name='target_entity_id'
          AND is_nullable='YES'
      ) AS nullable_target,
      EXISTS(
        SELECT 1 FROM pg_constraint
        WHERE conname='proposal_target_identity_consistent'
      ) AS target_constraint
  `);
  return result.rows[0];
}

async function fetchResolution(url){
  const response=await fetch(url,{headers:{accept:'application/json'}});
  if(!response.ok) throw new Error('identity_resolution_fetch_failed:'+response.status);
  return response.json();
}

export async function executeNational15({
  pool,
  resolution,
  execute=false,
  actor={
    subject:'tn7-national15-controlled-batch',
    displayName:'TN7 NATIONAL-15 Controlled Batch',
    roles:['reviewer']
  }
}={}){
  if(!pool) throw new Error('pool_required');
  if(!resolution) throw new Error('identity_resolution_required');

  const candidates=(resolution.items||[]).filter(item=>
    item.controlledOutcome?.state==='canonical_creation_candidate' &&
    item.resolution?.status==='canonical_identity_evidence_ready'
  );
  const holds=(resolution.items||[]).filter(item=>
    item.controlledOutcome?.state==='manual_hold'
  );

  if(resolution.summary?.targetedCases!==10 ||
     resolution.summary?.resolvedCases!==10 ||
     candidates.length!==9 ||
     holds.length!==1){
    throw new Error('national15_resolution_shape_mismatch');
  }

  if(holds[0]?.resolution?.reason!=='association_identity_placeholder'){
    throw new Error('national15_expected_placeholder_hold_missing');
  }

  const preflight=await proposalSchemaPreflight(pool);
  if(!preflight.proposal_table || !preflight.nullable_target || !preflight.target_constraint){
    throw new Error('national15_proposal_schema_not_ready');
  }

  const before=await canonicalInventory(pool);
  const planned=candidates.map(item=>({
    associationLabel:item.associationLabel,
    canonicalName:item.associationLabel,
    province:'KwaZulu-Natal',
    verificationStatus:'documented',
    idempotencyKey:keyFor(item.associationLabel),
    evidence:{
      gate:'TN7-NATIONAL-15',
      sourceGate:'TN7-NATIONAL-14',
      caseKey:item.caseKey,
      priority:item.priority,
      observations:item.observations,
      recurrence:item.recurrence,
      identityResolution:{
        status:item.resolution.status,
        reason:item.resolution.reason,
        supportingEvidence:item.resolution.supportingEvidence
      }
    }
  }));

  if(!execute){
    return {
      mode:'tn7_national_15_controlled_association_creation_batch',
      gate:'TN7-NATIONAL-15',
      execution:'dry_run',
      preflight,
      before,
      plannedCount:planned.length,
      manualHolds:holds.map(item=>({
        associationLabel:item.associationLabel,
        reason:item.resolution?.reason
      })),
      planned,
      policy:{
        automaticApproval:false,
        canonicalMutation:false,
        proposalsOnly:true,
        twoPersonControlRequired:true,
        deterministicIdempotency:true
      }
    };
  }

  const results=[];
  for(const spec of planned){
    const result=await createTaxiAssociationCreateProposal(pool,{
      canonicalName:spec.canonicalName,
      province:spec.province,
      verificationStatus:spec.verificationStatus,
      actor,
      idempotencyKey:spec.idempotencyKey,
      rationale:'TN7-NATIONAL-15: repeated authoritative KZN Provincial Gazette evidence supports controlled canonical association creation review.',
      evidence:spec.evidence,
      requestId:randomUUID()
    });
    results.push({
      associationLabel:spec.associationLabel,
      idempotencyKey:spec.idempotencyKey,
      status:result.status,
      replay:Boolean(result.payload?.replay),
      error:result.payload?.error||null,
      proposal:result.payload?.proposal||null
    });
  }

  const after=await canonicalInventory(pool);
  const unchanged=JSON.stringify(before)===JSON.stringify(after);

  const successful=results.filter(row=>
    [200,201].includes(row.status) &&
    row.proposal?.action==='taxi_association.create' &&
    row.proposal?.targetEntityType==='taxi_association' &&
    row.proposal?.targetEntityId===null &&
    row.proposal?.status==='proposed'
  );

  return {
    mode:'tn7_national_15_controlled_association_creation_batch',
    gate:'TN7-NATIONAL-15',
    execution:'proposal_batch',
    preflight,
    before,
    after,
    canonicalInventoryUnchanged:unchanged,
    summary:{
      targetedCandidates:candidates.length,
      manualHolds:holds.length,
      attempted:results.length,
      successfulProposedProposals:successful.length,
      created:results.filter(x=>x.status===201).length,
      replayed:results.filter(x=>x.status===200 && x.replay).length,
      failed:results.filter(x=>![200,201].includes(x.status)).length
    },
    results,
    policy:{
      automaticApproval:false,
      canonicalMutation:false,
      proposalsOnly:true,
      twoPersonControlRequired:true,
      deterministicIdempotency:true
    }
  };
}

if(import.meta.url===`file://${process.argv[1]}`){
  if(!process.env.DATABASE_URL) throw new Error('DATABASE_URL required');
  const resolutionUrl=process.env.NATIONAL15_IDENTITY_RESOLUTION_URL;
  if(!resolutionUrl) throw new Error('NATIONAL15_IDENTITY_RESOLUTION_URL required');

  const pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:false,max:3});
  try{
    const resolution=await fetchResolution(resolutionUrl);
    const result=await executeNational15({
      pool,
      resolution,
      execute:process.env.NATIONAL15_EXECUTE_PROPOSALS==='true'
    });
    console.log(JSON.stringify({event:'tn7_national_15_result',...result}));
    if(result.execution==='proposal_batch' &&
       (!result.canonicalInventoryUnchanged ||
        result.summary.successfulProposedProposals!==9 ||
        result.summary.failed!==0)){
      process.exitCode=1;
    }
  }finally{
    await pool.end();
  }
}
