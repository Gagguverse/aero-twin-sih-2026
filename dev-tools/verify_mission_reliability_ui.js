const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const profileDir = path.join('C:\\Users\\gd116\\AppData\\Local\\Temp', 'chrome_rel_verify_' + Date.now());
const debugPort = 9235;

function wait(ms) { return new Promise(r => setTimeout(r, ms)); }
function fetchJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

async function run() {
  console.log('=== VERIFYING MISSION RELIABILITY & MAP ENVELOPE IN BROWSER ===');
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

  try {
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
      console.error('Could not connect to Chrome target');
      return;
    }

    const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
    let idCounter = 1;
    const pending = new Map();

    ws.onmessage = (evt) => {
      const msg = JSON.parse(evt.data);
      if (msg.id && pending.has(msg.id)) {
        pending.get(msg.id)(msg);
        pending.delete(msg.id);
      }
    };

    await new Promise(r => ws.onopen = r);

    const callCdp = (method, params = {}) => new Promise((resolve) => {
      const id = idCounter++;
      pending.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params }));
    });

    await callCdp('Page.enable');
    await callCdp('Runtime.enable');

    console.log('Waiting for initial page ready state...');
    await wait(800);

    console.log('Clicking "ENTER MISSION CONTROL" button or calling window.enterMissionControl()...');
    await callCdp('Runtime.evaluate', {
      expression: `(() => {
        if (typeof window.enterMissionControl === 'function') {
          window.enterMissionControl();
        } else {
          const btn = document.getElementById('btn-enter-mission-control');
          if (btn) btn.click();
        }
      })()`
    });

    // Wait for cinematic fade-out and telemetry engine ticks
    await wait(1200);

    // Query UI state from browser DOM
    const uiData = await callCdp('Runtime.evaluate', {
      expression: `(() => {
        const s = window.appState;
        const score = document.getElementById('mission-rel-val')?.textContent?.trim();
        const badge = document.getElementById('mission-rel-badge')?.textContent?.trim();
        const risk = document.getElementById('mission-risk-val')?.textContent?.trim();
        const preview = document.getElementById('mission-rel-contributors-preview')?.textContent?.trim();

        // Physics table rows
        const physicsRows = Array.from(document.querySelectorAll('#physics-table-body tr')).map(r => ({
          text: r.textContent.replace(/\\s+/g, ' ').trim(),
          param: r.querySelector('td:nth-child(1)')?.textContent?.replace(/\\s+/g, ' ')?.trim(),
          expected: r.querySelector('td:nth-child(2)')?.textContent?.trim(),
          actual: r.querySelector('td:nth-child(3)')?.textContent?.trim(),
          residual: r.querySelector('td:nth-child(4)')?.textContent?.trim(),
          status: r.querySelector('td:nth-child(5)')?.textContent?.trim()
        }));

        const mapPhysicsRow = physicsRows.find(r => r.param && (r.param.includes('MAP') || r.param.includes('Boost')));

        // Live telemetry tile
        const mapTelemTile = document.getElementById('telem-map');
        const mapTelemStatus = mapTelemTile?.querySelector('.telemetry-status-tag')?.textContent?.trim();
        const mapTelemTrend = mapTelemTile?.querySelector('.telemetry-trend')?.textContent?.trim();

        const btnInspect = document.getElementById('btn-inspect-reliability');

        return {
          bodyBriefActive: document.body.classList.contains('brief-active'),
          hasPhysicsInAppState: !!s?.physics,
          physicsTableInnerHTML: document.getElementById('physics-table-body')?.innerHTML?.length || 0,
          appStateScore: s?.missionReliability?.score,
          appStateStatus: s?.missionReliability?.status,
          appStateRisk: s?.missionReliability?.riskLevel,
          contributors: s?.missionReliability?.contributors?.penalties,
          debugText: s?.missionReliability?.debugText,
          cardScore: score,
          cardBadge: badge,
          cardRisk: risk,
          cardPreview: preview,
          physicsRowsCount: physicsRows.length,
          mapPhysics: mapPhysicsRow,
          mapTelemStatus,
          mapTelemTrend,
          hasBtnInspect: !!btnInspect,
          rawTelem: {
            rpm: s?.rawTelemetry?.rpm,
            map: s?.rawTelemetry?.map,
            altitude: s?.rawTelemetry?.altitude,
            load: s?.rawTelemetry?.load
          }
        };
      })()`,
      returnByValue: true
    });

    const val = uiData.result?.result?.value || uiData.result?.value || {};
    console.log('\n--- LIVE BROWSER AUDIT RESULTS ---');
    console.log('Body brief-active class:', val.bodyBriefActive);
    console.log('AppState has physics:', val.hasPhysicsInAppState);
    console.log('Raw Telemetry:', val.rawTelem);
    console.log('Mission Reliability Score (DOM):', (val.cardScore || 'N/A') + '%');
    console.log('Mission Reliability Badge (DOM):', val.cardBadge);
    console.log('Risk Level (DOM):', val.cardRisk);
    console.log('Contributors Preview (DOM):', val.cardPreview);
    console.log('Total Physics Rows Rendered:', val.physicsRowsCount, '| innerHTML len:', val.physicsTableInnerHTML);
    console.log('MAP in Physics Table:', JSON.stringify(val.mapPhysics));
    console.log('MAP in Live Telemetry (Status):', val.mapTelemStatus, '| Trend:', val.mapTelemTrend);
    console.log('Contributors Debug Block:\n' + val.debugText);

    // Open Modal by clicking CONTRIBUTORS button
    console.log('\nOpening Mission Reliability Contributors Modal...');
    const clickResult = await callCdp('Runtime.evaluate', {
      expression: `(() => {
        const btn = document.getElementById('btn-inspect-reliability');
        if (btn) {
          btn.click();
          return { clicked: true };
        }
        return { clicked: false, error: 'button not found' };
      })()`,
      returnByValue: true
    });
    console.log('Click button result:', clickResult.result?.value);

    await wait(500);

    const modalData = await callCdp('Runtime.evaluate', {
      expression: `(() => {
        const modal = document.getElementById('modal-reliability-breakdown');
        const isOpen = modal?.classList.contains('open');
        const debugPre = document.getElementById('reliability-debug-pre')?.textContent;
        const detailsRows = Array.from(document.querySelectorAll('#reliability-breakdown-details > div')).map(d => d.textContent.replace(/\\s+/g, ' ').trim());
        const modalScore = document.getElementById('modal-rel-score-val')?.textContent?.trim();
        const modalStatus = document.getElementById('modal-rel-status-val')?.textContent?.trim();
        const modalRisk = document.getElementById('modal-rel-risk-val')?.textContent?.trim();
        return { isOpen, debugPre, detailsRows, modalScore, modalStatus, modalRisk };
      })()`,
      returnByValue: true
    });

    const mVal = modalData.result?.result?.value || modalData.result?.value || {};
    console.log('Modal is open:', mVal.isOpen);
    console.log('Modal Score:', mVal.modalScore, '| Status:', mVal.modalStatus, '| Risk:', mVal.modalRisk);
    console.log('Modal contributor rows rendered (' + (mVal.detailsRows?.length || 0) + '):', mVal.detailsRows);
    console.log('Modal pre debug text:\n' + mVal.debugPre);

    // Capture screenshot of browser with modal open
    const ss = await callCdp('Page.captureScreenshot', { format: 'png' });
    const ssPath = path.join(__dirname, 'reliability_breakdown_live.png');
    fs.writeFileSync(ssPath, Buffer.from(ss.result.data, 'base64'));
    console.log('Screenshot saved to:', ssPath);

    // Close modal
    await callCdp('Runtime.evaluate', {
      expression: `(() => {
        const btn = document.getElementById('btn-close-reliability');
        if (btn) btn.click();
      })()`
    });

  } finally {
    chrome.kill();
  }
}

run();
