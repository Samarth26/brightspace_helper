// Minimal local CORS proxy for Hugging Face Inference API
// Run: node cors-proxy.js
// Endpoint: http://localhost:3001/hf

const http = require('http');
const https = require('https');

const PORT = process.env.PORT || 3001;
const TARGET_HOST = 'router.huggingface.co';
const TARGET_PATH = '/v1/chat/completions';

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Expose-Headers', '*');
}

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    setCors(res);
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.url !== '/hf') {
    setCors(res);
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
    return;
  }

  if (req.method !== 'POST') {
    setCors(res);
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }

  // Read incoming body
  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', () => {
    // Forward to Hugging Face
    const auth = req.headers['authorization'] || '';

    const options = {
      hostname: TARGET_HOST,
      path: TARGET_PATH,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': auth,
        'Content-Length': Buffer.byteLength(body)
      }
    };

    const hfReq = https.request(options, (hfRes) => {
      let responseData = '';
      hfRes.on('data', chunk => { responseData += chunk; });
      hfRes.on('end', () => {
        setCors(res);
        res.writeHead(hfRes.statusCode || 200, { 'Content-Type': 'application/json' });
        res.end(responseData);
      });
    });

    hfReq.on('error', (err) => {
      setCors(res);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Proxy error', message: err.message }));
    });

    hfReq.write(body);
    hfReq.end();
  });
});

server.listen(PORT, () => {
  console.log(`CORS proxy running on http://localhost:${PORT}/hf`);
});
