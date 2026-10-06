import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const port = Number(process.env.PORT || 4173);
const root = new URL('../prototype/', import.meta.url).pathname;
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml'
};

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    let relative = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    relative = normalize(relative).replace(/^([.][.][\/\\])+/, '');
    const path = join(root, relative);
    const info = await stat(path);
    if (!info.isFile()) throw new Error('not a file');
    res.writeHead(200, { 'content-type': mime[extname(path)] || 'application/octet-stream' });
    res.end(await readFile(path));
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  }
}).listen(port, '0.0.0.0', () => {
  console.log(`Tenderize Transport Network preview: http://localhost:${port}`);
});
