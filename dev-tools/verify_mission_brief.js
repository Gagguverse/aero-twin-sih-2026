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

async function runVerification() {
  const profileDir = path.join('C:\\Users\\gd116\\AppData\\Local\\Temp', 'chrome_brief_verify_' + Date.now());
  console.log('Starting Headless Chrome for Mission Brief Verification...');
  
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
  for (let i = 0; i < 20; i++) {
    await wait(400);
    try {
      const targets = await fetchJson('http://127.0.0.1:9224/json');
      pageTarget = targets.find(t => t.type === 'page' && t.url.includes('localhost:3000'));
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
  const consoleMessages = [];
  const uncaughtExceptions = [];

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && callbacks.has(msg.id)) {
      callbacks.get(msg.id)(msg);
      callbacks.delete(msg.id);
    }
    if (msg.method === 'Runtime.consoleAPICalled') {
      consoleMessages.push(msg.params);
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

  await sendCmd('Emulation.setDeviceMetricsOverride', {
    width: 1600,
    height: 1050,
    deviceScaleFactor: 1,
    mobile: false
  });

  await sendCmd('Page.reload');
  await wait(2500);

  async function evaluate(fn) {
    const fnStr = typeof fn === 'function' ? fn.toString() : fn;
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

  async function captureScreenshot(filename) {
    const res = await sendCmd('Page.captureScreenshot', { format: 'png' });
    if (res && res.result && res.result.data) {
      const outPath = path.join(__dirname, filename);
      fs.writeFileSync(outPath, Buffer.from(res.result.data, 'base64'));
      console.log(`Saved screenshot: ${outPath}`);
    }
  }

  console.log('\n--- 1. VERIFY PRE-UI / MISSION BRIEF ON INITIAL LOAD ---');
  const initialLandingCheck = await evaluate(function () {
    const screen = document.getElementById('mission-brief-screen');
    if (!screen) return { error: 'mission-brief-screen element missing' };
    
    const style = window.getComputedStyle(screen);
    const rect = screen.getBoundingClientRect();
    
    // Check Top Header
    const brandTitle = document.querySelector('.brief-brand-title') ? document.querySelector('.brief-brand-title').textContent.trim() : '';
    const brandSubtitle = document.querySelector('.brief-brand-subtitle') ? document.querySelector('.brief-brand-subtitle').textContent.trim() : '';
    const headerStatus = document.querySelector('.brief-header-status') ? document.querySelector('.brief-header-status').textContent.trim() : '';
    
    // Check Hero
    const heroTitle = document.querySelector('.brief-hero-title') ? document.querySelector('.brief-hero-title').textContent.trim() : '';
    const heroSubtitle = document.querySelector('.brief-hero-subtitle') ? document.querySelector('.brief-hero-subtitle').textContent.trim() : '';
    const heroDesc = document.querySelector('.brief-hero-description') ? document.querySelector('.brief-hero-description').textContent.trim() : '';
    
    // Check Mission Brief Card
    const cardTitle = document.querySelector('.brief-card-title') ? document.querySelector('.brief-card-title').textContent.trim() : '';
    const cardBadge = document.querySelector('.brief-card-badge') ? document.querySelector('.brief-card-badge').textContent.trim() : '';
    const cardRows = Array.from(document.querySelectorAll('.brief-card-row')).map(function (r) {
      return r.innerText.split(/\s+/).join(' ').trim();
    });
    
    // Check 5 Capabilities
    const capCards = Array.from(document.querySelectorAll('.brief-cap-card')).map(function (c) {
      const t = c.querySelector('.brief-cap-title');
      const d = c.querySelector('.brief-cap-desc');
      return {
        title: t ? t.textContent.trim() : '',
        desc: d ? d.textContent.trim() : ''
      };
    });
    
    // Check CTA
    const ctaBtn = document.getElementById('btn-enter-mission-control');
    const ctaBtnText = ctaBtn ? ctaBtn.innerText.split(/\s+/).join(' ').trim() : '';
    const ctaSubtext = document.querySelector('.brief-cta-subtext') ? document.querySelector('.brief-cta-subtext').textContent.trim() : '';
    
    // Check Footer
    const footerLeft = document.querySelector('.brief-footer-left') ? document.querySelector('.brief-footer-left').textContent.split(/\s+/).join(' ').trim() : '';
    const footerRight = document.querySelector('.brief-footer-right') ? document.querySelector('.brief-footer-right').textContent.split(/\s+/).join(' ').trim() : '';

    // Check Boot Sequence
    const bootEl = document.getElementById('brief-boot-sequence');
    const bootDisplay = bootEl ? window.getComputedStyle(bootEl).display : 'none';
    const bootLines = Array.from(document.querySelectorAll('.brief-boot-line')).map(l => l.textContent.split(/\s+/).join(' ').trim());

    // Check Live Telemetry Strip
    const telemStrip = document.querySelector('.brief-telemetry-strip');
    const telemValues = {
      rpm: document.getElementById('brief-val-rpm')?.textContent,
      cht: document.getElementById('brief-val-cht')?.textContent,
      egt: document.getElementById('brief-val-egt')?.textContent,
      oilp: document.getElementById('brief-val-oilp')?.textContent,
      ehi: document.getElementById('brief-val-ehi')?.textContent
    };

    // Check Digital Twin Signal Flow
    const flowSection = document.querySelector('.brief-signal-flow-section');
    const flowNodes = Array.from(document.querySelectorAll('.brief-flow-diagram .flow-node')).map(n => {
      return {
        badge: n.querySelector('.node-badge')?.textContent.trim(),
        title: n.querySelector('.node-title')?.textContent.trim(),
        rate: n.querySelector('.node-rate')?.textContent.trim()
      };
    });

    // Check Schematic Wrap
    const schematicWrap = document.querySelector('.brief-schematic-wrap');

    return {
      displayed: style.display !== 'none',
      opacity: style.opacity,
      zIndex: style.zIndex,
      width: rect.width,
      height: rect.height,
      brandTitle: brandTitle,
      brandSubtitle: brandSubtitle,
      headerStatus: headerStatus,
      heroTitle: heroTitle,
      heroSubtitle: heroSubtitle,
      heroDesc: heroDesc,
      cardTitle: cardTitle,
      cardBadge: cardBadge,
      cardRows: cardRows,
      capCards: capCards,
      ctaBtnText: ctaBtnText,
      ctaSubtext: ctaSubtext,
      footerLeft: footerLeft,
      footerRight: footerRight,
      bootExists: !!bootEl,
      bootDisplay: bootDisplay,
      bootLines: bootLines,
      hasTelemStrip: !!telemStrip,
      telemValues: telemValues,
      hasFlowSection: !!flowSection,
      flowNodes: flowNodes,
      hasSchematicWrap: !!schematicWrap
    };
  });

  console.log('Initial Landing State:');
  console.log(` - Displayed: ${initialLandingCheck.displayed} (z-index: ${initialLandingCheck.zIndex}, opacity: ${initialLandingCheck.opacity})`);
  console.log(` - Boot Overlay Exists: ${initialLandingCheck.bootExists} (Display: ${initialLandingCheck.bootDisplay})`);
  console.log(` - Boot Lines:`, initialLandingCheck.bootLines);
  console.log(` - Brand: "${initialLandingCheck.brandTitle}" - "${initialLandingCheck.brandSubtitle}"`);
  console.log(` - Status: "${initialLandingCheck.headerStatus}"`);
  console.log(` - Hero: "${initialLandingCheck.heroTitle}" - "${initialLandingCheck.heroSubtitle}"`);
  console.log(` - Schematic Wrap Present: ${initialLandingCheck.hasSchematicWrap}`);
  console.log(` - Live Telemetry Strip Present: ${initialLandingCheck.hasTelemStrip}`, initialLandingCheck.telemValues);
  console.log(` - Card: "${initialLandingCheck.cardTitle}" Badge: "${initialLandingCheck.cardBadge}"`);
  console.log(' - Card Rows:', initialLandingCheck.cardRows);
  console.log(` - Key Capabilities count: ${initialLandingCheck.capCards?.length}`);
  initialLandingCheck.capCards?.forEach((c, idx) => console.log(`    0${idx+1}. ${c.title}: "${c.desc}"`));
  console.log(` - Signal Flow Section Present: ${initialLandingCheck.hasFlowSection} (Nodes count: ${initialLandingCheck.flowNodes?.length})`);
  initialLandingCheck.flowNodes?.forEach(n => console.log(`    [${n.badge}] ${n.title} (${n.rate})`));
  console.log(` - CTA: "${initialLandingCheck.ctaBtnText}" / "${initialLandingCheck.ctaSubtext}"`);
  console.log(` - Footer: Left="${initialLandingCheck.footerLeft}" | Right="${initialLandingCheck.footerRight}"`);

  // Verify requirements
  const hasSynthetic = initialLandingCheck.cardRows?.some(r => r.includes('SYNTHETIC SIMULATION'));
  console.log(` - Has "SYNTHETIC SIMULATION": ${hasSynthetic ? 'PASS' : 'FAIL'}`);
  const has5Caps = initialLandingCheck.capCards?.length === 5;
  console.log(` - Exactly 5 Capabilities: ${has5Caps ? 'PASS' : 'FAIL'}`);
  const has6FlowNodes = initialLandingCheck.flowNodes?.length === 6;
  console.log(` - Exactly 6 Signal Flow Nodes: ${has6FlowNodes ? 'PASS' : 'FAIL'}`);

  // Test 1440x900 Viewport
  await sendCmd('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false
  });
  await wait(500);
  const check1440 = await evaluate(function () {
    const screen = document.getElementById('mission-brief-screen');
    const cta = document.getElementById('btn-enter-mission-control');
    const ctaRect = cta ? cta.getBoundingClientRect() : null;
    return {
      windowHeight: window.innerHeight,
      screenScrollHeight: screen.scrollHeight,
      ctaBottom: ctaRect ? ctaRect.bottom : 0,
      ctaVisibleInViewport: ctaRect ? ctaRect.bottom <= window.innerHeight : false
    };
  });
  console.log(`\n--- 1440x900 Viewport Fit Check ---`);
  console.log(` - Window Height: ${check1440.windowHeight}px | Screen Scroll: ${check1440.screenScrollHeight}px`);
  console.log(` - CTA bottom position: ${check1440.ctaBottom}px (Visible without scrolling: ${check1440.ctaVisibleInViewport ? 'YES' : 'NO'})`);
  await captureScreenshot('mission_brief_1440x900.png');

  // Test 1920x1080 Viewport
  await sendCmd('Emulation.setDeviceMetricsOverride', {
    width: 1920,
    height: 1080,
    deviceScaleFactor: 1,
    mobile: false
  });
  await wait(500);
  await captureScreenshot('mission_brief_1920x1080.png');

  console.log('\n--- 2. CLICK "ENTER MISSION CONTROL" ---');
  await evaluate(`() => {
    const btn = document.getElementById('btn-enter-mission-control');
    btn.click();
  }`);

  await wait(500);

  const postClickCheck = await evaluate(`() => {
    const screen = document.getElementById('mission-brief-screen');
    const appContainer = document.querySelector('.app-container');
    const appStyle = window.getComputedStyle(appContainer);
    
    return {
      screenDisplay: screen.style.display,
      screenClass: screen.className,
      appVisible: appStyle.display !== 'none',
      appStateExists: !!window.appState,
      appStateRpm: window.appState?.rawTelemetry?.rpm,
      appStateEhi: window.appState?.ehi,
      appStateStatus: window.appState?.aiDiagnosis,
      has3DCanvas: !!document.getElementById('engine-canvas'),
      hasMapContainer: !!document.getElementById('mission-map-container')
    };
  }`);

  console.log('Post-Click State:');
  console.log(` - Mission Brief screen display: "${postClickCheck.screenDisplay}" (Class: "${postClickCheck.screenClass}")`);
  console.log(` - Existing app-container visible: ${postClickCheck.appVisible}`);
  console.log(` - AppState exists: ${postClickCheck.appStateExists}`);
  console.log(` - Live RPM: ${postClickCheck.appStateRpm} | EHI: ${postClickCheck.appStateEhi} | Status: ${postClickCheck.appStateStatus}`);
  console.log(` - 3D Engine Canvas present: ${postClickCheck.has3DCanvas}`);
  console.log(` - Mapbox container present: ${postClickCheck.hasMapContainer}`);

  // Capture screenshot of the Dashboard after entering
  await captureScreenshot('dashboard_entered.png');

  console.log('\n--- 3. VERIFY DASHBOARD INTERACTIVITY & SENSOR TRUST ---');
  // Switch to Thermal scenario and check update
  await evaluate(`() => {
    window.applyScenario('thermal_degradation');
  }`);
  await wait(1000);

  const scenarioTest = await evaluate(`() => {
    return {
      scenario: window.appState?.scenario,
      ehi: window.appState?.ehi,
      status: window.appState?.aiDiagnosis,
      anomalyScore: window.appState?.anomalyScore
    };
  }`);
  console.log('Switched to thermal_degradation scenario:');
  console.log(` - Scenario: ${scenarioTest.scenario}`);
  console.log(` - EHI: ${scenarioTest.ehi} | Status: ${scenarioTest.status} | Anomaly Score: ${scenarioTest.anomalyScore}`);

  // Switch back to normal
  await evaluate(`() => {
    window.applyScenario('normal');
  }`);
  await wait(500);

  console.log('\n--- 4. CONSOLE ERRORS AUDIT ---');
  const errors = consoleMessages.filter(m => m.type === 'error');
  console.log(`Total console error messages: ${errors.length}`);
  if (errors.length > 0) {
    errors.forEach(e => console.log('Console Error:', e.args));
  }
  console.log(`Uncaught exceptions: ${uncaughtExceptions.length}`);
  if (uncaughtExceptions.length > 0) {
    uncaughtExceptions.forEach(e => console.log('Exception:', e));
  }

  ws.close();
  chrome.kill();
  console.log('\nVerification complete!');
}

runVerification().catch(e => {
  console.error('Fatal verification error:', e);
  process.exit(1);
});
