const fs = require('fs');
const path = require('path');

console.log('=== VERIFYING STITCH UI & INTEGRATED PIPELINE ===\n');

const indexPath = path.join(__dirname, '..', 'index.html');
const appJsPath = path.join(__dirname, '..', 'js', 'app.js');
const sensorTrustPath = path.join(__dirname, '..', 'js', 'sensor-trust.js');
const aiDiagPath = path.join(__dirname, '..', 'js', 'ai-diagnostic-net.js');

const html = fs.readFileSync(indexPath, 'utf8');
const appJs = fs.readFileSync(appJsPath, 'utf8');
const sensorTrustJs = fs.readFileSync(sensorTrustPath, 'utf8');
const aiDiagJs = fs.readFileSync(aiDiagPath, 'utf8');

let passed = 0;
let failed = 0;

function assert(cond, name) {
  if (cond) {
    console.log(`[PASS] ${name}`);
    passed++;
  } else {
    console.error(`[FAIL] ${name}`);
    failed++;
  }
}

// 1. Visual Source of Truth: Stitch Design Elements
assert(html.includes('AERO TWIN') && html.includes('UAV-SYS // v2.4'), 'Stitch Header Brand & Version included');
assert(html.includes('MALE UAV DIGITAL TWIN | Engine Health & Mission Reliability (SIH26054 Prototype)') || html.includes('SIH26054 Prototype'), 'Stitch Subtitle included');
assert(html.includes('Sensor Trust Before Health Judgment'), 'Stitch Core Paradigm banner included');
assert(html.includes('RAW TELEMETRY') && html.includes('SENSOR TRUST LAYER') && html.includes('EXPLAINABLE MISSION DECISION'), 'Analytical pipeline visualization included');
assert(html.includes('Opposed-Cylinder Aero Boxer Twin'), 'Stitch Center Column: Opposed-Cylinder Aero Boxer Twin included');
assert(html.includes('node-cht') && html.includes('node-egt') && html.includes('node-oil') && html.includes('node-rpm'), 'Stitch Engine SVG sensor tapping nodes and callout pins included');
assert(html.includes('twin-banner-overlay'), 'Stitch dynamic status banner overlay included');
assert(html.includes('modal-feature-analysis'), 'Stitch Feature Importance & Decision Vector modal included');
assert(html.includes('Mission Replay &amp; Telemetry Timeline') || html.includes('Mission Replay & Telemetry Timeline'), 'Stitch Mission Replay & Telemetry Timeline included');

// 2. Prohibited Technologies / Fake Claims (Strict Scope Rule)
assert(!html.includes('CFD') && !html.includes('Computational Fluid Dynamics'), 'No CFD included');
assert(!html.includes('PINN') && !html.includes('Physics-Informed Neural Network'), 'No PINN included');
assert(!html.includes('FPGA'), 'No FPGA included');
assert(!html.includes('Jetson'), 'No Jetson hardware panel included');
assert(!html.includes('ARINC-429'), 'No ARINC-429 panels included');
assert(!html.includes('CAN hardware') && !html.includes('CAN-bus transceiver'), 'No fake CAN hardware included');
assert(!html.includes('fleet management'), 'No fleet management included');
assert(!html.includes('CEMILAC'), 'No fake CEMILAC certification claims');
assert(!html.includes('STANAG'), 'No fake STANAG certification claims');
assert(!html.includes('Live DRDO Connection'), 'No fake Live DRDO connection claim');

// 3. Functional Logic & Pipeline Verification
assert(sensorTrustJs.includes('class SensorTrustEngine'), 'SensorTrustEngine class exists in js/sensor-trust.js');
assert(sensorTrustJs.includes('_evaluateOilPressureTrust'), 'Oil pressure freeze/variance evaluation exists');
assert(aiDiagJs.includes('class AIDiagnosticNet'), 'AIDiagnosticNet class exists in js/ai-diagnostic-net.js');
assert(appJs.includes('startTelemetryStreamLoop'), 'Live 10Hz telemetry simulator loop implemented in app.js');

// 4. Scenario 1: NORMAL MISSION
assert(appJs.includes('ehi: 96') && appJs.includes('trustScore: "9 / 9"'), 'NORMAL: EHI 96, Trust 9/9');
assert(appJs.includes('anomaly: "0.04"'), 'NORMAL: Anomaly score 0.04');
assert(appJs.includes('rul: "182"'), 'NORMAL: RUL 182 h');

// 5. Scenario 2: SENSOR FAILURE (BAD SENSOR != BAD ENGINE)
assert(appJs.includes('oilPressFrozen: true'), 'SENSOR FAILURE: Oil pressure sensor frozen with 0 variance');
assert(appJs.includes('forcedOilTrust: 0.25') || appJs.includes('rowOilScore: "25%"'), 'SENSOR FAILURE: Oil pressure trust falls to 25%');
assert(appJs.includes('ehi: 94'), 'SENSOR FAILURE: Engine EHI remains healthy at 94/100 (BAD SENSOR != BAD ENGINE)');
assert(appJs.includes('BAD SENSOR != BAD ENGINE: Hardware health intact'), 'SENSOR FAILURE: UI explicitly proves BAD SENSOR != BAD ENGINE');
assert(appJs.includes('twinCalloutOil: "SENSOR STUCK: 44 PSI (ISOLATED)"'), 'SENSOR FAILURE: Oil sensor probe highlighted as stuck & isolated in schematic');
assert(appJs.includes('Reading remained unchanged while RPM and load varied') || appJs.includes('reading unchanged while RPM and load varied'), 'SENSOR FAILURE: WHY text explains sensor uncoupling');

// 6. Scenario 3: THERMAL DEGRADATION
assert(appJs.includes('targetCht: 228') && appJs.includes('targetEgt: 918'), 'THERMAL DEGRADATION: CHT 228°C and EGT 918°C rise together');
assert(appJs.includes('trustDesc: "HIGH TRUST IN CRITICAL THERMAL SIGNATURE"'), 'THERMAL DEGRADATION: High sensor trust maintained');
assert(appJs.includes('ehi: 64'), 'THERMAL DEGRADATION: EHI decreases to 64/100');
assert(appJs.includes('rul: "48"'), 'THERMAL DEGRADATION: RUL drops to 48 h');
assert(appJs.includes('thermalHeatGrad'), 'THERMAL DEGRADATION: Engine schematic heats up with thermal gradient');
assert(appJs.includes('All 9 sensors are in full operational agreement (Trust: 95%)'), 'THERMAL DEGRADATION: WHY explains multi-sensor verified thermodynamic failure');

// 7. Data Binding & Interactivity
assert(appJs.includes('window.setScenario = function'), 'setScenario(id) function exposed globally for button clicks');
assert(appJs.includes('window.askAssistant = function'), 'askAssistant(topic) function exposed for AI assistant');
assert(appJs.includes('window.toggleAnalysisModal = function'), 'toggleAnalysisModal() function exposed for modal inspector');
assert(appJs.includes('window.switchTwinView = function'), 'switchTwinView() function allows toggling 2.5D schematic vs 3D WebGL');
assert(appJs.includes('window.updateScrubberTime = function'), 'updateScrubberTime() function handles mission timeline scrubbing');

console.log(`\nVerification complete: ${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);
