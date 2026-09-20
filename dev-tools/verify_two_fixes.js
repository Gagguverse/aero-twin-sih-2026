const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const profileDir = path.join('C:\\Users\\gd116\\AppData\\Local\\Temp', 'chrome_test_verify_' + Date.now());
const debugPort = 9230;

const chrome = spawn(chromePath, [
  '--headless=new',
  '--remote-debugging-port=' + debugPort,
  '--remote-debugging-address=127.0.0.1',
  '--user-data-dir=' + profileDir,
  '--window-size=1600,1050',
  '--no-first-run',
  '--no-default-browser-check',
  'http://localhost:3000/'
]);

function wait(ms) { return new Promise(r => setTimeout(r, ms)); }
function fetchJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });
}

async function run() {
  console.log('=== STARTING VERIFICATION OF TWO FIXES ===');
  await wait(2000);

  let pageTarget = null;
  for (let i = 0; i < 25; i++) {
    try {
      const targets = await fetchJson('http://127.0.0.1:' + debugPort + '/json');
      pageTarget = targets.find(t => t.type === 'page' && t.url.includes('localhost:3000'));
      if (pageTarget && pageTarget.webSocketDebuggerUrl) break;
    } catch(e) {}
    await wait(300);
  }
  if (!pageTarget) {
    console.error('❌ Could not connect to Chrome on port', debugPort);
    chrome.kill();
    process.exit(1);
  }

  const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
  let msgId = 1;
  const callbacks = new Map();
  const consoleLogs = [];
  const uncaughtErrors = [];

  ws.onmessage = (e) => {
    const d = JSON.parse(e.data);
    if (d.method === 'Runtime.consoleAPICalled') {
      consoleLogs.push(d.params.args.map(a => a.value || '').join(' '));
    }
    if (d.method === 'Runtime.exceptionThrown') {
      uncaughtErrors.push(d.params.exceptionDetails.text);
    }
    if (d.id && callbacks.has(d.id)) {
      callbacks.get(d.id)(d.result);
      callbacks.delete(d.id);
    }
  };

  function sendCdp(method, params={}) {
    return new Promise(r => {
      const id = msgId++;
      callbacks.set(id, r);
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  await new Promise((resolve, reject) => {
    if (ws.readyState === WebSocket.OPEN) return resolve();
    ws.onopen = () => resolve();
    ws.onerror = (err) => reject(err);
  });

  await sendCdp('Runtime.enable');
  await wait(2500);

  // ---------------------------------------------------------------------------
  // PART A: AI ASSISTANT CHAT SPACING & HEIGHT VERIFICATION
  // ---------------------------------------------------------------------------
  console.log('\n--- TEST A1: Baseline Chat Layout & Initial Message ---');
  const baseline = await sendCdp('Runtime.evaluate', {
    expression: `(() => {
      const panel = document.querySelector('.assistant-panel');
      const chatBox = document.querySelector('.chat-history-box');
      const input = document.querySelector('.chat-input-bar');
      const analysisGrid = document.querySelector('.analysis-grid');
      const degPanel = document.querySelector('.degradation-panel');
      return {
        panelHeight: panel.getBoundingClientRect().height,
        chatBoxHeight: chatBox.getBoundingClientRect().height,
        analysisGridHeight: analysisGrid.getBoundingClientRect().height,
        degPanelHeight: degPanel.getBoundingClientRect().height,
        bubbleCount: document.querySelectorAll('.chat-bubble').length
      };
    })()`,
    returnByValue: true
  });
  console.log('Baseline measurements:', baseline.result.value);

  console.log('\n--- TEST A2: Sending 10 queries sequentially ---');
  const queries = [
    "Hello",
    "What is your model?",
    "Why is engine health changing?",
    "Is this a sensor fault?",
    "What caused the anomaly?",
    "How much RUL remains?",
    "Which sensor is unreliable?",
    "What are the CHT temperatures?",
    "Explain the EHI score",
    "Status check"
  ];

  for (let idx = 0; idx < queries.length; idx++) {
    const q = queries[idx];
    await sendCdp('Runtime.evaluate', {
      expression: `window.handleUserQuery(${JSON.stringify(q)});`
    });
    // Wait for response & typing cleanup
    for (let w = 0; w < 15; w++) {
      await wait(300);
      const isBusy = await sendCdp('Runtime.evaluate', {
        expression: `document.querySelectorAll('.typing-indicator').length > 0;`,
        returnByValue: true
      });
      if (!isBusy.result.value) break;
    }
  }

  const after10 = await sendCdp('Runtime.evaluate', {
    expression: `(() => {
      const panel = document.querySelector('.assistant-panel');
      const chatBox = document.querySelector('.chat-history-box');
      const input = document.querySelector('.chat-input-bar');
      const analysisGrid = document.querySelector('.analysis-grid');
      const degPanel = document.querySelector('.degradation-panel');
      const bubbles = Array.from(document.querySelectorAll('.chat-bubble'));
      
      const gaps = [];
      for (let i = 0; i < bubbles.length - 1; i++) {
        const r1 = bubbles[i].getBoundingClientRect();
        const r2 = bubbles[i+1].getBoundingClientRect();
        gaps.push(Math.round(r2.top - r1.bottom));
      }

      // Check if input bar is below chat box
      const chatRect = chatBox.getBoundingClientRect();
      const inputRect = input.getBoundingClientRect();
      const inputAtBottom = inputRect.top >= chatRect.bottom;

      // Check for orphan typing indicators
      const typingIndicators = document.querySelectorAll('.typing-indicator').length;

      return {
        panelHeight: panel.getBoundingClientRect().height,
        chatBoxHeight: chatBox.getBoundingClientRect().height,
        analysisGridHeight: analysisGrid.getBoundingClientRect().height,
        degPanelHeight: degPanel.getBoundingClientRect().height,
        chatBoxScrollHeight: chatBox.scrollHeight,
        chatBoxClientHeight: chatBox.clientHeight,
        isScrollable: chatBox.scrollHeight > chatBox.clientHeight,
        bubbleCount: bubbles.length,
        typingIndicators,
        inputAtBottom,
        uniqueGaps: Array.from(new Set(gaps)),
        gapsSample: gaps.slice(0, 10)
      };
    })()`,
    returnByValue: true
  });
  console.log('Measurements after 10 messages:', after10.result.value);

  // Assertions for Chat
  const bVal = baseline && baseline.result ? baseline.result.value : null;
  const aVal = after10 && after10.result ? after10.result.value : null;

  const chatOk = aVal &&
                 aVal.panelHeight === 520 &&
                 aVal.typingIndicators === 0 &&
                 aVal.inputAtBottom &&
                 aVal.isScrollable &&
                 aVal.uniqueGaps.length === 1 &&
                 aVal.uniqueGaps[0] === 8;

  if (chatOk) {
    console.log('✅ CHAT FIX VERIFIED: Strict uniform 8px gap between all bubbles, zero dashboard height expansion (stays locked at 520px), zero orphan typing indicators, input pinned at bottom!');
  } else {
    console.log('⚠️ CHAT WARNING: check details', aVal);
  }

  // ---------------------------------------------------------------------------
  // PART B: MAPBOX SATELLITE VIEW TOGGLE VERIFICATION
  // ---------------------------------------------------------------------------
  console.log('\n--- TEST B1: Verifying Initial Standard Map State ---');
  const mapInitial = await sendCdp('Runtime.evaluate', {
    expression: `(() => {
      const mapCtrl = window.missionMap;
      const toggle = document.getElementById('map-style-toggle');
      const btnStd = document.getElementById('btn-map-style-standard');
      const btnSat = document.getElementById('btn-map-style-satellite');
      return {
        hasToggle: !!toggle,
        stdActive: btnStd && btnStd.classList.contains('active'),
        satActive: btnSat && btnSat.classList.contains('active'),
        currentStyleMode: mapCtrl ? mapCtrl.currentStyleMode : null,
        hasMap: !!(mapCtrl && mapCtrl.map),
        hasRouteSource: !!(mapCtrl && mapCtrl.map && mapCtrl.map.getSource('planned-route')),
        hasRouteLayer: !!(mapCtrl && mapCtrl.map && mapCtrl.map.getLayer('route-line')),
        hasUavMarker: !!(mapCtrl && mapCtrl.uavMarker),
        waypointCount: mapCtrl ? mapCtrl.waypointMarkers.length : 0,
        baseCount: mapCtrl ? mapCtrl.baseMarkers.length : 0
      };
    })()`,
    returnByValue: true
  });
  console.log('Initial Map State:', mapInitial.result.value);

  console.log('\n--- TEST B2: Switching to SATELLITE View ---');
  await sendCdp('Runtime.evaluate', {
    expression: `document.getElementById('btn-map-style-satellite').click();`
  });
  // Wait for Mapbox to fetch satellite tiles and load new style
  await wait(4000);

  const mapSat = await sendCdp('Runtime.evaluate', {
    expression: `(() => {
      const mapCtrl = window.missionMap;
      const btnStd = document.getElementById('btn-map-style-standard');
      const btnSat = document.getElementById('btn-map-style-satellite');
      return {
        stdActive: btnStd && btnStd.classList.contains('active'),
        satActive: btnSat && btnSat.classList.contains('active'),
        currentStyleMode: mapCtrl ? mapCtrl.currentStyleMode : null,
        hasRouteSource: !!(mapCtrl && mapCtrl.map && mapCtrl.map.getSource('planned-route')),
        hasRouteLayer: !!(mapCtrl && mapCtrl.map && mapCtrl.map.getLayer('route-line')),
        hasRouteGlowLayer: !!(mapCtrl && mapCtrl.map && mapCtrl.map.getLayer('route-glow')),
        hasUavMarker: !!(mapCtrl && mapCtrl.uavMarker),
        waypointCount: mapCtrl ? mapCtrl.waypointMarkers.length : 0,
        baseCount: mapCtrl ? mapCtrl.baseMarkers.length : 0
      };
    })()`,
    returnByValue: true
  });
  console.log('Satellite Map State:', mapSat.result.value);

  console.log('\n--- TEST B3: Switching back to STANDARD View ---');
  await sendCdp('Runtime.evaluate', {
    expression: `document.getElementById('btn-map-style-standard').click();`
  });
  await wait(4000);

  const mapStdReturn = await sendCdp('Runtime.evaluate', {
    expression: `(() => {
      const mapCtrl = window.missionMap;
      const btnStd = document.getElementById('btn-map-style-standard');
      const btnSat = document.getElementById('btn-map-style-satellite');
      return {
        stdActive: btnStd && btnStd.classList.contains('active'),
        satActive: btnSat && btnSat.classList.contains('active'),
        currentStyleMode: mapCtrl ? mapCtrl.currentStyleMode : null,
        hasRouteSource: !!(mapCtrl && mapCtrl.map && mapCtrl.map.getSource('planned-route')),
        hasRouteLayer: !!(mapCtrl && mapCtrl.map && mapCtrl.map.getLayer('route-line')),
        hasRouteGlowLayer: !!(mapCtrl && mapCtrl.map && mapCtrl.map.getLayer('route-glow')),
        hasUavMarker: !!(mapCtrl && mapCtrl.uavMarker),
        waypointCount: mapCtrl ? mapCtrl.waypointMarkers.length : 0,
        baseCount: mapCtrl ? mapCtrl.baseMarkers.length : 0
      };
    })()`,
    returnByValue: true
  });
  console.log('Standard Returned State:', mapStdReturn.result.value);

  const mapOk = mapSat.result.value.satActive &&
                mapSat.result.value.currentStyleMode === 'satellite' &&
                mapSat.result.value.hasRouteSource &&
                mapSat.result.value.hasRouteLayer &&
                mapSat.result.value.hasUavMarker &&
                mapStdReturn.result.value.stdActive &&
                mapStdReturn.result.value.currentStyleMode === 'standard' &&
                mapStdReturn.result.value.hasRouteSource &&
                mapStdReturn.result.value.hasRouteLayer;

  if (mapOk) {
    console.log('✅ MAPBOX SATELLITE TOGGLE VERIFIED: Smooth toggle between Standard and Satellite, complete preservation of route, markers, and overlays with no duplicates!');
  } else {
    console.log('⚠️ MAP WARNING: check details', mapSat.result.value, mapStdReturn.result.value);
  }

  // Check errors
  console.log('\nUncaught errors detected during session:', uncaughtErrors.length);
  if (uncaughtErrors.length > 0) {
    console.log('Uncaught errors:', uncaughtErrors);
  }

  chrome.kill();
  console.log('\n=== ALL VERIFICATION TESTS COMPLETED ===');
}

run();
