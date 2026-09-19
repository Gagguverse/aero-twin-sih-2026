const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const targetDir = 'C:\\Users\\gd116\\.gemini\\antigravity-ide\\brain\\55b1a247-7552-4914-9a97-d3582f5954ae';

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

async function run() {
  const profileDir = path.join('C:\\Users\\gd116\\AppData\\Local\\Temp', 'chrome_cdp_' + Date.now());
  console.log('Spawning Chrome with profile:', profileDir);

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

  chrome.on('error', (err) => console.error('Chrome spawn error:', err));

  let pageTarget = null;
  console.log('Waiting for Chrome CDP port 9222...');
  for (let i = 0; i < 20; i++) {
    await wait(500);
    try {
      const targets = await fetchJson('http://127.0.0.1:9222/json');
      pageTarget = targets.find(t => t.type === 'page' && t.url.includes('localhost:3000'));
      if (pageTarget && pageTarget.webSocketDebuggerUrl) {
        console.log('Found page target:', pageTarget.title);
        break;
      }
    } catch (e) {}
  }

  if (!pageTarget || !pageTarget.webSocketDebuggerUrl) {
    console.error('Failed to find page target on CDP!');
    chrome.kill();
    process.exit(1);
  }

  console.log('Connecting to WebSocket:', pageTarget.webSocketDebuggerUrl);
  const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
  let msgId = 1;
  const callbacks = new Map();

  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
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

  console.log('Waiting 3s for 3D engine canvas and kinematics to initialize...');
  await wait(3000);

  async function takeScreenshot(filename) {
    const res = await send('Page.captureScreenshot', { format: 'png' });
    if (res.result && res.result.data) {
      const fullPath = path.join(targetDir, filename);
      fs.writeFileSync(fullPath, Buffer.from(res.result.data, 'base64'));
      console.log(`[CAPTURED] ${filename} (${(fs.statSync(fullPath).size / 1024).toFixed(1)} KB)`);
    } else {
      console.error('Failed to capture screenshot for:', filename, res);
    }
  }

  async function evalJs(expr) {
    const res = await send('Runtime.evaluate', { expression: expr, awaitPromise: true });
    return res.result ? res.result.value : null;
  }

  // 1. Initial State: Normal Mission with Complete Engine Running + Motion overlay
  console.log('Capturing Complete Engine with Running Motion + Kinematics...');
  await wait(1000);
  await takeScreenshot('motion_01_complete_engine_running.png');

  // 2. X-Ray Cutaway Mode: Transparent Casing revealing rotating crankshaft, swinging rods & reciprocating pistons
  console.log('Activating X-RAY Cutaway Mode...');
  await evalJs('window.setInspectionMode("xray")');
  await wait(1500);
  await takeScreenshot('motion_02_xray_cutaway_mechanism.png');

  // 3. Exploded Assembly View
  console.log('Activating EXPLODED Assembly Mode...');
  await evalJs('window.setInspectionMode("exploded")');
  await wait(1200);
  await takeScreenshot('motion_03_exploded_assembly.png');

  // 4. Select Piston 1 in X-Ray / Standard Mode
  console.log('Resetting to X-Ray and selecting Piston 1 (CYLINDER 1)...');
  await evalJs('window.setInspectionMode("xray")');
  await wait(800);
  await evalJs('window.inspectComponent("piston_1")');
  await wait(1500);
  await takeScreenshot('motion_04_piston_1_kinematic_focus.png');

  // 5. Switch to Sensor Fault Scenario while inspecting Piston 1
  console.log('Testing Scenario 2: SENSOR FAULT while inspecting Piston 1...');
  await evalJs('document.getElementById("btn-scen-fault").click()');
  await wait(1200);
  await takeScreenshot('motion_05_piston_1_sensor_fault.png');

  // 6. Switch to Thermal Degradation Scenario
  console.log('Testing Scenario 3: THERMAL DEGRADATION...');
  await evalJs('document.getElementById("btn-scen-thermal").click()');
  await wait(1200);
  await takeScreenshot('motion_06_piston_1_thermal_degradation.png');

  // 7. Reset back to Complete Engine
  console.log('Resetting back to Complete Engine View...');
  await evalJs('window.resetEngineInspection()');
  await evalJs('document.getElementById("btn-scen-normal").click()');
  await wait(1000);
  await takeScreenshot('motion_07_engine_reset_normal.png');

  console.log('\nAll motion and inspection state screenshots captured successfully!');
  ws.close();
  chrome.kill();
  process.exit(0);
}

run().catch(err => {
  console.error('Error during capture:', err);
  process.exit(1);
});
