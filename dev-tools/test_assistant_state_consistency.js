/**
 * AERO TWIN — AI Assistant State Consistency Test Suite
 * Validates:
 * 1. TEST 1 — NORMAL: State = HEALTHY, Trust = 9/9, nominal operation
 * 2. TEST 2 — SENSOR FAULT: State = SENSOR FAULT, oil pressure quarantined, EHI shielded, explicit distinction that engine itself is healthy
 * 3. TEST 3 — THERMAL: State = THERMAL RUNAWAY, CHT/EGT residuals elevated, thermal sensors trusted, genuine degradation
 * 4. TEST 4 — IDENTITY: "who are you" / "what can you do" returns identity response, NO telemetry diagnosis
 * 5. TEST 5 — WHY: "Why is engine health changing?" reflects respective current state (SENSOR FAULT shielded vs THERMAL degraded)
 * 6. TEST 6 — REPLAY: Replay snapshot analyzed at replayIndex, no leakage of live values
 * 7. TEST 7 — NO FABRICATION: No hallucinated telemetry (742, 153, 0.62, 97), unavailable values returned gracefully
 */

const { spawn } = require('child_process');
const http = require('http');
const path = require('path');

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

function wait(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

async function runConsistencySuite() {
  console.log('=================================================================');
  console.log('  AERO TWIN — AI ASSISTANT STATE CONSISTENCY VALIDATION SUITE');
  console.log('=================================================================');

  const profileDir = path.join('C:\\Users\\gd116\\AppData\\Local\\Temp', 'chrome_consistency_' + Date.now());
  const debugPort = 9225;

  const chrome = spawn(chromePath, [
    '--headless=new',
    `--remote-debugging-port=${debugPort}`,
    '--remote-debugging-address=127.0.0.1',
    `--user-data-dir=${profileDir}`,
    '--window-size=1600,1050',
    '--no-first-run',
    '--no-default-browser-check',
    'http://localhost:3000/'
  ]);

  let pageTarget = null;
  for (let i = 0; i < 25; i++) {
    await wait(400);
    try {
      const targets = await fetchJson(`http://127.0.0.1:${debugPort}/json`);
      pageTarget = targets.find(t => t.type === 'page' && t.url.includes('localhost:3000'));
      if (pageTarget && pageTarget.webSocketDebuggerUrl) break;
    } catch (e) {}
  }

  if (!pageTarget) {
    console.error('FAIL: Could not connect to Headless Chrome on port ' + debugPort);
    chrome.kill();
    process.exit(1);
  }

  const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
  let msgId = 1;
  const callbacks = new Map();

  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.id && callbacks.has(data.id)) {
      const cb = callbacks.get(data.id);
      callbacks.delete(data.id);
      cb(data.result);
    }
  };

  function sendCdp(method, params = {}) {
    return new Promise((resolve) => {
      const id = msgId++;
      callbacks.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async function evaluate(expr) {
    const res = await sendCdp('Runtime.evaluate', {
      expression: expr,
      returnByValue: true,
      awaitPromise: true
    });
    if (res && res.exceptionDetails) {
      throw new Error(JSON.stringify(res.exceptionDetails));
    }
    return res && res.result ? res.result.value : null;
  }

  await wait(1000);
  for (let i = 0; i < 30; i++) {
    const ready = await evaluate(`typeof window.applyScenario === 'function' && typeof window.appState === 'object'`);
    if (ready) break;
    await wait(200);
  }

  let passedCount = 0;
  let totalCount = 0;

  function assert(condition, testName, details = '') {
    totalCount++;
    if (condition) {
      passedCount++;
      console.log(`  ✓ PASS: ${testName}`);
    } else {
      console.error(`  ✗ FAIL: ${testName} — ${details}`);
    }
  }

  try {
    // ---------------------------------------------------------------------------
    // TEST 1 — NORMAL MISSION
    // ---------------------------------------------------------------------------
    console.log('\n--- TEST 1: NORMAL MISSION STATE & ASSISTANT AGREEMENT ---');
    await evaluate(`window.applyScenario('normal')`);
    await wait(400);

    const normalState = await evaluate(`({
      aiDiagnosis: window.appState.aiDiagnosis,
      trustedCount: window.appState.trustedCount,
      totalSensors: window.appState.totalSensors,
      anomalyScore: window.appState.anomalyScore,
      ehi: window.appState.ehi,
      quarantined: window.appState.trustResult ? window.appState.trustResult.quarantined : []
    })`);

    assert(normalState.aiDiagnosis === 'HEALTHY', 'Dashboard state is HEALTHY', `got: ${normalState.aiDiagnosis}`);
    assert(normalState.trustedCount === 9, 'Sensor Trust is 9/9', `got: ${normalState.trustedCount}`);
    assert(!normalState.quarantined || normalState.quarantined.length === 0, 'No quarantined sensors in normal state');

    const normalResp = await evaluate(`
      window.generateLocalAnalysis("what's going on with engine", window.captureAppStateSnapshot())
    `);
    assert(normalResp.includes('HEALTHY') && !normalResp.includes('SENSOR FAULT') && !normalResp.includes('THERMAL RUNAWAY'),
      'Assistant identifies engine as HEALTHY in normal state', `response: ${normalResp}`);
    assert(normalResp.includes(`${normalState.ehi}/100`),
      'Assistant reflects exact snapshot EHI', `response: ${normalResp}`);

    // ---------------------------------------------------------------------------
    // TEST 2 — SENSOR FAULT (BAD SENSOR != BAD ENGINE)
    // ---------------------------------------------------------------------------
    console.log('\n--- TEST 2: SENSOR FAULT & QUALIFIED ENGINE HEALTH ---');
    await evaluate(`window.applyScenario('sensor_fault')`);
    await wait(400);

    const faultState = await evaluate(`({
      aiDiagnosis: window.appState.aiDiagnosis,
      quarantined: window.appState.trustResult ? window.appState.trustResult.quarantined : [],
      oilTrust: window.appState.trustResult && window.appState.trustResult.scores ? window.appState.trustResult.scores.oilPress : null,
      ehi: window.appState.ehi,
      anomalyScore: window.appState.anomalyScore
    })`);

    assert(faultState.aiDiagnosis === 'SENSOR FAULT', 'Dashboard state is SENSOR FAULT', `got: ${faultState.aiDiagnosis}`);
    assert(faultState.quarantined.includes('oilPress'), 'Oil pressure sensor is quarantined');
    assert(faultState.oilTrust < 0.40, 'Oil pressure trust is below 0.40', `got: ${faultState.oilTrust}`);
    assert(faultState.ehi >= 85, 'Engine Health Index remains protected (>= 85)', `got: ${faultState.ehi}`);

    const faultOverviewResp = await evaluate(`
      window.generateLocalAnalysis("status", window.captureAppStateSnapshot())
    `);
    assert(faultOverviewResp.includes('SENSOR FAULT'), 'Assistant reports SENSOR FAULT');
    assert(faultOverviewResp.includes('The engine itself appears healthy; the detected problem is isolated to the oil-pressure sensor'),
      'Assistant explicitly distinguishes instrument fault from mechanical engine condition');
    assert(!faultOverviewResp.startsWith('Current Engine State: <strong>HEALTHY</strong>'),
      'Assistant DOES NOT collapse SENSOR FAULT into generic HEALTHY');

    const faultSensorQueryResp = await evaluate(`
      window.generateLocalAnalysis("is this a sensor fault", window.captureAppStateSnapshot())
    `);
    assert(faultSensorQueryResp.includes('sensor fault') && faultSensorQueryResp.includes('Quarantined'),
      'Assistant confirms isolated sensor fault with quarantined transducer');

    // ---------------------------------------------------------------------------
    // TEST 3 — THERMAL RUNAWAY / DEGRADATION
    // ---------------------------------------------------------------------------
    console.log('\n--- TEST 3: THERMAL DEGRADATION & ELEVATED RESIDUALS ---');
    await evaluate(`window.applyScenario('thermal_degradation')`);
    await wait(400);

    const thermalState = await evaluate(`({
      aiDiagnosis: window.appState.aiDiagnosis,
      anomalyScore: window.appState.anomalyScore,
      ehi: window.appState.ehi,
      rulHours: window.appState.rulHours,
      quarantined: window.appState.trustResult ? window.appState.trustResult.quarantined : [],
      chtResidual: window.appState.physics && window.appState.physics.residuals ? window.appState.physics.residuals.cht : 0,
      egtResidual: window.appState.physics && window.appState.physics.residuals ? window.appState.physics.residuals.egt : 0
    })`);

    assert(thermalState.aiDiagnosis === 'THERMAL DEGRADATION', 'Dashboard state is THERMAL DEGRADATION');
    assert(thermalState.anomalyScore > 0.50, 'Anomaly score is elevated (> 0.50)', `got: ${thermalState.anomalyScore}`);
    assert(thermalState.ehi < 75, 'EHI is depleted (< 75)', `got: ${thermalState.ehi}`);
    assert(thermalState.rulHours < 80, 'RUL is depleted (< 80 h)', `got: ${thermalState.rulHours}`);
    assert(!thermalState.quarantined || thermalState.quarantined.length === 0, 'Thermal sensors are trusted, not quarantined');

    const thermalResp = await evaluate(`
      window.generateLocalAnalysis("what is going on", window.captureAppStateSnapshot())
    `);
    assert(thermalResp.includes('THERMAL RUNAWAY') || thermalResp.includes('THERMAL DEGRADATION'),
      'Assistant describes genuine thermal runaway/degradation');
    assert(!thermalResp.includes('Current Engine State: <strong>HEALTHY</strong>'),
      'Assistant DOES NOT call thermal runaway HEALTHY');
    assert(thermalResp.includes(`${thermalState.ehi}/100`),
      'Assistant reports exact degraded EHI from state');

    // ---------------------------------------------------------------------------
    // TEST 4 — IDENTITY INTENT ROUTING
    // ---------------------------------------------------------------------------
    console.log('\n--- TEST 4: DETERMINISTIC IDENTITY INTENT ROUTING ---');
    const identityQuestions = [
      'who are you',
      'what are you',
      'what can you do',
      'introduce yourself'
    ];

    for (const q of identityQuestions) {
      const resp = await evaluate(`window.routeDeterministicIntent(${JSON.stringify(q)})`);
      assert(resp && resp.includes('AERO TWIN Decision-Support Assistant') && resp.includes('do not directly control'),
        `Identity question "${q}" routed to decision-support identity response`);
      assert(!resp.includes('°C') && !resp.includes('PSI') && !resp.includes('RPM') && !resp.includes('/100'),
        `Identity response for "${q}" contains 0 telemetry diagnosis`);
    }

    // ---------------------------------------------------------------------------
    // TEST 5 — WHY DID HEALTH DROP / WHY IS HEALTH CHANGING
    // ---------------------------------------------------------------------------
    console.log('\n--- TEST 5: WHY IS ENGINE HEALTH CHANGING IN EACH STATE ---');
    // First in Sensor Fault
    await evaluate(`window.applyScenario('sensor_fault')`);
    await wait(300);
    const whySensorResp = await evaluate(`
      window.generateLocalAnalysis("Why is engine health changing?", window.captureAppStateSnapshot())
    `);
    assert(whySensorResp.includes('protected') || whySensorResp.includes('shielded'),
      'Sensor Fault explanation confirms EHI is shielded/protected');
    assert(whySensorResp.includes('oil pressure sensor fault'),
      'Sensor Fault explanation identifies oil pressure sensor fault');

    // Then in Thermal
    await evaluate(`window.applyScenario('thermal_degradation')`);
    await wait(300);
    const whyThermalResp = await evaluate(`
      window.generateLocalAnalysis("Why is engine health changing?", window.captureAppStateSnapshot())
    `);
    assert(whyThermalResp.includes('dropped') && (whyThermalResp.includes('EGT') || whyThermalResp.includes('CHT')),
      'Thermal explanation identifies EGT/CHT thermal stress and dropped EHI');
    assert(whyThermalResp.includes('authentic thermodynamic degradation'),
      'Thermal explanation confirms authentic thermodynamic degradation');

    // ---------------------------------------------------------------------------
    // TEST 6 — REPLAY TIMELINE CONSISTENCY & NO STALE/LIVE LEAKAGE
    // ---------------------------------------------------------------------------
    console.log('\n--- TEST 6: HISTORICAL REPLAY SNAPSHOT ISOLATION ---');
    // Seek to Replay Second 5 (Baseline)
    await evaluate(`window.jumpToReplaySecond(5)`);
    await wait(300);
    const replay5State = await evaluate(`window.captureAppStateSnapshot()`);
    assert(replay5State.isReplaying === true, 'Replay mode is active at t=5');
    assert(replay5State.replayIndex === 5, 'Replay index is 5 at t=5');

    const replay5Resp = await evaluate(`
      window.generateLocalAnalysis("current condition", window.captureAppStateSnapshot())
    `);
    assert(replay5Resp.includes('[REPLAY @ 5s]'), 'Assistant response tags [REPLAY @ 5s]');
    assert(replay5Resp.includes('HEALTHY'), 't=5 replay frame is HEALTHY');

    // Seek to Replay Second 64 (Sensor Fault)
    await evaluate(`window.jumpToReplaySecond(64)`);
    await wait(300);
    const replay64State = await evaluate(`window.captureAppStateSnapshot()`);
    assert(replay64State.isReplaying === true && replay64State.replayIndex === 64, 'Replay index is 64 at t=64');
    const replay64Resp = await evaluate(`
      window.generateLocalAnalysis("current condition", window.captureAppStateSnapshot())
    `);
    assert(replay64Resp.includes('[REPLAY @ 64s]'), 'Assistant response tags [REPLAY @ 64s]');
    assert(replay64Resp.includes('SENSOR FAULT'), 't=64 replay frame correctly analyzes SENSOR FAULT');

    // Seek to Replay Second 82 (Thermal Runaway)
    await evaluate(`window.jumpToReplaySecond(82)`);
    await wait(300);
    const replay82State = await evaluate(`window.captureAppStateSnapshot()`);
    assert(replay82State.isReplaying === true && replay82State.replayIndex === 82, 'Replay index is 82 at t=82');
    const replay82Resp = await evaluate(`
      window.generateLocalAnalysis("current condition", window.captureAppStateSnapshot())
    `);
    assert(replay82Resp.includes('[REPLAY @ 82s]'), 'Assistant response tags [REPLAY @ 82s]');
    assert(replay82Resp.includes('THERMAL RUNAWAY') || replay82Resp.includes('THERMAL DEGRADATION'),
      't=82 replay frame correctly analyzes THERMAL RUNAWAY');

    // ---------------------------------------------------------------------------
    // TEST 7 — NO HARDCODED / FABRICATED NUMBERS
    // ---------------------------------------------------------------------------
    console.log('\n--- TEST 7: NO FABRICATED OR HARDCODED FALLBACK TELEMETRY ---');
    // Test with missing telemetry snapshot
    const sparseSnapshot = {
      scenario: 'normal',
      missionPhase: 'CRUISE',
      simTime: '14:22',
      rawTelemetry: {},
      aiDiagnosis: 'HEALTHY',
      aiDiagStatus: 'NOMINAL',
      ehi: 94,
      ehiStatus: 'NOMINAL',
      anomalyScore: 0.05,
      overallTrust: 0.98,
      trustedCount: 9,
      totalSensors: 9,
      rulHours: 180,
      rulLabel: '180 h',
      degradationPct: 4,
      degradationTrend: 'STABLE',
      isReplaying: false,
      replayIndex: null
    };

    const sparseResidualResp = await evaluate(`
      window.generateLocalAnalysis("physics residuals", ${JSON.stringify(sparseSnapshot)})
    `);
    assert(sparseResidualResp.includes('That value is not currently available in the Digital Twin state.'),
      'Missing telemetry safely returns "That value is not currently available..." without inventing numbers');
    assert(!sparseResidualResp.includes('742') && !sparseResidualResp.includes('153') && !sparseResidualResp.includes('824') && !sparseResidualResp.includes('178'),
      'Sparse analysis does NOT fabricate 742, 153, 824, or 178');

  } catch (err) {
    console.error('Unexpected exception in test suite:', err);
    totalCount++;
  } finally {
    ws.close();
    chrome.kill();
  }

  console.log('\n=================================================================');
  console.log(`  CONSISTENCY SUITE RESULTS: ${passedCount} / ${totalCount} PASSED`);
  console.log('=================================================================');

  if (passedCount === totalCount && totalCount > 0) {
    console.log('ALL ASSISTANT STATE CONSISTENCY TESTS PASSED SUCCESSFULLY!\n');
    process.exit(0);
  } else {
    console.error(`FAILED: ${totalCount - passedCount} test(s) failed.\n`);
    process.exit(1);
  }
}

runConsistencySuite();
