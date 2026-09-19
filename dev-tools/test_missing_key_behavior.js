/**
 * Verification of Missing GROQ_API_KEY behavior
 * Tests that without a valid API key, the system returns
 * "Groq AI not configured — add GROQ_API_KEY to .env" and does NOT
 * silently switch to a local fake fallback.
 */

const http = require('http');
const { handleRequest } = require('../lib/aero-twin-server');

async function testMissingKey() {
  console.log('--- Testing API Behavior When GROQ_API_KEY Is Missing ---');
  
  // Create an ephemeral server with empty GROQ_API_KEY
  const originalKey = process.env.GROQ_API_KEY;
  process.env.GROQ_API_KEY = '';

  const server = http.createServer(handleRequest);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  try {
    const payload = JSON.stringify({
      message: 'What is the engine health?',
      appState: { EHI: 96, diagnosis: 'HEALTHY' }
    });

    const res = await new Promise((resolve, reject) => {
      const req = http.request({
        hostname: '127.0.0.1',
        port: port,
        path: '/api/grok',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        }
      }, r => {
        let data = '';
        r.on('data', c => data += c);
        r.on('end', () => resolve({ status: r.statusCode, ...JSON.parse(data) }));
      });
      req.on('error', reject);
      req.write(payload);
      req.end();
    });

    console.log('Response status:', res.status);
    console.log('Response source:', res.source);
    console.log('Response error:', res.error);
    console.log('Response text:', res.response);

    if (res.source === 'local_fallback') {
      console.error('FAILED: Returned local_fallback which is strictly disallowed.');
      process.exit(1);
    }

    if (res.error !== 'not_configured' || !res.response.includes('Groq AI not configured')) {
      console.error('FAILED: Did not return explicit missing key error.');
      process.exit(1);
    }

    console.log('✓ PASS: Explicitly returned "Groq AI not configured — add GROQ_API_KEY to .env"');
    console.log('✓ PASS: No local_fallback returned.');
  } finally {
    server.close();
    process.env.GROQ_API_KEY = originalKey;
  }
}

testMissingKey().then(() => {
  console.log('=== MISSING KEY VERIFICATION SUITE PASSED ===');
}).catch(e => {
  console.error(e);
  process.exit(1);
});
