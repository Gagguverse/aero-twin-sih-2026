const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3000;
const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.py': 'text/plain',
  '.ino': 'text/plain'
};

// In-memory buffer for real engine hardware telemetry
let latestHardwareTelemetry = null;
let lastHardwarePacketTimestamp = 0;

const server = http.createServer((req, res) => {
  const parsedUrl = req.url.split('?')[0];

  // API Endpoint: POST /api/telemetry (From Python / CAN-bus bridge / MATLAB)
  if (req.method === 'POST' && parsedUrl === '/api/telemetry') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        latestHardwareTelemetry = {
          ...data,
          receivedAt: Date.now()
        };
        lastHardwarePacketTimestamp = Date.now();
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ status: 'ok', received: true }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON telemetry payload' }));
      }
    });
    return;
  }

  // API Endpoint: GET /api/telemetry (Frontend polls latest hardware data)
  if (req.method === 'GET' && parsedUrl === '/api/telemetry') {
    res.writeHead(200, { 
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-cache'
    });
    res.end(JSON.stringify({
      active: (Date.now() - lastHardwarePacketTimestamp) < 5000,
      timestamp: lastHardwarePacketTimestamp,
      telemetry: latestHardwareTelemetry
    }));
    return;
  }

  // CORS pre-flight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    res.end();
    return;
  }

  // Static File Serving
  let reqPath = parsedUrl === '/' ? '/index.html' : parsedUrl;
  let filePath = path.join(__dirname, reqPath);

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 Not Found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      'Pragma': 'no-cache',
      'Expires': '0'
    });

    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
  });
});

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}/`);
  console.log(`Hardware Telemetry Ingestion API ready at http://localhost:${PORT}/api/telemetry`);
});
