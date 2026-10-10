import assert from 'node:assert/strict';
import { resolveMultiDateAssociationCases } from './kzn-multi-date-identity-resolution.mjs';

const queries=[];
const db={
  async query(sql,args=[]){
    queries.push({sql,args});
    if(sql.includes("to_regprocedure('normalize_transport_identity_name(text)')")){
      return {rows:[{available:false}]};
    }
    if(sql.includes('FROM taxi_association')){
      return {rows:[]};
    }
    if(sql.includes('FROM rank_association_candidate')){
      return {rows:[]};
    }
    if(sql.includes('FROM route_candidate')){
      return {rows:[]};
    }
    throw new Error('unexpected_query:'+sql);
  }
};

const backlog={
  items:[{
    caseKey:'example taxi association',
    associationLabel:'EXAMPLE TAXI ASSOCIATION',
    observations:3,
    priority:{score:80,band:'P1'},
    evidence:{
      distinctEvidenceDates:['2023-10-12','2025-02-13'],
      documentIds:['doc-1','doc-2'],
      sourceUrls:['https://example.org/1.pdf','https://example.org/2.pdf'],
      routeIdentifiers:[]
    },
    nextAction:{state:'controlled_association_identity_review'}
  },{
    caseKey:'not available',
    associationLabel:'NOT AVAILABLE',
    observations:10,
    priority:{score:70,band:'P1'},
    evidence:{
      distinctEvidenceDates:['2023-10-12','2025-02-13'],
      documentIds:['doc-1','doc-2'],
      sourceUrls:['https://example.org/1.pdf','https://example.org/2.pdf'],
      routeIdentifiers:[]
    },
    nextAction:{state:'controlled_association_identity_review'}
  }]
};

const result=await resolveMultiDateAssociationCases(db,backlog);
assert.equal(result.summary.targetedCases,2);
assert.equal(result.summary.resolvedCases,2);
assert.equal(result.items[0].resolution.status,'canonical_identity_evidence_ready');
assert.equal(result.items[0].controlledOutcome.state,'canonical_creation_candidate');
assert.equal(result.items[0].controlledOutcome.proposalEligible,false);
assert.equal(result.items[0].proposalCreated,false);
assert.equal(result.items[0].canonicalMutation,false);
assert.equal(result.policy.fuzzyMatching,false);
assert.equal(result.policy.proposalCreation,false);

const placeholder=result.items.find(x=>x.associationLabel==='NOT AVAILABLE');
assert.equal(placeholder.resolution.status,'invalid');
assert.equal(placeholder.resolution.reason,'association_identity_placeholder');
assert.equal(placeholder.controlledOutcome.state,'manual_hold');
assert.equal(placeholder.proposalCreated,false);
assert.equal(placeholder.canonicalMutation,false);

console.log('TN7_NATIONAL_14_RESOLUTION_UNIT_PASS');
