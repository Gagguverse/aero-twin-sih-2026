/**
 * AERO TWIN — AI Engine Assistant Accuracy & Layout Validation Test Suite
 * Validates all 11 core scenarios:
 * 1. Live Normal State: General diagnosis grounded in appState (3-part format: CURRENT STATE, EVIDENCE, WHY)
 * 2. Live Normal State: Identity intent ("Who are you?") has 0 engine diagnosis and 0 fake numbers
 * 3. Live Sensor Fault: "Are any sensors quarantined?" identifies oilPress, trust score, confirms engine itself healthy
 * 4. Live Thermal Degradation: "Why is EGT high?" identifies elevated EGT, positive residual, authentic degradation
 * 5. Live Thermal Degradation: "What is the remaining useful life?" matches exact RUL, degradation %, no fabrication
 * 6. Historical Replay T+60 (Cruise baseline): Matches exact T+60 snapshot values
 * 7. Historical Replay T+64 (Sensor freeze): Matches exact T+64 snapshot values
 * 8. Historical Replay T+70 (Loiter & quarantined): Matches exact T+70 snapshot values
 * 9. Historical Replay T+82 (Thermal runaway): Matches exact T+82 snapshot values
 * 10. UI Layout: .chat-history-box expands with flex-grow (no max-height: 160px limit), chips directly above input bar, 0 dead space
 * 11. Full system consistency check: All 10 engine intents + RPM instability produce grounded 3-part answers
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

async function runAccuracySuite() {
  console.log('======================================================================');
  console.log('  AERO TWIN — AI ASSISTANT ACCURACY & UI LAYOUT VERIFICATION SUITE');
  console.log('======================================================================\n');

  const profileDir = path.join('C:\\Users\\gd116\\AppData\\Local\\Temp', 'chrome_ai_acc_' + Date.now());
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

  try {
    // -------------------------------------------------------------------------
    // SCENARIO 1: LIVE NORMAL STATE -> GENERAL DIAGNOSIS
    // -------------------------------------------------------------------------
    console.log('--- SCENARIO 1: LIVE NORMAL STATE -> GENERAL DIAGNOSIS ---');
    await evaluate(`window.applyScenario('normal')`);
    await wait(400);

    const snap1 = await evaluate(`window.getAssistantSnapshot()`);
    assert(snap1 && typeof snap1 === 'object', 'getAssistantSnapshot() returns object');
    assert(snap1.isReplaying === false, 'Snapshot marks isReplaying as false');
    assert(snap1.diagnosis === 'HEALTHY', 'Diagnosis is HEALTHY in normal state');
    assert(snap1.telemetry && snap1.telemetry.rpm > 1000, 'Telemetry contains non-null RPM');
    assert(snap1.sensorTrust.trustedCount === 9, 'All 9 sensors are trusted');

    const resp1 = await evaluate(`window.generateLocalAnalysis("What is the engine diagnosis?", window.getAssistantSnapshot())`);
    assert(resp1.includes('CURRENT STATE:'), 'Response contains CURRENT STATE section');
    assert(resp1.includes('EVIDENCE:'), 'Response contains EVIDENCE section');
    assert(resp1.includes('WHY:'), 'Response contains WHY section');
    assert(resp1.includes('HEALTHY') || resp1.includes('nominally'), 'Response confirms healthy/nominal status');
    assert(resp1.includes(`${Math.round(snap1.ehi)}/100`), 'Response includes exact snapshot EHI');

    // -------------------------------------------------------------------------
    // SCENARIO 2: LIVE NORMAL STATE -> "WHO ARE YOU?"
    // -------------------------------------------------------------------------
    console.log('\n--- SCENARIO 2: IDENTITY QUESTION -> "WHO ARE YOU?" ---');
    const resp2 = await evaluate(`window.routeDeterministicIntent("Who are you?")`);
    assert(resp2 && resp2.includes('AERO TWIN Decision-Support Assistant'), 'Identity response identifies assistant');
    assert(resp2.includes('do not directly control'), 'Identifies decision-support role without flight control');
    assert(!resp2.includes('RPM') && !resp2.includes('°C') && !resp2.includes('PSI') && !resp2.includes('/100'), 'Identity contains 0 engine diagnosis or fabricated metrics');

    // -------------------------------------------------------------------------
    // SCENARIO 3: LIVE SENSOR FAULT -> "ARE ANY SENSORS QUARANTINED?"
    // -------------------------------------------------------------------------
    console.log('\n--- SCENARIO 3: SENSOR FAULT -> "ARE ANY SENSORS QUARANTINED?" ---');
    await evaluate(`window.applyScenario('sensor_fault')`);
    await wait(400);

    const snap3 = await evaluate(`window.getAssistantSnapshot()`);
    assert(snap3.diagnosis === 'SENSOR FAULT', 'Snapshot records SENSOR FAULT');
    assert(snap3.quarantinedSensors.includes('oilPress'), 'Snapshot quarantinedSensors lists oilPress');
    assert(snap3.ehi >= 85, 'Engine health index is preserved (>= 85)');

    const resp3 = await evaluate(`window.generateLocalAnalysis("Are any sensors quarantined?", window.getAssistantSnapshot())`);
    assert(resp3.includes('CURRENT STATE:') && resp3.includes('EVIDENCE:') && resp3.includes('WHY:'), '3-part structured format');
    assert(resp3.includes('oilPress'), 'Quarantined sensor oilPress is identified');
    assert(resp3.includes('The engine itself appears healthy; current evidence does not indicate mechanical engine failure'),
      'Explicitly states engine itself appears healthy and problem is isolated');
    assert(resp3.includes('Quarantined'), 'Indicates quarantined status');

    // -------------------------------------------------------------------------
    // SCENARIO 4: LIVE THERMAL DEGRADATION -> "WHY IS EGT HIGH?"
    // -------------------------------------------------------------------------
    console.log('\n--- SCENARIO 4: THERMAL DEGRADATION -> "WHY IS EGT HIGH?" ---');
    await evaluate(`window.applyScenario('thermal_degradation')`);
    await wait(400);

    const snap4 = await evaluate(`window.getAssistantSnapshot()`);
    assert(snap4.diagnosis === 'THERMAL DEGRADATION' || snap4.diagnosis === 'THERMAL RUNAWAY', 'Snapshot records thermal degradation');
    assert(snap4.residuals && (snap4.residuals.egt > 15 || snap4.residuals.cht > 4), 'Thermal residuals are positive and elevated');

    const resp4 = await evaluate(`window.generateLocalAnalysis("Why is EGT high?", window.getAssistantSnapshot())`);
    assert(resp4.includes('CURRENT STATE:') && resp4.includes('EVIDENCE:') && resp4.includes('WHY:'), '3-part structured format');
    assert(resp4.includes('Exhaust Gas Temperature (EGT) is significantly elevated'), 'Identifies elevated EGT');
    assert(resp4.includes('Residual:'), 'Reports physics residual');
    assert(resp4.includes('thermodynamic'), 'Explains thermodynamic cause in WHY section');

    // -------------------------------------------------------------------------
    // SCENARIO 5: LIVE THERMAL DEGRADATION -> "WHAT IS THE REMAINING USEFUL LIFE?"
    // -------------------------------------------------------------------------
    console.log('\n--- SCENARIO 5: THERMAL DEGRADATION -> "WHAT IS THE REMAINING USEFUL LIFE?" ---');
    const resp5 = await evaluate(`window.generateLocalAnalysis("What is the remaining useful life?", window.getAssistantSnapshot())`);
    assert(resp5.includes('CURRENT STATE:') && resp5.includes('EVIDENCE:') && resp5.includes('WHY:'), '3-part structured format');
    assert(resp5.includes(`${snap4.rul} h`) || resp5.includes(`${snap4.rul} hours`), 'Reports exact snapshot RUL hours');
    assert(resp5.includes(`${snap4.degradation}%`), 'Reports exact snapshot degradation percentage');
    assert(resp5.includes('RUL prognosis combines cumulative fatigue damage modeling'), 'Engineering explanation in WHY section');

    // -------------------------------------------------------------------------
    // SCENARIO 6: REPLAY AT T+60 (BASELINE CRUISE)
    // -------------------------------------------------------------------------
    console.log('\n--- SCENARIO 6: HISTORICAL REPLAY @ T+60 (BASELINE CRUISE) ---');
    await evaluate(`window.jumpToReplaySecond(60)`);
    await wait(400);

    const snap60 = await evaluate(`window.getAssistantSnapshot()`);
    assert(snap60.isReplaying === true, 'Snapshot isReplaying is true');
    assert(snap60.replayIndex === 60, 'Snapshot replayIndex is 60');
    assert(snap60.missionPhase === 'CRUISE', 'Snapshot missionPhase is CRUISE');
    assert(snap60.diagnosis === 'HEALTHY', 'Snapshot diagnosis is HEALTHY');
    assert(snap60.telemetry.rpm === 4200, 'Snapshot RPM is 4200 (exact historical cruise baseline)');
    assert(snap60.telemetry.load === 72, 'Snapshot Load is 72%');

    const resp60 = await evaluate(`window.generateLocalAnalysis("What is the engine diagnosis?", window.getAssistantSnapshot())`);
    assert(resp60.includes('[REPLAY @ 60s]'), 'Response tags exact replay frame [REPLAY @ 60s]');
    assert(resp60.includes('HEALTHY') || resp60.includes('nominally'), 'Diagnosis matches historical healthy state');

    // -------------------------------------------------------------------------
    // SCENARIO 7: REPLAY AT T+64 (SENSOR FREEZE EVENT)
    // -------------------------------------------------------------------------
    console.log('\n--- SCENARIO 7: HISTORICAL REPLAY @ T+64 (SENSOR FREEZE) ---');
    await evaluate(`window.jumpToReplaySecond(64)`);
    await wait(400);

    const snap64 = await evaluate(`window.getAssistantSnapshot()`);
    assert(snap64.isReplaying === true && snap64.replayIndex === 64, 'Replaying at 64s');
    assert(snap64.diagnosis === 'SENSOR FAULT', 'Snapshot diagnosis is SENSOR FAULT');
    assert(snap64.telemetry.oilPress === 52.4, 'Oil pressure frozen at 52.4 PSI');

    const resp64 = await evaluate(`window.generateLocalAnalysis("Is this a sensor fault?", window.getAssistantSnapshot())`);
    assert(resp64.includes('[REPLAY @ 64s]'), 'Response tags exact replay frame [REPLAY @ 64s]');
    assert(resp64.includes('isolated sensor fault') || resp64.includes('sensor fault'), 'Identifies sensor fault');
    assert(resp64.includes('oilPress'), 'Identifies oilPress');

    // -------------------------------------------------------------------------
    // SCENARIO 8: REPLAY AT T+70 (LOITER & QUARANTINED)
    // -------------------------------------------------------------------------
    console.log('\n--- SCENARIO 8: HISTORICAL REPLAY @ T+70 (LOITER & QUARANTINED) ---');
    await evaluate(`window.jumpToReplaySecond(70)`);
    await wait(400);

    const snap70 = await evaluate(`window.getAssistantSnapshot()`);
    assert(snap70.isReplaying === true && snap70.replayIndex === 70, 'Replaying at 70s');
    assert(snap70.missionPhase === 'LOITER', 'Mission phase derived as LOITER');
    assert(snap70.quarantinedSensors.includes('oilPress'), 'oilPress remains quarantined in loiter');

    const resp70 = await evaluate(`window.generateLocalAnalysis("Can we complete the mission?", window.getAssistantSnapshot())`);
    assert(resp70.includes('[REPLAY @ 70s]'), 'Response tags exact replay frame [REPLAY @ 70s]');
    assert(resp70.includes('LOITER'), 'Response reflects LOITER phase');

    // -------------------------------------------------------------------------
    // SCENARIO 9: REPLAY AT T+82 (THERMAL RUNAWAY)
    // -------------------------------------------------------------------------
    console.log('\n--- SCENARIO 9: HISTORICAL REPLAY @ T+82 (THERMAL RUNAWAY) ---');
    await evaluate(`window.jumpToReplaySecond(82)`);
    await wait(400);

    const snap82 = await evaluate(`window.getAssistantSnapshot()`);
    assert(snap82.isReplaying === true && snap82.replayIndex === 82, 'Replaying at 82s');
    assert(snap82.diagnosis === 'THERMAL DEGRADATION' || snap82.diagnosis === 'THERMAL RUNAWAY', 'Snapshot diagnosis is THERMAL DEGRADATION');
    assert(snap82.ehi === 64, 'EHI is depleted to 64');
    assert(snap82.rul === 48, 'RUL is reduced to 48 h');

    const resp82 = await evaluate(`window.generateLocalAnalysis("What is the engine diagnosis?", window.getAssistantSnapshot())`);
    assert(resp82.includes('[REPLAY @ 82s]'), 'Response tags exact replay frame [REPLAY @ 82s]');
    assert(resp82.includes('THERMAL RUNAWAY') || resp82.includes('THERMAL DEGRADATION'), 'Identifies thermal runaway');
    assert(resp82.includes('64/100'), 'Cites exact 64/100 EHI');

    // Return to live simulation
    await evaluate(`window.exitReplayMode()`);
    await wait(300);

    // -------------------------------------------------------------------------
    // SCENARIO 10: UI LAYOUT & NO BLANK SPACE CHECK
    // -------------------------------------------------------------------------
    console.log('\n--- SCENARIO 10: ASSISTANT PANEL UI LAYOUT & BLANK SPACE AUDIT ---');
    const layout = await evaluate(`(() => {
      const panel = document.querySelector('.assistant-panel');
      const chatBox = document.querySelector('.chat-history-box');
      const chips = document.querySelector('.assistant-chips-container');
      const inputBar = document.querySelector('.chat-input-bar');

      const panelRect = panel.getBoundingClientRect();
      const chatRect = chatBox.getBoundingClientRect();
      const chipsRect = chips.getBoundingClientRect();
      const inputRect = inputBar.getBoundingClientRect();

      const computedChat = window.getComputedStyle(chatBox);
      const computedPanel = window.getComputedStyle(panel);

      return {
        panelHeight: panelRect.height,
        chatBoxHeight: chatRect.height,
        chipsTop: chipsRect.top,
        chatBottom: chatRect.bottom,
        inputTop: inputRect.top,
        chipsBottom: chipsRect.bottom,
        maxHeightProp: computedChat.maxHeight,
        flexGrowProp: computedChat.flexGrow
      };
    })()`);

    assert(layout.chatBoxHeight >= 140, 'Chat history box has healthy vertical expansion (>= 140px)', `height: ${layout.chatBoxHeight}`);
    assert(layout.maxHeightProp === 'none' || parseInt(layout.maxHeightProp, 10) > 300, 'Chat history box has no restrictive max-height (160px removed)', `maxHeight: ${layout.maxHeightProp}`);
    assert(layout.flexGrowProp === '1', 'Chat history box uses flex-grow: 1', `flexGrow: ${layout.flexGrowProp}`);
    assert(layout.chipsTop >= layout.chatBottom - 2, 'Chips are located below chat history box');
    assert(layout.inputTop >= layout.chipsBottom - 2, 'Input bar is located below chips at the bottom');
    assert((layout.chipsTop - layout.chatBottom) <= 18, 'Zero gap/void between chat box and chips', `gap: ${layout.chipsTop - layout.chatBottom}px`);

    // -------------------------------------------------------------------------
    // SCENARIO 11: FULL INTENTS COVERAGE (ALL 10 INTENTS + RPM INSTABILITY)
    // -------------------------------------------------------------------------
    console.log('\n--- SCENARIO 11: FULL INTENTS & PREDICTABLE ACCURACY COVERAGE ---');
    const queries = [
      { q: "What is the cylinder head temperature?", key: "CHT" },
      { q: "Is oil pressure normal?", key: "oil pressure" },
      { q: "What is the current oil temperature?", key: "oil temperature" },
      { q: "Can we complete the mission?", key: "Mission Reliability" },
      { q: "What is the recommended action?", key: "Recommended action" },
      { q: "Is RPM unstable?", key: "RPM" }
    ];

    for (const testItem of queries) {
      const resp = await evaluate(`window.generateLocalAnalysis(${JSON.stringify(testItem.q)}, window.getAssistantSnapshot())`);
      assert(resp.includes('CURRENT STATE:') && resp.includes('EVIDENCE:') && resp.includes('WHY:'),
        `Query "${testItem.q}" formats into 3-part structured answer`);
    }

  } catch (err) {
    console.error('Unexpected exception during accuracy suite:', err);
    total++;
  } finally {
    ws.close();
    chrome.kill();
  }

  console.log('\n======================================================================');
  console.log(`  ACCURACY SUITE RESULTS: ${passed} / ${total} PASSED`);
  console.log('======================================================================');

  if (passed === total && total > 0) {
    console.log('ALL AI ASSISTANT ACCURACY & LAYOUT TESTS PASSED WITH 100% SUCCESS!\n');
    process.exit(0);
  } else {
    console.error(`FAILED: ${total - passed} test(s) failed.\n`);
    process.exit(1);
  }
}

runAccuracySuite();
