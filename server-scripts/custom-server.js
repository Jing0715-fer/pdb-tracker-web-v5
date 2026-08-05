const { createServer } = require('http');
const { parse } = require('url');
const fs = require('fs');
const path = require('path');
const cluster = require('cluster');
const numCPUs = 2;

const STATIC_HTML = fs.readFileSync(path.join(__dirname, '.next/server/app/index.html'), 'utf-8');
const STATIC_DIR = path.join(__dirname, '.next/static');

const staticFiles = {};
function walkDir(dir, base) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir)) {
    const fullPath = path.join(dir, entry);
    const relPath = base + '/' + entry;
    if (fs.statSync(fullPath).isDirectory()) {
      walkDir(fullPath, relPath);
    } else {
      staticFiles[relPath] = fullPath;
    }
  }
}
walkDir(STATIC_DIR, '');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

process.on('uncaughtException', (err) => {
  console.error('[FATAL] uncaughtException:', err);
});
process.on('unhandledRejection', (err) => {
  console.error('[FATAL] unhandledRejection:', err);
});

if (cluster.isPrimary && numCPUs > 1) {
  console.log(`Primary ${process.pid} is running`);
  for (let i = 0; i < numCPUs; i++) {
    cluster.fork();
  }
  cluster.on('exit', (worker, code, signal) => {
    console.error(`Worker ${worker.process.pid} died (code ${code}). Restarting...`);
    cluster.fork();
  });
} else {
  const server = createServer((req, res) => {
    res.setHeader('Connection', 'close');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');
    
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const parsedUrl = parse(req.url, true);
    const pathname = decodeURIComponent(parsedUrl.pathname);

    if (pathname === '/' || pathname === '/index.html') {
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      });
      res.end(STATIC_HTML);
      return;
    }

    if (pathname.startsWith('/_next/static/')) {
      const relPath = pathname.replace('/_next/static/', '');
      const filePath = staticFiles[relPath];
      if (filePath) {
        const ext = path.extname(filePath);
        res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
        fs.createReadStream(filePath).pipe(res);
        return;
      }
    }

    // Proxy to API server on 3001
    const http = require('http');
    const proxyReq = http.request({
      hostname: '127.0.0.1',
      port: 3001,
      path: req.url,
      method: req.method,
      headers: { ...req.headers, host: 'localhost:3001', connection: 'close' },
      agent: false,
    }, (proxyRes) => {
      const headers = { ...proxyRes.headers, connection: 'close' };
      res.writeHead(proxyRes.statusCode, headers);
      proxyRes.pipe(res);
    });
    proxyReq.on('error', (e) => {
      console.error('[PROXY ERROR]', e.message);
      if (!res.headersSent) {
        res.writeHead(502);
        res.end('Bad Gateway');
      }
    });
    req.pipe(proxyReq);
  });

  server.keepAliveTimeout = 1;
  server.requestTimeout = 30000;
  server.headersTimeout = 31000;
  server.maxConnections = 100;

  server.on('error', (e) => {
    console.error(`[SERVER ERROR] Worker ${process.pid}:`, e);
  });

  server.listen(3000, () => {
    console.log(`> Worker ${process.pid} ready on http://localhost:3000`);
  });
}
