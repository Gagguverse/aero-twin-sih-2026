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

async function captureBottom() {
  const profileDir = path.join('C:\\Users\\gd116\\AppData\\Local\\Temp', 'chrome_bottom_' + Date.now());
  
  const chrome = spawn(chromePath, [
    '--headless=new',
    '--remote-debugging-port=9224',
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
      const targets = await fetchJson('http://127.0.0.1:9224/json');
      pageTarget = targets.find(t => t.type === 'page' && t.url.includes('localhost:3000'));
      if (pageTarget && pageTarget.webSocketDebuggerUrl) break;
    } catch (e) {}
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
  await sendCmd('DOM.enable');

  await wait(3000);

  // Scroll down to analysis-grid
  await sendCmd('Runtime.evaluate', {
    expression: `document.querySelector('.analysis-grid').scrollIntoView({ behavior: 'instant', block: 'center' });`
  });
  await wait(1000);

  const res = await sendCmd('Page.captureScreenshot', { format: 'png' });
  if (res.result && res.result.data) {
    fs.writeFileSync('dev-tools/ui_verify_bottom_graph.png', Buffer.from(res.result.data, 'base64'));
    console.log('Saved bottom graph screenshot to dev-tools/ui_verify_bottom_graph.png');
  }

  ws.close();
  chrome.kill();
  try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch (e) {}
}

captureBottom().catch(console.error);
