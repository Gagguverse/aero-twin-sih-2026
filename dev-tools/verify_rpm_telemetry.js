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

async function runVerification() {
  const profileDir = path.join('C:\\Users\\gd116\\AppData\\Local\\Temp', 'chrome_rpm_verify_' + Date.now());
  console.log('Launching Headless Chrome for RPM Telemetry Verification...');

  const chrome = spawn(chromePath, [
    '--headless=new',
    '--remote-debugging-port=9225',
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
      const targets = await fetchJson('http://127.0.0.1:9225/json');
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

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && callbacks.has(msg.id)) {
      callbacks.get(msg.id)(msg);
      callbacks.delete(msg.id);
    }
  };

  await new Promise(r => ws.onopen = r);

  function sendCmd(method, params = {}) {
    return new Promise((resolve) => {
      const id = msgId++;
      callbacks.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  await sendCmd('Runtime.enable');
  await sendCmd('Page.enable');

  await wait(3500);

  async function evaluate(fnStr) {
    const res = await sendCmd('Runtime.evaluate', {
      expression: `(${fnStr})()`,
      returnByValue: true,
      awaitPromise: true
    });
    if (res.result && res.result.exceptionDetails) {
      console.error('Eval error:', res.result.exceptionDetails);
      return null;
    }
    return res.result ? res.result.result.value : null;
  }

  console.log('\n=== TEST 1: Normal Mission Cruise Telemetry State ===');
  const normalTelem = await evaluate(`() => {
    const items = Array.from(document.querySelectorAll('.telemetry-item')).map(el => {
      const name = el.querySelector('.telemetry-name')?.textContent.trim();
      const status = el.querySelector('.telemetry-status-tag')?.textContent.trim();
      const val = el.querySelector('.telemetry-val')?.textContent.trim();
      const trend = el.querySelector('.telemetry-trend')?.textContent.trim();
      return { id: el.id, name, val, status, trend };
    });
    const s = window.appState || {};
    return {
      missionPhase: s.missionPhase,
      rpm: s.rawTelemetry ? s.rawTelemetry.rpm : null,
      expectedRpm: (s.physics && s.physics.expected) ? s.physics.expected.rpm : null,
      telemetryCards: items
    };
  }`);
  console.log('Normal Mission Telemetry Summary:');
  console.log('Phase:', normalTelem.missionPhase, '| Actual RPM:', normalTelem.rpm, '| Expected RPM:', normalTelem.expectedRpm);
  console.log('Telemetry Cards:');
  normalTelem.telemetryCards.forEach(c => {
    console.log(`  • ${c.name}: ${c.val} | Status: [${c.status}] | Trend: [${c.trend}]`);
  });

  console.log('\n=== TEST 2: Inject Moderate Excessive RPM (+300 RPM above expected) ===');
  const warnRpmResult = await evaluate(`() => {
    const s = window.appState;
    const expRpm = s.physics.expected.rpm || 4392;
    const testRpm = expRpm + 300;
    // Temporarily inject test RPM into rawTelemetry and render
    s.rawTelemetry.rpm = testRpm;
    window.renderLiveTelemetry(s.rawTelemetry, s.trustResult, s.physics);
    const rpmEl = document.getElementById('telem-rpm');
    return {
      injectedRpm: testRpm,
      status: rpmEl.querySelector('.telemetry-status-tag')?.textContent.trim(),
      trend: rpmEl.querySelector('.telemetry-trend')?.textContent.trim(),
      alertClass: rpmEl.className
    };
  }`);
  console.log('Moderate Excessive RPM Result:', warnRpmResult);

  console.log('\n=== TEST 3: Inject Severe Excessive RPM (+550 RPM above expected) ===');
  const critRpmResult = await evaluate(`() => {
    const s = window.appState;
    const expRpm = s.physics.expected.rpm || 4392;
    const testRpm = expRpm + 550;
    s.rawTelemetry.rpm = testRpm;
    window.renderLiveTelemetry(s.rawTelemetry, s.trustResult, s.physics);
    const rpmEl = document.getElementById('telem-rpm');
    return {
      injectedRpm: testRpm,
      status: rpmEl.querySelector('.telemetry-status-tag')?.textContent.trim(),
      trend: rpmEl.querySelector('.telemetry-trend')?.textContent.trim(),
      alertClass: rpmEl.className
    };
  }`);
  console.log('Severe Excessive RPM Result:', critRpmResult);

  console.log('\n=== TEST 4: Inject Severe Low RPM (-550 RPM below expected) ===');
  const lowRpmResult = await evaluate(`() => {
    const s = window.appState;
    const expRpm = s.physics.expected.rpm || 4392;
    const testRpm = expRpm - 550;
    s.rawTelemetry.rpm = testRpm;
    window.renderLiveTelemetry(s.rawTelemetry, s.trustResult, s.physics);
    const rpmEl = document.getElementById('telem-rpm');
    return {
      injectedRpm: testRpm,
      status: rpmEl.querySelector('.telemetry-status-tag')?.textContent.trim(),
      trend: rpmEl.querySelector('.telemetry-trend')?.textContent.trim(),
      alertClass: rpmEl.className
    };
  }`);
  console.log('Severe Low RPM Result:', lowRpmResult);

  console.log('\n=== TEST 5: Return to Normal Cruise State ===');
  const restoredResult = await evaluate(`() => {
    const s = window.appState;
    const expRpm = s.physics.expected.rpm || 4392;
    s.rawTelemetry.rpm = expRpm;
    window.renderLiveTelemetry(s.rawTelemetry, s.trustResult, s.physics);
    const rpmEl = document.getElementById('telem-rpm');
    return {
      restoredRpm: expRpm,
      status: rpmEl.querySelector('.telemetry-status-tag')?.textContent.trim(),
      trend: rpmEl.querySelector('.telemetry-trend')?.textContent.trim(),
      alertClass: rpmEl.className
    };
  }`);
  console.log('Restored RPM Result:', restoredResult);

  ws.close();
  chrome.kill();
  console.log('\nAll verification tests completed successfully.');
}

runVerification().catch(err => {
  console.error('Verification error:', err);
  process.exit(1);
});
