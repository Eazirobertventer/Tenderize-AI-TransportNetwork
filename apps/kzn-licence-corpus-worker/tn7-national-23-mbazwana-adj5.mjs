import pg from 'pg';
import {
  buildRankAssociationSnapshot,
  validateRankAssociationSnapshot
} from '../transport-api/src/operator-association-links.mjs';
import { createRankAssociationAssignmentProposal } from '../transport-api/src/operator-proposals.mjs';
import { appendOperatorAuditEvent } from '../transport-api/src/operator-audit.mjs';

const {Pool}=pg;

const RANK_ID='acadacb7-ae3b-4581-a28b-ba445af280ba';
const ASSOCIATION_ID='1561a588-e225-4af3-b5ca-12ba5e754f4a';
const SOURCE_KEY='kzn-gazette-uthukela-mirror';
const SOURCE_RANK_EXTERNAL_ID='KRPUMD002';
const ASSOCIATION_LABEL='MBAZWANA TAXI ASSOCIATION';
const FIRST_SEEN='2023-10-12T00:00:00Z';
const LAST_SEEN='2025-02-13T00:00:00Z';

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

async function loadEvidenceState(pool){
  const [rank,association,source,alias]=await Promise.all([
    pool.query(`SELECT id::text,canonical_name,aliases,province,verification_status::text
                  FROM taxi_rank WHERE id=$1::uuid`,[RANK_ID]),
    pool.query(`SELECT id::text,canonical_name,aliases,province,verification_status::text
                  FROM taxi_association WHERE id=$1::uuid`,[ASSOCIATION_ID]),
    pool.query(`SELECT id::text,source_key,source_name,authority
                  FROM source_registry WHERE source_key=$1`,[SOURCE_KEY]),
    pool.query(`SELECT id::text,entity_type,entity_id::text,alias,normalized_alias,
                        promoted_by_proposal_id::text,promoted_audit_event_id::text
                  FROM transport_entity_alias
                  WHERE entity_type='taxi_rank'
                    AND entity_id=$1::uuid
                    AND normalized_alias='mbazwana taxi rank'`,[RANK_ID])
  ]);
  return {
    rank:rank.rows[0]||null,
    association:association.rows[0]||null,
    source:source.rows[0]||null,
    alias:alias.rows[0]||null
  };
}

export async function executeNational23({
  pool,
  materialize=false,
  createProposal=false,
  actor={
    subject:'tn7-national23-mbazwana-candidate-review',
    displayName:'TN7 NATIONAL-23 Mbazwana Candidate Review',
    roles:['reviewer']
  }
}={}){
  if(!pool) throw new Error('pool_required');

  const before=await inventory(pool);
  const state=await loadEvidenceState(pool);

  if(!state.rank || !state.association || !state.source || !state.alias){
    throw new Error('national23_prerequisite_missing');
  }
  if(!(state.rank.aliases||[]).includes('Mbazwana Taxi Rank')){
    throw new Error('national23_mbazwana_alias_not_approved');
  }
  if(state.association.canonical_name!=='MBAZWANA TAXI ASSOCIATION'){
    throw new Error('national23_association_identity_mismatch');
  }

  const normalized=(await pool.query(
    'SELECT normalize_transport_identity_name($1)::text AS normalized',
    [ASSOCIATION_LABEL]
  )).rows[0].normalized;

  let candidate=(await pool.query(
    `SELECT id::text,source_id::text,source_rank_external_id,taxi_rank_id::text,
            association_label,normalized_label,verification_status::text,
            first_seen_at,last_seen_at
       FROM rank_association_candidate
       WHERE source_id=$1::uuid
         AND source_rank_external_id=$2
         AND normalized_label=$3
       LIMIT 1`,
    [state.source.id,SOURCE_RANK_EXTERNAL_ID,normalized]
  )).rows[0]||null;

  if(materialize && !candidate){
    const client=await pool.connect();
    try{
      await client.query('BEGIN');
      const replay=(await client.query(
        `SELECT id::text,source_id::text,source_rank_external_id,taxi_rank_id::text,
                association_label,normalized_label,verification_status::text,
                first_seen_at,last_seen_at
           FROM rank_association_candidate
           WHERE source_id=$1::uuid
             AND source_rank_external_id=$2
             AND normalized_label=$3
           FOR UPDATE`,
        [state.source.id,SOURCE_RANK_EXTERNAL_ID,normalized]
      )).rows[0]||null;

      if(replay){
        candidate=replay;
      }else{
        candidate=(await client.query(
          `INSERT INTO rank_association_candidate (
             source_id,source_rank_external_id,taxi_rank_id,association_label,
             normalized_label,verification_status,first_seen_at,last_seen_at
           ) VALUES ($1::uuid,$2,$3::uuid,$4,$5,'documented',$6::timestamptz,$7::timestamptz)
           RETURNING id::text,source_id::text,source_rank_external_id,taxi_rank_id::text,
                     association_label,normalized_label,verification_status::text,
                     first_seen_at,last_seen_at`,
          [state.source.id,SOURCE_RANK_EXTERNAL_ID,RANK_ID,ASSOCIATION_LABEL,normalized,FIRST_SEEN,LAST_SEEN]
        )).rows[0];

        await appendOperatorAuditEvent(client,{
          actor,
          action:'rank_association_candidate.materialize',
          entityType:'rank_association_candidate',
          entityId:candidate.id,
          requestId:'tn7-national23-mbazwana-candidate',
          idempotencyKey:'tn7-national23-mbazwana-candidate',
          beforeState:null,
          afterState:candidate,
          evidence:{
            gate:'TN7-NATIONAL-23',
            sourceGates:['TN7-NATIONAL-20','TN7-NATIONAL-21','TN7-NATIONAL-22'],
            sourceDocuments:[
              {documentId:'KZN-PROVINCIAL-GAZETTE-2605-2023-10-12',sourceKey:'kzn-gazette-uthukela-mirror'},
              {documentId:'KZN-PROVINCIAL-GAZETTE-2780-2025-02-13',sourceKey:'kzn-gazette-lawlibrary-mirror'}
            ],
            rankAlias:{
              targetRankId:RANK_ID,
              alias:'Mbazwana Taxi Rank',
              aliasProposalId:'057d2830-760d-4bb1-a02b-4f39190e2db6',
              aliasAuditEventId:'b311f3a5-a22f-4564-bf52-66922e4884ab',
              aliasRecordId:'1999ca79-6f12-4fdc-a9d5-5a690b29cdf9'
            },
            associationId:ASSOCIATION_ID
          },
          rationale:'TN7-NATIONAL-23: materialise one documented rank-association candidate after deterministic Mbazwana rank alias approval and independent Gazette recurrence.'
        });
      }
      await client.query('COMMIT');
    }catch(error){
      try{await client.query('ROLLBACK')}catch{}
      throw error;
    }finally{
      client.release();
    }
  }

  let validation=null;
  let proposalResult=null;

  if(candidate){
    const snapshot=await buildRankAssociationSnapshot(pool,{
      candidateId:candidate.id,
      associationId:ASSOCIATION_ID,
      lock:false
    });
    validation=validateRankAssociationSnapshot(snapshot);

    if(createProposal && validation.ok){
      proposalResult=await createRankAssociationAssignmentProposal(pool,{
        candidateId:candidate.id,
        associationId:ASSOCIATION_ID,
        actor,
        idempotencyKey:'tn7-national23-mbazwana-adj5-proposal',
        rationale:'TN7-NATIONAL-23: create controlled ADJ5 proposal linking canonical Mbazwana rank KRPUMD002 to MBAZWANA TAXI ASSOCIATION after alias approval and repeated 2023/2025 Gazette evidence.',
        evidence:{
          gate:'TN7-NATIONAL-23',
          sourceGates:['TN7-NATIONAL-20','TN7-NATIONAL-21','TN7-NATIONAL-22'],
          rank:{
            id:RANK_ID,
            canonicalName:'KRPUMD002',
            alias:'Mbazwana Taxi Rank'
          },
          association:{
            id:ASSOCIATION_ID,
            canonicalName:'MBAZWANA TAXI ASSOCIATION'
          },
          recurrence:{
            firstSeen:'2023-10-12',
            lastSeen:'2025-02-13',
            sourceDocuments:[
              {
                documentId:'KZN-PROVINCIAL-GAZETTE-2605-2023-10-12',
                sourceKey:'kzn-gazette-uthukela-mirror'
              },
              {
                documentId:'KZN-PROVINCIAL-GAZETTE-2780-2025-02-13',
                sourceKey:'kzn-gazette-lawlibrary-mirror'
              }
            ]
          },
          aliasPromotion:{
            proposalId:'057d2830-760d-4bb1-a02b-4f39190e2db6',
            auditEventId:'b311f3a5-a22f-4564-bf52-66922e4884ab',
            aliasRecordId:'1999ca79-6f12-4fdc-a9d5-5a690b29cdf9'
          },
          automaticApproval:false
        }
      });
    }
  }

  const after=await inventory(pool);

  return {
    mode:'tn7_national_23_mbazwana_rank_association_materialisation',
    gate:'TN7-NATIONAL-23',
    execution:{
      materialize,
      createProposal
    },
    before,
    after,
    candidate,
    validation,
    proposalResult:proposalResult ? {
      status:proposalResult.status,
      replay:Boolean(proposalResult.payload?.replay),
      error:proposalResult.payload?.error||null,
      proposal:proposalResult.payload?.proposal||null
    } : null,
    policy:{
      candidateMaterialisationControlled:true,
      existingAdj5ValidationRequired:true,
      proposalOnly:true,
      automaticApproval:false,
      relationshipMutation:false
    }
  };
}

if(import.meta.url===`file://${process.argv[1]}`){
  if(!process.env.DATABASE_URL) throw new Error('DATABASE_URL required');
  const pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:false,max:2});
  try{
    const result=await executeNational23({
      pool,
      materialize:process.env.NATIONAL23_MATERIALIZE_CANDIDATE==='true',
      createProposal:process.env.NATIONAL23_CREATE_ADJ5_PROPOSAL==='true'
    });
    console.log(JSON.stringify({event:'tn7_national_23_result',...result}));
    if(result.execution.materialize && !result.candidate) process.exitCode=1;
    if(result.execution.createProposal){
      const p=result.proposalResult?.proposal;
      const ok=
        result.validation?.ok===true &&
        [200,201].includes(result.proposalResult?.status) &&
        p?.action==='taxi_rank_association.assign' &&
        p?.status==='proposed' &&
        result.before.ranks===result.after.ranks &&
        result.before.associations===result.after.associations &&
        result.before.routes===result.after.routes &&
        result.before.route_candidates===result.after.route_candidates;
      if(!ok) process.exitCode=1;
    }
  }finally{
    await pool.end();
  }
}
