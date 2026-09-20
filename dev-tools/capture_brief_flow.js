const http = require('http');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const chrome = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
  '--headless=new', '--remote-debugging-port=9227', '--user-data-dir=C:\\Users\\gd116\\AppData\\Local\\Temp\\chrome_flow', 'http://localhost:3000/'
]);

function wait(ms) {
  return new Promise(r => setTimeout(r, ms));
}

setTimeout(async () => {
  const targets = await new Promise(res => http.get('http://127.0.0.1:9227/json', r => {
    let d = '';
    r.on('data', c => d += c);
    r.on('end', () => res(JSON.parse(d)));
  }));
  const t = targets.find(x => x.type === 'page');
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise(r => ws.onopen = r);

  let msgId = 1;
  const callbacks = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && callbacks.has(m.id)) {
      callbacks.get(m.id)(m);
      callbacks.delete(m.id);
    }
  };

  function sendCmd(method, params = {}) {
    return new Promise(resolve => {
      const id = msgId++;
      callbacks.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  await sendCmd('Runtime.enable');
  await sendCmd('Page.enable');
  await sendCmd('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false
  });

  // Reload and capture boot sequence in progress at ~450ms
  await sendCmd('Page.reload');
  await wait(450);
  const shotBoot = await sendCmd('Page.captureScreenshot', { format: 'png' });
  if (shotBoot.result?.data) {
    fs.writeFileSync(path.join(__dirname, 'brief_boot_overlay.png'), Buffer.from(shotBoot.result.data, 'base64'));
    console.log('Saved brief_boot_overlay.png');
  }

  // Wait for boot to finish and settle
  await wait(1800);
  const shotMain = await sendCmd('Page.captureScreenshot', { format: 'png' });
  if (shotMain.result?.data) {
    fs.writeFileSync(path.join(__dirname, 'brief_main_screen.png'), Buffer.from(shotMain.result.data, 'base64'));
    console.log('Saved brief_main_screen.png');
  }

  // 1920x1080
  await sendCmd('Emulation.setDeviceMetricsOverride', {
    width: 1920,
    height: 1080,
    deviceScaleFactor: 1,
    mobile: false
  });
  await wait(300);
  const shot1080 = await sendCmd('Page.captureScreenshot', { format: 'png' });
  if (shot1080.result?.data) {
    fs.writeFileSync(path.join(__dirname, 'brief_main_1920x1080.png'), Buffer.from(shot1080.result.data, 'base64'));
    console.log('Saved brief_main_1920x1080.png');
  }

  // Mobile 390x844
  await sendCmd('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true
  });
  await wait(300);
  const shotMob = await sendCmd('Page.captureScreenshot', { format: 'png' });
  if (shotMob.result?.data) {
    fs.writeFileSync(path.join(__dirname, 'brief_main_mobile.png'), Buffer.from(shotMob.result.data, 'base64'));
    console.log('Saved brief_main_mobile.png');
  }

  // Reset to desktop and click CTA
  await sendCmd('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false
  });
  await wait(200);
  await sendCmd('Runtime.evaluate', {
    expression: `(() => { document.getElementById('btn-enter-mission-control')?.click(); })()`
  });
  await wait(600);
  const shotDash = await sendCmd('Page.captureScreenshot', { format: 'png' });
  if (shotDash.result?.data) {
    fs.writeFileSync(path.join(__dirname, 'dashboard_entered_live.png'), Buffer.from(shotDash.result.data, 'base64'));
    console.log('Saved dashboard_entered_live.png');
  }

  chrome.kill();
  console.log('Flow capture finished successfully!');
  process.exit(0);
}, 1000);
