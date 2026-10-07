import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';

const port = Number(process.env.PORT || 3000);
const root = resolve(new URL('.', import.meta.url).pathname);
const repoRoot = resolve(root, '..');
const apiBase = process.env.TRANSPORT_API_URL || '';

const publicApiPaths = [
  '/api/v1/meta',
  '/api/v1/ranks',
  '/api/v1/rank-filters',
  '/api/v1/routes',
  '/api/v1/nltis/endpoint-evidence',
  '/api/v1/source-route-geometries',
  '/api/v1/route-candidates',
  '/api/v1/coverage',
  '/api/v1/associations/map',
  '/api/v1/data-quality/summary'
];

function isPublicApiPath(rawUrl=''){
  const url=new URL(rawUrl,'http://localhost');
  if(publicApiPaths.includes(url.pathname)) return true;
  if(/^\/api\/v1\/ranks\/[^/]+$/.test(url.pathname)) return true;
  return /^\/api\/v1\/associations\/[^/]+$/.test(url.pathname);
}

const mime = {
  '.html':'text/html; charset=utf-8',
  '.css':'text/css; charset=utf-8',
  '.js':'text/javascript; charset=utf-8',
  '.json':'application/json; charset=utf-8',
  '.svg':'image/svg+xml'
};

async function proxy(req,res){
  if (!apiBase) {
    res.writeHead(503,{'content-type':'application/json; charset=utf-8'});
    res.end(JSON.stringify({error:'transport_api_not_configured'}));
    return;
  }
  const target = apiBase.replace(/\/$/,'') + req.url;
  const upstream = await fetch(target,{headers:{'user-agent':'TenderizeTransportWeb/0.3'},signal:AbortSignal.timeout(15000)});
  res.writeHead(upstream.status,{
    'content-type':upstream.headers.get('content-type') || 'application/json; charset=utf-8',
    'cache-control':'no-store'
  });
  res.end(Buffer.from(await upstream.arrayBuffer()));
}

async function serveFile(path,res){
  const info = await stat(path);
  if (!info.isFile()) throw new Error('not_file');
  res.writeHead(200,{'content-type':mime[extname(path)] || 'application/octet-stream'});
  res.end(await readFile(path));
}

createServer(async(req,res)=>{
  try {
    if (req.url === '/health') {
      res.writeHead(200,{'content-type':'application/json; charset=utf-8'});
      res.end(JSON.stringify({ok:true,service:'transport-web',apiConfigured:Boolean(apiBase)}));
      return;
    }

    if (req.url?.startsWith('/api/')) {
      if(!['GET','HEAD'].includes(req.method || 'GET')){
        res.writeHead(405,{'content-type':'application/json; charset=utf-8','allow':'GET, HEAD'});
        res.end(JSON.stringify({error:'method_not_allowed'}));
        return;
      }
      if(!isPublicApiPath(req.url)){
        res.writeHead(404,{'content-type':'application/json; charset=utf-8'});
        res.end(JSON.stringify({error:'not_found'}));
        return;
      }
      await proxy(req,res);
      return;
    }

    if (req.url === '/seed-data.js') {
      await serveFile(join(repoRoot,'prototype/data/seed-data.js'),res);
      return;
    }

    const url = new URL(req.url || '/', 'http://localhost');
    let rel = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    rel = normalize(rel).replace(/^([.][.][\/\\])+/, '');
    await serveFile(join(root,rel),res);
  } catch (error) {
    res.writeHead(404,{'content-type':'text/plain; charset=utf-8'});
    res.end('Not found');
  }
}).listen(port,'0.0.0.0',()=>console.log('transport-web listening on :' + port));
