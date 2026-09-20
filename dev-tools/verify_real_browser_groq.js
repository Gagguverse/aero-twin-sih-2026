const { spawn } = require('child_process');
const http = require('http');
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

async function runBrowserTest() {
  const profileDir = path.join('C:\\Users\\gd116\\AppData\\Local\\Temp', 'chrome_groq_test_' + Date.now());
  console.log('[TEST] Launching real Chrome browser for UI verification...');

  const chrome = spawn(chromePath, [
    '--headless=new',
    '--remote-debugging-port=9225',
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
      const targets = await fetchJson('http://127.0.0.1:9225/json');
      pageTarget = targets.find(t => t.type === 'page' && t.url.includes('localhost:3000'));
      if (pageTarget && pageTarget.webSocketDebuggerUrl) break;
    } catch (e) {}
  }

  if (!pageTarget) {
    console.error('[TEST ERROR] Could not connect to Chrome debugging target');
    chrome.kill();
    process.exit(1);
  }

  const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
  let msgId = 1;
  const callbacks = new Map();
  const networkRequests = [];
  const networkResponses = [];
  const aiRouteLogs = [];

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && callbacks.has(msg.id)) {
      callbacks.get(msg.id)(msg);
      callbacks.delete(msg.id);
    }
    if (msg.method === 'Runtime.consoleAPICalled') {
      const text = msg.params.args.map(a => a.value || '').join(' ');
      if (text.includes('[AI ROUTE]') || text.includes('[AI DEBUG]')) {
        console.log('[BROWSER LOG]', text);
        if (text.includes('[AI ROUTE]')) {
          aiRouteLogs.push(text);
        }
      }
    }
    if (msg.method === 'Network.requestWillBeSent') {
      const req = msg.params.request;
      if (req.url.includes('/api/grok')) {
        networkRequests.push(req);
        console.log(`[NETWORK EVENT] Outgoing Request: ${req.method} ${req.url}`);
      }
    }
    if (msg.method === 'Network.responseReceived') {
      const res = msg.params.response;
      if (res.url.includes('/api/grok')) {
        networkResponses.push(res);
        console.log(`[NETWORK EVENT] Incoming Response: HTTP ${res.status} ${res.statusText} for ${res.url}`);
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
  await sendCmd('Network.enable');

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

  // Wait for chat elements to be ready in DOM
  for (let i = 0; i < 30; i++) {
    const ready = await evaluate(`() => !!document.getElementById('chat-input') && !!document.getElementById('btn-chat-send')`);
    if (ready) break;
    await wait(300);
  }

  console.log('\n--- SENDING USER QUESTION VIA CHAT UI ---');
  const testQuestion = 'Why is engine health changing?';
  console.log(`Query: "${testQuestion}"`);

  await evaluate(`() => {
    const input = document.getElementById('chat-input');
    if (!input) return;
    input.value = ${JSON.stringify(testQuestion)};
    document.getElementById('btn-chat-send').click();
  }`);

  // Wait for Groq response to arrive and be rendered in DOM
  let responseRendered = false;
  let bubbleData = null;

  for (let attempt = 0; attempt < 25; attempt++) {
    await wait(800);
    bubbleData = await evaluate(`() => {
      const bubbles = document.querySelectorAll('.chat-bubble.ai:not(.typing-indicator)');
      if (!bubbles.length) return null;
      // Filter out initial welcome notice if any
      const last = bubbles[bubbles.length - 1];
      const badge = last.querySelector('.ai-source-badge');
      return {
        totalAiBubbles: bubbles.length,
        badgeText: badge ? badge.textContent.trim() : null,
        badgeClass: badge ? badge.className : null,
        htmlContent: last.innerHTML,
        innerText: last.innerText.trim()
      };
    }`);

    if (bubbleData && bubbleData.totalAiBubbles >= 2 && bubbleData.badgeText) {
      responseRendered = true;
      break;
    }
  }

  console.log('\n=== REAL BROWSER VERIFICATION REPORT ===');
  console.log('1. Network Requests to /api/grok:');
  networkRequests.forEach(req => {
    console.log(`   - Method: ${req.method}, URL: ${req.url}`);
  });

  console.log('2. Network Responses from /api/grok:');
  networkResponses.forEach(res => {
    console.log(`   - Status: ${res.status} ${res.statusText}`);
  });

  console.log('3. Captured [AI ROUTE] Browser Console Logs:');
  aiRouteLogs.forEach(log => {
    console.log(`   ${log}`);
  });

  console.log('4. Rendered Chat Bubble Details:');
  if (bubbleData) {
    console.log(`   - Total AI Bubbles: ${bubbleData.totalAiBubbles}`);
    console.log(`   - Badge Text: "${bubbleData.badgeText}"`);
    console.log(`   - Badge Class: "${bubbleData.badgeClass}"`);
    console.log(`   - Visible Content:\n${bubbleData.innerText}\n`);
  } else {
    console.log('   - No response bubble found!');
  }

  const isGroqBadge = bubbleData && bubbleData.badgeText === '✦ GROK AI';
  const hasNetworkPost = networkRequests.some(r => r.method === 'POST');
  const has200Response = networkResponses.some(r => r.status === 200);

  console.log('=== VERIFICATION SUMMARY ===');
  console.log(`- Network POST request sent to /api/grok: ${hasNetworkPost ? 'PASS' : 'FAIL'}`);
  console.log(`- Network HTTP 200 received: ${has200Response ? 'PASS' : 'FAIL'}`);
  console.log(`- Chat badge rendered as "✦ GROK AI": ${isGroqBadge ? 'PASS' : 'FAIL'}`);
  console.log(`- Response visibly rendered: ${responseRendered ? 'PASS' : 'FAIL'}`);

  chrome.kill();
  if (hasNetworkPost && has200Response && isGroqBadge && responseRendered) {
    console.log('\nSUCCESS: Groq response is verified visibly rendered in the real browser!');
    process.exit(0);
  } else {
    console.error('\nFAILURE: One or more verification checks failed.');
    process.exit(1);
  }
}

runBrowserTest().catch(err => {
  console.error('[TEST EXCEPTION]', err);
  process.exit(1);
});
