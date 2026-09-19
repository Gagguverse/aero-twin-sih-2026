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

async function capture() {
  const profileDir = path.join('C:\\Users\\gd116\\AppData\\Local\\Temp', 'chrome_cap_' + Date.now());
  const debugPort = 9227;

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
    console.error('Could not connect to Chrome');
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
    return res && res.result ? res.result.value : null;
  }

  async function saveScreenshot(filename) {
    const res = await sendCdp('Page.captureScreenshot', { format: 'png' });
    const buffer = Buffer.from(res.data, 'base64');
    const outPath = path.join(artifactDir, filename);
    fs.writeFileSync(outPath, buffer);
    console.log(`Saved screenshot: ${outPath}`);
  }

  await wait(2500);

  // Send sample query to show 3-part structured assistant answer in chat history
  await evaluate(`
    const input = document.getElementById('chat-input');
    const btn = document.getElementById('btn-chat-send');
    if (input && btn) {
      input.value = "Why is engine health changing?";
      btn.click();
    }
  `);

  // Wait for typing indicator to disappear
  for (let i = 0; i < 40; i++) {
    await wait(250);
    const typing = await evaluate(`!!document.querySelector('.typing-indicator')`);
    if (!typing) break;
  }
  await wait(400);

  // Scroll to bottom grid to show assistant panel prominently
  await evaluate(`
    const el = document.querySelector('.analysis-grid');
    if (el) el.scrollIntoView({ behavior: 'instant', block: 'center' });
  `);
  await wait(400);

  await saveScreenshot('assistant_layout_normal_expanded.png');

  // Switch to Thermal Runaway Replay at T+82s
  await evaluate(`window.jumpToReplaySecond(82)`);
  await wait(400);
  await evaluate(`window.handleUserQuery("What is the engine diagnosis?")`);

  // Wait for typing indicator to disappear
  for (let i = 0; i < 40; i++) {
    await wait(250);
    const typing = await evaluate(`!!document.querySelector('.typing-indicator')`);
    if (!typing) break;
  }
  await wait(400);

  await saveScreenshot('assistant_layout_replay_82s.png');

  ws.close();
  chrome.kill();
  console.log('Done capturing assistant screenshots.');
}

capture();
