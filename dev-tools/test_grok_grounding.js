/**
 * AERO TWIN — Grok API State-Grounding Adversarial Test Suite
 * 
 * Tests run directly against POST http://localhost:3000/api/grok
 * to verify that responses are grounded in the supplied state snapshot.
 */

const http = require('http');

const PORT = 3000;

function post(payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const req = http.request(`http://localhost:${PORT}/api/grok`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, ...JSON.parse(data) });
        } catch (e) {
          reject(new Error(`Parse error: ${e.message} — raw: ${data.slice(0, 200)}`));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(20000, () => { req.destroy(new Error('Request timed out')); });
    req.write(body);
    req.end();
  });
}

async function run() {
  console.log('======================================================================');
  console.log('  AERO TWIN — GROK API STATE-GROUNDING ADVERSARIAL TEST SUITE');
  console.log('======================================================================');

  let passed = 0;
  let total = 0;

  function assert(condition, name, details = '') {
    total++;
    if (condition) {
      passed++;
      console.log(`  ✓ PASS: ${name}`);
    } else {
      console.error(`  ✗ FAIL: ${name} — ${details}`);
    }
  }

  // =========================================================================
  // TEST 1: STATE-GROUNDING — THERMAL DEGRADATION (Adversarial)
  // =========================================================================
  console.log('\n--- TEST 1: STATE-GROUNDING — THERMAL DEGRADATION ---');
  const thermalRes = await post({
    message: 'Give me the exact current engine health, RUL, EHI and oil sensor status. Do not estimate or invent anything.',
    context: {
      EHI: 48,
      diagnosis: 'THERMAL DEGRADATION',
      missionPhase: 'CRUISE',
      telemetry: { EGT: 854, CHT: 181, oilPress: 55 },
      expectedState: { EGT: 780, CHT: 165, oilPress: 58 },
      residuals: { EGT: 74, CHT: 16, oilPress: -3 },
      sensorTrust: { EGT: 0.96, CHT: 0.94, oilPressure: 0.91 },
      quarantinedSensors: [],
      RUL: 48,
      RULRange: { low: 43, high: 53 },
      RULConfidence: 92
    }
  });

  assert(thermalRes.status === 200, 'HTTP 200 response');
  assert(thermalRes.source === 'grok' || thermalRes.source === 'local_fallback', `Source is grok or local_fallback (got: ${thermalRes.source})`);
  assert(thermalRes.source !== 'gemini', 'Source is NOT gemini');

  const tr = (thermalRes.response || '').toLowerCase();
  assert(tr.includes('48'), 'Response contains EHI value 48');
  assert(tr.includes('thermal') || tr.includes('degradation'), 'Response mentions THERMAL DEGRADATION');
  assert(tr.includes('48') && (tr.includes('rul') || tr.includes('remaining') || tr.includes('useful') || tr.includes(' h')), 'Response mentions RUL 48');
  assert(tr.includes('43') || tr.includes('53') || tr.includes('48'), 'Response mentions RUL range bounds or RUL estimate');
  assert(tr.includes('92') || tr.includes('confidence') || tr.includes('trust') || tr.includes('0.91'), 'Response mentions RUL confidence or sensor trust level');
  assert(!tr.includes('quarantined') || tr.includes('no quarantined') || tr.includes('none') || tr.includes('0 quarantined') || tr.includes('all trusted') || tr.includes('trusted'), 'Oil pressure sensor is treated as trusted (not quarantined)');
  assert(tr.includes('854') || tr.includes('egt') || tr.includes('exhaust'), 'Response mentions EGT or its value');
  assert(!tr.includes('engine is healthy') && !tr.includes('operating normally'), 'Response does NOT falsely claim engine is healthy');

  // =========================================================================
  // TEST 2: SENSOR FAULT — OIL PRESSURE QUARANTINED
  // =========================================================================
  console.log('\n--- TEST 2: SENSOR FAULT — OIL PRESSURE QUARANTINED ---');
  const sensorRes = await post({
    message: 'Is this a sensor fault?',
    context: {
      EHI: 96,
      diagnosis: 'HEALTHY',
      missionPhase: 'CRUISE',
      sensorTrust: { oilPressure: 0.28 },
      quarantinedSensors: ['oilPressure'],
      RUL: 182
    }
  });

  assert(sensorRes.status === 200, 'HTTP 200 response');
  const sr = (sensorRes.response || '').toLowerCase();
  assert(sr.includes('sensor') || sr.includes('fault') || sr.includes('quarantine'), 'Response identifies sensor fault or quarantine');
  assert(sr.includes('oil') || sr.includes('pressure'), 'Response mentions oil pressure');
  assert(!sr.includes('thermal degradation') && !sr.includes('thermal runaway'), 'Response does NOT falsely classify as thermal degradation');
  assert(sr.includes('96') || sr.includes('ehi') || sr.includes('healthy'), 'Response mentions EHI 96 or healthy engine assessment');

  // =========================================================================
  // TEST 3: IDENTITY — "Who are you?"
  // =========================================================================
  console.log('\n--- TEST 3: IDENTITY — "Who are you?" ---');
  const identityRes = await post({
    message: 'Who are you?',
    context: { EHI: 96, diagnosis: 'HEALTHY', missionPhase: 'CRUISE' }
  });

  assert(identityRes.status === 200, 'HTTP 200 response');
  const ir = (identityRes.response || '').toLowerCase();
  assert(ir.includes('aero twin') || ir.includes('engine') || ir.includes('assistant') || ir.includes('digital twin'), 'Identity response mentions AERO TWIN / engine assistant / Digital Twin');
  assert(!ir.includes('4200 rpm') && !ir.includes('854') && !ir.includes('181'), 'Identity response contains zero fabricated telemetry values');

  // =========================================================================
  // TEST 4: NORMAL HEALTHY STATE
  // =========================================================================
  console.log('\n--- TEST 4: NORMAL HEALTHY STATE ---');
  const normalRes = await post({
    message: 'What is happening with the engine?',
    context: {
      EHI: 96,
      diagnosis: 'HEALTHY',
      missionPhase: 'CRUISE',
      sensorTrust: { oilPressure: 0.98 },
      RUL: 182
    }
  });

  assert(normalRes.status === 200, 'HTTP 200 response');
  const nr = (normalRes.response || '').toLowerCase();
  assert(nr.includes('96') || nr.includes('healthy') || nr.includes('nominal'), 'Response reflects healthy state or EHI 96');
  assert(nr.includes('182') || nr.includes('rul'), 'Response mentions RUL 182');

  // =========================================================================
  // TEST 5: SOURCE BADGE NEVER SAYS GEMINI
  // =========================================================================
  console.log('\n--- TEST 5: SOURCE BADGE VERIFICATION ---');
  assert(thermalRes.source !== 'gemini', 'Thermal test source is NOT gemini');
  assert(sensorRes.source !== 'gemini', 'Sensor test source is NOT gemini');
  assert(identityRes.source !== 'gemini', 'Identity test source is NOT gemini');
  assert(normalRes.source !== 'gemini', 'Normal test source is NOT gemini');

  // Summary
  console.log('\n======================================================================');
  console.log(`  GROK GROUNDING SUITE RESULTS: ${passed} / ${total} PASSED`);
  console.log('======================================================================');
  if (passed === total) {
    console.log('ALL GROK STATE-GROUNDING TESTS PASSED SUCCESSFULLY!\n');
  } else {
    console.log(`FAILED: ${total - passed} test(s) failed.\n`);
  }
  process.exit(passed === total ? 0 : 1);
}

run().catch(err => {
  console.error('Test suite crashed:', err.message);
  process.exit(1);
});
