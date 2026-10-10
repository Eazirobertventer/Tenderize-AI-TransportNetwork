import assert from 'node:assert/strict';
import { buildEvidenceBacklog } from './evidence-backlog.mjs';

const queue=[
  {
    evidenceId:'e1',
    normalizedAssociationLabel:'example taxi association',
    associationLabel:'Example Taxi Association',
    documentId:'doc-a',
    documentDate:'2026-01-01',
    sourceUrl:'https://example.org/a.pdf',
    authority:'Official Gazette',
    routeIdentifiers:['R1'],
    rankMentions:['Rank A'],
    associationMatches:[],
    routeCandidateMatches:[],
    rankMatches:[],
    bucket:'association_identity_pending',
    extractionConfidence:0.9
  },
  {
    evidenceId:'e2',
    normalizedAssociationLabel:'example taxi association',
    associationLabel:'Example Taxi Association',
    documentId:'doc-b',
    documentDate:'2026-02-01',
    sourceUrl:'https://example.org/b.pdf',
    authority:'Official Gazette',
    routeIdentifiers:['R2'],
    rankMentions:['Rank B'],
    associationMatches:[],
    routeCandidateMatches:[],
    rankMatches:[],
    bucket:'association_identity_pending',
    extractionConfidence:0.8
  },
  {
    evidenceId:'e3',
    normalizedAssociationLabel:'resolved association',
    associationLabel:'Resolved Association',
    documentId:'doc-a',
    documentDate:'2026-01-01',
    sourceUrl:'https://example.org/a.pdf',
    authority:'Official Gazette',
    routeIdentifiers:['R3'],
    rankMentions:[],
    associationMatches:[{id:'assoc-1',name:'Resolved Association'}],
    routeCandidateMatches:[{id:'route-1'}],
    rankMatches:[],
    bucket:'route_candidate_evidence_ready',
    extractionConfidence:0.95
  }
];

const backlog=buildEvidenceBacklog(queue);
assert.equal(backlog.summary.evidenceRows,3);
assert.equal(backlog.summary.groupedCases,2);

const identity=backlog.items.find(x=>x.caseKey==='example taxi association');
assert.equal(identity.observations,2);
assert.equal(identity.evidence.distinctEvidenceDates.length,2);
assert.equal(identity.nextAction.state,'controlled_association_identity_review');
assert.equal(identity.nextAction.proposalEligible,false);

const route=backlog.items.find(x=>x.caseKey==='resolved association');
assert.equal(route.nextAction.action,'taxi_route.promote');
assert.equal(route.nextAction.proposalEligible,true);
assert.equal(route.nextAction.associationId,'assoc-1');
assert.equal(route.nextAction.candidateId,'route-1');

assert.equal(backlog.policy.automaticApproval,false);
assert.equal(backlog.policy.automaticCanonicalMutation,false);

console.log('TN7_NATIONAL_12_BACKLOG_UNIT_PASS');
