const base=(process.env.API_BASE||'').replace(/\/$/,'');
if(!base) throw new Error('API_BASE required');
const response=await fetch(base+'/api/v1/coverage/kzn/gazette-queue?limit=250',{cache:'no-store'});
const payload=await response.json();
if(!response.ok) throw new Error('HTTP '+response.status+' '+JSON.stringify(payload));
console.log(JSON.stringify({
  event:'tn7_national_3_probe',
  mode:payload.mode,
  evidence:payload.evidence,
  sourceAvailability:payload.sourceAvailability,
  queue:(payload.queue?.items||[]).map(item=>({
    routeCode:item.routeCode,
    association:item.association,
    evidenceOrigin:item.evidenceOrigin,
    bucket:item.bucket,
    reason:item.reason,
    associationMatches:(item.associationMatches||[]).length,
    routeCandidates:(item.routeCandidates||[]).length,
    canonicalRoutes:(item.canonicalRoutes||[]).length,
    adjudicationRequired:item.adjudicationRequired
  }))
}));
await new Promise(resolve=>setTimeout(resolve,3000));
