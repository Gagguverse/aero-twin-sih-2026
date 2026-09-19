const fs = require('fs');
const path = require('path');

console.log('=== AERO TWIN DASHBOARD VERIFICATION ===\n');

const indexPath = path.join(__dirname, '..', 'index.html');
const cssPath = path.join(__dirname, '..', 'css', 'main.css');
const jsAppPath = path.join(__dirname, '..', 'js', 'app.js');
const jsTwinPath = path.join(__dirname, '..', 'js', 'engine-3d.js');

const html = fs.readFileSync(indexPath, 'utf8');
const css = fs.readFileSync(cssPath, 'utf8');
const appJs = fs.readFileSync(jsAppPath, 'utf8');
const twinJs = fs.readFileSync(jsTwinPath, 'utf8');

let passed = 0;
let failed = 0;

function assert(condition, testName) {
  if (condition) {
    console.log(`[PASS] ${testName}`);
    passed++;
  } else {
    console.error(`[FAIL] ${testName}`);
    failed++;
  }
}

// 1. Header & Title checks
assert(html.includes('AERO TWIN'), 'Header includes brand title "AERO TWIN"');
assert(html.includes('Engine Digital Twin'), 'Header includes "Engine Digital Twin"');
assert(html.includes('DECISION-SUPPORT PROTOTYPE'), 'Header includes "DECISION-SUPPORT PROTOTYPE"');
assert(html.includes('SIH26054 &bull; DRDO'), 'Header includes DRDO SIH26054 context');
assert(html.includes('Mission Phase:') && html.includes('CRUISE'), 'Header includes Mission Phase: CRUISE');
assert(html.includes('LIVE SIMULATION'), 'Header includes LIVE SIMULATION indicator');
assert(html.includes('SIMULATION DATA'), 'Header includes subtle label SIMULATION DATA');

// 2. Strict Negative Scope Check (No fake claims or HUD bloat)
assert(!html.includes('CEMILAC'), 'No fake CEMILAC compliance badge');
assert(!html.includes('STANAG'), 'No fake STANAG compliance badge');
assert(!html.includes('Live DRDO Connection'), 'No fake Live DRDO Connection claim');
assert(!html.includes('ARINC-429'), 'No ARINC-429 panels');
assert(!html.includes('FPGA/Jetson'), 'No FPGA/Jetson hardware panels');

// 3. Section 1 Overview Cards
assert(html.includes('id="card-ehi"') && html.includes('Engine Health'), 'Card 1: Engine Health card exists');
assert(html.includes('id="card-diag"') && html.includes('AI Diagnosis'), 'Card 2: AI Diagnosis card exists');
assert(html.includes('id="card-trust"') && html.includes('Sensor Trust'), 'Card 3: Sensor Trust card exists');
assert(html.includes('id="card-rul"') && html.includes('Remaining Useful Life'), 'Card 4: Remaining Useful Life card exists');
assert(html.includes('MODEL-BASED ESTIMATE &bull; SIMULATION') || html.includes('MODEL-BASED ESTIMATE'), 'Card 4 has simulation estimate label');

// 4. Section 2 Demo Scenario Controls
assert(html.includes('data-scenario="normal"') && html.includes('NORMAL MISSION'), 'Demo control: NORMAL MISSION exists');
assert(html.includes('data-scenario="sensor_fault"') && html.includes('SENSOR FAULT'), 'Demo control: SENSOR FAULT exists');
assert(html.includes('data-scenario="thermal_degradation"') && html.includes('THERMAL DEGRADATION'), 'Demo control: THERMAL DEGRADATION exists');

// 5. Section 3 Live Monitoring (3 Columns)
assert(html.includes('LIVE TELEMETRY'), 'Left Column: LIVE TELEMETRY exists');
assert(html.includes('id="engine-canvas"') && html.includes('DIGITAL TWIN'), 'Center Column: DIGITAL TWIN canvas exists');
assert(html.includes('SYNCHRONIZED ENGINE STATE'), 'Digital twin label: SYNCHRONIZED ENGINE STATE exists');
assert(html.includes('ENGINE STATUS') && html.includes('id="why-title"'), 'Right Column: ENGINE STATUS + WHY exists');
assert(html.includes('VIEW CONTRIBUTING PARAMETERS'), 'VIEW CONTRIBUTING PARAMETERS control exists');

// 6. Section 4 Sensor Trust Matrix
assert(html.includes('SENSOR TRUST MATRIX'), 'Section 4: SENSOR TRUST MATRIX exists');
assert(html.includes('CORE DIFFERENTIATOR: SENSOR TRUST BEFORE HEALTH JUDGMENT'), 'Sensor trust core differentiator badge exists');
assert(html.includes('id="trust-table-body"'), 'Trust table body container exists');

// 7. Section 5 AI Diagnostic Assessment
assert(html.includes('AI DIAGNOSTIC ASSESSMENT'), 'Section 5: AI Diagnostic Assessment exists');
assert(html.includes('Isolation Forest + Random Forest'), 'ML Architecture secondary caption exists');
assert(html.includes('EXPLAIN DIAGNOSIS'), 'EXPLAIN DIAGNOSIS button exists');

// 8. Section 6 Engine Degradation + RUL
assert(html.includes('ENGINE DEGRADATION &amp; RUL'), 'Section 6: Engine Degradation and RUL exists');
assert(html.includes('id="degradation-chart-canvas"'), 'Degradation chart canvas exists');

// 9. Section 7 AI Engine Assistant
assert(html.includes('AI ENGINE ASSISTANT'), 'Section 7: AI Engine Assistant exists');
assert(html.includes('Why is engine health changing?'), 'Question chip: Why is engine health changing? exists');
assert(html.includes('Is this a sensor fault?'), 'Question chip: Is this a sensor fault? exists');
assert(html.includes('What caused the anomaly?'), 'Question chip: What caused the anomaly? exists');
assert(html.includes('How much RUL remains?'), 'Question chip: How much RUL remains? exists');
assert(html.includes('Which sensor is unreliable?'), 'Question chip: Which sensor is unreliable? exists');
assert(html.includes('Does not issue direct aircraft flight commands'), 'Assistant decision-support disclaimer exists');

// 10. Section 8 Mission Timeline
assert(html.includes('MISSION TIMELINE'), 'Section 8: Mission Timeline exists');
assert(html.includes('IDLE') && html.includes('TAKEOFF') && html.includes('CRUISE') && html.includes('LANDING'), 'Timeline phases exist');
assert(html.includes('Oil pressure sensor anomaly'), 'Event marker 1 exists');
assert(html.includes('Thermal degradation detected'), 'Event marker 2 exists');
assert(html.includes('id="timeline-slider"'), 'Scrubbing slider exists');

// 11. CSS Responsive Design Breakpoints
assert(css.includes('@media (max-width: 1280px)'), 'CSS includes tablet responsive breakpoint (max-width: 1280px)');
assert(css.includes('@media (max-width: 860px)'), 'CSS includes mobile responsive breakpoint (max-width: 860px)');
assert(css.includes('--status-nominal') && css.includes('--status-warning') && css.includes('--status-critical'), 'CSS semantic colors configured');

// 12. App Logic & Core Differentiator
assert(appJs.includes("ehi: 94"), 'SENSOR FAULT preserves EHI at 94/100 (Core differentiator)');
assert(appJs.includes("score: 0.25, status: 'FAULTY'"), 'SENSOR FAULT drops oil pressure trust to 0.25 (FAULTY)');
assert(appJs.includes("Reading remained unchanged while RPM/load changed."), 'Sensor fault reason matches specifications');
assert(appJs.includes("ehi: 64"), 'THERMAL DEGRADATION decreases EHI to 64/100');
assert(appJs.includes("rul: '48 h'"), 'THERMAL DEGRADATION reduces RUL to 48 h');
assert(twinJs.includes("AeroPistonDigitalTwin"), 'Interactive Digital Twin engine class implemented');

// 13. Interactive Engine Inspection / X-Ray / Piston Isolation Mode
assert(html.includes('REF: TAPAS-BH-201'), 'Digital twin header references TAPAS-BH-201');
assert(html.includes('id="btn-mode-inspect"') && html.includes('id="btn-mode-xray"') && html.includes('id="btn-mode-exploded"'), 'Inspection mode buttons exist (INSPECT, X-RAY, EXPLODED, RESET)');
assert(html.includes('id="twin-inspection-hud"'), 'Floating inspection HUD container exists');
assert(html.includes('id="hud-name"') && html.includes('id="hud-status"') && html.includes('id="hud-desc"'), 'HUD identity and status elements exist');
assert(html.includes('id="hud-cht"') && html.includes('id="hud-egt"') && html.includes('id="hud-rpm"') && html.includes('id="hud-oil-p"'), 'HUD component telemetry elements exist');
assert(html.includes('id="hud-relevance-text"'), 'HUD diagnostic relevance text element exists');
assert(html.includes('id="twin-xray-overview"'), 'X-Ray cutaway overview banner exists');

assert(twinJs.includes("'piston_' + cfg.index"), 'Internal Pistons 1-4 meshes registered for selection');
assert(twinJs.includes("'conrod_' + cfg.index"), 'Internal Connecting Rods 1-4 meshes registered for selection');
assert(twinJs.includes("this.raycaster.intersectObjects"), 'Raycasting mesh picker implemented');
assert(twinJs.includes("setInspectionMode"), 'setInspectionMode implemented in 3D engine');
assert(twinJs.includes("matCrankcase.transparent = true"), 'X-Ray cutaway transparency toggles crankcase/fins');
assert(twinJs.includes("frameCameraOn"), 'Smooth camera framing on selected component implemented');

assert(appJs.includes("window.setInspectionMode"), 'window.setInspectionMode handler exposed');
assert(appJs.includes("window.resetEngineInspection"), 'window.resetEngineInspection handler exposed');
assert(appJs.includes("window.onEngineComponentSelected"), 'window.onEngineComponentSelected handler exposed');
assert(appJs.includes("BAD SENSOR ≠ BAD ENGINE REASSURANCE"), 'HUD scenario diagnostic text preserves BAD SENSOR != BAD ENGINE');

// 14. Mechanical Engine Kinematics & Motion Controls
assert(html.includes('id="twin-motion-flow"'), 'Engine motion principle "HOW IT WORKS" overlay exists');
assert(html.includes('PISTON RECIPROCATES') && html.includes('CRANKSHAFT ROTATES'), 'Motion principle steps 1-4 documented');
assert(html.includes('id="btn-motion-play"') && html.includes('id="btn-speed-half"'), 'Motion play/pause and speed controls exist');
assert(html.includes('id="motion-rpm-chip"'), 'Motion RPM live speed chip exists');
assert(html.includes('id="hud-kinematic-chain"'), 'HUD kinematic relationship chain exists');
assert(html.includes('id="hud-motion-pill"'), 'HUD reciprocating motion pill exists');

assert(twinJs.includes("_updateKinematics"), 'Slider-crank kinematics update method implemented');
assert(twinJs.includes("this.crankAngle + item.cfg.phase"), 'Staggered multi-cylinder crank phasing implemented');
assert(twinJs.includes("conrodGroup.rotation.z = Math.atan2"), 'Connecting rod angular swing kinematics implemented');
assert(twinJs.includes("this.motionPlaying = true"), 'Engine motion starts automatically upon load');
assert(twinJs.includes("toggleMotion"), 'Motion toggle method implemented');
assert(twinJs.includes("setSpeedFactor"), 'Speed factor adjustment method implemented');

assert(appJs.includes("window.toggleEngineMotion"), 'window.toggleEngineMotion exposed');
assert(appJs.includes("window.setEngineSpeed"), 'window.setEngineSpeed exposed');

console.log(`\nResults: ${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);
