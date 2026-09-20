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

async function runResponsiveCheck() {
  const profileDir = path.join('C:\\Users\\gd116\\AppData\\Local\\Temp', 'chrome_resp_' + Date.now());
  const chrome = spawn(chromePath, [
    '--headless=new',
    '--remote-debugging-port=9225',
    '--remote-debugging-address=127.0.0.1',
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    'http://localhost:3000/'
  ]);

  let pageTarget = null;
  for (let i = 0; i < 20; i++) {
    await wait(400);
    try {
      const targets = await fetchJson('http://127.0.0.1:9225/json');
      pageTarget = targets.find(t => t.type === 'page' && t.url.includes('localhost:3000'));
      if (pageTarget && pageTarget.webSocketDebuggerUrl) break;
    } catch (e) {}
  }

  const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
  let msgId = 1;
  const callbacks = new Map();
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.id && callbacks.has(msg.id)) {
      callbacks.get(msg.id)(msg);
      callbacks.delete(msg.id);
    }
  };
  await new Promise(r => ws.onopen = r);

  function sendCmd(method, params = {}) {
    return new Promise(resolve => {
      const id = msgId++;
      callbacks.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  await sendCmd('Runtime.enable');
  await sendCmd('Page.enable');

  const viewports = [
    { name: 'desktop', width: 1440, height: 900 },
    { name: 'tablet', width: 768, height: 1024 },
    { name: 'mobile', width: 390, height: 844 }
  ];

  for (const vp of viewports) {
    await sendCmd('Emulation.setDeviceMetricsOverride', {
      width: vp.width,
      height: vp.height,
      deviceScaleFactor: 1,
      mobile: vp.name === 'mobile'
    });
    await sendCmd('Page.reload');
    await wait(1500);

    const overflowCheck = await sendCmd('Runtime.evaluate', {
      expression: `(() => {
        const doc = document.documentElement;
        const screen = document.getElementById('mission-brief-screen');
        return {
          windowWidth: window.innerWidth,
          scrollWidth: doc.scrollWidth,
          screenScrollWidth: screen.scrollWidth,
          hasHorizontalScroll: doc.scrollWidth > window.innerWidth || screen.scrollWidth > window.innerWidth,
          ctaVisible: !!document.getElementById('btn-enter-mission-control')
        };
      })()`,
      returnByValue: true
    });

    const resData = overflowCheck.result?.result?.value;
    console.log(`Viewport [${vp.name}] ${vp.width}x${vp.height}:`);
    console.log(` - Has Horizontal Scroll: ${resData?.hasHorizontalScroll} (Window: ${resData?.windowWidth}px, DocScroll: ${resData?.scrollWidth}px, ScreenScroll: ${resData?.screenScrollWidth}px)`);
    console.log(` - CTA Visible: ${resData?.ctaVisible}`);

    const shot = await sendCmd('Page.captureScreenshot', { format: 'png' });
    if (shot.result?.data) {
      fs.writeFileSync(path.join(__dirname, `brief_${vp.name}.png`), Buffer.from(shot.result.data, 'base64'));
    }
  }

  ws.close();
  chrome.kill();
  console.log('Responsive verification complete!');
}

runResponsiveCheck().catch(console.error);
