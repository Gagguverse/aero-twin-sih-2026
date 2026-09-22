/**
 * AERO TWIN — Automated Dev Panel Test Runner
 * Paste this ENTIRE script into the browser console (F12 → Console)
 * It will run all 4 tests in sequence and print a PASS/FAIL report.
 * 
 * Usage: Copy all of this, paste into console, press Enter.
 */
(async function runAllTests() {
  const PASS = '✅ PASS';
  const FAIL = '❌ FAIL';
  const results = [];
  const log = (msg) => console.log(`%c[AERO TWIN TEST] ${msg}`, 'color:#38bdf8;font-weight:600;');
  const wait = (ms) => new Promise(r => setTimeout(r, ms));

  const checkNoNaN = () => {
    const text = document.body.innerText;
    return !text.includes('NaN') && !text.includes('Infinity') && !text.includes('undefined');
  };
  const checkEhiValid = () => {
    const ehi = window.appState && window.appState.ehi;
    return typeof ehi === 'number' && isFinite(ehi) && !isNaN(ehi);
  };
  const checkAppAlive = () => {
    const s = window.appState;
    return s && s.rawTelemetry !== null;
  };

  log('=== STARTING AERO TWIN ERROR HANDLING TEST SUITE ===');
  log('All tests run through the REAL Validator → SensorTrust → AI → UI pipeline.');

  // ──────────────────────────────────────────────────────────────
  // TEST 1: Oil Pressure Sensor Fault
  // ──────────────────────────────────────────────────────────────
  log('TEST 1: Injecting oilPress = -50 PSI ...');
  const savedOilPress = window.telemetryEngine && window.telemetryEngine.state.oilPress;
  if (window.telemetryEngine) window.telemetryEngine.state.oilPress = -50;
  await wait(300);

  const t1_noNaN = checkNoNaN();
  const t1_ehiOk = checkEhiValid();
  const t1_alive = checkAppAlive();
  const t1_trust = window.appState && window.appState.trustResult && window.appState.trustResult.scores && window.appState.trustResult.scores.oilPress;
  const t1_fault = window.appState && window.appState.diagnosticResult && window.appState.diagnosticResult.faultClass;
  const t1_sensorInvalid = t1_trust !== undefined && t1_trust < 0.5;
  const t1_pass = t1_noNaN && t1_ehiOk && t1_alive;

  results.push({ test: 'TEST 1 — Oil Pressure Sensor Fault', status: t1_pass ? PASS : FAIL,
    details: `NaN-free=${t1_noNaN} | EHI valid=${t1_ehiOk} | App alive=${t1_alive} | oilPress trust=${t1_trust !== undefined ? t1_trust.toFixed(2) : 'N/A'} | faultClass=${t1_fault || 'HEALTHY'} | sensorInvalid=${t1_sensorInvalid}`
  });
  console[t1_pass ? 'info' : 'error'](`[TEST 1] ${t1_pass ? PASS : FAIL}`);

  // Reset
  if (window.telemetryEngine) window.telemetryEngine.state.oilPress = savedOilPress || 52.4;
  await wait(200);

  // ──────────────────────────────────────────────────────────────
  // TEST 2: Missing Telemetry (EGT = null)
  // ──────────────────────────────────────────────────────────────
  log('TEST 2: Injecting egt = null ...');
  const savedEgt = window.telemetryEngine && window.telemetryEngine.state.egt;
  if (window.telemetryEngine) window.telemetryEngine.state.egt = null;
  await wait(300);

  const t2_noNaN = checkNoNaN();
  const t2_ehiOk = checkEhiValid();
  const t2_alive = checkAppAlive();
  const t2_pass = t2_noNaN && t2_ehiOk && t2_alive;

  results.push({ test: 'TEST 2 — Missing Telemetry (Null EGT)', status: t2_pass ? PASS : FAIL,
    details: `NaN-free=${t2_noNaN} | EHI valid=${t2_ehiOk} | App alive=${t2_alive}`
  });
  console[t2_pass ? 'info' : 'error'](`[TEST 2] ${t2_pass ? PASS : FAIL}`);

  // Reset
  if (window.telemetryEngine) window.telemetryEngine.state.egt = savedEgt || [780, 776, 792, 779];
  await wait(200);

  // ──────────────────────────────────────────────────────────────
  // TEST 3: Malformed Telemetry Payload
  // ──────────────────────────────────────────────────────────────
  log('TEST 3: Sending malformed packet through telemetryAdapter._dispatch() ...');
  const preState = window.appState && JSON.stringify({ehi: window.appState.ehi, diag: window.appState.aiDiagnosis});
  if (window.telemetryAdapter) window.telemetryAdapter._dispatch({ rpm: 'not-a-number', bad: true, x: 99 }, null, null);
  await wait(300);

  const t3_noNaN = checkNoNaN();
  const t3_alive = checkAppAlive();
  const t3_statePreserved = JSON.stringify({ehi: window.appState && window.appState.ehi, diag: window.appState && window.appState.aiDiagnosis}) === preState;
  const t3_pass = t3_noNaN && t3_alive;

  results.push({ test: 'TEST 3 — Malformed Telemetry Payload', status: t3_pass ? PASS : FAIL,
    details: `NaN-free=${t3_noNaN} | App alive=${t3_alive} | State preserved=${t3_statePreserved}`
  });
  console[t3_pass ? 'info' : 'error'](`[TEST 3] ${t3_pass ? PASS : FAIL}`);

  await wait(200);

  // ──────────────────────────────────────────────────────────────
  // TEST 4: Connection Failure (5s)
  // ──────────────────────────────────────────────────────────────
  log('TEST 4: Simulating 5s telemetry disconnect ...');
  if (window.telemetryAdapter) window.telemetryAdapter.simulateDisconnect(5000);

  // Check mid-disconnect at 2.5s
  await wait(2500);
  const t4_disconnected = window.telemetryAdapter && !window.telemetryAdapter.isConnected;
  const t4_mid_noNaN = checkNoNaN();
  log(`TEST 4: Mid-disconnect state — isConnected=${window.telemetryAdapter && window.telemetryAdapter.isConnected}, NaN-free=${t4_mid_noNaN}`);

  // Check after reconnect at 7s
  await wait(5000);
  const t4_reconnected = window.telemetryAdapter && window.telemetryAdapter.isConnected;
  const t4_noNaN = checkNoNaN();
  const t4_alive = checkAppAlive();
  const t4_pass = t4_disconnected && t4_reconnected && t4_noNaN && t4_alive;

  results.push({ test: 'TEST 4 — Connection Failure (5s Disconnect)', status: t4_pass ? PASS : FAIL,
    details: `Disconnected=${t4_disconnected} | Reconnected=${t4_reconnected} | NaN-free=${t4_noNaN} | App alive=${t4_alive}`
  });
  console[t4_pass ? 'info' : 'error'](`[TEST 4] ${t4_pass ? PASS : FAIL}`);

  // Final reset
  if (window.DevTestPanel) window.DevTestPanel.runTest('reset');
  await wait(300);

  // ──────────────────────────────────────────────────────────────
  // PRINT FULL REPORT
  // ──────────────────────────────────────────────────────────────
  log('=== TEST SUITE COMPLETE ===');
  console.log('\n%c AERO TWIN ERROR HANDLING — TEST RESULTS', 'font-size:14px;font-weight:700;color:#00f0ff;background:#0b1120;padding:4px 8px;border-radius:4px;');
  results.forEach(r => {
    const color = r.status.includes('PASS') ? '#10b981' : '#ef4444';
    console.log(`%c ${r.status} ${r.test}\n%c   ${r.details}`, `font-weight:700;color:${color}`, 'color:#94a3b8;font-size:0.9em');
  });

  const passCount = results.filter(r => r.status.includes('PASS')).length;
  const totalCount = results.length;
  console.log(`\n%c RESULT: ${passCount}/${totalCount} tests passed`, `font-size:13px;font-weight:700;color:${passCount === totalCount ? '#10b981' : '#ef4444'}`);

  return results;
})();
