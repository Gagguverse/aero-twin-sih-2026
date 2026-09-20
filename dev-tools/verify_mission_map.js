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

async function verifyRealMapboxMap() {
  console.log('=== VERIFYING REAL MAPBOX STANDARD GEOGRAPHIC MAP IMPLEMENTATION ===');
  
  const profileDir = path.join('C:\\Users\\dell\\AppData\\Local\\Temp', 'chrome_mapbox_test_' + Date.now());
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
    await wait(300);
    try {
      const targets = await fetchJson('http://127.0.0.1:9225/json');
      pageTarget = targets.find(t => t.type === 'page' && t.url.includes('localhost:3000'));
      if (pageTarget && pageTarget.webSocketDebuggerUrl) break;
    } catch (e) {}
  }

  if (!pageTarget) {
    console.error('❌ Could not attach to headless Chrome on port 9225');
    chrome.kill();
    process.exit(1);
  }

  const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
  let msgId = 1;
  const callbacks = new Map();
  const consoleLogs = [];
  const uncaughtErrors = [];

  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.method === 'Runtime.consoleAPICalled') {
      consoleLogs.push(data.params);
    }
    if (data.method === 'Runtime.exceptionThrown') {
      uncaughtErrors.push(data.params);
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

  console.log('Waiting 4s for Mapbox Standard tiles, WebGL rendering and engine initialization...');
  await wait(4000);

  async function evalJs(expr) {
    const res = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (res.result?.exceptionDetails) {
      return { error: res.result.exceptionDetails.text || res.result.exceptionDetails.exception?.description };
    }
    return { value: res.result?.result?.value !== undefined ? res.result.result.value : res.result?.value };
  }

  // 1. Verify Real Mapbox GL JS Instance & Style
  console.log('\n1. Verifying Real Mapbox GL JS Instance & Geographic Configuration...');
  const mapboxCheck = await evalJs(`(() => {
    const m = window.missionMap?.map;
    const canvas = document.querySelector('#mission-map-container .mapboxgl-canvas');
    return {
      hasMapboxGlobal: typeof window.mapboxgl !== 'undefined',
      hasTokenInWindow: !!window.VITE_MAPBOX_TOKEN && window.VITE_MAPBOX_TOKEN.startsWith('pk.'),
      isMapboxLoaded: !!window.missionMap?.isMapLoaded,
      mapCenter: m ? m.getCenter() : null,
      mapZoom: m ? m.getZoom() : null,
      hasRealCanvas: !!canvas,
      canvasWidth: canvas ? canvas.width : 0,
      canvasHeight: canvas ? canvas.height : 0,
      hasNavigationCtrl: !!document.querySelector('.mapboxgl-ctrl-group'),
      hasFullscreenCtrl: !!document.querySelector('.mapboxgl-ctrl-fullscreen'),
      hasPlannedRouteSource: m ? !!m.getSource('planned-route') : false,
      hasRouteGlowLayer: m ? !!m.getLayer('route-glow') : false,
      hasRouteLineLayer: m ? !!m.getLayer('route-line') : false,
      baseMarkersCount: window.missionMap?.baseMarkers?.length || 0,
      waypointMarkersCount: window.missionMap?.waypointMarkers?.length || 0,
      hasUavMarker: !!window.missionMap?.uavMarker
    };
  })()`);
  console.log('   Mapbox Verification Report:', JSON.stringify(mapboxCheck.value, null, 2));

  // 2. Verify Real Mapbox Tiles Rendered
  console.log('\n2. Verifying Real Mapbox Tile Rendering and Zero Fake Radar Canvas...');
  const tileCheck = await evalJs(`(() => {
    const fakeCanvas = document.getElementById('tactical-airspace-canvas');
    const realCanvas = document.querySelector('#mission-map-container .mapboxgl-canvas');
    const container = document.getElementById('mission-map-container');
    const rect = container ? container.getBoundingClientRect() : {};
    return {
      fakeCanvasPresent: !!fakeCanvas,
      realCanvasPresent: !!realCanvas,
      containerHeight: rect.height,
      containerWidth: rect.width,
      isRealGeographicMap: !fakeCanvas && !!realCanvas && rect.height > 400
    };
  })()`);
  console.log('   Tile Rendering Report:', JSON.stringify(tileCheck.value, null, 2));

  // 3. Test Sensor Freeze Scenario ("Bad Sensor != Bad Engine")
  console.log('\n3. Testing Scenario: SENSOR FREEZE...');
  await evalJs(`window.applyScenario('sensor_fault')`);
  await wait(1200);
  const check3 = await evalJs(`({
    scenario: window.appState.scenario,
    aiDiagnosis: window.appState.aiDiagnosis,
    ehi: window.appState.ehi,
    actionTag: document.getElementById('contingency-rec-tag')?.textContent?.trim(),
    title: document.getElementById('contingency-rec-title')?.textContent?.trim()
  })`);
  console.log('   Recommendation:', JSON.stringify(check3.value));

  // 4. Test Thermal Runaway Scenario (Incident Marker + Tactical Divert to Deesa FLS)
  console.log('\n4. Testing Scenario: THERMAL RUNAWAY (Verifying Incident Marker Placement)...');
  await evalJs(`window.applyScenario('thermal_degradation')`);
  await wait(1200);
  const check4 = await evalJs(`(() => {
    const m = window.missionMap;
    const incMarker = m?.incidentMarker;
    const incEl = document.querySelector('.mapbox-incident-marker');
    return {
      scenario: window.appState.scenario,
      aiDiagnosis: window.appState.aiDiagnosis,
      ehi: window.appState.ehi,
      actionTag: document.getElementById('contingency-rec-tag')?.textContent?.trim(),
      title: document.getElementById('contingency-rec-title')?.textContent?.trim(),
      incidentActive: m?.incident?.active,
      incidentLat: m?.incident?.lat,
      incidentLng: m?.incident?.lng,
      hasIncidentMarkerEl: !!incEl,
      incidentMarkerText: incEl ? incEl.textContent?.trim() : null
    };
  })()`);
  console.log('   Thermal Runaway & Incident Marker:', JSON.stringify(check4.value));

  // 5. Test Lubrication Fault Scenario (Emergency Divert to AFS Uttarlai)
  console.log('\n5. Testing Scenario: LUBRICATION FAULT...');
  await evalJs(`window.applyScenario('lubrication_degradation')`);
  await wait(1200);
  const check5 = await evalJs(`({
    scenario: window.appState.scenario,
    aiDiagnosis: window.appState.aiDiagnosis,
    ehi: window.appState.ehi,
    actionTag: document.getElementById('contingency-rec-tag')?.textContent?.trim(),
    title: document.getElementById('contingency-rec-title')?.textContent?.trim(),
    metrics: document.getElementById('contingency-rec-metrics')?.textContent?.replace(/\\s+/g, ' ')?.trim()
  })`);
  console.log('   Lubrication Fault Recommendation:', JSON.stringify(check5.value));

  // 6. Reset to Normal
  console.log('\n6. Resetting to Normal Mission...');
  await evalJs(`window.applyScenario('normal')`);
  await wait(600);

  console.log('\n7. Checking for Uncaught Exceptions:');
  console.log('   Uncaught Exceptions Count:', uncaughtErrors.length);
  if (uncaughtErrors.length > 0) {
    console.error('   Details:', JSON.stringify(uncaughtErrors, null, 2));
  }

  const success = 
    mapboxCheck.value?.hasMapboxGlobal &&
    mapboxCheck.value?.hasTokenInWindow &&
    mapboxCheck.value?.isMapboxLoaded &&
    mapboxCheck.value?.hasRealCanvas &&
    mapboxCheck.value?.hasNavigationCtrl &&
    mapboxCheck.value?.hasRouteLineLayer &&
    tileCheck.value?.isRealGeographicMap &&
    !tileCheck.value?.fakeCanvasPresent &&
    check4.value?.hasIncidentMarkerEl &&
    check5.value?.title?.includes('UTTARLAI') &&
    uncaughtErrors.length === 0;

  console.log('\n================================================================');
  console.log(success 
    ? '✅ REAL MAPBOX GEOGRAPHIC MAP VERIFICATION: 100% PASSED' 
    : '❌ REAL MAPBOX MAP VERIFICATION FAILED');
  console.log('================================================================');

  chrome.kill();
  process.exit(success ? 0 : 1);
}

verifyRealMapboxMap().catch(err => {
  console.error('Fatal verification error:', err);
  process.exit(1);
});
