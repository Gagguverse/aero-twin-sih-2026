const http = require('http');
const { spawn } = require('child_process');

const chrome = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
  '--headless=new', '--remote-debugging-port=9230', '--user-data-dir=C:\\Users\\gd116\\AppData\\Local\\Temp\\chrome_1080', 'http://localhost:3000/'
]);

setTimeout(async () => {
  const targets = await new Promise(res => http.get('http://127.0.0.1:9230/json', r => {
    let d = '';
    r.on('data', c => d += c);
    r.on('end', () => res(JSON.parse(d)));
  }));
  const t = targets.find(x => x.type === 'page');
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise(r => ws.onopen = r);
  ws.send(JSON.stringify({ id: 1, method: 'Emulation.setDeviceMetricsOverride', params: { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false } }));
  ws.send(JSON.stringify({ id: 2, method: 'Page.reload' }));

  setTimeout(() => {
    ws.send(JSON.stringify({
      id: 3,
      method: 'Runtime.evaluate',
      params: {
        expression: `(() => {
          const screen = document.getElementById('mission-brief-screen');
          return {
            docScrollW: document.documentElement.scrollWidth,
            screenScrollW: screen ? screen.scrollWidth : 0,
            winW: window.innerWidth,
            isDocOver: document.documentElement.scrollWidth > window.innerWidth,
            isScreenOver: screen ? screen.scrollWidth > window.innerWidth : false,
            overflowingElements: Array.from(document.querySelectorAll('#mission-brief-screen *'))
              .filter(e => e.getBoundingClientRect().right > 1920)
              .map(e => ({ tag: e.tagName, cls: e.className, right: e.getBoundingClientRect().right }))
          };
        })()`,
        returnByValue: true
      }
    }));
  }, 2000);

  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id === 3) {
      console.log('1080p Check Result:', JSON.stringify(m.result.result.value, null, 2));
      chrome.kill();
      process.exit(0);
    }
  };
}, 1000);
