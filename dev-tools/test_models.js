const https = require('https');
require('dotenv').config();

const apiKey = process.env.XAI_API_KEY || process.env.GROQ_API_KEY;

async function test(model) {
  const body = JSON.stringify({
    model: model,
    messages: [
      { role: 'system', content: 'You are the AERO TWIN assistant. Always provide answers in 3 parts: CURRENT STATE, EVIDENCE, WHY.' },
      { role: 'user', content: 'What is the engine status if EHI is 48 and diagnosis is THERMAL DEGRADATION?' }
    ],
    max_tokens: 512,
    temperature: 0.2
  });

  return new Promise(resolve => {
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
        try {
          const j = JSON.parse(d);
          console.log(`\n=== MODEL: ${model} ===`);
          console.log('Message object:', j.choices && j.choices[0] && j.choices[0].message);
          resolve(j.choices && j.choices[0] && j.choices[0].message ? j.choices[0].message.content : null);
        } catch (e) {
          console.log(`[${model}] JSON error:`, e.message, d.slice(0, 150));
          resolve(null);
        }
      });
    });
    req.on('error', e => { console.log(`[${model}] Net error:`, e.message); resolve(null); });
    req.write(body);
    req.end();
  });
}

async function run() {
  await test('openai/gpt-oss-120b');
  await test('qwen/qwen3.8-27b');
  await test('openai/gpt-oss-20b');
}
run();
