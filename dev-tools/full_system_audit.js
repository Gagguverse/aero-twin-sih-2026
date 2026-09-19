const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
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

async function runAudit() {
  const profileDir = path.join('C:\\Users\\gd116\\AppData\\Local\\Temp', 'chrome_audit_' + Date.now());
  console.log('Starting Headless Chrome for Full System Audit...');
  
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
  for (let i = 0; i < 20; i++) {
    await wait(400);
    try {
      const targets = await fetchJson('http://127.0.0.1:9222/json');
      pageTarget = targets.find(t => t.type === 'page' && t.url.includes('localhost:3000'));
      if (pageTarget && pageTarget.webSocketDebuggerUrl) break;
    } catch (e) {}
  }

  if (!pageTarget) {
    console.error('Failed to connect to Chrome target');
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

  console.log('Waiting 3s for page and 3D engine initialization...');
  await wait(3000);

  async function evalJs(expr) {
    const res = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (res.result?.exceptionDetails) {
      return { error: res.result.exceptionDetails.text || res.result.exceptionDetails.exception?.description };
    }
    const val = res.result?.result?.value !== undefined ? res.result.result.value : res.result?.value;
    return { value: val };
  }

  const auditResults = {};

  // Test 1: Check Global Classes (TelemetryEngine, SensorTrustEngine, AIDiagnosticNet)
  console.log('Auditing Pipeline Classes in Window Scope...');
  auditResults.classes = await evalJs(`({
    hasTelemetryEngine: typeof window.TelemetryEngine !== 'undefined',
    hasSensorTrustEngine: typeof window.SensorTrustEngine !== 'undefined',
    hasAIDiagnosticNet: typeof window.AIDiagnosticNet !== 'undefined',
    hasAeroPistonDigitalTwin: typeof window.AeroPistonDigitalTwin !== 'undefined'
  })`);

  // Test 2: Check Active Telemetry & Scenario Data Source
  console.log('Auditing Active Telemetry & Scenario Data Source...');
  auditResults.scenarioSource = await evalJs(`({
    ehi: document.getElementById('ehi-val')?.textContent,
    diag: document.getElementById('diag-val')?.textContent,
    trustCount: document.getElementById('trust-count-val')?.textContent,
    overallTrust: document.getElementById('overall-trust-val')?.textContent,
    rul: document.getElementById('rul-val')?.textContent,
    anomaly: document.getElementById('anomaly-val')?.textContent
  })`);

  // Test 3: Check Twin Mode View Buttons (ISO, TOP, FRONT, SENSORS)
  console.log('Auditing View Buttons (ISO, TOP, FRONT, SENSORS)...');
  const viewErrors = [];
  for (const view of ['iso', 'top', 'front', 'sensors']) {
    const res = await evalJs(`document.querySelector('.btn-twin-mode[data-view="${view}"]')?.click()`);
    if (res.error) viewErrors.push({ view, error: res.error });
  }
  auditResults.viewButtons = { viewErrors, uncaughtCount: uncaughtExceptions.length };

  // Test 4: Check Modals (Contributing Parameters & Explain Diagnosis)
  console.log('Auditing Modals...');
  auditResults.modals = await evalJs(`(() => {
    const btnParams = document.getElementById('btn-explain-params');
    const modalParams = document.getElementById('modal-params');
    const btnDiag = document.getElementById('btn-explain-diag');
    const modalDiag = document.getElementById('modal-diagnosis');
    
    btnParams?.click();
    const paramsOpen = modalParams?.classList.contains('open');
    const paramsBarsCount = document.getElementById('param-bars-list')?.children.length;
    document.getElementById('btn-close-params')?.click();
    const paramsClosed = !modalParams?.classList.contains('open');

    btnDiag?.click();
    const diagOpen = modalDiag?.classList.contains('open');
    const diagContentLength = document.getElementById('diag-modal-content')?.innerHTML.length;
    document.getElementById('btn-close-diag')?.click();
    const diagClosed = !modalDiag?.classList.contains('open');

    return { paramsOpen, paramsBarsCount, paramsClosed, diagOpen, diagContentLength, diagClosed };
  })()`);

  // Test 5: Check AI Assistant Q&A
  console.log('Auditing AI Assistant Responses...');
  auditResults.assistant = {};
  const testQuestions = [
    "Why is engine health changing?",
    "Is this a sensor fault?",
    "What caused the anomaly?",
    "How much RUL remains?",
    "Which sensor is unreliable?"
  ];

  for (const q of testQuestions) {
    await evalJs(`(() => {
      const input = document.getElementById('chat-input');
      const btn = document.getElementById('btn-chat-send');
      if (input && btn) {
        input.value = "${q}";
        btn.click();
      }
    })()`);
    await wait(600);
    const lastMsg = await evalJs(`(() => {
      const msgs = document.querySelectorAll('.chat-bubble.ai');
      return msgs.length > 0 ? msgs[msgs.length - 1].textContent : null;
    })()`);
    auditResults.assistant[q] = lastMsg.value;
  }

  // Test 6: Check Scenario Switching State Propagation
  console.log('Auditing Scenario Switching State Propagation...');
  await evalJs(`document.getElementById('btn-scen-fault')?.click()`);
  await wait(500);
  const faultState = await evalJs(`({
    ehi: document.getElementById('ehi-val')?.textContent,
    diag: document.getElementById('diag-val')?.textContent,
    trustCount: document.getElementById('trust-count-val')?.textContent,
    overallTrust: document.getElementById('overall-trust-val')?.textContent,
    oilPressTrust: Array.from(document.querySelectorAll('#trust-table-body tr')).find(r => r.textContent.includes('Oil Pressure'))?.querySelector('.trust-score-num')?.textContent,
    oilPressReason: Array.from(document.querySelectorAll('#trust-table-body tr')).find(r => r.textContent.includes('Oil Pressure'))?.querySelector('.trust-reason-cell')?.textContent.trim()
  })`);

  await evalJs(`document.getElementById('btn-scen-thermal')?.click()`);
  await wait(500);
  const thermalState = await evalJs(`({
    ehi: document.getElementById('ehi-val')?.textContent,
    diag: document.getElementById('diag-val')?.textContent,
    overallTrust: document.getElementById('overall-trust-val')?.textContent,
    rul: document.getElementById('rul-val')?.textContent,
    chtVal: document.getElementById('telem-val-cht')?.textContent,
    egtVal: document.getElementById('telem-val-egt')?.textContent
  })`);

  auditResults.scenarios = { faultState: faultState.value, thermalState: thermalState.value };

  // Test 7: Check Timeline Slider & Scrubbing
  console.log('Auditing Timeline Slider & Scrubbing...');
  auditResults.timeline = await evalJs(`(() => {
    const slider = document.getElementById('timeline-slider');
    const timeVal = document.getElementById('timeline-time-val');
    slider.value = 20;
    slider.dispatchEvent(new Event('input'));
    const at20 = { val: slider.value, time: timeVal?.textContent, ehi: document.getElementById('ehi-val')?.textContent };
    
    slider.value = 60;
    slider.dispatchEvent(new Event('input'));
    const at60 = { val: slider.value, time: timeVal?.textContent, ehi: document.getElementById('ehi-val')?.textContent };

    slider.value = 85;
    slider.dispatchEvent(new Event('input'));
    const at85 = { val: slider.value, time: timeVal?.textContent, ehi: document.getElementById('ehi-val')?.textContent };

    return { at20, at60, at85 };
  })()`);

  // Test 8: Check Exception Log
  auditResults.exceptions = uncaughtExceptions;

  console.log('\n================ AUDIT SUMMARY ================');
  console.log(JSON.stringify(auditResults, null, 2));

  ws.close();
  chrome.kill();
  process.exit(0);
}

runAudit().catch(err => {
  console.error('Audit script failed:', err);
  process.exit(1);
});
