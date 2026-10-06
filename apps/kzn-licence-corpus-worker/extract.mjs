import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const pdf=require('pdf-parse');
import { parseGazetteText } from './parser.mjs';

const args=new Set(process.argv.slice(2));
const sourceArg=process.argv.find(value=>value.startsWith('--source='));
const fixtureArg=process.argv.find(value=>value.startsWith('--fixture='));
const manifest=JSON.parse(await readFile(new URL('./sources.json',import.meta.url),'utf8'));

async function fetchBuffer(url){
  const response=await fetch(url,{
    headers:{'user-agent':'TenderizeTransportNetwork/1.0 tn6-z1-readonly'},
    signal:AbortSignal.timeout(90000)
  });
  if(!response.ok) throw new Error('HTTP '+response.status+' '+response.statusText);
  return Buffer.from(await response.arrayBuffer());
}

async function extractSource(source){
  let text;
  if(fixtureArg){
    text=await readFile(fixtureArg.split('=').slice(1).join('='),'utf8');
  }else{
    const buffer=await fetchBuffer(source.url);
    const parsed=await pdf(buffer);
    text=parsed.text;
  }

  const result=parseGazetteText(text,source);
  for(const row of result.rows){
    process.stdout.write(JSON.stringify(row)+'\n');
  }
  return result.rows.length;
}

const selected=sourceArg
  ? manifest.filter(source=>source.documentId===sourceArg.split('=').slice(1).join('='))
  : manifest;

if(!selected.length) throw new Error('No matching source in sources.json');

let total=0;
for(const source of selected){
  const rows=await extractSource(source);
  total+=rows;
  console.error(JSON.stringify({
    event:'tn6_z1_document_extracted',
    documentId:source.documentId,
    rows,
    writes:false
  }));
}

console.error(JSON.stringify({
  event:'tn6_z1_corpus_extract_complete',
  documents:selected.length,
  rows:total,
  databaseWrites:false,
  rankLinkWrites:false,
  routeCandidateWrites:false,
  canonicalRouteWrites:false
}));
