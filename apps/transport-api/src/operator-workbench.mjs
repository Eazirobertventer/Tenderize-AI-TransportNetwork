import { loadNationalCoverageModel } from './national-coverage.mjs';

export async function operatorWorkbenchSchemaAvailable(pool){
  if(!pool) return false;
  const result=await pool.query(
    `SELECT
       to_regclass('operator_audit_event') IS NOT NULL AS audit,
       to_regclass('operator_decision_proposal') IS NOT NULL AS proposals,
       to_regclass('transport_entity_alias') IS NOT NULL AS aliases,
       to_regclass('taxi_rank_merge_lineage') IS NOT NULL AS rank_merges,
       to_regclass('taxi_association_merge_lineage') IS NOT NULL AS association_merges`
  );
  const row=result.rows[0]||{};
  return Boolean(row.audit && row.proposals && row.aliases && row.rank_merges && row.association_merges);
}

function proposalView(row){
  return {
    id:row.id,
    action:row.action,
    targetEntityType:row.target_entity_type,
    targetEntityId:row.target_entity_id,
    intendedChange:row.intended_change,
    rationale:row.rationale,
    proposer:{
      subject:row.proposer_subject,
      displayName:row.proposer_display_name,
      role:row.proposer_role
    },
    proposedAt:row.proposed_at,
    status:row.status,
    decision:row.decision_actor_subject ? {
      subject:row.decision_actor_subject,
      displayName:row.decision_actor_display_name,
      role:row.decision_actor_role,
      rationale:row.decision_rationale,
      decidedAt:row.decided_at
    } : null,
    approvedAuditEventId:row.approved_audit_event_id
  };
}

export const adjudicationActionCatalog=[
  {
    gate:'ADJ1',
    action:'data_issue.defer',
    label:'Defer issue',
    target:'data_issue',
    dualControl:false,
    reversible:true
  },
  {
    gate:'ADJ2',
    action:'data_issue.reject',
    label:'Reject issue',
    target:'data_issue',
    dualControl:false,
    reversible:true
  },
  {
    gate:'ADJ2',
    action:'data_issue.reopen',
    label:'Reopen / undefer',
    target:'data_issue',
    dualControl:false,
    reversible:false
  },
  {
    gate:'ADJ4',
    action:'taxi_rank.alias.add',
    label:'Promote rank alias',
    target:'taxi_rank',
    dualControl:true,
    reversible:false
  },
  {
    gate:'ADJ4',
    action:'taxi_association.alias.add',
    label:'Promote association alias',
    target:'taxi_association',
    dualControl:true,
    reversible:false
  },
  {
    gate:'ADJ5',
    action:'taxi_rank_association.assign',
    label:'Assign operating association',
    target:'taxi_rank',
    dualControl:true,
    reversible:false
  },
  {
    gate:'ADJ6',
    action:'taxi_route.promote',
    label:'Promote route candidate',
    target:'route_candidate',
    dualControl:true,
    reversible:false
  },
  {
    gate:'ADJ7',
    action:'taxi_rank.merge',
    label:'Merge duplicate rank',
    target:'taxi_rank',
    dualControl:true,
    reversible:false
  },
  {
    gate:'ADJ8',
    action:'taxi_association.merge',
    label:'Merge duplicate association',
    target:'taxi_association',
    dualControl:true,
    reversible:false
  }
];

export async function loadOperatorWorkbench(pool,{capabilities,limit=100}={}){
  if(!pool) return null;
  const bounded=Math.min(Math.max(Number(limit)||100,10),250);

  const [
    issueSummary,
    issues,
    pendingProposals,
    recentProposals,
    recentAudit,
    rankCandidates,
    routeCandidates,
    nationalCoverage
  ]=await Promise.all([
    pool.query(
      `SELECT
         count(*) FILTER (WHERE status IN ('open','reviewing','deferred'))::int AS active,
         count(*) FILTER (WHERE status='reviewing')::int AS reviewing,
         count(*) FILTER (WHERE status='deferred')::int AS deferred,
         count(*) FILTER (WHERE status='rejected')::int AS rejected,
         count(*) FILTER (WHERE severity IN ('error','blocking') AND status IN ('open','reviewing','deferred'))::int AS high_severity
       FROM data_issue`
    ),
    pool.query(
      `SELECT id::text,entity_type,entity_id::text,issue_type,severity,summary,detail,status,created_at,resolved_at
       FROM data_issue
       WHERE status IN ('open','reviewing','deferred','rejected')
       ORDER BY
         CASE severity WHEN 'blocking' THEN 1 WHEN 'error' THEN 2 WHEN 'warning' THEN 3 ELSE 4 END,
         created_at DESC
       LIMIT $1`,
      [bounded]
    ),
    pool.query(
      `SELECT id::text,action,target_entity_type,target_entity_id::text,intended_change,rationale,
              proposer_subject,proposer_display_name,proposer_role,proposed_at,status,
              decision_actor_subject,decision_actor_display_name,decision_actor_role,
              decision_rationale,decided_at,approved_audit_event_id::text
       FROM operator_decision_proposal
       WHERE status='proposed'
       ORDER BY proposed_at ASC,id
       LIMIT $1`,
      [bounded]
    ),
    pool.query(
      `SELECT id::text,action,target_entity_type,target_entity_id::text,intended_change,rationale,
              proposer_subject,proposer_display_name,proposer_role,proposed_at,status,
              decision_actor_subject,decision_actor_display_name,decision_actor_role,
              decision_rationale,decided_at,approved_audit_event_id::text
       FROM operator_decision_proposal
       ORDER BY proposed_at DESC,id DESC
       LIMIT $1`,
      [bounded]
    ),
    pool.query(
      `SELECT id::text,event_sequence,occurred_at,actor_subject,actor_display_name,actor_role,
              action,entity_type,entity_id::text,request_id,idempotency_key,rationale,metadata
       FROM operator_audit_event
       ORDER BY event_sequence DESC
       LIMIT $1`,
      [bounded]
    ),
    pool.query(
      `SELECT rac.id::text,rac.taxi_rank_id::text,rac.association_label,rac.normalized_label,
              rac.verification_status::text,rac.first_seen_at,rac.last_seen_at,
              r.canonical_name AS rank_name,r.province,r.municipality,r.town
       FROM rank_association_candidate rac
       LEFT JOIN taxi_rank r ON r.id=rac.taxi_rank_id
       ORDER BY rac.last_seen_at DESC,rac.id
       LIMIT $1`,
      [bounded]
    ),
    pool.query(
      `SELECT rc.id::text,rc.origin_rank_id::text,rc.destination_rank_id::text,rc.association_id::text,
              rc.route_code,rc.reconciliation_status,rc.verification_status::text,
              rc.first_seen_at,rc.last_seen_at,
              o.canonical_name AS origin_name,d.canonical_name AS destination_name
       FROM route_candidate rc
       LEFT JOIN taxi_rank o ON o.id=rc.origin_rank_id
       LEFT JOIN taxi_rank d ON d.id=rc.destination_rank_id
       ORDER BY rc.last_seen_at DESC,rc.id
       LIMIT $1`,
      [bounded]
    ),
    loadNationalCoverageModel(pool)
  ]);

  const enabled=new Set(capabilities?.adjudication?.enabledActions || []);
  const actions=adjudicationActionCatalog.map(item=>({
    ...item,
    enabled:enabled.has(item.action)
  }));

  return {
    mode:'operator_workbench',
    mutationEnabled:Boolean(capabilities?.mutationEnabled),
    capabilities:capabilities?.adjudication || {},
    actionCatalog:actions,
    summary:{
      ...issueSummary.rows[0],
      pendingProposals:pendingProposals.rowCount,
      recentAuditEvents:recentAudit.rowCount,
      rankAssociationCandidates:rankCandidates.rowCount,
      routeCandidates:routeCandidates.rowCount
    },
    queues:{
      dataIssues:issues.rows,
      rankAssociationCandidates:rankCandidates.rows,
      routeCandidates:routeCandidates.rows
    },
    proposals:{
      pending:pendingProposals.rows.map(proposalView),
      recent:recentProposals.rows.map(proposalView)
    },
    coverage:nationalCoverage,
    audit:{
      recent:recentAudit.rows.map(row=>({
        id:row.id,
        eventSequence:Number(row.event_sequence),
        occurredAt:row.occurred_at,
        actor:{
          subject:row.actor_subject,
          displayName:row.actor_display_name,
          role:row.actor_role
        },
        action:row.action,
        entityType:row.entity_type,
        entityId:row.entity_id,
        requestId:row.request_id,
        idempotencyKey:row.idempotency_key,
        rationale:row.rationale,
        metadata:row.metadata
      }))
    }
  };
}
