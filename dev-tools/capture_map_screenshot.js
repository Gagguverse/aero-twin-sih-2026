const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const outputPath = 'C:\\Users\\dell\\.gemini\\antigravity-ide\\brain\\9cd734d2-31b2-4d66-863d-c40a7fda5a9f\\mapbox_geographic_render.png';

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

async function captureScreenshot() {
  const profileDir = path.join('C:\\Users\\dell\\AppData\\Local\\Temp', 'chrome_shot_' + Date.now());
  const chrome = spawn(chromePath, [
    '--headless=new',
    '--remote-debugging-port=9226',
    '--remote-debugging-address=127.0.0.1',
    `--user-data-dir=${profileDir}`,
    '--window-size=1600,1200',
    '--no-first-run',
    '--no-default-browser-check',
    '--ignore-gpu-blocklist',
    '--enable-webgl',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    'http://localhost:3000/'
  ]);

  let pageTarget = null;
  for (let i = 0; i < 25; i++) {
    await wait(300);
    try {
      const targets = await fetchJson('http://127.0.0.1:9226/json');
      pageTarget = targets.find(t => t.type === 'page' && t.url.includes('localhost:3000'));
      if (pageTarget && pageTarget.webSocketDebuggerUrl) break;
    } catch (e) {}
  }

  if (!pageTarget) {
    console.error('Could not connect to Chrome on port 9226');
    chrome.kill();
    process.exit(1);
  }

  const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
  let msgId = 1;
  const callbacks = new Map();

  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.method === 'Runtime.consoleAPICalled') {
      const text = data.params.args.map(a => a.value || a.description || '').join(' ');
      console.log('[PAGE CONSOLE]', text);
    }
    if (data.method === 'Runtime.exceptionThrown') {
      console.error('[PAGE EXCEPTION]', JSON.stringify(data.params.exceptionDetails, null, 2));
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

  // Scroll down to mission map
  console.log('Waiting 5s for Mapbox Standard tiles to load in Chrome...');
  await wait(5000);

  // Scroll map into view
  await send('Runtime.evaluate', {
    expression: `(() => {
      const el = document.querySelector('.mission-map-panel');
      if (el) {
        el.scrollIntoView({ behavior: 'instant', block: 'start' });
      }
    })()`
  });
  await wait(2000);

  // Capture screenshot of the mission map element
  const boxRes = await send('Runtime.evaluate', {
    expression: `(() => {
      const el = document.querySelector('.mission-map-panel');
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      return { 
        x: Math.round(rect.left), 
        y: Math.round(rect.top), 
        width: Math.round(rect.width), 
        height: Math.round(rect.height) 
      };
    })()`,
    returnByValue: true
  });

  console.log('Capturing viewport...');
  const shotRes = await send('Page.captureScreenshot', { format: 'png' });

  if (shotRes.result?.data) {
    const buffer = Buffer.from(shotRes.result.data, 'base64');
    fs.writeFileSync(outputPath, buffer);
    console.log(`Saved screenshot (${buffer.length} bytes) to: ${outputPath}`);
  } else {
    console.error('Failed to capture screenshot data:', shotRes);
  }

  chrome.kill();
  process.exit(0);
}

captureScreenshot().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
