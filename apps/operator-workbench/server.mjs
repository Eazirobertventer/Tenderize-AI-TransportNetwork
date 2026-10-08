import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';

const port=Number(process.env.PORT||3000);
const root=resolve(new URL('.',import.meta.url).pathname);
const apiBase=(process.env.TRANSPORT_API_URL||'').replace(/\/$/,'');
const enabled=process.env.OPERATOR_WORKBENCH_ENABLED==='true';

const allowed=[
  /^\/api\/v1\/operator\/me$/,
  /^\/api\/v1\/operator\/workbench(?:\?.*)?$/,
  /^\/api\/v1\/operator\/proposals\/[0-9a-fA-F-]{36}$/,
  /^\/api\/v1\/operator\/proposals\/[0-9a-fA-F-]{36}\/(approve|reject|withdraw)$/,
  /^\/api\/v1\/operator\/proposals\/rank-merges$/,
  /^\/api\/v1\/operator\/proposals\/association-merges$/,
  /^\/api\/v1\/operator\/proposals\/ranks\/[0-9a-fA-F-]{36}\/aliases$/,
  /^\/api\/v1\/operator\/proposals\/associations\/[0-9a-fA-F-]{36}\/aliases$/,
  /^\/api\/v1\/operator\/proposals\/rank-association-candidates\/[0-9a-fA-F-]{36}\/assign$/,
  /^\/api\/v1\/operator\/proposals\/route-candidates\/[0-9a-fA-F-]{36}\/promote$/,
  /^\/api\/v1\/operator\/adjudications\/data-issues\/[0-9a-fA-F-]{36}\/(defer|reject|reopen)$/
];

const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8'};

function json(res,status,payload){
  res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});
  res.end(JSON.stringify(payload));
}

async function proxy(req,res,url){
  if(!enabled) return json(res,503,{error:'operator_workbench_disabled'});
  if(!apiBase) return json(res,503,{error:'transport_api_not_configured'});
  const path=url.pathname.replace(/^\/operator-api/,'')+url.search;
  if(!allowed.some(pattern=>pattern.test(path))) return json(res,404,{error:'not_found'});

  const headers={'user-agent':'TenderizeOperatorWorkbench/0.1'};
  if(req.headers.authorization) headers.authorization=req.headers.authorization;
  if(req.headers['idempotency-key']) headers['idempotency-key']=req.headers['idempotency-key'];
  if(req.headers['content-type']) headers['content-type']=req.headers['content-type'];

  let body;
  if(!['GET','HEAD'].includes(req.method||'GET')){
    const chunks=[]; for await(const chunk of req) chunks.push(chunk);
    body=Buffer.concat(chunks);
  }
  const upstream=await fetch(apiBase+path,{
    method:req.method,
    headers,
    body,
    signal:AbortSignal.timeout(20000)
  });
  res.writeHead(upstream.status,{
    'content-type':upstream.headers.get('content-type')||'application/json; charset=utf-8',
    'cache-control':'no-store'
  });
  res.end(Buffer.from(await upstream.arrayBuffer()));
}

async function serveFile(path,res){
  const info=await stat(path);
  if(!info.isFile()) throw new Error('not_file');
  res.writeHead(200,{'content-type':mime[extname(path)]||'application/octet-stream','cache-control':'no-store'});
  res.end(await readFile(path));
}

createServer(async(req,res)=>{
  try{
    const url=new URL(req.url||'/','http://localhost');
    if(url.pathname==='/health') return json(res,200,{ok:true,service:'operator-workbench',enabled,apiConfigured:Boolean(apiBase)});
    if(url.pathname.startsWith('/operator-api/')) return proxy(req,res,url);
    if(!enabled) return json(res,404,{error:'not_found'});
    let rel=decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname);
    rel=normalize(rel).replace(/^([.][.][\/\\])+/,'');
    await serveFile(join(root,rel),res);
  }catch{
    json(res,404,{error:'not_found'});
  }
}).listen(port,'0.0.0.0',()=>console.log('operator-workbench listening on :'+port));
