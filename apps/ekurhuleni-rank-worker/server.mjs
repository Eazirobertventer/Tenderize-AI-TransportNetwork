import http from 'node:http';
const port=Number(process.env.PORT || 8080);
const server=http.createServer((req,res)=>{
  if(req.url==='/health'){
    res.writeHead(200,{'content-type':'application/json'});
    res.end(JSON.stringify({ok:true,service:'ekurhuleni-rank-worker'}));
    return;
  }
  res.writeHead(404,{'content-type':'application/json'});
  res.end(JSON.stringify({error:'not_found'}));
});
server.listen(port,'0.0.0.0',()=>console.log('ekurhuleni-rank-worker listening on :'+port));
