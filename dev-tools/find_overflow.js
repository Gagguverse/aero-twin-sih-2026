const http = require('http');
const { spawn } = require('child_process');

const chrome = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
  '--headless=new', '--remote-debugging-port=9226', '--user-data-dir=C:\\Users\\gd116\\AppData\\Local\\Temp\\chrome_deb', 'http://localhost:3000/'
]);

setTimeout(async () => {
  const targets = await new Promise(res => http.get('http://127.0.0.1:9226/json', r => {
    let d = '';
    r.on('data', c => d += c);
    r.on('end', () => res(JSON.parse(d)));
  }));
  const t = targets.find(x => x.type === 'page');
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise(r => ws.onopen = r);
  ws.send(JSON.stringify({ id: 1, method: 'Emulation.setDeviceMetricsOverride', params: { width: 390, height: 844, deviceScaleFactor: 1, mobile: true } }));
  ws.send(JSON.stringify({ id: 2, method: 'Page.reload' }));
  
  setTimeout(() => {
    ws.send(JSON.stringify({
      id: 3,
      method: 'Runtime.evaluate',
      params: {
        expression: `(() => {
          const els = Array.from(document.querySelectorAll('#mission-brief-screen *'))
            .filter(e => e.getBoundingClientRect().right > 390)
            .map(e => ({
              tag: e.tagName,
              cls: e.className,
              id: e.id,
              right: Math.round(e.getBoundingClientRect().right),
              width: Math.round(e.getBoundingClientRect().width)
            }));
          return els;
        })()`,
        returnByValue: true
      }
    }));
  }, 1200);

  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id === 3) {
      console.log('Overflowing elements on 390px:', JSON.stringify(m.result.result.value, null, 2));
      chrome.kill();
      process.exit(0);
    }
  };
}, 1000);
