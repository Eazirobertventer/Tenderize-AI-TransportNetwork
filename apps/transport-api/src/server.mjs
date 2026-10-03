import { createServer } from 'node:http';

const port = Number(process.env.PORT || 8080);
createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ ok: true, service: 'transport-api', path: req.url }));
}).listen(port, '0.0.0.0', () => {
  console.log(`transport-api listening on :${port}`);
});
