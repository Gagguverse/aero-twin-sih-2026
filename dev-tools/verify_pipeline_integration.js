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

async function runVerification() {
  const profileDir = path.join('C:\\Users\\gd116\\AppData\\Local\\Temp', 'chrome_verify_' + Date.now());
  console.log('===========================================================================');
  console.log('AERO TWIN: END-TO-END PIPELINE & RUNTIME VERIFICATION SUITE');
  console.log('SIH26054 | DRDO MALE UAV Aero Piston Engine Digital Twin');
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

  await wait(2500);

  async function evalJs(expr) {
    const res = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (res.result?.exceptionDetails) {
      return { error: res.result.exceptionDetails.text || res.result.exceptionDetails.exception?.description };
    }
    const val = res.result?.result?.value !== undefined ? res.result.result.value : res.result?.value;
    return { value: val };
  }

  let passCount = 0;
  let totalTests = 0;

  function assert(name, condition, details = '') {
    totalTests++;
    if (condition) {
      console.log(`>>> [PASS] ${name} ${details ? '(' + details + ')' : ''}`);
      passCount++;
    } else {
      console.error(`>>> [FAIL] ${name} ${details ? '(' + details + ')' : ''}`);
    }
  }

  console.log('\n--- SUITE 1: Runtime Pipeline Architecture & ML Model Loading ---');
  const pipelineScope = (await evalJs(`({
    hasModels: typeof window.AERO_ML_MODELS !== 'undefined',
    hasTrees: !!(window.AERO_ML_MODELS?.fault_classifier?.trees?.length > 0),
    hasIso: !!(window.AERO_ML_MODELS?.isolation_forest?.trees?.length > 0),
    hasAppState: typeof window.appState !== 'undefined',
    hasTelemetry: typeof window.telemetryEngine !== 'undefined',
    hasTrust: typeof window.sensorTrustEngine !== 'undefined',
    hasAI: typeof window.aiDiagnosticNet !== 'undefined'
  })`)).value;

  assert('ML Ensemble Bundle Loaded', pipelineScope && pipelineScope.hasModels && pipelineScope.hasTrees && pipelineScope.hasIso, 'Random Forest & Isolation Forest tree JSON loaded in browser');
  assert('Pipeline Classes Active', pipelineScope && pipelineScope.hasAppState && pipelineScope.hasTelemetry && pipelineScope.hasTrust && pipelineScope.hasAI, 'appState and 3 core engines instantiated');

  console.log('\n--- SUITE 2: Scenario A (Normal Mission Baseline) ---');
  await evalJs(`window.applyScenario('normal')`);
  await wait(400);
  const normalState = (await evalJs(`({
    ehi: parseInt(document.getElementById('ehi-val')?.textContent, 10),
    ehiBadge: document.getElementById('ehi-badge')?.textContent,
    diag: document.getElementById('diag-val')?.textContent,
    trustCount: document.getElementById('trust-count-val')?.textContent,
    overallTrust: parseFloat(document.getElementById('overall-trust-val')?.textContent),
    rul: document.getElementById('rul-val')?.textContent,
    currentState: document.getElementById('engine-current-state')?.textContent,
    whyBullets: document.getElementById('why-bullets')?.children.length
  })`)).value;

  assert('Normal EHI Nominal', normalState.ehi >= 90 && normalState.ehiBadge === 'NOMINAL', `EHI=${normalState.ehi}`);
  assert('Normal AI Diagnosis', normalState.diag === 'HEALTHY' && normalState.currentState === 'HEALTHY', `Diagnosis=${normalState.diag}`);
  assert('Normal Sensor Trust', normalState.trustCount === '9 / 9' && normalState.overallTrust >= 0.95, `Trust=${normalState.overallTrust}`);
  assert('Normal WHY bullets rendered', normalState.whyBullets >= 3, `Count=${normalState.whyBullets}`);

  console.log('\n--- SUITE 3: Scenario B (Sensor Fault - BAD SENSOR ≠ BAD ENGINE) ---');
  await evalJs(`window.applyScenario('sensor_fault')`);
  await wait(400);
  const faultState = (await evalJs(`({
    ehi: parseInt(document.getElementById('ehi-val')?.textContent, 10),
    ehiBadge: document.getElementById('ehi-badge')?.textContent,
    diag: document.getElementById('diag-val')?.textContent,
    trustCount: document.getElementById('trust-count-val')?.textContent,
    overallTrust: parseFloat(document.getElementById('overall-trust-val')?.textContent),
    oilRow: Array.from(document.querySelectorAll('#trust-table-body tr')).find(r => r.textContent.includes('Oil Pressure'))?.textContent,
    quarantinedClass: Array.from(document.querySelectorAll('#trust-table-body tr')).find(r => r.textContent.includes('Oil Pressure'))?.className,
    whyBullets: document.getElementById('why-bullets')?.textContent
  })`)).value;

  assert('Sensor Fault: Engine Health Protected', faultState.ehi >= 90 && faultState.ehiBadge === 'NOMINAL', `EHI=${faultState.ehi} (BAD SENSOR ≠ BAD ENGINE)`);
  assert('Sensor Fault: AI Diagnosis Flags Sensor', faultState.diag === 'SENSOR FAULT', `Diagnosis=${faultState.diag}`);
  assert('Sensor Fault: Oil Pressure Transducer Quarantined', faultState.trustCount === '8 / 9' && faultState.quarantinedClass.includes('row-distrusted'), `Table Class=${faultState.quarantinedClass}`);

  console.log('\n--- SUITE 4: Scenario C (Thermal Degradation) ---');
  await evalJs(`window.applyScenario('thermal_degradation')`);
  await wait(400);
  const thermalState = (await evalJs(`({
    ehi: parseInt(document.getElementById('ehi-val')?.textContent, 10),
    ehiBadge: document.getElementById('ehi-badge')?.textContent,
    diag: document.getElementById('diag-val')?.textContent,
    trustCount: document.getElementById('trust-count-val')?.textContent,
    rul: document.getElementById('rul-val')?.textContent,
    chtVal: parseFloat(document.getElementById('telem-val-cht')?.textContent),
    egtVal: parseFloat(document.getElementById('telem-val-egt')?.textContent),
    currentState: document.getElementById('engine-current-state')?.textContent
  })`)).value;

  assert('Thermal: EHI Downgraded', thermalState.ehi < 75 && (thermalState.ehiBadge === 'WARNING' || thermalState.ehiBadge === 'CRITICAL'), `EHI=${thermalState.ehi}`);
  assert('Thermal: AI Diagnosis Runaway', thermalState.diag === 'THERMAL DEGRADATION' && thermalState.currentState.includes('THERMAL'), `Diagnosis=${thermalState.diag}`);
  assert('Thermal: RUL Depleted', parseInt(thermalState.rul, 10) <= 64, `RUL=${thermalState.rul} h`);
  assert('Thermal: Sensors Verified Trusted', thermalState.trustCount === '9 / 9', `Trust Count=${thermalState.trustCount}`);

  console.log('\n--- SUITE 5: Explainability Modals ---');
  const modalTest = (await evalJs(`(() => {
    const btnParams = document.getElementById('btn-explain-params');
    const modalParams = document.getElementById('modal-params');
    const btnDiag = document.getElementById('btn-explain-diag');
    const modalDiag = document.getElementById('modal-diagnosis');

    btnParams?.click();
    const paramsOpen = modalParams?.classList.contains('open');
    const paramBars = document.querySelectorAll('#param-bars-list .feature-bar-item').length;
    document.getElementById('btn-close-params')?.click();

    btnDiag?.click();
    const diagOpen = modalDiag?.classList.contains('open');
    const diagContent = document.getElementById('diag-modal-content')?.textContent;
    document.getElementById('btn-close-diag')?.click();

    return { paramsOpen, paramBars, diagOpen, hasStages: diagContent?.includes('Stage 1') && diagContent?.includes('Stage 2') && diagContent?.includes('Stage 3') };
  })()`).then(r => r.value));

  assert('Contributing Parameters Modal Renders Features', modalTest.paramsOpen && modalTest.paramBars === 4, `Bars=${modalTest.paramBars}`);
  assert('Explain Diagnosis Modal Renders 3 Pipeline Stages', modalTest.diagOpen && modalTest.hasStages, 'Includes Sensor Trust Gatekeeper, Isolation Forest, and Random Forest stages');

  console.log('\n--- SUITE 6: Continuous Mission Replay Timeline Scrubbing ---');
  const replayScrub = (await evalJs(`(() => {
    const slider = document.getElementById('timeline-slider');
    
    // Seek to normal cruise (t=10s)
    slider.value = 17;
    slider.dispatchEvent(new Event('input'));
    const atNormal = { diag: document.getElementById('diag-val')?.textContent, time: document.getElementById('timeline-time-val')?.textContent };

    // Seek to frozen event (t=25s)
    slider.value = 42;
    slider.dispatchEvent(new Event('input'));
    const atFreeze = { diag: document.getElementById('diag-val')?.textContent, time: document.getElementById('timeline-time-val')?.textContent };

    // Seek to thermal degradation event (t=48s)
    slider.value = 81;
    slider.dispatchEvent(new Event('input'));
    const atThermal = { diag: document.getElementById('diag-val')?.textContent, time: document.getElementById('timeline-time-val')?.textContent, ehi: document.getElementById('ehi-val')?.textContent };

    return { atNormal, atFreeze, atThermal };
  })()`).then(r => r.value));

  assert('Replay Scrubbing at t=10s', replayScrub.atNormal.diag === 'HEALTHY', `Time=${replayScrub.atNormal.time}, Diag=${replayScrub.atNormal.diag}`);
  assert('Replay Scrubbing at t=25s (Sensor Freeze Window)', replayScrub.atFreeze.diag === 'SENSOR FAULT', `Time=${replayScrub.atFreeze.time}, Diag=${replayScrub.atFreeze.diag}`);
  assert('Replay Scrubbing at t=48s (Thermal Runaway Window)', replayScrub.atThermal.diag === 'THERMAL DEGRADATION', `Time=${replayScrub.atThermal.time}, EHI=${replayScrub.atThermal.ehi}`);

  console.log('\n--- SUITE 7: AI Assistant Telemetry Grounding ---');
  await evalJs(`window.applyScenario('sensor_fault')`);
  await wait(400);
  const assistantResponse = (await evalJs(`(() => {
    const input = document.getElementById('chat-input');
    const btn = document.getElementById('btn-chat-send');
    input.value = "Which sensor is unreliable?";
    btn.click();
  })()`));
  await wait(600);
  const lastAiBubble = (await evalJs(`document.querySelectorAll('.chat-bubble.ai')[document.querySelectorAll('.chat-bubble.ai').length - 1]?.textContent`)).value;
  assert('AI Assistant Identifies Quarantined Sensor', lastAiBubble.includes('Oil Pressure'), `Response preview: "${lastAiBubble.slice(0, 75)}..."`);

  console.log('\n--- SUITE 8: Console Error Audit ---');
  assert('Zero Uncaught JavaScript Exceptions', uncaughtExceptions.length === 0, `Uncaught count = ${uncaughtExceptions.length}`);

  console.log('\n===========================================================================');
  console.log(`TEST SUMMARY: ${passCount} / ${totalTests} TESTS PASSED`);
  console.log('===========================================================================');

  ws.close();
  chrome.kill();
  process.exit(passCount === totalTests ? 0 : 1);
}

runVerification().catch(err => {
  console.error('Verification failed with error:', err);
  process.exit(1);
});
