import { createServer } from 'node:http';

const port=Number(process.env.PORT || 8080);
const last={ok:true,service:'route-worker',source:'capetown-taxi-routes'};

createServer((req,res)=>{
  res.setHeader('content-type','application/json; charset=utf-8');
  if(req.url==='/health'){
    res.statusCode=200;
    res.end(JSON.stringify(last));
    return;
  }
  res.statusCode=404;
  res.end(JSON.stringify({error:'not_found'}));
}).listen(port,'0.0.0.0',()=>console.log('route-worker listening on :' + port));
