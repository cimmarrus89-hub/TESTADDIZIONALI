#!/usr/bin/env node
/* Mini server locale: serve i file statici e, su /api/nyrr/*, fa da proxy verso le API NYRR.
 * Uso: node server.js [porta]   (default 8080)  ->  http://localhost:8080
 * Non serve su GitHub Pages: lì il browser chiama direttamente rmsprodapi.nyrr.org (CORS aperto). */
const http = require('http'), https = require('https'), fs = require('fs'), path = require('path');
const PORT = Number(process.argv[2] || process.env.PORT || 8080);
const ROOT = __dirname;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.md': 'text/plain; charset=utf-8' };

function proxy(req, res) {
  const target = 'https://rmsprodapi.nyrr.org/api/v2' + req.url.replace(/^\/api\/nyrr/, '');
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    const up = https.request(target, { method: req.method, headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'Content-Length': body.length, 'User-Agent': 'nyc-marathon-tracker/1.0' } }, (r) => {
      res.writeHead(r.statusCode, { 'Content-Type': r.headers['content-type'] || 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' });
      r.pipe(res);
    });
    up.on('error', (e) => { res.writeHead(502, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: e.message })); });
    up.end(body);
  });
}

http.createServer((req, res) => {
  if (req.url.startsWith('/api/nyrr/')) return proxy(req, res);
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const file = path.normalize(path.join(ROOT, p));
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}).listen(PORT, () => console.log(`Tracker pronto su http://localhost:${PORT}`));
