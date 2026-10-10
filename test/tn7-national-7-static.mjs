import fs from 'node:fs';

const orchestration=fs.readFileSync('apps/transport-api/src/kzn-bhamshela-canonicalisation.mjs','utf8');
const server=fs.readFileSync('apps/transport-api/src/server.mjs','utf8');

const checks=[
  ['NATIONAL-6 identity resolution reused',/loadKznBhamshelaIdentityResolution/.test(orchestration)],
  ['NATIONAL-3 queue reused',/loadKznGazetteEvidenceQueue/.test(orchestration)],
  ['generic route gap recovery reused',/recoverRouteEvidenceGaps/.test(orchestration)],
  ['exact three Bhamshela routes scoped',/KZNBRCPMB100/.test(orchestration) && /KZNBRCPMB102/.test(orchestration) && /KZNBRCPMB103/.test(orchestration)],
  ['association create proposal path reused',/createTaxiAssociationCreateProposal/.test(orchestration)],
  ['alias proposal path reused',/createAliasProposal/.test(orchestration)],
  ['ADJ5 path reused',/createRankAssociationAssignmentProposal/.test(orchestration)],
  ['ADJ6 path reused',/createRoutePromotionProposal/.test(orchestration)],
  ['creation precedes route unlock',/association_creation_proposal_required/.test(orchestration)],
  ['alias review precedes route unlock',/association_alias_proposal_required/.test(orchestration)],
  ['route candidate gap explicit',/route_candidate_gap/.test(orchestration)],
  ['automatic approval disabled',/automaticApproval:false/.test(orchestration)],
  ['no canonical mutation claimed',/canonicalMutationPerformed:false/.test(orchestration)],
  ['two-person control explicit',/twoPersonControlRequired:true/.test(orchestration)],
  ['plan endpoint exists',server.includes('coverage\\/kzn\\/bhamshela-canonicalisation')],
  ['proposal endpoint exists',server.includes('coverage\\/kzn\\/bhamshela-canonicalisation\\/proposals')],
  ['proposal endpoint authenticated',/national7ProposalMatch[\s\S]*operatorAuthOrSend/.test(server)],
  ['proposal endpoint idempotent',/national7ProposalMatch[\s\S]*idempotency_key_required/.test(server)]
];

const failed=checks.filter(([,ok])=>!ok);
for(const [name,ok] of checks) console.log((ok?'PASS ':'FAIL ')+name);
if(failed.length){
  console.error('TN7_NATIONAL_7_STATIC_FAIL '+failed.length+'/'+checks.length);
  process.exit(1);
}
console.log('TN7_NATIONAL_7_STATIC_PASS '+checks.length+'/'+checks.length);
