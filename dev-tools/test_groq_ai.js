const http = require('http');
const { spawn } = require('child_process');

const chrome = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
  '--headless=new', '--remote-debugging-port=9232', '--user-data-dir=C:\\Users\\gd116\\AppData\\Local\\Temp\\chrome_ai_test', 'http://localhost:3000/'
]);

setTimeout(async () => {
  const targets = await new Promise(res => http.get('http://127.0.0.1:9232/json', r => {
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
  await new Promise(r => setTimeout(r, 2000));

  // Click CTA to enter Mission Control
  await sendCmd('Runtime.evaluate', {
    expression: `(() => { document.getElementById('btn-enter-mission-control')?.click(); })()`
  });
  await new Promise(r => setTimeout(r, 800));

  // Type question and send
  console.log('Sending message to AI Assistant...');
  const sendRes = await sendCmd('Runtime.evaluate', {
    expression: `(() => {
      const input = document.getElementById('chat-input');
      const sendBtn = document.getElementById('btn-chat-send');
      if (!input || !sendBtn) return false;
      input.value = 'what is the current engine status?';
      sendBtn.click();
      return true;
    })()`,
    returnByValue: true
  });
  console.log('Message sent successfully:', sendRes.result?.result?.value);

  // Poll for AI response in chat-history
  let received = null;
  for (let i = 0; i < 40; i++) {
    await new Promise(r => setTimeout(r, 250));
    const check = await sendCmd('Runtime.evaluate', {
      expression: `(() => {
        const msgs = Array.from(document.querySelectorAll('#chat-history .chat-bubble.ai'));
        if (msgs.length <= 1) return null; // initial greeting is 1st msg
        const last = msgs[msgs.length - 1];
        if (last.classList.contains('typing-indicator')) return null;
        return {
          text: last.innerText,
          html: last.innerHTML
        };
      })()`,
      returnByValue: true
    });
    if (check.result?.result?.value) {
      received = check.result.result.value;
      break;
    }
  }

  console.log('AI Response Result:', received ? { textLength: received.text.length, snippet: received.text.slice(0, 160) } : 'TIMEOUT');

  chrome.kill();
  process.exit(0);
}, 1000);
