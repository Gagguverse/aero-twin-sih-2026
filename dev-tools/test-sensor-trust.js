/**
 * Automated Verification Script for Aero Twin UAV MVP
 * Tests the 4 critical acceptance tests specified in the PRD:
 * 
 * Test 1: Healthy telemetry → high sensor trust → high EHI → NOMINAL
 * Test 2: Freeze oil-pressure sensor → oil-pressure trust decreases → sensor fault detected → engine health does NOT falsely collapse → explanation shown
 * Test 3: Inject thermal degradation → EGT/CHT rise → trust remains high → anomaly/fault detected → EHI decreases → degradation increases → RUL changes → explanation shown
 * Test 4: Replay the mission → fault markers visible → health timeline visible → event explanation accessible
 */

const SensorTrustEngine = require('../js/sensor-trust.js');
const TelemetryEngine = require('../js/telemetry-engine.js');
const AIDiagnosticNet = require('../js/ai-diagnostic-net.js');

console.log('='.repeat(75));
console.log('AERO-TWIN MVP: 4-STAGE ACCEPTANCE SUITE');
console.log('Problem Statement: SIH26054 (DRDO MALE UAV Aero Piston Engine)');
console.log('='.repeat(75));

let testsPassed = 0;
let testsTotal = 4;

// -----------------------------------------------------------------------------
// TEST 1: Healthy Telemetry Baseline
// -----------------------------------------------------------------------------
console.log('\n--- EXECUTING TEST 1: Healthy Telemetry Baseline ---');
const telemetry1 = new TelemetryEngine();
const trustEngine1 = new SensorTrustEngine();
const aiEngine1 = new AIDiagnosticNet();

telemetry1.setScenario('nominal');
// Run 20 ticks to settle filters
for (let i = 0; i < 20; i++) {
  telemetry1.computePhysicsStep();
  const trustRes = trustEngine1.evaluate(telemetry1.state, telemetry1.expected);
  aiEngine1.evaluate(telemetry1.state, trustRes, telemetry1.expected);
}

const res1 = trustEngine1.evaluate(telemetry1.state, telemetry1.expected);
const diag1 = aiEngine1.evaluate(telemetry1.state, res1, telemetry1.expected);

console.log(`- Overall Sensor Trust: ${res1.overallTrust} (Expect >= 0.90)`);
console.log(`- Engine Health Index (EHI): ${diag1.healthIndex} (Expect >= 88)`);
console.log(`- Status: ${diag1.status} (Expect NOMINAL)`);
console.log(`- Fault Classification: ${diag1.detectedFault}`);

if (res1.overallTrust >= 0.90 && diag1.healthIndex >= 88 && diag1.status === 'NOMINAL') {
  console.log('>>> [PASS] TEST 1: Healthy telemetry yields high trust and NOMINAL health.');
  testsPassed++;
} else {
  console.error('>>> [FAIL] TEST 1 failed expectations!');
}

// -----------------------------------------------------------------------------
// TEST 2: Oil Pressure Sensor Freeze (Sensor Fault ≠ Engine Fault)
// -----------------------------------------------------------------------------
console.log('\n--- EXECUTING TEST 2: Oil Pressure Sensor Freeze (Core Demo Moment) ---');
const telemetry2 = new TelemetryEngine();
const trustEngine2 = new SensorTrustEngine();
const aiEngine2 = new AIDiagnosticNet();

telemetry2.setScenario('sensor_freeze');
// Run ticks so variance detector catches frozen signal under dynamic engine conditions
for (let i = 0; i < 25; i++) {
  // Vary throttle slightly to prove engine is operating dynamically
  telemetry2.setThrottle(0.70 + Math.sin(i * 0.5) * 0.1);
  telemetry2.computePhysicsStep();
  const trustRes = trustEngine2.evaluate(telemetry2.state, telemetry2.expected);
  aiEngine2.evaluate(telemetry2.state, trustRes, telemetry2.expected);
}

const res2 = trustEngine2.evaluate(telemetry2.state, telemetry2.expected);
const diag2 = aiEngine2.evaluate(telemetry2.state, res2, telemetry2.expected);

console.log(`- Oil Pressure Trust Score: ${res2.scores.oilPress} (Expect < 0.50)`);
console.log(`- Has Sensor Fault: ${res2.hasSensorFault} (Expect true)`);
console.log(`- Quarantined Sensors: ${res2.quarantined.join(', ')}`);
console.log(`- Sensor Fault Reason: "${res2.reasons.oilPress || ''}"`);
console.log(`- Engine Health Index (EHI): ${diag2.healthIndex} (Expect >= 88 - HEALTH MUST NOT COLLAPSE!)`);
console.log(`- Engine Status: ${diag2.status} (Expect NOMINAL)`);
console.log(`- Diagnosis: ${diag2.detectedFault}`);

const test2TrustCheck = res2.scores.oilPress < 0.50 && res2.hasSensorFault;
const test2HealthCheck = diag2.healthIndex >= 88 && diag2.status === 'NOMINAL';
const test2ReasonCheck = Boolean(res2.reasons.oilPress && res2.reasons.oilPress.includes('Oil pressure signal remained unchanged'));

if (test2TrustCheck && test2HealthCheck && test2ReasonCheck) {
  console.log('>>> [PASS] TEST 2: Sensor freeze successfully detected and quarantined. Engine health did NOT falsely collapse!');
  testsPassed++;
} else {
  console.error(`>>> [FAIL] TEST 2 failed: trustCheck=${test2TrustCheck}, healthCheck=${test2HealthCheck}, reasonCheck=${test2ReasonCheck}`);
}

// -----------------------------------------------------------------------------
// TEST 3: Real Engine Thermal Degradation (EGT + CHT Elevation Under Load)
// -----------------------------------------------------------------------------
console.log('\n--- EXECUTING TEST 3: Genuine Engine Fault (Thermal Degradation) ---');
const telemetry3 = new TelemetryEngine();
const trustEngine3 = new SensorTrustEngine();
const aiEngine3 = new AIDiagnosticNet();

telemetry3.setScenario('thermal_degradation');
// Run ticks to accumulate thermal degradation
for (let i = 0; i < 40; i++) {
  telemetry3.computePhysicsStep();
  const trustRes = trustEngine3.evaluate(telemetry3.state, telemetry3.expected);
  aiEngine3.evaluate(telemetry3.state, trustRes, telemetry3.expected);
}

const res3 = trustEngine3.evaluate(telemetry3.state, telemetry3.expected);
const diag3 = aiEngine3.evaluate(telemetry3.state, res3, telemetry3.expected);

console.log(`- EGT Sensor Trust: ${res3.scores.egt[0]} (Expect >= 0.85)`);
console.log(`- CHT Sensor Trust: ${res3.scores.cht[0]} (Expect >= 0.85)`);
console.log(`- Fault Classification: ${diag3.detectedFault}`);
console.log(`- Fault Class: ${diag3.faultClass} (Expect THERMAL_DEGRADATION)`);
console.log(`- Engine Health Index: ${diag3.healthIndex} (Expect < 88, WARNING)`);
console.log(`- Health Status: ${diag3.status} (Expect WARNING)`);
console.log(`- Estimated RUL: ${diag3.rulMinHours}–${diag3.rulMaxHours} Hours (Confidence: ${diag3.rulConfidence})`);
console.log(`- Explainability Factors:\n  • ${diag3.explainability.contributingFactors.join('\n  • ')}`);

const test3TrustCheck = res3.scores.egt[0] >= 0.85 && res3.scores.cht[0] >= 0.85;
const test3ClassCheck = diag3.faultClass === 'THERMAL_DEGRADATION';
const test3HealthCheck = diag3.healthIndex < 88 && diag3.status === 'WARNING';
const test3RulCheck = diag3.rulMinHours < 50;

if (test3TrustCheck && test3ClassCheck && test3HealthCheck && test3RulCheck) {
  console.log('>>> [PASS] TEST 3: Genuine thermal degradation detected with high sensor trust, health reduction, and RUL update.');
  testsPassed++;
} else {
  console.error(`>>> [FAIL] TEST 3 failed: trustCheck=${test3TrustCheck}, classCheck=${test3ClassCheck}, healthCheck=${test3HealthCheck}, rulCheck=${test3RulCheck}`);
}

// -----------------------------------------------------------------------------
// TEST 4: Mission Replay & Blackbox Timeline
// -----------------------------------------------------------------------------
console.log('\n--- EXECUTING TEST 4: Mission Replay Buffer & Markers ---');
const telemetry4 = new TelemetryEngine();
const replayLog = telemetry4.generateMissionReplayLog();

console.log(`- Total Replay Frames: ${replayLog.length} seconds`);
const freezeEvent = replayLog.find(f => f.eventMarker === 'SENSOR_FREEZE');
const thermalEvent = replayLog.find(f => f.eventMarker === 'THERMAL_DEGRADATION');

console.log(`- Found Sensor Freeze Marker at: ${freezeEvent ? freezeEvent.timeStr : 'NONE'}`);
console.log(`- Found Thermal Degradation Marker at: ${thermalEvent ? thermalEvent.timeStr : 'NONE'}`);

telemetry4.seekReplay(freezeEvent.second);
console.log(`- Seeked to freeze event: Oil Press = ${telemetry4.state.oilPress} PSI, Phase = ${telemetry4.state.missionPhase}`);

if (replayLog.length >= 60 && freezeEvent && thermalEvent && telemetry4.state.oilPress === 52.4) {
  console.log('>>> [PASS] TEST 4: Mission replay log generates markers for both sensor and engine faults with seekable state.');
  testsPassed++;
} else {
  console.error('>>> [FAIL] TEST 4 failed replay verification!');
}

// -----------------------------------------------------------------------------
// SUMMARY
// -----------------------------------------------------------------------------
console.log('\n' + '='.repeat(75));
console.log(`FINAL RESULT: ${testsPassed} / ${testsTotal} ACCEPTANCE TESTS PASSED`);
console.log('='.repeat(75));

if (testsPassed === testsTotal) {
  process.exit(0);
} else {
  process.exit(1);
}
