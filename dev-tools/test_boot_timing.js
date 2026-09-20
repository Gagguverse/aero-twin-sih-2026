const http = require('http');
const { spawn } = require('child_process');

const chrome = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
  '--headless=new', '--remote-debugging-port=9231', '--user-data-dir=C:\\Users\\gd116\\AppData\\Local\\Temp\\chrome_boot_test', 'about:blank'
]);

setTimeout(async () => {
  const targets = await new Promise(res => http.get('http://127.0.0.1:9231/json', r => {
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
  await sendCmd('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

  // Navigate to localhost:3000
  await sendCmd('Page.navigate', { url: 'http://localhost:3000/' });

  // Poll boot lines every 100ms for 2.2 seconds
  const start = Date.now();
  const timeline = [];

  for (let i = 0; i < 22; i++) {
    await new Promise(r => setTimeout(r, 100));
    const res = await sendCmd('Runtime.evaluate', {
      expression: `(() => {
        const b = document.getElementById('brief-boot-sequence');
        if (!b) return null;
        const l1 = b.querySelector('.line-1')?.classList.contains('active');
        const l2 = b.querySelector('.line-2')?.classList.contains('active');
        const l3 = b.querySelector('.line-3')?.classList.contains('active');
        const l4 = b.querySelector('.line-4')?.classList.contains('active');
        const complete = b.classList.contains('boot-complete');
        const disp = window.getComputedStyle(b).display;
        return { l1, l2, l3, l4, complete, disp };
      })()`,
      returnByValue: true
    });
    const val = res.result?.result?.value;
    if (val) {
      timeline.push({ elapsed: Date.now() - start, ...val });
    }
  }

  console.log('Boot sequence timeline samples:');
  timeline.filter((_, idx) => idx % 2 === 0 || idx === timeline.length - 1).forEach(item => {
    console.log(` t=${item.elapsed}ms: L1=${item.l1} L2=${item.l2} L3=${item.l3} L4=${item.l4} completeClass=${item.complete} display=${item.disp}`);
  });

  const firstAllActive = timeline.find(x => x.l1 && x.l2 && x.l3 && x.l4);
  const firstComplete = timeline.find(x => x.complete);
  const firstHidden = timeline.find(x => x.disp === 'none');

  console.log('\nMilestones:');
  console.log(' - All 4 lines active at:', firstAllActive?.elapsed, 'ms');
  console.log(' - Boot complete class added at:', firstComplete?.elapsed, 'ms');
  console.log(' - Overlay fully hidden (display: none) at:', firstHidden?.elapsed, 'ms');

  chrome.kill();
  process.exit(0);
}, 1000);
