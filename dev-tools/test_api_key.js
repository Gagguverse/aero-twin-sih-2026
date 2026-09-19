const https = require('https');
require('dotenv').config();

const apiKey = process.env.XAI_API_KEY || process.env.GROQ_API_KEY;

const body = JSON.stringify({
  model: 'openai/gpt-oss-120b',
  messages: [
    { role: 'system', content: 'You are the AERO TWIN assistant.' },
    { role: 'user', content: 'Reply with: GROK/GROQ CLOUD CONNECTION TEST PASSED' }
  ],
  max_tokens: 100
});

const req = https.request({
  hostname: 'api.groq.com',
  port: 443,
  path: '/openai/v1/chat/completions',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${apiKey}`,
    'Content-Length': Buffer.byteLength(body)
  }
}, res => {
  let d = '';
  res.on('data', c => d += c);
  res.on('end', () => {
    console.log('Status:', res.statusCode);
    console.log('Response:', d);
  });
});
req.on('error', e => console.log('Error:', e.message));
req.write(body);
req.end();
