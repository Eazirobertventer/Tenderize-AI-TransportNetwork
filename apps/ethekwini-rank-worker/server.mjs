import { createServer } from 'node:http';

const port=Number(process.env.PORT || 8080);
createServer((req,res)=>{
  res.setHeader('content-type','application/json; charset=utf-8');
  if(req.url==='/health'){
    res.statusCode=200;
    res.end(JSON.stringify({ok:true,service:'ethekwini-rank-worker',sourceMode:'official_degraded_tls_stale'}));
    return;
  }
  res.statusCode=404;
  res.end(JSON.stringify({error:'not_found'}));
}).listen(port,'0.0.0.0',()=>console.log('ethekwini-rank-worker listening on :' + port));
