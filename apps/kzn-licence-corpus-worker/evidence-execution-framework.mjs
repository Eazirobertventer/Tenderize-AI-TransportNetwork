import { createHash } from 'node:crypto';

export function sha256Buffer(buffer){
  return createHash('sha256').update(buffer).digest('hex');
}

export function normalizeEvidenceText(value=''){
  return String(value).normalize('NFKC').toLowerCase()
    .replace(/&/g,' and ')
    .replace(/[^a-z0-9]+/g,' ')
    .replace(/\s+/g,' ')
    .trim();
}

function absoluteUrl(base,href){
  try{return new URL(href,base).toString()}catch{return null}
}

export function discoverDocumentLinks(html,indexUrl,{includePatterns=[],excludePatterns=[]}={}){
  const hrefs=[...String(html||'').matchAll(/href\s*=\s*["']([^"']+)["']/gi)].map(m=>m[1]);
  const include=includePatterns.map(x=>new RegExp(x,'i'));
  const exclude=excludePatterns.map(x=>new RegExp(x,'i'));
  const urls=[];

  for(const href of hrefs){
    const url=absoluteUrl(indexUrl,href);
    if(!url) continue;
    if(!/\.pdf(?:$|[?#])/i.test(url)) continue;
    if(include.length && !include.some(re=>re.test(url))) continue;
    if(exclude.some(re=>re.test(url))) continue;
    if(!urls.includes(url)) urls.push(url);
  }
  return urls;
}

export async function fetchWithPolicy(url,{
  userAgent='TenderizeTransportNetwork/2.0 evidence-execution-readonly',
  timeoutMs=60000,
  retries=2,
  maxBytes=50*1024*1024
}={}){
  let lastError=null;
  for(let attempt=0;attempt<=retries;attempt++){
    try{
      const response=await fetch(url,{
        headers:{'user-agent':userAgent},
        redirect:'follow',
        signal:AbortSignal.timeout(timeoutMs)
      });
      if(!response.ok) throw new Error('HTTP '+response.status+' '+response.statusText);
      const declared=Number(response.headers.get('content-length')||0);
      if(declared && declared>maxBytes) throw new Error('document_too_large:'+declared);
      const buffer=Buffer.from(await response.arrayBuffer());
      if(buffer.length>maxBytes) throw new Error('document_too_large:'+buffer.length);
      return {
        ok:true,
        buffer,
        bytes:buffer.length,
        checksum:sha256Buffer(buffer),
        contentType:response.headers.get('content-type')||null,
        finalUrl:response.url||url,
        attempt:attempt+1
      };
    }catch(error){
      lastError=error;
    }
  }
  return {ok:false,error:String(lastError?.message||lastError||'fetch_failed')};
}

export async function discoverAdapterDocuments(adapter){
  const result=await fetchWithPolicy(adapter.indexUrl,{
    timeoutMs:adapter.timeoutMs||60000,
    retries:adapter.retries??2,
    maxBytes:adapter.maxIndexBytes||5*1024*1024
  });
  if(!result.ok){
    return {
      adapterId:adapter.id,
      ok:false,
      indexUrl:adapter.indexUrl,
      error:result.error,
      documents:[]
    };
  }
  const html=result.buffer.toString('utf8');
  const documents=discoverDocumentLinks(html,adapter.indexUrl,{
    includePatterns:adapter.includePatterns||[],
    excludePatterns:adapter.excludePatterns||[]
  }).slice(0,Math.min(Math.max(Number(adapter.maxDocuments)||500,1),1000));

  return {
    adapterId:adapter.id,
    ok:true,
    indexUrl:adapter.indexUrl,
    indexChecksum:result.checksum,
    documents:documents.map((url,index)=>({
      documentId:adapter.id+'-'+String(index+1).padStart(4,'0'),
      url,
      province:adapter.province,
      authority:adapter.authority,
      sourceClass:adapter.sourceClass,
      adapterId:adapter.id
    }))
  };
}

export function dedupeDocuments(discoveryResults,{maxDocuments=500}={}){
  const seen=new Set();
  const documents=[];
  for(const result of discoveryResults){
    for(const document of result.documents||[]){
      const key=document.url.replace(/^https:\/\/www\d?\./i,'https://www.');
      if(seen.has(key)) continue;
      seen.add(key);
      documents.push(document);
      if(documents.length>=maxDocuments) return documents;
    }
  }
  return documents;
}

export function normalizeEvidenceRows(rows,{document,checksum}={}){
  return (rows||[]).map((row,index)=>({
    evidenceId:createHash('sha256')
      .update([
        document?.adapterId||'',
        document?.url||'',
        checksum||'',
        row.applicationNumber||'',
        row.associationLabel||'',
        (row.routeIdentifiers||[]).join('|'),
        String(index)
      ].join('::'))
      .digest('hex'),
    province:document?.province||null,
    sourceAdapter:document?.adapterId||null,
    authority:document?.authority||null,
    sourceClass:document?.sourceClass||null,
    sourceUrl:document?.url||row.sourceUrl||null,
    sourceChecksum:checksum||null,
    documentId:document?.documentId||row.documentId||null,
    applicationNumber:row.applicationNumber||null,
    associationLabel:row.associationLabel||null,
    normalizedAssociationLabel:normalizeEvidenceText(row.associationLabel||''),
    routeIdentifiers:[...(row.routeIdentifiers||[])],
    rankMentions:[...(row.rankMentions||[])],
    normalizedRankMentions:(row.rankMentions||[]).map(normalizeEvidenceText).filter(Boolean),
    extractionConfidence:Number(row.extractionConfidence||0),
    rawEvidence:row
  }));
}

export function classifyEvidenceRow(row,{associationMatches=[],routeCandidateMatches=[],rankMatches=[]}={}){
  if(associationMatches.length>1) return {bucket:'association_identity_ambiguous',reason:'multiple_canonical_associations'};
  if(associationMatches.length===0 && row.associationLabel) return {bucket:'association_identity_pending',reason:'association_not_canonical'};
  if(associationMatches.length===1 && routeCandidateMatches.length===1){
    const candidate=routeCandidateMatches[0];
    if(candidate.association_id===associationMatches[0].id) return {bucket:'already_assigned',reason:'candidate_already_assigned'};
    if(candidate.association_id && candidate.association_id!==associationMatches[0].id) return {bucket:'conflict',reason:'candidate_association_conflict'};
    return {bucket:'route_candidate_evidence_ready',reason:'unique_association_and_route_candidate'};
  }
  if(associationMatches.length===1 && routeCandidateMatches.length>1) return {bucket:'conflict',reason:'multiple_route_candidate_matches'};
  if(associationMatches.length===1 && rankMatches.length===1) return {bucket:'rank_association_evidence_ready',reason:'unique_association_and_rank'};
  if(associationMatches.length===1 && rankMatches.length>1) return {bucket:'review_required',reason:'multiple_rank_matches'};
  if(associationMatches.length===1) return {bucket:'association_only_evidence',reason:'association_resolved_without_route_or_rank'};
  return {bucket:'unresolved',reason:'insufficient_deterministic_identity'};
}
