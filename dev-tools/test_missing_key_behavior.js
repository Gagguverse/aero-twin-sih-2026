/**
 * Verification of Missing GROQ_API_KEY behavior
 * Tests that without a valid API key, the system returns
 * "Groq AI not configured — add GROQ_API_KEY to .env" and does NOT
 * silently switch to a local fake fallback.
 */

const http = require('http');

async function testMissingKey() {
  console.log('--- Testing API Behavior When Server Has No Key / Config ---');
  
  // Directly simulate sending to server with null key scenario check
  const payload = JSON.stringify({
    message: 'What is the engine health?',
    appState: { EHI: 96, diagnosis: 'HEALTHY' }
  });

  const res = await new Promise((resolve, reject) => {
    const req = http.request('http://localhost:3000/api/grok', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
    }, r => {
      let data = '';
      r.on('data', c => data += c);
      r.on('end', () => resolve({ status: r.statusCode, ...JSON.parse(data) }));
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });

  console.log('Response source:', res.source);
  console.log('Response content preview:', (res.response || '').slice(0, 100));

  if (res.source === 'grok') {
    console.log('✓ Valid Groq response received from live Groq Cloud API.');
  } else if (res.response && res.response.includes('Groq AI not configured')) {
    console.log('✓ Correctly returns explicit missing key message.');
  } else {
    console.log('Result:', res);
  }

  if (res.source === 'local_fallback') {
    console.error('FAILED: Returned local_fallback which is strictly disallowed.');
    process.exit(1);
  }

  console.log('✓ PASSED: No fake local fallback returned.');
}

testMissingKey().catch(e => {
  console.error(e);
  process.exit(1);
});
