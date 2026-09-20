const http = require('http');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const debugPort = 9240;
const chrome = spawn(chromePath, [
  '--headless=new',
  '--remote-debugging-port=' + debugPort,
  '--window-size=1600,1050',
  '--user-data-dir=C:\\Users\\gd116\\AppData\\Local\\Temp\\chrome_rel_full_' + Date.now(),
  'http://localhost:3000/'
]);

setTimeout(async () => {
  try {
    const list = await new Promise((res, rej) => {
      http.get('http://127.0.0.1:' + debugPort + '/json', r => {
        let d = ''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d)));
      }).on('error', rej);
    });
    const target = list.find(t => t.type === 'page' && t.url.includes('localhost:3000'));
    const ws = new WebSocket(target.webSocketDebuggerUrl);

    let pendingCallbacks = new Map();
    let msgId = 1;
    function send(method, params = {}) {
      return new Promise((resolve) => {
        const id = msgId++;
        pendingCallbacks.set(id, resolve);
        ws.send(JSON.stringify({ id, method, params }));
      });
    }

    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.method === 'Runtime.consoleAPICalled') {
        console.log('[BROWSER CONSOLE]', m.params.type, m.params.args.map(a => a.value !== undefined ? JSON.stringify(a.value) : (a.description || '')).join(' '));
      } else if (m.method === 'Runtime.exceptionThrown') {
        console.error('[BROWSER EXCEPTION]', m.params.exceptionDetails?.text, m.params.exceptionDetails?.exception?.description);
      }
      if (m.id && pendingCallbacks.has(m.id)) {
        pendingCallbacks.get(m.id)(m);
        pendingCallbacks.delete(m.id);
      }
    };

    ws.onopen = async () => {
      await send('Log.enable');
      await send('Runtime.enable');
      await send('Page.enable');

      console.log('1. Page loaded, waiting 800ms for boot...');
      await new Promise(r => setTimeout(r, 800));

      console.log('2. Clicking "ENTER MISSION CONTROL"...');
      const enterRes = await send('Runtime.evaluate', {
        expression: `(() => {
          const btn = document.getElementById('btn-enter-mission-control');
          if (btn) btn.click();
          return { clicked: !!btn };
        })()`,
        returnByValue: true
      });
      console.log('   Enter result:', enterRes.result?.result?.value);

      console.log('3. Waiting 1800ms for pipeline ticks and dashboard render...');
      await new Promise(r => setTimeout(r, 1800));

      console.log('4. Querying Card 5 & Live Telemetry & Physics Table...');
      const dashRes = await send('Runtime.evaluate', {
        expression: `(() => {
          const score = document.getElementById('mission-rel-val')?.textContent?.trim();
          const badge = document.getElementById('mission-rel-badge')?.textContent?.trim();
          const risk = document.getElementById('mission-risk-val')?.textContent?.trim();
          const preview = document.getElementById('mission-rel-contributors-preview')?.textContent?.trim();

          const tableRows = Array.from(document.querySelectorAll('#physics-table-body tr')).map(tr => {
            const tds = tr.querySelectorAll('td');
            return {
              param: tds[0]?.textContent?.replace(/\\s+/g, ' ')?.trim(),
              expected: tds[1]?.textContent?.trim(),
              actual: tds[2]?.textContent?.trim(),
              residual: tds[3]?.textContent?.trim(),
              status: tds[4]?.textContent?.trim()
            };
          });

          const mapRow = tableRows.find(r => r.param && (r.param.includes('MAP') || r.param.includes('Boost')));

          const mapTelemTile = document.getElementById('telem-map');
          const mapTelemStatus = mapTelemTile?.querySelector('.telemetry-status-tag')?.textContent?.trim();
          const mapTelemTrend = mapTelemTile?.querySelector('.telemetry-trend')?.textContent?.trim();

          return {
            cardScore: score,
            cardBadge: badge,
            cardRisk: risk,
            cardPreview: preview,
            totalPhysicsRows: tableRows.length,
            mapPhysicsRow: mapRow,
            mapTelemStatus,
            mapTelemTrend
          };
        })()`,
        returnByValue: true
      });

      console.log('\n--- LIVE DASHBOARD DATA ---');
      const d = dashRes.result?.result?.value || {};
      console.log('Mission Reliability Score:', d.cardScore + '%');
      console.log('Mission Reliability Badge:', d.cardBadge);
      console.log('Risk Level:', d.cardRisk);
      console.log('Contributors Preview:', d.cardPreview);
      console.log('Total Physics Rows:', d.totalPhysicsRows);
      console.log('MAP Physics Row:', d.mapPhysicsRow);
      console.log('MAP Live Telemetry:', d.mapTelemStatus, '| Trend:', d.mapTelemTrend);

      console.log('\n5. Clicking "CONTRIBUTORS →" to open Modal...');
      const clickRel = await send('Runtime.evaluate', {
        expression: `(() => {
          const btn = document.getElementById('btn-inspect-reliability');
          if (btn) btn.click();
          return { clicked: !!btn };
        })()`,
        returnByValue: true
      });
      console.log('   Contributors button click result:', clickRel.result?.result?.value);

      await new Promise(r => setTimeout(r, 600));

      console.log('6. Querying Modal Contents...');
      const modalRes = await send('Runtime.evaluate', {
        expression: `(() => {
          const modal = document.getElementById('modal-reliability-breakdown');
          const isOpen = modal ? modal.classList.contains('open') : false;
          const score = document.getElementById('modal-rel-score-val')?.textContent?.trim();
          const status = document.getElementById('modal-rel-status-val')?.textContent?.trim();
          const risk = document.getElementById('modal-rel-risk-val')?.textContent?.trim();
          const rows = Array.from(document.querySelectorAll('#reliability-breakdown-details > div')).map(el => el.textContent.replace(/\\s+/g, ' ').trim());
          const debugPre = document.getElementById('reliability-debug-pre')?.textContent;

          return { isOpen, score, status, risk, rowsCount: rows.length, rows, debugPre };
        })()`,
        returnByValue: true
      });

      const m = modalRes.result?.result?.value || {};
      console.log('\n--- MODAL BREAKDOWN DATA ---');
      console.log('Modal is open:', m.isOpen);
      console.log('Modal Score:', m.score, '| Status:', m.status, '| Risk:', m.risk);
      console.log('Contributor items (' + m.rowsCount + '):');
      (m.rows || []).forEach((r, idx) => console.log(`  [${idx+1}] ${r}`));
      console.log('\nDeterministic Debug Block:\n' + m.debugPre);

      console.log('7. Capturing Screenshot...');
      const ssRes = await send('Page.captureScreenshot', { format: 'png' });
      if (ssRes.result && ssRes.result.data) {
        const outPath = path.join(__dirname, 'reliability_breakdown_live.png');
        fs.writeFileSync(outPath, Buffer.from(ssRes.result.data, 'base64'));
        console.log('   Screenshot written to:', outPath);
      }

      console.log('8. Closing Modal...');
      const closeRes = await send('Runtime.evaluate', {
        expression: `(() => {
          const btn = document.getElementById('btn-close-reliability');
          if (btn) btn.click();
          const modal = document.getElementById('modal-reliability-breakdown');
          return { closed: modal ? !modal.classList.contains('open') : false };
        })()`,
        returnByValue: true
      });
      console.log('   Close modal result:', closeRes.result?.result?.value);

      setTimeout(() => {
        chrome.kill();
        process.exit(0);
      }, 500);
    };

  } catch(e) {
    console.error('Err:', e);
    chrome.kill();
    process.exit(1);
  }
}, 800);
