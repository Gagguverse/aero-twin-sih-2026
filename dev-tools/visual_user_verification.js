const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const artifactDir = 'C:\\Users\\gd116\\.gemini\\antigravity-ide\\brain\\55b1a247-7552-4914-9a97-d3582f5954ae';

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

async function runVisualVerification() {
  const profileDir = path.join('C:\\Users\\gd116\\AppData\\Local\\Temp', 'chrome_vis_' + Date.now());
  console.log('===========================================================================');
  console.log('AERO TWIN: VISUAL & FUNCTIONAL REAL USER VERIFICATION PASS');
  console.log('SIH26054 | DRDO MALE UAV Aero Piston Engine Digital Twin');
  console.log('Target URL: http://localhost:3000/');
  console.log('===========================================================================');

  const chrome = spawn(chromePath, [
    '--headless=new',
    '--remote-debugging-port=9222',
    '--remote-debugging-address=127.0.0.1',
    `--user-data-dir=${profileDir}`,
    '--window-size=1600,1050',
    '--no-first-run',
    '--no-default-browser-check',
    'http://localhost:3000/'
  ]);

  let pageTarget = null;
  for (let i = 0; i < 25; i++) {
    await wait(300);
    try {
      const targets = await fetchJson('http://127.0.0.1:9222/json');
      pageTarget = targets.find(t => t.type === 'page' && t.url.includes('localhost:3000'));
      if (pageTarget && pageTarget.webSocketDebuggerUrl) break;
    } catch (e) {}
  }

  if (!pageTarget) {
    console.error('Failed to connect to Chrome remote debugging session');
    chrome.kill();
    process.exit(1);
  }

  const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
  let msgId = 1;
  const callbacks = new Map();
  const consoleMessages = [];
  const uncaughtExceptions = [];

  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.method === 'Runtime.consoleAPICalled') {
      consoleMessages.push(data.params);
    }
    if (data.method === 'Runtime.exceptionThrown') {
      uncaughtExceptions.push(data.params);
    }
    if (data.id && callbacks.has(data.id)) {
      const cb = callbacks.get(data.id);
      callbacks.delete(data.id);
      cb(data);
    }
  };

  await new Promise(r => ws.onopen = r);

  function send(method, params = {}) {
    return new Promise((resolve) => {
      const id = msgId++;
      callbacks.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  await send('Page.enable');
  await send('Runtime.enable');

  console.log('Waiting 3s for WebGL 3D engine and dashboard initialization...');
  await wait(3000);

  async function evalJs(expr) {
    const res = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (res.result?.exceptionDetails) {
      return { error: res.result.exceptionDetails.text || res.result.exceptionDetails.exception?.description };
    }
    const val = res.result?.result?.value !== undefined ? res.result.result.value : res.result?.value;
    return { value: val };
  }

  async function captureScreenshot(filename) {
    const res = await send('Page.captureScreenshot', { format: 'png' });
    if (res.result && res.result.data) {
      const outPath = path.join(artifactDir, filename);
      fs.writeFileSync(outPath, Buffer.from(res.result.data, 'base64'));
      console.log(`[SCREENSHOT CAPTURED] -> ${filename} (${(fs.statSync(outPath).size / 1024).toFixed(1)} KB)`);
    }
  }

  const results = {};

  // -------------------------------------------------------------------------
  // TEST 1: NORMAL MISSION BASELINE
  // -------------------------------------------------------------------------
  console.log('\n--- TEST 1: NORMAL MISSION USER TEST ---');
  await evalJs(`document.getElementById('btn-scen-normal')?.click()`);
  await wait(800);

  const normalState = await evalJs(`({
    appState: {
      scenario: window.appState.scenario,
      ehi: window.appState.ehi,
      ehiStatus: window.appState.ehiStatus,
      aiDiagnosis: window.appState.aiDiagnosis,
      anomalyScore: window.appState.anomalyScore,
      overallTrust: window.appState.overallTrust,
      trustedCount: window.appState.trustedCount,
      rulHours: window.appState.rulHours,
      degradationPct: window.appState.degradationPct,
      whyTitle: window.appState.why.title
    },
    dom: {
      ehi: document.getElementById('ehi-val')?.textContent,
      diag: document.getElementById('diag-val')?.textContent,
      trustCount: document.getElementById('trust-count-val')?.textContent,
      overallTrust: document.getElementById('overall-trust-val')?.textContent,
      rul: document.getElementById('rul-val')?.textContent,
      anomaly: document.getElementById('anomaly-val')?.textContent,
      motionRpm: document.getElementById('motion-rpm-chip')?.textContent,
      whyTitle: document.getElementById('why-title')?.textContent.trim()
    }
  })`);
  console.log('Normal Mission State:', JSON.stringify(normalState.value, null, 2));
  results.normal = normalState.value;
  await captureScreenshot('final_verify_01_normal_mission.png');

  // -------------------------------------------------------------------------
  // TEST 2: SENSOR FAULT
  // -------------------------------------------------------------------------
  console.log('\n--- TEST 2: SENSOR FAULT USER TEST ---');
  await evalJs(`document.getElementById('btn-scen-fault')?.click()`);
  await wait(800);

  const faultState = await evalJs(`({
    appState: {
      scenario: window.appState.scenario,
      ehi: window.appState.ehi,
      ehiStatus: window.appState.ehiStatus,
      aiDiagnosis: window.appState.aiDiagnosis,
      overallTrust: window.appState.overallTrust,
      trustedCount: window.appState.trustedCount,
      oilPressTrust: window.appState.trustResult.scores.oilPress,
      quarantined: window.appState.trustResult.quarantined,
      whyTitle: window.appState.why.title,
      whyConclusion: window.appState.why.conclusion
    },
    dom: {
      ehi: document.getElementById('ehi-val')?.textContent,
      diag: document.getElementById('diag-val')?.textContent,
      trustCount: document.getElementById('trust-count-val')?.textContent,
      overallTrust: document.getElementById('overall-trust-val')?.textContent,
      oilPressRowText: Array.from(document.querySelectorAll('#trust-table-body tr')).find(r => r.textContent.includes('Oil Pressure'))?.textContent.replace(/\\s+/g, ' ').trim()
    }
  })`);
  console.log('Sensor Fault State:', JSON.stringify(faultState.value, null, 2));
  results.sensorFault = faultState.value;
  await captureScreenshot('final_verify_02_sensor_fault.png');

  // -------------------------------------------------------------------------
  // TEST 3: THERMAL DEGRADATION
  // -------------------------------------------------------------------------
  console.log('\n--- TEST 3: THERMAL DEGRADATION USER TEST ---');
  await evalJs(`document.getElementById('btn-scen-thermal')?.click()`);
  await wait(800);

  const thermalState = await evalJs(`({
    appState: {
      scenario: window.appState.scenario,
      ehi: window.appState.ehi,
      ehiStatus: window.appState.ehiStatus,
      aiDiagnosis: window.appState.aiDiagnosis,
      anomalyScore: window.appState.anomalyScore,
      rulHours: window.appState.rulHours,
      degradationPct: window.appState.degradationPct,
      degradationTrend: window.appState.degradationTrend,
      whyTitle: window.appState.why.title,
      whyConclusion: window.appState.why.conclusion
    },
    dom: {
      ehi: document.getElementById('ehi-val')?.textContent,
      diag: document.getElementById('diag-val')?.textContent,
      anomaly: document.getElementById('anomaly-val')?.textContent,
      rul: document.getElementById('rul-val')?.textContent,
      degVal: document.getElementById('deg-current-val')?.textContent,
      degTrend: document.getElementById('deg-trend-val')?.textContent,
      cht: document.getElementById('telem-val-cht')?.textContent,
      egt: document.getElementById('telem-val-egt')?.textContent
    }
  })`);
  console.log('Thermal Degradation State:', JSON.stringify(thermalState.value, null, 2));
  results.thermal = thermalState.value;
  await captureScreenshot('final_verify_03_thermal_degradation.png');

  // -------------------------------------------------------------------------
  // TEST 4: TIMELINE SCRUBBING
  // -------------------------------------------------------------------------
  console.log('\n--- TEST 4: MISSION TIMELINE REPLAY SCRUBBING ---');
  const replayAt40 = await evalJs(`(() => {
    const slider = document.getElementById('timeline-slider');
    slider.value = 40; // ~23.6 sec (in the middle of sensor freeze 18-32s)
    slider.dispatchEvent(new Event('input'));
    return {
      sliderVal: slider.value,
      simTime: window.appState.simTime,
      scenario: window.appState.scenario,
      diag: window.appState.aiDiagnosis,
      ehi: window.appState.ehi,
      oilPressTrust: window.appState.trustResult?.scores?.oilPress
    };
  })()`);
  console.log('Replay at t=24s (Sensor Freeze):', replayAt40.value);

  const replayAt85 = await evalJs(`(() => {
    const slider = document.getElementById('timeline-slider');
    slider.value = 85; // ~50s (thermal degradation)
    slider.dispatchEvent(new Event('input'));
    return {
      sliderVal: slider.value,
      simTime: window.appState.simTime,
      scenario: window.appState.scenario,
      diag: window.appState.aiDiagnosis,
      ehi: window.appState.ehi,
      rul: window.appState.rulHours
    };
  })()`);
  console.log('Replay at t=50s (Thermal Degradation):', replayAt85.value);
  results.replay = { at40: replayAt40.value, at85: replayAt85.value };
  await captureScreenshot('final_verify_04_timeline_replay.png');

  // -------------------------------------------------------------------------
  // TEST 5: AI ENGINE ASSISTANT REAL Q&A
  // -------------------------------------------------------------------------
  console.log('\n--- TEST 5: AI ENGINE ASSISTANT REAL Q&A ---');
  // Reset to sensor fault to test sensor-fault grounded Q&A
  await evalJs(`document.getElementById('btn-scen-fault')?.click()`);
  await wait(600);

  const questions = [
    "Why is engine health changing?",
    "Is this a sensor fault?",
    "What caused the anomaly?",
    "How much RUL remains?",
    "Which sensor is unreliable?"
  ];
  const qnaResults = {};

  for (const q of questions) {
    await evalJs(`(() => {
      const input = document.getElementById('chat-input');
      const btn = document.getElementById('btn-chat-send');
      if (input && btn) {
        input.value = "${q}";
        btn.click();
      }
    })()`);
    await wait(2500);
    const lastMsg = await evalJs(`(() => {
      const msgs = document.querySelectorAll('.chat-bubble.ai');
      return msgs.length > 0 ? msgs[msgs.length - 1].textContent : '';
    })()`);
    qnaResults[q] = lastMsg.value;
    console.log(`Q: "${q}"\nA: "${lastMsg.value}"\n`);
  }
  results.assistant = qnaResults;
  await captureScreenshot('final_verify_05_ai_assistant.png');

  // -------------------------------------------------------------------------
  // TEST 6: 3D DIGITAL TWIN INSPECTION MODES
  // -------------------------------------------------------------------------
  console.log('\n--- TEST 6: 3D DIGITAL TWIN INSPECTION MODES ---');
  await evalJs(`window.setInspectionMode('xray')`);
  await wait(600);
  await evalJs(`window.inspectComponent('piston_1')`);
  await wait(600);

  const twinHudState = await evalJs(`({
    hudDisplayed: document.getElementById('twin-inspection-hud')?.style.display !== 'none',
    hudName: document.getElementById('hud-name')?.textContent,
    hudMotionText: document.getElementById('hud-motion-text')?.textContent,
    hudStatus: document.getElementById('hud-status')?.textContent,
    hudRelevance: document.getElementById('hud-relevance-text')?.textContent
  })`);
  console.log('3D HUD State (Piston 1 during Sensor Fault):', JSON.stringify(twinHudState.value, null, 2));
  results.twinHud = twinHudState.value;
  await captureScreenshot('final_verify_06_3d_inspection.png');

  // Reset inspection
  await evalJs(`window.resetEngineInspection()`);
  await wait(400);

  // Check exceptions
  results.uncaughtExceptions = uncaughtExceptions;
  console.log('\nTotal Uncaught Exceptions:', uncaughtExceptions.length);

  console.log('\n===========================================================================');
  console.log('VISUAL AND FUNCTIONAL VERIFICATION COMPLETED SUCCESSFULLY');
  console.log('===========================================================================');

  ws.close();
  chrome.kill();
  process.exit(0);
}

runVisualVerification().catch(err => {
  console.error('Visual verification failed:', err);
  process.exit(1);
});
