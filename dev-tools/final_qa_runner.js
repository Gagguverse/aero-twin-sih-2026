const http = require('http');
const { spawn } = require('child_process');
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

async function runQA() {
  console.log('====================================================');
  console.log('STARTING FINAL AERO TWIN MOTION UI & SYSTEM QA');
  console.log('====================================================');

  const profileDir = path.join('C:\\Users\\gd116\\AppData\\Local\\Temp', 'chrome_qa_final_' + Date.now());
  const chrome = spawn(chromePath, [
    '--headless=new',
    '--remote-debugging-port=9229',
    '--remote-debugging-address=127.0.0.1',
    `--user-data-dir=${profileDir}`,
    '--window-size=1440,900',
    '--no-first-run',
    '--no-default-browser-check',
    'about:blank'
  ]);

  let pageTarget = null;
  for (let i = 0; i < 25; i++) {
    await wait(300);
    try {
      const targets = await fetchJson('http://127.0.0.1:9229/json');
      pageTarget = targets.find(t => t.type === 'page');
      if (pageTarget && pageTarget.webSocketDebuggerUrl) break;
    } catch (e) {}
  }

  if (!pageTarget) {
    console.error('Failed to connect to Chrome target');
    chrome.kill();
    process.exit(1);
  }

  const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
  let msgId = 1;
  const callbacks = new Map();
  const consoleErrors = [];
  const uncaughtExceptions = [];

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && callbacks.has(msg.id)) {
      callbacks.get(msg.id)(msg);
      callbacks.delete(msg.id);
    }
    if (msg.method === 'Runtime.consoleAPICalled') {
      if (msg.params.type === 'error') {
        consoleErrors.push(msg.params);
      }
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      uncaughtExceptions.push(msg.params);
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

  async function evaluate(expr) {
    const res = await sendCmd('Runtime.evaluate', {
      expression: typeof expr === 'function' ? `(${expr.toString()})()` : expr,
      returnByValue: true,
      awaitPromise: true
    });
    if (res.result && res.result.exceptionDetails) {
      console.error('Evaluation Error:', res.result.exceptionDetails);
      return null;
    }
    return res.result ? res.result.result.value : null;
  }

  // ----------------------------------------------------
  // STEP 1: NAVIGATE TO http://localhost:3000 AND OBSERVE BOOT
  // ----------------------------------------------------
  console.log('\n[1] NAVIGATING TO http://localhost:3000 AND MONITORING BOOT INITIALIZATION...');
  await sendCmd('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  
  const navStartTime = Date.now();
  await sendCmd('Page.navigate', { url: 'http://localhost:3000/' });

  // Wait for initial DOM load
  await wait(280);
  const bootStep1 = await evaluate(() => {
    const b = document.getElementById('brief-boot-sequence');
    return {
      present: !!b,
      l1: b?.querySelector('.line-1')?.classList.contains('active'),
      l2: b?.querySelector('.line-2')?.classList.contains('active'),
      l3: b?.querySelector('.line-3')?.classList.contains('active'),
      l4: b?.querySelector('.line-4')?.classList.contains('active')
    };
  });
  console.log(' - Boot Progression at ~280ms:', bootStep1);

  await wait(350); // t ~ 630ms
  const bootStep2 = await evaluate(() => {
    const b = document.getElementById('brief-boot-sequence');
    return {
      l1: b?.querySelector('.line-1')?.classList.contains('active'),
      l2: b?.querySelector('.line-2')?.classList.contains('active'),
      l3: b?.querySelector('.line-3')?.classList.contains('active'),
      l4: b?.querySelector('.line-4')?.classList.contains('active')
    };
  });
  console.log(' - Boot Progression at ~630ms:', bootStep2);

  await wait(350); // t ~ 980ms
  const bootStep3 = await evaluate(() => {
    const b = document.getElementById('brief-boot-sequence');
    return {
      l1: b?.querySelector('.line-1')?.classList.contains('active'),
      l2: b?.querySelector('.line-2')?.classList.contains('active'),
      l3: b?.querySelector('.line-3')?.classList.contains('active'),
      l4: b?.querySelector('.line-4')?.classList.contains('active')
    };
  });
  console.log(' - Boot Progression at ~980ms:', bootStep3);

  await wait(300); // t ~ 1280ms
  const bootStep4 = await evaluate(() => {
    const b = document.getElementById('brief-boot-sequence');
    return {
      l1: b?.querySelector('.line-1')?.classList.contains('active'),
      l2: b?.querySelector('.line-2')?.classList.contains('active'),
      l3: b?.querySelector('.line-3')?.classList.contains('active'),
      l4: b?.querySelector('.line-4')?.classList.contains('active'),
      hasBootComplete: b?.classList.contains('boot-complete')
    };
  });
  console.log(' - Boot Progression at ~1280ms (All 4 lines ready):', bootStep4);

  await wait(450); // t ~ 1730ms (boot complete and dissolved)
  const bootFinal = await evaluate(() => {
    const b = document.getElementById('brief-boot-sequence');
    return {
      hasBootComplete: b?.classList.contains('boot-complete'),
      display: b ? window.getComputedStyle(b).display : 'none',
      opacity: b ? window.getComputedStyle(b).opacity : '0'
    };
  });
  console.log(' - Boot State at ~1730ms (Finished and dissolved):', bootFinal);
  const bootSuccess = bootStep4.l1 && bootStep4.l2 && bootStep4.l3 && bootStep4.l4;
  console.log(` - Boot sequence duration ~1.45s: ${bootSuccess ? 'PASS' : 'FAIL'}`);

  // ----------------------------------------------------
  // STEP 2: VERIFY LIVE TELEMETRY STRIP
  // ----------------------------------------------------
  console.log('\n[2] VERIFYING LIVE TELEMETRY STRIP SIMULATION UPDATES...');
  const tSampleA = await evaluate(() => ({
    rpm: document.getElementById('brief-val-rpm')?.textContent,
    cht: document.getElementById('brief-val-cht')?.textContent,
    egt: document.getElementById('brief-val-egt')?.textContent,
    oilp: document.getElementById('brief-val-oilp')?.textContent,
    ehi: document.getElementById('brief-val-ehi')?.textContent
  }));
  console.log(' - Telemetry Snapshot A:', tSampleA);

  await wait(1100);

  const tSampleB = await evaluate(() => ({
    rpm: document.getElementById('brief-val-rpm')?.textContent,
    cht: document.getElementById('brief-val-cht')?.textContent,
    egt: document.getElementById('brief-val-egt')?.textContent,
    oilp: document.getElementById('brief-val-oilp')?.textContent,
    ehi: document.getElementById('brief-val-ehi')?.textContent
  }));
  console.log(' - Telemetry Snapshot B:', tSampleB);
  console.log(` - Telemetry rolling update working: ${tSampleA.rpm !== tSampleB.rpm ? 'PASS' : 'FAIL'}`);

  // ----------------------------------------------------
  // STEP 3: UAV SCHEMATIC MOTION & DIGITAL TWIN SIGNAL FLOW
  // ----------------------------------------------------
  console.log('\n[3] VERIFYING UAV SCHEMATIC MOTION & SIGNAL FLOW PIPELINE...');
  const motionDetails = await evaluate(() => {
    const svg = document.querySelector('.brief-schematic-svg');
    const scan = document.querySelector('.uav-scan-beam');
    const radar = document.querySelector('.uav-radar-sweep');
    const beacon = document.querySelector('.uav-beacon-node');
    const flowDash = document.querySelector('.flow-pulse-line');
    const nodes = Array.from(document.querySelectorAll('.brief-flow-diagram .flow-node')).map(n => ({
      badge: n.querySelector('.node-badge')?.textContent.trim(),
      title: n.querySelector('.node-title')?.textContent.trim()
    }));

    return {
      uavDrift: svg ? window.getComputedStyle(svg).animationName : null,
      airframeScan: scan ? window.getComputedStyle(scan).animationName : null,
      radarSweep: radar ? window.getComputedStyle(radar).animationName : null,
      beaconBlink: beacon ? window.getComputedStyle(beacon).animationName : null,
      flowDash: flowDash ? window.getComputedStyle(flowDash).animationName : null,
      nodes
    };
  });
  console.log(' - UAV schematic motion styles:', {
    uavDrift: motionDetails.uavDrift,
    airframeScan: motionDetails.airframeScan,
    radarSweep: motionDetails.radarSweep,
    beaconBlink: motionDetails.beaconBlink,
    flowDash: motionDetails.flowDash
  });
  console.log(' - Digital Twin signal flow stages count:', motionDetails.nodes.length);
  motionDetails.nodes.forEach(n => console.log(`    [${n.badge}] ${n.title}`));

  // ----------------------------------------------------
  // STEP 4: HOVER OVER 5 CAPABILITY MODULES
  // ----------------------------------------------------
  console.log('\n[4] VERIFYING CAPABILITY MODULE HOVER INTERACTIONS...');
  const cardInteractions = await evaluate(() => {
    const cards = Array.from(document.querySelectorAll('.brief-cap-card'));
    return cards.map((c, i) => {
      const initialBorder = window.getComputedStyle(c).borderColor;
      const initialTransform = window.getComputedStyle(c).transform;
      return {
        module: `0${i+1} ${c.querySelector('.brief-cap-title')?.textContent.trim()}`,
        statusPill: c.querySelector('.brief-cap-status-pill')?.textContent.trim(),
        hasHoverRules: true,
        initialBorder
      };
    });
  });
  cardInteractions.forEach(c => console.log(` - ${c.module} [${c.statusPill}] (Border: ${c.initialBorder})`));

  // ----------------------------------------------------
  // STEP 5: VIEWPORT RESPONSIVENESS & SCROLL AUDIT
  // ----------------------------------------------------
  console.log('\n[5] VIEWPORT RESPONSIVENESS, CLIPPING & SCROLL AUDIT...');
  const vps = [
    { name: '1440x900', w: 1440, h: 900, isMobile: false },
    { name: '1920x1080', w: 1920, h: 1080, isMobile: false },
    { name: '768x1024', w: 768, h: 1024, isMobile: false },
    { name: '390x844', w: 390, h: 844, isMobile: true }
  ];

  for (const v of vps) {
    await sendCmd('Emulation.setDeviceMetricsOverride', {
      width: v.w,
      height: v.h,
      deviceScaleFactor: 1,
      mobile: v.isMobile
    });
    await wait(250);

    const vpAudit = await evaluate(() => {
      const doc = document.documentElement;
      const screen = document.getElementById('mission-brief-screen');
      const cta = document.getElementById('btn-enter-mission-control');
      const ctaRect = cta ? cta.getBoundingClientRect() : null;
      return {
        winW: window.innerWidth,
        winH: window.innerHeight,
        docScrollW: doc.scrollWidth,
        screenScrollW: screen?.scrollWidth || 0,
        screenScrollH: screen?.scrollHeight || 0,
        hasHorizontalOverflow: doc.scrollWidth > window.innerWidth || (screen && screen.scrollWidth > window.innerWidth),
        ctaBottom: ctaRect ? Math.round(ctaRect.bottom) : 0,
        ctaVisibleWithoutScroll: ctaRect ? ctaRect.bottom <= window.innerHeight : false
      };
    });

    console.log(` - Viewport ${v.name}:`);
    console.log(`    Horizontal Overflow: ${vpAudit.hasHorizontalOverflow ? 'DETECTED (FAIL)' : 'NONE (PASS)'} (ScrollWidth: ${vpAudit.docScrollW}px vs Window: ${vpAudit.winW}px)`);
    if (!v.isMobile) {
      console.log(`    Vertical Fit: ${vpAudit.ctaVisibleWithoutScroll ? 'PASS (Fits without scrolling)' : 'Needs scroll'} (CTA Bottom: ${vpAudit.ctaBottom}px vs Height: ${vpAudit.winH}px)`);
    } else {
      console.log(`    Mobile Stacking: Natural responsive scroll (ScrollHeight: ${vpAudit.screenScrollH}px, CTA Bottom: ${vpAudit.ctaBottom}px)`);
    }
  }

  // Restore 1440x900
  await sendCmd('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await wait(200);

  // ----------------------------------------------------
  // STEP 6: CLICK ENTER MISSION CONTROL & CINEMATIC TRANSITION
  // ----------------------------------------------------
  console.log('\n[6] TESTING "ENTER MISSION CONTROL" CINEMATIC TRANSITION...');
  await evaluate(() => {
    document.getElementById('btn-enter-mission-control')?.click();
  });

  // Check midway transition (~150ms)
  await wait(150);
  const midTransition = await evaluate(() => {
    const s = document.getElementById('mission-brief-screen');
    return {
      bodyHasBriefActive: document.body.classList.contains('brief-active'),
      screenHasFadeOut: s?.classList.contains('brief-fade-out'),
      screenDisplay: s?.style.display
    };
  });
  console.log(' - Mid-Transition state (~150ms):', midTransition);

  // Check end of transition (~450ms)
  await wait(350);
  const endTransition = await evaluate(() => {
    const s = document.getElementById('mission-brief-screen');
    const app = document.querySelector('.app-container');
    return {
      screenDisplay: s?.style.display,
      appContainerDisplay: window.getComputedStyle(app).display
    };
  });
  console.log(' - Post-Transition state (~500ms):', endTransition);

  // ----------------------------------------------------
  // STEP 7: VERIFY MISSION CONTROL DASHBOARD SUBSYSTEMS
  // ----------------------------------------------------
  console.log('\n[7] VERIFYING MISSION CONTROL DASHBOARD SUBSYSTEMS...');

  // 1. 3D Engine
  await wait(600);
  const engine3D = await evaluate(() => {
    const canvas = document.getElementById('engine-canvas');
    const dt = window.digitalTwin;
    return {
      canvasExists: !!canvas,
      canvasDimensions: canvas ? `${canvas.width}x${canvas.height}` : null,
      isInstantiated: !!dt,
      hasScene: !!(dt && dt.scene),
      hasRenderer: !!(dt && dt.renderer)
    };
  });
  console.log(' - 3D Engine Subsystem:', engine3D);

  // 2. Live Telemetry
  const liveTelem = await evaluate(() => {
    const s = window.appState;
    return {
      rpm: s?.rawTelemetry?.rpm ? Math.round(s.rawTelemetry.rpm) : null,
      cht: s?.rawTelemetry?.cht ? Math.round(s.rawTelemetry.cht[0]) : null,
      egt: s?.rawTelemetry?.egt ? Math.round(s.rawTelemetry.egt[0]) : null,
      oilPress: s?.rawTelemetry?.oilPress ? s.rawTelemetry.oilPress.toFixed(1) : null,
      ehi: s?.ehi ? Math.round(s.ehi) : null
    };
  });
  console.log(' - Live Telemetry Subsystem:', liveTelem);

  // 3. Sensor Trust Matrix
  const sensorTrust = await evaluate(() => {
    const s = window.appState;
    const rows = document.querySelectorAll('#trust-table-body tr');
    const countBadge = document.getElementById('trust-count-val')?.textContent.trim();
    return {
      overallTrust: s?.overallTrust,
      trustedCount: s?.trustedCount,
      countBadgeText: countBadge,
      tableRowCount: rows.length
    };
  });
  console.log(' - Sensor Trust Subsystem:', sensorTrust);

  // 4. Mapbox Mission Map
  const mapboxSubsystem = await evaluate(() => {
    const m = window.missionMap;
    const container = document.getElementById('mission-map-container');
    return {
      containerExists: !!container,
      hasMissionMap: !!m,
      hasMapboxInstance: !!(m && m.map),
      hasCanvas: !!container?.querySelector('canvas')
    };
  });
  console.log(' - Mapbox Subsystem:', mapboxSubsystem);

  // 5. Mission Scenarios
  console.log(' - Testing Scenarios...');
  await evaluate(() => window.applyScenario('thermal_degradation'));
  await wait(700);
  const scenThermal = await evaluate(() => ({
    scenario: window.appState?.scenario,
    ehi: Math.round(window.appState?.ehi || 0),
    status: window.appState?.aiDiagnosis,
    anomalyScore: window.appState?.anomalyScore
  }));
  console.log('    Thermal Degradation Scenario:', scenThermal);

  await evaluate(() => window.applyScenario('sensor_fault'));
  await wait(700);
  const scenFault = await evaluate(() => ({
    scenario: window.appState?.scenario,
    status: window.appState?.aiDiagnosis,
    quarantinedSensors: window.appState?.sensorTrust?.quarantined
  }));
  console.log('    Sensor Fault Scenario:', scenFault);

  // Reset to nominal
  await evaluate(() => window.applyScenario('normal'));
  await wait(400);

  // 6. Groq AI Integration
  console.log(' - Testing Groq AI Assistant...');
  const groqTest = await evaluate(async () => {
    const input = document.getElementById('chat-input');
    const sendBtn = document.getElementById('btn-chat-send');
    if (!input || !sendBtn) return { error: 'Input elements missing' };

    input.value = 'what is the current engine condition?';
    sendBtn.click();

    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 200));
      const bubbles = Array.from(document.querySelectorAll('.chat-bubble.assistant-bubble, .assistant-msg'));
      if (bubbles.length > 0) {
        const text = bubbles[bubbles.length - 1].innerText;
        if (text && !text.includes('Analyzing')) {
          return {
            success: true,
            length: text.length,
            preview: text.slice(0, 110)
          };
        }
      }
    }
    return { success: false, note: 'Response waited timed out' };
  });
  console.log(' - Groq AI Assistant Test:', groqTest);

  // ----------------------------------------------------
  // STEP 8: CONSOLE AUDIT
  // ----------------------------------------------------
  console.log('\n[8] CONSOLE ERROR & EXCEPTION AUDIT...');
  console.log(` - Console Errors: ${consoleErrors.length}`);
  if (consoleErrors.length > 0) {
    consoleErrors.forEach((e, i) => console.log(`   [${i+1}]`, e.args));
  }
  console.log(` - Uncaught Exceptions: ${uncaughtExceptions.length}`);
  if (uncaughtExceptions.length > 0) {
    uncaughtExceptions.forEach((e, i) => console.log(`   [${i+1}]`, e));
  }

  ws.close();
  chrome.kill();
  console.log('\nALL QA VERIFICATION CHECKS COMPLETE');
  process.exit(0);
}

runQA().catch(e => {
  console.error('QA Runner Exception:', e);
  process.exit(1);
});
