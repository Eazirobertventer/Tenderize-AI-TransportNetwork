import { readFile } from 'node:fs/promises';

const files=process.argv.slice(2);
if(!files.length) throw new Error('Provide one or more JSONL files');

const knownRanks=[
  'Newcastle Sizwe Main Taxi Rank',
  'Stanger Taxi Rank',
  'Professor Nyembezi (Symons Centre) Taxi Terminal',
  'Port Shepstone Main Taxi Rank',
  'Estcourt Main Taxi Rank',
  'Mtubatuba Taxi Rank',
  'Lyell Street Taxi Rank',
  'Bergville Taxi Rank',
  'Vryheid Main Taxi Rank',
  'Dundee Taxi Rank'
];

function norm(value){
  return String(value || '').toLowerCase().normalize('NFKD')
    .replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ');
}

const rows=[];
for(const file of files){
  const text=await readFile(file,'utf8');
  for(const line of text.split(/\n+/).filter(Boolean)){
    rows.push(JSON.parse(line));
  }
}

const unique=valueFn=>new Set(rows.map(valueFn).filter(Boolean));
const associationRows=rows.filter(row=>row.associationLabel);
const rankRows=rows.filter(row=>Array.isArray(row.rankMentions) && row.rankMentions.length);
const linkedEvidenceRows=rows.filter(row=>row.associationLabel && Array.isArray(row.rankMentions) && row.rankMentions.length);
const routeEvidenceRows=rows.filter(row=>row.associationLabel && Array.isArray(row.routeIdentifiers) && row.routeIdentifiers.length);

const mentionCorpus=new Set(rows.flatMap(row=>row.normalizedRankMentions || []));
const knownRankHits=knownRanks.map(name=>{
  const n=norm(name);
  const matched=[...mentionCorpus].filter(m=>m.includes(n) || n.includes(m));
  return {name,matched};
}).filter(item=>item.matched.length);

const summary={
  event:'tn6_z1_r1_bounded_batch_summary',
  documents:unique(row=>row.documentId).size,
  evidenceRows:rows.length,
  uniqueApplications:unique(row=>row.applicationNumber).size,
  uniqueAssociations:unique(row=>row.normalizedAssociationLabel).size,
  uniqueOperatingLicences:unique(row=>row.operatingLicenceNumber).size,
  uniqueRouteIdentifiers:new Set(rows.flatMap(row=>row.routeIdentifiers || [])).size,
  rowsWithAssociation:associationRows.length,
  rowsWithRankMentions:rankRows.length,
  rowsWithAssociationAndRankMentions:linkedEvidenceRows.length,
  rowsWithAssociationAndRouteIdentifiers:routeEvidenceRows.length,
  uniqueNormalizedRankMentions:new Set(rows.flatMap(row=>row.normalizedRankMentions || [])).size,
  knownRecoveredRankHits:knownRankHits,
  sampleAssociations:[...unique(row=>row.associationLabel)].slice(0,25),
  databaseWrites:false,
  rankLinkWrites:false,
  routeCandidateWrites:false,
  canonicalRouteWrites:false
};

console.log(JSON.stringify(summary,null,2));
