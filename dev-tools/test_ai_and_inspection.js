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

async function runTests() {
  const profileDir = path.join('C:\\Users\\gd116\\AppData\\Local\\Temp', 'chrome_test_' + Date.now());
  console.log('Launching Headless Chrome for AI Pipeline and 3D Inspection verification...');

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
  for (let i = 0; i < 25; i++) {
    await wait(400);
    try {
      const targets = await fetchJson('http://127.0.0.1:9224/json');
      pageTarget = targets.find(t => t.type === 'page' && t.url.includes('localhost:3000'));
      if (pageTarget && pageTarget.webSocketDebuggerUrl) break;
    } catch (e) {}
  }

  if (!pageTarget) {
    console.error('Failed to connect to Chrome remote debugging port 9224');
    chrome.kill();
    process.exit(1);
  }

  const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
  let msgId = 1;
  const callbacks = new Map();
  const consoleMessages = [];

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && callbacks.has(msg.id)) {
      callbacks.get(msg.id)(msg);
      callbacks.delete(msg.id);
    }
    if (msg.method === 'Runtime.consoleAPICalled') {
      const text = msg.params.args.map(a => a.value || '').join(' ');
      consoleMessages.push(text);
      if (text.includes('[AI DEBUG]')) {
        console.log('[BROWSER CONSOLE]', text);
      }
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

  async function evaluate(fnStr) {
    const res = await sendCmd('Runtime.evaluate', {
      expression: `(${fnStr})()`,
      returnByValue: true,
      awaitPromise: true
    });
    if (res.result && res.result.exceptionDetails) {
      console.error('Eval error:', res.result.exceptionDetails);
      return null;
    }
    return res.result ? res.result.result.value : null;
  }

  console.log('\n=== TEST 1: AI Assistant Query 1 ===');
  console.log('Sending: "Hello, what is the current engine status?"');
  await evaluate(`() => {
    const input = document.getElementById('chat-input');
    input.value = 'Hello, what is the current engine status?';
    document.getElementById('btn-chat-send').click();
  }`);

  // Wait for Groq response
  let q1Done = false;
  for (let i = 0; i < 20; i++) {
    await wait(800);
    const lastMsg = await evaluate(`() => {
      const bubbles = document.querySelectorAll('.chat-bubble.ai');
      if (!bubbles.length) return null;
      const last = bubbles[bubbles.length - 1];
      const badge = last.querySelector('.ai-source-badge');
      return {
        count: bubbles.length,
        badge: badge ? badge.textContent : 'none',
        text: last.innerText.slice(0, 150)
      };
    }`);
    if (lastMsg && lastMsg.count >= 2) {
      console.log('Q1 Response received:', lastMsg);
      q1Done = true;
      break;
    }
  }

  console.log('\n=== TEST 2: AI Assistant Query 2 ===');
  console.log('Sending: "Is this a sensor fault?"');
  await evaluate(`() => {
    const input = document.getElementById('chat-input');
    input.value = 'Is this a sensor fault?';
    document.getElementById('btn-chat-send').click();
  }`);

  let q2Done = false;
  for (let i = 0; i < 20; i++) {
    await wait(800);
    const lastMsg = await evaluate(`() => {
      const bubbles = document.querySelectorAll('.chat-bubble.ai');
      if (bubbles.length < 3) return null;
      const last = bubbles[bubbles.length - 1];
      const badge = last.querySelector('.ai-source-badge');
      return {
        count: bubbles.length,
        badge: badge ? badge.textContent : 'none',
        text: last.innerText.slice(0, 150)
      };
    }`);
    if (lastMsg) {
      console.log('Q2 Response received:', lastMsg);
      q2Done = true;
      break;
    }
  }

  console.log('\n=== TEST 3: AI Assistant Query 3 ===');
  console.log('Sending: "What is the remaining useful life?"');
  await evaluate(`() => {
    const input = document.getElementById('chat-input');
    input.value = 'What is the remaining useful life?';
    document.getElementById('btn-chat-send').click();
  }`);

  let q3Done = false;
  for (let i = 0; i < 20; i++) {
    await wait(800);
    const lastMsg = await evaluate(`() => {
      const bubbles = document.querySelectorAll('.chat-bubble.ai');
      if (bubbles.length < 4) return null;
      const last = bubbles[bubbles.length - 1];
      const badge = last.querySelector('.ai-source-badge');
      return {
        count: bubbles.length,
        badge: badge ? badge.textContent : 'none',
        text: last.innerText.slice(0, 150)
      };
    }`);
    if (lastMsg) {
      console.log('Q3 Response received:', lastMsg);
      q3Done = true;
      break;
    }
  }

  // Check chat bubble spacing and duplicates
  const chatState = await evaluate(`() => {
    const bubbles = Array.from(document.querySelectorAll('.chat-bubble'));
    const texts = bubbles.map(b => b.innerText);
    const hasDupes = new Set(texts).size !== texts.length;
    const history = document.getElementById('chat-history');
    const compStyle = window.getComputedStyle(history);
    return {
      bubbleCount: bubbles.length,
      hasDupes,
      gap: compStyle.gap,
      height: compStyle.height,
      maxHeight: compStyle.maxHeight
    };
  }`);
  console.log('\nChat Container & Spacing State:', chatState);

  console.log('\n=== TEST 4: Digital Twin 3D Inspection - Cylinder 2 ===');
  const inspectCyl2 = await evaluate(`() => {
    window.inspectComponent('cyl_2');
    const backBtn = document.getElementById('btn-back-to-engine');
    const hud = document.getElementById('twin-inspection-hud');
    const rect = backBtn ? backBtn.getBoundingClientRect() : null;
    const style = backBtn ? window.getComputedStyle(backBtn) : null;
    return {
      selectedComp: window.selectedComponent ? window.selectedComponent.name || window.selectedComponent.id : null,
      hudDisplay: hud ? hud.style.display : null,
      backBtnExists: !!backBtn,
      backBtnDisplay: style ? style.display : null,
      backBtnZIndex: style ? style.zIndex : null,
      backBtnRect: rect ? { top: rect.top, left: rect.left, width: rect.width, height: rect.height } : null
    };
  }`);
  console.log('Inspect Cylinder 2 State:', inspectCyl2);

  console.log('\nClicking "BACK TO ENGINE"...');
  const clickBack1 = await evaluate(`() => {
    const backBtn = document.getElementById('btn-back-to-engine');
    if (backBtn) backBtn.click();
    const style = backBtn ? window.getComputedStyle(backBtn) : null;
    const hud = document.getElementById('twin-inspection-hud');
    return {
      selectedComp: window.selectedComponent,
      backBtnDisplay: style ? style.display : null,
      hudDisplay: hud ? hud.style.display : null
    };
  }`);
  console.log('After Back To Engine:', clickBack1);

  console.log('\n=== TEST 5: Digital Twin 3D Inspection - Component 2 (Piston 1) ===');
  const inspectPiston1 = await evaluate(`() => {
    window.inspectComponent('piston_1');
    const backBtn = document.getElementById('btn-back-to-engine');
    const hud = document.getElementById('twin-inspection-hud');
    const style = backBtn ? window.getComputedStyle(backBtn) : null;
    return {
      selectedComp: window.selectedComponent ? window.selectedComponent.name || window.selectedComponent.id : null,
      hudDisplay: hud ? hud.style.display : null,
      backBtnDisplay: style ? style.display : null,
      backBtnZIndex: style ? style.zIndex : null
    };
  }`);
  console.log('Inspect Piston 1 State:', inspectPiston1);

  console.log('\nClicking "BACK TO ENGINE" again...');
  const clickBack2 = await evaluate(`() => {
    const backBtn = document.getElementById('btn-back-to-engine');
    if (backBtn) backBtn.click();
    const style = backBtn ? window.getComputedStyle(backBtn) : null;
    return {
      selectedComp: window.selectedComponent,
      backBtnDisplay: style ? style.display : null
    };
  }`);
  console.log('After Back To Engine 2:', clickBack2);

  // Verify Mapbox untouched
  const mapboxState = await evaluate(`() => {
    return {
      mapInstanceExists: !!(window.missionMap || window.map),
      mapContainer: !!document.getElementById('mission-map-container'),
      styleButtons: Array.from(document.querySelectorAll('.map-style-btn')).map(b => b.textContent.trim())
    };
  }`);
  console.log('\nMapbox state:', mapboxState);

  ws.close();
  chrome.kill();
  console.log('\nAll tests completed.');
}

runTests().catch(err => {
  console.error('Test script error:', err);
  process.exit(1);
});
