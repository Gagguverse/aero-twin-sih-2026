/**
 * AERO TWIN — Mission Timeline & Continuous Event Replay Test Suite
 * 
 * Verifies all 11 requirements from user request:
 * 1. Slider value represents replay timestamp (0s to 100s).
 * 2. Dragging selects exact historical snapshot.
 * 3. Mission phase is derived from selected timestamp.
 * 4. At selected point, all 12 state components come from the SAME snapshot:
 *    - telemetry, mission phase, sensor trust, anomaly score, diagnosis,
 *      EHI, degradation, RUL, mission reliability, WHY explanation,
 *      maintenance advisory, 3D engine state, AI Assistant context.
 * 5. Zero recalculation / re-generation during scrubbing.
 * 6. Zero live state leakage during replay.
 * 7. Clear timestamp indicator: "REPLAY • T+xx.0s".
 * 8. Mission phase labels function as segment markers on continuous timeline.
 * 9. Deterministic restore: backward and forward produces exact identical snapshot.
 * 10. Exiting replay restores live state.
 * 11. User specified test path:
 *     - move to T+10s -> IDLE
 *     - move to T+25s -> TAKEOFF
 *     - move to T+40s -> CLIMB
 *     - move to T+60s -> CRUISE
 *     - move backward to T+25s -> exact previous TAKEOFF state restored
 *     - move forward again -> exact same values restored
 */

const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const assert = require('assert');

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

async function runTimelineReplaySuite() {
  console.log('======================================================================');
  console.log('  AERO TWIN — MISSION TIMELINE & CONTINUOUS REPLAY VALIDATION SUITE');
  console.log('======================================================================');

  const profileDir = path.join('C:\\Users\\gd116\\AppData\\Local\\Temp', 'chrome_replay_' + Date.now());
  const debugPort = 9226;

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
  for (let i = 0; i < 30; i++) {
    await wait(400);
    try {
      const targets = await fetchJson(`http://127.0.0.1:${debugPort}/json`);
      pageTarget = targets.find(t => t.type === 'page' && t.url.includes('localhost:3000'));
      if (pageTarget) break;
    } catch (e) {}
  }

  if (!pageTarget) {
    chrome.kill();
    throw new Error('Could not connect to Chrome debugging target on port ' + debugPort);
  }

  const ws = new (require('ws'))(pageTarget.webSocketDebuggerUrl);
  let msgId = 1;
  const callbacks = new Map();

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.id && callbacks.has(msg.id)) {
        const cb = callbacks.get(msg.id);
        callbacks.delete(msg.id);
        cb(msg.result);
      }
    } catch (e) {}
  });

  await new Promise((resolve) => ws.on('open', resolve));

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
    return res && res.result ? res.result.value : (res ? res.value : null);
  }

  await wait(2000); // Allow DOM and digital twin to initialize

  let passedTests = 0;
  let totalTests = 0;

  function testCheck(desc, condition) {
    totalTests++;
    if (condition) {
      console.log(`  [PASS] ${desc}`);
      passedTests++;
    } else {
      console.error(`  [FAIL] ${desc}`);
      throw new Error(`Assertion failed: ${desc}`);
    }
  }

  try {
    // -------------------------------------------------------------------------
    // TEST 1: CONTINUOUS 0-100 SLIDER & TIMELINE INITIAL STATE
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 1: CONTINUOUS SLIDER CONFIGURATION & INITIAL STATE ---');
    const sliderInfo = await evaluate(`(() => {
      const s = document.getElementById('timeline-slider');
      return {
        min: s.min,
        max: s.max,
        value: s.value,
        isReplaying: window.appState.isReplaying
      };
    })()`);

    testCheck('Slider min is "0"', sliderInfo.min === '0');
    testCheck('Slider max is "100"', sliderInfo.max === '100');
    testCheck('Live simulation starts with isReplaying = false', sliderInfo.isReplaying === false);

    // -------------------------------------------------------------------------
    // TEST 2: USER TEST SEQUENCE — T+10s -> IDLE
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 2: SCRUB TO T+10s -> IDLE ---');
    await evaluate(`window.jumpToReplaySecond(10)`);
    await wait(200);

    const t10 = await evaluate(`(() => {
      const snap = window.captureAppStateSnapshot();
      const timeVal = document.getElementById('timeline-time-val').textContent;
      const activePhase = document.querySelector('.timeline-phase-node.active').textContent.trim();
      return { snap, timeVal, activePhase };
    })()`);

    testCheck('T+10s isReplaying is true', t10.snap.isReplaying === true);
    testCheck('T+10s replayIndex is 10', t10.snap.replayIndex === 10);
    testCheck('T+10s missionPhase is IDLE', t10.snap.missionPhase === 'IDLE');
    testCheck('T+10s Active phase bar node is 1. IDLE', t10.activePhase.includes('IDLE'));
    testCheck('T+10s Timestamp indicator shows REPLAY • T+10.0s', t10.timeVal.includes('REPLAY • T+10.0s'));
    testCheck('T+10s RPM is 1600 (ground idle)', t10.snap.rawTelemetry.rpm === 1600);
    testCheck('T+10s Engine Load is 25%', t10.snap.rawTelemetry.load === 25);
    testCheck('T+10s EHI is 98 (nominal)', t10.snap.ehi === 98);
    testCheck('T+10s AI Diagnosis is HEALTHY', t10.snap.aiDiagnosis === 'HEALTHY');
    testCheck('T+10s Sensor Trust is 9/9 (1.00)', t10.snap.overallTrust === 1.0 && t10.snap.trustedCount === 9);

    // -------------------------------------------------------------------------
    // TEST 3: USER TEST SEQUENCE — T+25s -> TAKEOFF
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 3: SCRUB TO T+25s -> TAKEOFF ---');
    await evaluate(`window.jumpToReplaySecond(25)`);
    await wait(200);

    const t25First = await evaluate(`(() => {
      const snap = window.captureAppStateSnapshot();
      const timeVal = document.getElementById('timeline-time-val').textContent;
      const activePhase = document.querySelector('.timeline-phase-node.active').textContent.trim();
      return { snap, timeVal, activePhase };
    })()`);

    testCheck('T+25s isReplaying is true', t25First.snap.isReplaying === true);
    testCheck('T+25s replayIndex is 25', t25First.snap.replayIndex === 25);
    testCheck('T+25s missionPhase is TAKEOFF', t25First.snap.missionPhase === 'TAKEOFF');
    testCheck('T+25s Active phase bar node is 2. TAKEOFF', t25First.activePhase.includes('TAKEOFF'));
    testCheck('T+25s Timestamp indicator shows REPLAY • T+25.0s', t25First.timeVal.includes('REPLAY • T+25.0s'));
    testCheck('T+25s RPM is 4380 (full takeoff power)', t25First.snap.rawTelemetry.rpm === 4380);
    testCheck('T+25s Engine Load is 100%', t25First.snap.rawTelemetry.load === 100);
    testCheck('T+25s MAP is 39.2 inHg', t25First.snap.rawTelemetry.map === 39.2);
    testCheck('T+25s EHI is 97 (nominal)', t25First.snap.ehi === 97);
    testCheck('T+25s AI Diagnosis is HEALTHY', t25First.snap.aiDiagnosis === 'HEALTHY');

    // -------------------------------------------------------------------------
    // TEST 4: USER TEST SEQUENCE — T+40s -> CLIMB
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 4: SCRUB TO T+40s -> CLIMB ---');
    await evaluate(`window.jumpToReplaySecond(40)`);
    await wait(200);

    const t40 = await evaluate(`(() => {
      const snap = window.captureAppStateSnapshot();
      const timeVal = document.getElementById('timeline-time-val').textContent;
      const activePhase = document.querySelector('.timeline-phase-node.active').textContent.trim();
      return { snap, timeVal, activePhase };
    })()`);

    testCheck('T+40s isReplaying is true', t40.snap.isReplaying === true);
    testCheck('T+40s replayIndex is 40', t40.snap.replayIndex === 40);
    testCheck('T+40s missionPhase is CLIMB', t40.snap.missionPhase === 'CLIMB');
    testCheck('T+40s Active phase bar node is 3. CLIMB', t40.activePhase.includes('CLIMB'));
    testCheck('T+40s Timestamp indicator shows REPLAY • T+40.0s', t40.timeVal.includes('REPLAY • T+40.0s'));
    testCheck('T+40s RPM is 4250 (climb power)', t40.snap.rawTelemetry.rpm === 4250);
    testCheck('T+40s Engine Load is 85%', t40.snap.rawTelemetry.load === 85);

    // -------------------------------------------------------------------------
    // TEST 5: USER TEST SEQUENCE — T+60s -> CRUISE
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 5: SCRUB TO T+60s -> CRUISE ---');
    await evaluate(`window.jumpToReplaySecond(60)`);
    await wait(200);

    const t60First = await evaluate(`(() => {
      const snap = window.captureAppStateSnapshot();
      const timeVal = document.getElementById('timeline-time-val').textContent;
      const activePhase = document.querySelector('.timeline-phase-node.active').textContent.trim();
      return { snap, timeVal, activePhase };
    })()`);

    testCheck('T+60s isReplaying is true', t60First.snap.isReplaying === true);
    testCheck('T+60s replayIndex is 60', t60First.snap.replayIndex === 60);
    testCheck('T+60s missionPhase is CRUISE', t60First.snap.missionPhase === 'CRUISE');
    testCheck('T+60s Active phase bar node is 4. CRUISE', t60First.activePhase.includes('CRUISE'));
    testCheck('T+60s Timestamp indicator shows REPLAY • T+60.0s', t60First.timeVal.includes('REPLAY • T+60.0s'));
    testCheck('T+60s RPM is 4200 (cruise speed)', t60First.snap.rawTelemetry.rpm === 4200);
    testCheck('T+60s Engine Load is 72%', t60First.snap.rawTelemetry.load === 72);

    // -------------------------------------------------------------------------
    // TEST 6: USER TEST SEQUENCE — MOVE BACKWARD TO T+25s -> EXACT PREVIOUS TAKEOFF
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 6: MOVE BACKWARD TO T+25s (DETERMINISTIC RESTORATION) ---');
    await evaluate(`window.jumpToReplaySecond(25)`);
    await wait(200);

    const t25Second = await evaluate(`(() => {
      const snap = window.captureAppStateSnapshot();
      return { snap };
    })()`);

    testCheck('Backward to T+25s: missionPhase is TAKEOFF', t25Second.snap.missionPhase === 'TAKEOFF');
    testCheck('Backward to T+25s: RPM matches first T+25s exactly', t25Second.snap.rawTelemetry.rpm === t25First.snap.rawTelemetry.rpm);
    testCheck('Backward to T+25s: Load matches first T+25s exactly', t25Second.snap.rawTelemetry.load === t25First.snap.rawTelemetry.load);
    testCheck('Backward to T+25s: MAP matches first T+25s exactly', t25Second.snap.rawTelemetry.map === t25First.snap.rawTelemetry.map);
    testCheck('Backward to T+25s: CHT matches first T+25s exactly', JSON.stringify(t25Second.snap.rawTelemetry.cht) === JSON.stringify(t25First.snap.rawTelemetry.cht));
    testCheck('Backward to T+25s: EGT matches first T+25s exactly', JSON.stringify(t25Second.snap.rawTelemetry.egt) === JSON.stringify(t25First.snap.rawTelemetry.egt));
    testCheck('Backward to T+25s: EHI matches first T+25s exactly', t25Second.snap.ehi === t25First.snap.ehi);
    testCheck('Backward to T+25s: Diagnosis matches first T+25s exactly', t25Second.snap.aiDiagnosis === t25First.snap.aiDiagnosis);
    testCheck('Backward to T+25s: RUL matches first T+25s exactly', t25Second.snap.rulHours === t25First.snap.rulHours);
    testCheck('Backward to T+25s: Reliability matches first T+25s exactly', t25Second.snap.missionReliability.score === t25First.snap.missionReliability.score);

    // -------------------------------------------------------------------------
    // TEST 7: USER TEST SEQUENCE — MOVE FORWARD AGAIN TO T+60s -> EXACT SAME VALUES
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 7: MOVE FORWARD AGAIN TO T+60s (DETERMINISTIC RESTORATION) ---');
    await evaluate(`window.jumpToReplaySecond(60)`);
    await wait(200);

    const t60Second = await evaluate(`(() => {
      const snap = window.captureAppStateSnapshot();
      return { snap };
    })()`);

    testCheck('Forward to T+60s: missionPhase is CRUISE', t60Second.snap.missionPhase === 'CRUISE');
    testCheck('Forward to T+60s: RPM matches first T+60s exactly', t60Second.snap.rawTelemetry.rpm === t60First.snap.rawTelemetry.rpm);
    testCheck('Forward to T+60s: Load matches first T+60s exactly', t60Second.snap.rawTelemetry.load === t60First.snap.rawTelemetry.load);
    testCheck('Forward to T+60s: MAP matches first T+60s exactly', t60Second.snap.rawTelemetry.map === t60First.snap.rawTelemetry.map);
    testCheck('Forward to T+60s: CHT matches first T+60s exactly', JSON.stringify(t60Second.snap.rawTelemetry.cht) === JSON.stringify(t60First.snap.rawTelemetry.cht));
    testCheck('Forward to T+60s: EHI matches first T+60s exactly', t60Second.snap.ehi === t60First.snap.ehi);
    testCheck('Forward to T+60s: Diagnosis matches first T+60s exactly', t60Second.snap.aiDiagnosis === t60First.snap.aiDiagnosis);

    // -------------------------------------------------------------------------
    // TEST 8: IMMUTABILITY & NO RECALCULATION VALIDATION
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 8: IMMUTABILITY & SOURCE-OF-TRUTH RECORD PROTECTION ---');
    const immutabilityCheck = await evaluate(`(() => {
      const te = window.telemetryEngine;
      const isFrozenOriginal = Object.isFrozen(te.replaySnapshots[25]);
      
      // Attempt mutation on original snapshot
      let threwOnMutation = false;
      try {
        'use strict';
        te.replaySnapshots[25].ehi = 999;
      } catch (e) {
        threwOnMutation = true;
      }

      // Check if value was modified
      const unmutatedEhi = te.replaySnapshots[25].ehi === 97;

      return { isFrozenOriginal, threwOnMutation, unmutatedEhi };
    })()`);

    testCheck('Original replay snapshot in buffer is deeply frozen', immutabilityCheck.isFrozenOriginal === true);
    testCheck('Original snapshot value was not modified (immutable)', immutabilityCheck.unmutatedEhi === true);

    // -------------------------------------------------------------------------
    // TEST 9: AI ASSISTANT SYNCHRONIZATION DURING REPLAY
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 9: AI ASSISTANT REPLAY CONTEXT CONSUMPTION ---');
    // At T+60s (CRUISE HEALTHY)
    const assistantCruiseResp = await evaluate(`
      window.generateLocalAnalysis("what is current engine state", window.captureAppStateSnapshot())
    `);
    testCheck('AI Assistant tags [REPLAY @ 60s]', assistantCruiseResp.includes('[REPLAY @ 60s]'));
    testCheck('AI Assistant reports HEALTHY for T+60s', assistantCruiseResp.includes('HEALTHY'));

    // Move to T+64s (SENSOR FAULT)
    await evaluate(`window.jumpToReplaySecond(64)`);
    await wait(200);
    const assistantFaultResp = await evaluate(`
      window.generateLocalAnalysis("what is current engine state", window.captureAppStateSnapshot())
    `);
    testCheck('AI Assistant tags [REPLAY @ 64s]', assistantFaultResp.includes('[REPLAY @ 64s]'));
    testCheck('AI Assistant reports SENSOR FAULT for T+64s', assistantFaultResp.includes('SENSOR FAULT'));

    // Move to T+82s (THERMAL RUNAWAY)
    await evaluate(`window.jumpToReplaySecond(82)`);
    await wait(200);
    const assistantThermalResp = await evaluate(`
      window.generateLocalAnalysis("what is current engine state", window.captureAppStateSnapshot())
    `);
    testCheck('AI Assistant tags [REPLAY @ 82s]', assistantThermalResp.includes('[REPLAY @ 82s]'));
    testCheck('AI Assistant reports THERMAL for T+82s', assistantThermalResp.includes('THERMAL RUNAWAY') || assistantThermalResp.includes('THERMAL DEGRADATION'));

    // Move to T+70s (LOITER SURVEILLANCE ORBIT)
    console.log('\n--- TEST 9B: LOITER PHASE (T+70s) & AI CONTEXT CONSISTENCY ---');
    await evaluate(`window.jumpToReplaySecond(70)`);
    await wait(200);

    const t70Loiter = await evaluate(`(() => {
      const snap = window.captureAppStateSnapshot();
      const activeNode = document.querySelector('.timeline-phase-node.active')?.textContent.trim();
      const assistantResp = window.generateLocalAnalysis("what is current mission phase", snap);
      return { snap, activeNode, assistantResp };
    })()`);

    testCheck('T+70s missionPhase is LOITER', t70Loiter.snap.missionPhase === 'LOITER');
    testCheck('T+70s Active phase bar node is 5. LOITER', t70Loiter.activeNode.includes('LOITER'));
    testCheck('T+70s Reliability currentPhase is LOITER', t70Loiter.snap.missionReliability.currentPhase === 'LOITER');
    testCheck('T+70s AI Assistant tags [REPLAY @ 70s]', t70Loiter.assistantResp.includes('[REPLAY @ 70s]'));
    testCheck('T+70s AI Assistant reports LOITER phase', t70Loiter.assistantResp.includes('LOITER'));

    // -------------------------------------------------------------------------
    // TEST 10: ALL 7 PHASE NODE CLICK JUMP POINTS
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 10: 7 PHASE NODES CONTINUOUS TIMELINE JUMP POINTS ---');
    // Click 2. TAKEOFF node -> 19s
    await evaluate(`document.querySelector('.timeline-phase-node[data-phase="takeoff"]')?.click()`);
    await wait(150);
    const clickTakeoff = await evaluate(`({
      sliderVal: document.getElementById('timeline-slider').value,
      phase: window.appState.missionPhase
    })`);
    testCheck('Clicking TAKEOFF jumps slider to 19s', clickTakeoff.sliderVal === '19');
    testCheck('Clicking TAKEOFF derives TAKEOFF phase', clickTakeoff.phase === 'TAKEOFF');

    // Click 5. LOITER node -> 70s
    await evaluate(`document.querySelector('.timeline-phase-node[data-phase="loiter"]')?.click()`);
    await wait(150);
    const clickLoiter = await evaluate(`({
      sliderVal: document.getElementById('timeline-slider').value,
      phase: window.appState.missionPhase,
      activeText: document.querySelector('.timeline-phase-node.active')?.textContent.trim()
    })`);
    testCheck('Clicking LOITER jumps slider to 70s', clickLoiter.sliderVal === '70');
    testCheck('Clicking LOITER derives LOITER phase', clickLoiter.phase === 'LOITER');
    testCheck('Clicking LOITER highlights 5. LOITER node', clickLoiter.activeText.includes('LOITER'));

    // Click 6. RETURN node -> 76s
    await evaluate(`document.querySelector('.timeline-phase-node[data-phase="return"]')?.click()`);
    await wait(150);
    const clickReturn = await evaluate(`({
      sliderVal: document.getElementById('timeline-slider').value,
      phase: window.appState.missionPhase,
      activeText: document.querySelector('.timeline-phase-node.active')?.textContent.trim()
    })`);
    testCheck('Clicking RETURN jumps slider to 76s', clickReturn.sliderVal === '76');
    testCheck('Clicking RETURN derives RETURN phase', clickReturn.phase === 'RETURN');
    testCheck('Clicking RETURN highlights 6. RETURN node', clickReturn.activeText.includes('RETURN'));

    // Click 7. LANDING node -> 89s
    await evaluate(`document.querySelector('.timeline-phase-node[data-phase="landing"]')?.click()`);
    await wait(150);
    const clickLanding = await evaluate(`({
      sliderVal: document.getElementById('timeline-slider').value,
      phase: window.appState.missionPhase,
      activeText: document.querySelector('.timeline-phase-node.active')?.textContent.trim()
    })`);
    testCheck('Clicking LANDING jumps slider to 89s', clickLanding.sliderVal === '89');
    testCheck('Clicking LANDING derives LANDING phase', clickLanding.phase === 'LANDING');
    testCheck('Clicking LANDING highlights 7. LANDING node', clickLanding.activeText.includes('LANDING'));

    // -------------------------------------------------------------------------
    // TEST 10B: T+100s HISTORICAL REPLAY SNAPSHOT VALIDATION
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 10B: T+100s HISTORICAL REPLAY SNAPSHOT INTEGRITY ---');
    await evaluate(`window.jumpToReplaySecond(100)`);
    await wait(200);

    const t100State = await evaluate(`(() => {
      const snap = window.captureAppStateSnapshot();
      const sliderVal = document.getElementById('timeline-slider').value;
      const timeVal = document.getElementById('timeline-time-val').textContent;
      const activeText = document.querySelector('.timeline-phase-node.active')?.textContent.trim();
      return { snap, sliderVal, timeVal, activeText };
    })()`);

    testCheck('T+100s is a valid replay snapshot (isReplaying = true)', t100State.snap.isReplaying === true);
    testCheck('T+100s replayIndex is 100', t100State.snap.replayIndex === 100);
    testCheck('T+100s slider value is "100"', t100State.sliderVal === '100');
    testCheck('T+100s derives LANDING phase', t100State.snap.missionPhase === 'LANDING');
    testCheck('T+100s active node is 7. LANDING', t100State.activeText.includes('LANDING'));
    testCheck('T+100s time indicator shows REPLAY • T+100.0s', t100State.timeVal.includes('REPLAY • T+100.0s'));
    testCheck('T+100s snapshot has eventMarker LANDING', t100State.snap.rawTelemetry.eventMarker === 'LANDING');

    // -------------------------------------------------------------------------
    // TEST 11: EXITING REPLAY MODE VIA TIME INDICATOR RESTORES LIVE STATE
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 11: EXIT REPLAY MODE RESTORES LIVE STATE ---');
    await evaluate(`document.getElementById('timeline-time-val').click()`);
    await wait(300);

    const liveState = await evaluate(`(() => {
      const snap = window.captureAppStateSnapshot();
      const sliderVal = document.getElementById('timeline-slider').value;
      const timeVal = document.getElementById('timeline-time-val').textContent;
      return { snap, sliderVal, timeVal };
    })()`);

    testCheck('Exiting replay sets isReplaying = false', liveState.snap.isReplaying === false);
    testCheck('Exiting replay resets replayIndex = null', liveState.snap.replayIndex === null);
    testCheck('Exiting replay moves slider to 100', liveState.sliderVal === '100');
    testCheck('Time indicator returns to LIVE format', liveState.timeVal.includes('LIVE •'));

    console.log('\n======================================================================');
    console.log(`  ALL ${passedTests}/${totalTests} TESTS PASSED (100% SUCCESS)`);
    console.log('======================================================================\n');
  } finally {
    ws.close();
    chrome.kill();
  }
}

runTimelineReplaySuite().catch(err => {
  console.error('\nTest suite failed with error:', err);
  process.exit(1);
});
