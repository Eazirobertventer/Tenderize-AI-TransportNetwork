import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { parseGazetteText } from './parser.mjs';

const require=createRequire(import.meta.url);
const pdf=require('pdf-parse');

const config=JSON.parse(await readFile(new URL('./mirror-sources.json',import.meta.url),'utf8'));
const rows=[];

for(const item of config){
  const pdfArg=process.argv.find(v=>v.startsWith('--pdf-'+item.targetDocumentId+'='));
  if(!pdfArg) throw new Error('Missing local mirror for '+item.targetDocumentId);
  const file=pdfArg.split('=').slice(1).join('=');
  const parsed=await pdf(await readFile(file));
  const result=parseGazetteText(parsed.text,{
    documentId:item.mirrorDocumentId,
    url:item.mirrorUrl,
    authority:item.mirrorAuthority
  });
  const anchorRows=result.rows.filter(row=>(row.routeIdentifiers||[]).includes(item.targetAnchorRouteId));
  const associationMatches=anchorRows.filter(row=>
    item.targetAnchorAssociation==='NOT AVAILABLE'
      ? true
      : String(row.associationLabel||'').toUpperCase().includes(item.targetAnchorAssociation.toUpperCase())
  );
  rows.push({
    targetDocumentId:item.targetDocumentId,
    mirrorDocumentId:item.mirrorDocumentId,
    mirrorUrl:item.mirrorUrl,
    identityClass:item.identityClass,
    targetAnchorRouteId:item.targetAnchorRouteId,
    anchorRouteHits:anchorRows.length,
    associationAnchorHits:associationMatches.length,
    exactDocumentIdentity:item.targetDocumentId===item.mirrorDocumentId,
    passRouteLevelEvidence:anchorRows.length>0 && associationMatches.length>0
  });
}

console.log(JSON.stringify({
  event:'tn6_z1_r2_mirror_verification',
  exactDocumentMirrors:rows.filter(r=>r.exactDocumentIdentity).length,
  routeLevelAuthoritativeMirrors:rows.filter(r=>r.passRouteLevelEvidence).length,
  rows,
  databaseWrites:false,
  rankLinkWrites:false,
  routeCandidateWrites:false,
  canonicalRouteWrites:false
},null,2));
