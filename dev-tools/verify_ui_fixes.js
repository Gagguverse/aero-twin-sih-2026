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
  const profileDir = path.join('C:\\Users\\gd116\\AppData\\Local\\Temp', 'chrome_ui_verify_' + Date.now());
  console.log('Starting Headless Chrome for UI Verification...');
  
  const chrome = spawn(chromePath, [
    '--headless=new',
    '--remote-debugging-port=9223',
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
      const targets = await fetchJson('http://127.0.0.1:9223/json');
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
    const msg = JSON.parse(event.data);
    if (msg.id && callbacks.has(msg.id)) {
      callbacks.get(msg.id)(msg);
      callbacks.delete(msg.id);
    }
    if (msg.method === 'Runtime.consoleAPICalled') {
      consoleMessages.push(msg.params);
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      uncaughtExceptions.push(msg.params);
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
  await sendCmd('DOM.enable');

  await sendCmd('Emulation.setDeviceMetricsOverride', {
    width: 1600,
    height: 1050,
    deviceScaleFactor: 1,
    mobile: false
  });

  await sendCmd('Page.reload');
  await wait(2500);

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

  async function takeScreenshot(filePath) {
    const res = await sendCmd('Page.captureScreenshot', { format: 'png' });
    if (res.result && res.result.data) {
      fs.writeFileSync(filePath, Buffer.from(res.result.data, 'base64'));
      console.log(`Saved screenshot to ${filePath}`);
    }
  }

  console.log('\n--- 1. AUDITING AERO TWIN LOGO ---');
  const logoInfo = await evaluate(`() => {
    const icon = document.querySelector('.brand-icon');
    const svg = icon ? icon.querySelector('svg') : null;
    const rect = icon ? icon.getBoundingClientRect() : null;
    return {
      hasBrandIcon: !!icon,
      hasSvg: !!svg,
      boxWidth: rect ? rect.width : 0,
      boxHeight: rect ? rect.height : 0,
      svgWidth: svg ? svg.getAttribute('width') : null,
      svgHeight: svg ? svg.getAttribute('height') : null,
      ariaLabel: svg ? svg.getAttribute('aria-label') : null
    };
  }`);
  console.log('Logo Info:', JSON.stringify(logoInfo, null, 2));

  console.log('\n--- 2. AUDITING DEGRADATION & RUL GRAPH VISIBILITY ---');
  await wait(1000);
  const chartInfo = await evaluate(`() => {
    const canvas = document.getElementById('degradation-chart-canvas');
    if (canvas) canvas.scrollIntoView({ block: 'center' });
    const wrapper = document.querySelector('.chart-wrapper');
    const panel = document.querySelector('.degradation-panel');
    const cRect = canvas ? canvas.getBoundingClientRect() : null;
    const wRect = wrapper ? wrapper.getBoundingClientRect() : null;
    const pRect = panel ? panel.getBoundingClientRect() : null;
    return {
      canvasExists: !!canvas,
      canvasCssWidth: cRect ? Math.round(cRect.width) : 0,
      canvasCssHeight: cRect ? Math.round(cRect.height) : 0,
      canvasBufferWidth: canvas ? canvas.width : 0,
      canvasBufferHeight: canvas ? canvas.height : 0,
      wrapperWidth: wRect ? Math.round(wRect.width) : 0,
      wrapperHeight: wRect ? Math.round(wRect.height) : 0,
      panelHeight: pRect ? Math.round(pRect.height) : 0,
      currentDegText: document.getElementById('deg-current-val') ? document.getElementById('deg-current-val').textContent : null,
      trendText: document.getElementById('deg-trend-val') ? document.getElementById('deg-trend-val').textContent : null,
      rulText: document.getElementById('deg-rul-val') ? document.getElementById('deg-rul-val').textContent : null
    };
  }`);
  console.log('Chart Info (Desktop 1600x1050):', JSON.stringify(chartInfo, null, 2));

  await takeScreenshot('dev-tools/ui_verify_normal.png');

  console.log('\n--- 3. TESTING SCENARIO SWITCH: THERMAL DEGRADATION ---');
  await evaluate(`() => {
    const btn = document.getElementById('btn-scenario-thermal');
    if (btn) btn.click();
  }`);
  await wait(1500);

  const thermalInfo = await evaluate(`() => {
    const canvas = document.getElementById('degradation-chart-canvas');
    const cRect = canvas ? canvas.getBoundingClientRect() : null;
    return {
      currentDeg: document.getElementById('deg-current-val') ? document.getElementById('deg-current-val').textContent : null,
      trend: document.getElementById('deg-trend-val') ? document.getElementById('deg-trend-val').textContent : null,
      rul: document.getElementById('deg-rul-val') ? document.getElementById('deg-rul-val').textContent : null,
      cssWidth: cRect ? Math.round(cRect.width) : 0,
      cssHeight: cRect ? Math.round(cRect.height) : 0
    };
  }`);
  console.log('Thermal Degradation Info:', JSON.stringify(thermalInfo, null, 2));
  await takeScreenshot('dev-tools/ui_verify_thermal.png');

  console.log('\n--- 4. TESTING RESPONSIVE RESIZE TO 1100x800 ---');
  await sendCmd('Emulation.setDeviceMetricsOverride', {
    width: 1100,
    height: 800,
    deviceScaleFactor: 1,
    mobile: false
  });
  await wait(1000);

  const resize1100 = await evaluate(`() => {
    const canvas = document.getElementById('degradation-chart-canvas');
    const cRect = canvas ? canvas.getBoundingClientRect() : null;
    return {
      cssWidth: cRect ? Math.round(cRect.width) : 0,
      cssHeight: cRect ? Math.round(cRect.height) : 0,
      bufferW: canvas ? canvas.width : 0,
      bufferH: canvas ? canvas.height : 0
    };
  }`);
  console.log('Resize 1100px:', JSON.stringify(resize1100, null, 2));
  await takeScreenshot('dev-tools/ui_verify_1100px.png');

  console.log('\n--- 5. TESTING RESPONSIVE RESIZE TO 768x1024 (TABLET) ---');
  await sendCmd('Emulation.setDeviceMetricsOverride', {
    width: 768,
    height: 1024,
    deviceScaleFactor: 1,
    mobile: false
  });
  await wait(1000);

  const resize768 = await evaluate(`() => {
    const canvas = document.getElementById('degradation-chart-canvas');
    const cRect = canvas ? canvas.getBoundingClientRect() : null;
    return {
      cssWidth: cRect ? Math.round(cRect.width) : 0,
      cssHeight: cRect ? Math.round(cRect.height) : 0,
      bufferW: canvas ? canvas.width : 0,
      bufferH: canvas ? canvas.height : 0
    };
  }`);
  console.log('Resize 768px:', JSON.stringify(resize768, null, 2));
  await takeScreenshot('dev-tools/ui_verify_768px.png');

  console.log('\n--- 6. CHECKING CONSOLE ERRORS ---');
  console.log('Console Errors:', uncaughtExceptions);

  ws.close();
  chrome.kill();
  try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch (e) {}

  console.log('\n================ UI VERIFICATION SUMMARY ================');
  const allGood = logoInfo.hasSvg && chartInfo.canvasCssHeight >= 240 && resize1100.cssHeight >= 240 && uncaughtExceptions.length === 0;
  console.log(`UI Fixes Validated: ${allGood ? 'SUCCESS (100% PASS)' : 'FAIL'}`);
}

runVerification().catch(e => {
  console.error('Fatal Verification Error:', e);
  process.exit(1);
});
