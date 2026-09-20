/**
 * AERO TWIN — MISSION RELIABILITY & MAP OPERATING ENVELOPE REGRESSION TEST SUITE
 * 
 * Verifies 6 critical scenarios:
 * 1. Normal cruise -> high reliability / nominal (>= 96% / NOMINAL)
 * 2. Genuine thermal degradation -> reliability decreases (~25-38%)
 * 3. Genuine lubrication fault -> reliability decreases (< 25%)
 * 4. Sensor freeze -> sensor trust decreases but does not become engine failure (>= 90%)
 * 5. MAP within valid turbo envelope (28.5 inHg @ 25,000 ft) -> 0 MAP penalty & NORMAL status
 * 6. MAP genuinely outside envelope (18 inHg or 40 inHg) -> MAP penalty (-18 pts) & reliability drop
 */

const AeroPhysicsModel = require('../js/physics-engine.js');
const AIDiagnosticNet = require('../js/ai-diagnostic-net.js');

let passCount = 0;
let failCount = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  PASS: ${message}`);
    passCount++;
  } else {
    console.error(`  FAIL: ${message}`);
    failCount++;
  }
}

console.log('================================================================');
console.log('AERO TWIN — Mission Reliability & Turbo MAP Regression Tests');
console.log('================================================================\n');

const physics = new AeroPhysicsModel();
const aiNet = new AIDiagnosticNet();

// -----------------------------------------------------------------------------
// TEST 1: Normal cruise at 25,000 ft, 72% throttle, turbocharged engine
// -----------------------------------------------------------------------------
console.log('Test 1: Normal Cruise (25,000 ft, 72% throttle, EHI 96, trusted)');
{
  const conditions = {
    altitude: 25000,
    throttle: 0.72,
    missionPhase: 'cruise'
  };

  const expectedState = physics.computeExpectedState(conditions);
  console.log(`  Expected MAP at 25k ft / 72% throttle: ${expectedState.expected.map} inHg (Wastegate target)`);
  assert(expectedState.expected.map >= 28.0 && expectedState.expected.map <= 29.0, 'Expected MAP models wastegate regulation (~28.5 inHg)');

  const rawState = {
    rpm: 4200,
    map: 28.5,
    fuelFlow: 24.2,
    cht: [166.5, 164.8, 169.2, 165.4],
    egt: [780, 776, 792, 779],
    oilPress: 52.4,
    oilTemp: 88.5,
    load: 72,
    throttle: 0.72,
    altitude: 25000,
    missionPhase: 'cruise',
    vibrationRms: 1.75
  };

  const trustResult = {
    overallTrust: 1.0,
    quarantined: [],
    scores: { rpm: 1.0, map: 1.0, fuelFlow: 1.0, oilPress: 1.0, oilTemp: 1.0, cht: [1.0,1.0,1.0,1.0], egt: [1.0,1.0,1.0,1.0] }
  };

  const physResult = physics.computeResiduals(rawState, expectedState, trustResult);
  console.log(`  Physics MAP residual: ${physResult.residuals.map} inHg | status: ${physResult.status.map}`);
  assert(physResult.status.map === 'NORMAL', 'MAP status is NORMAL (not ELEVATED) when within valid turbo envelope');

  const diagResult = aiNet.evaluate(rawState, trustResult, expectedState.expected, physResult);
  const rel = diagResult.missionReliability;
  console.log(`  Mission Reliability: ${rel.score}% | Status: ${rel.status} | Risk: ${rel.riskLevel}`);
  console.log(`  Contributors:`, rel.contributors.penalties);

  assert(rel.score >= 96 && rel.score <= 99, `Mission Reliability is high nominal (${rel.score}% >= 96%)`);
  assert(rel.status === 'NOMINAL (GO)', `Mission Reliability status is NOMINAL (GO) (got: ${rel.status})`);
  assert(rel.riskLevel === 'NOMINAL', `Risk level is NOMINAL`);
  assert(rel.contributors.penalties.mapEnvelope === 0, `MAP envelope penalty is 0 (got: ${rel.contributors.penalties.mapEnvelope})`);
  assert(rel.contributors.penalties.sensorTrust === 0, `Sensor trust penalty is 0`);
  assert(rel.contributors.penalties.confirmedFault === 0, `Confirmed fault penalty is 0`);
}

// -----------------------------------------------------------------------------
// TEST 2: Genuine Thermal Degradation
// -----------------------------------------------------------------------------
console.log('\nTest 2: Genuine Thermal Degradation (Overheat runaway, sensors trusted)');
{
  const conditions = { altitude: 18000, throttle: 0.89, missionPhase: 'cruise' };
  const expectedState = physics.computeExpectedState(conditions);

  const rawState = {
    rpm: 4380,
    map: 32.5,
    fuelFlow: 31.4,
    cht: [186.0, 184.3, 188.7, 184.9], // High CHT
    egt: [872, 868, 884, 871],         // High EGT
    oilPress: 38.5,
    oilTemp: 108.5,
    load: 89,
    throttle: 0.89,
    altitude: 18000,
    missionPhase: 'cruise',
    vibrationRms: 2.1
  };

  const trustResult = {
    overallTrust: 0.96,
    quarantined: [],
    scores: { rpm: 1.0, map: 1.0, fuelFlow: 1.0, oilPress: 0.95, oilTemp: 0.94, cht: [1.0,1.0,1.0,1.0], egt: [1.0,1.0,1.0,1.0] }
  };

  const physResult = physics.computeResiduals(rawState, expectedState, trustResult);
  const diagResult = aiNet.evaluate(rawState, trustResult, expectedState.expected, physResult);
  const rel = diagResult.missionReliability;

  console.log(`  Fault Class: ${diagResult.faultClass} | EHI: ${diagResult.healthIndex}`);
  console.log(`  Mission Reliability: ${rel.score}% | Status: ${rel.status} | Risk: ${rel.riskLevel}`);
  console.log(`  Contributors:`, rel.contributors.penalties);

  assert(diagResult.faultClass === 'THERMAL_DEGRADATION', 'Classified as THERMAL_DEGRADATION');
  assert(rel.score <= 45, `Mission Reliability decreased severely (${rel.score}% <= 45%)`);
  assert(rel.contributors.penalties.confirmedFault === -28, `Confirmed fault penalty is -28`);
  assert(rel.status.includes('WARNING') || rel.status.includes('CRITICAL'), 'Status warns or derates engine');
}

// -----------------------------------------------------------------------------
// TEST 3: Genuine Lubrication Degradation
// -----------------------------------------------------------------------------
console.log('\nTest 3: Genuine Lubrication Degradation (Oil pump failure / bearing wear)');
{
  const conditions = { altitude: 18000, throttle: 0.72, missionPhase: 'cruise' };
  const expectedState = physics.computeExpectedState(conditions);

  const rawState = {
    rpm: 4200,
    map: 28.5,
    fuelFlow: 24.2,
    cht: [170.0, 168.0, 172.0, 169.0],
    egt: [785, 782, 795, 783],
    oilPress: 18.2, // Loss of oil pressure
    oilTemp: 114.0, // High oil temp
    load: 72,
    throttle: 0.72,
    altitude: 18000,
    missionPhase: 'cruise',
    vibrationRms: 3.4 // High bearing vibration
  };

  // Both pressure dropped and temp/vibration rose: sensors trusted, genuine mechanical failure
  const trustResult = {
    overallTrust: 0.92,
    quarantined: [],
    scores: { rpm: 1.0, map: 1.0, fuelFlow: 1.0, oilPress: 0.88, oilTemp: 0.92, cht: [1.0,1.0,1.0,1.0], egt: [1.0,1.0,1.0,1.0] }
  };

  const physResult = physics.computeResiduals(rawState, expectedState, trustResult);
  const diagResult = aiNet.evaluate(rawState, trustResult, expectedState.expected, physResult);
  const rel = diagResult.missionReliability;

  console.log(`  Fault Class: ${diagResult.faultClass} | EHI: ${diagResult.healthIndex}`);
  console.log(`  Mission Reliability: ${rel.score}% | Status: ${rel.status}`);
  console.log(`  Contributors:`, rel.contributors.penalties);

  assert(diagResult.faultClass === 'LUBRICATION_DEGRADATION', 'Classified as LUBRICATION_DEGRADATION');
  assert(rel.score <= 25, `Mission Reliability drops critically (${rel.score}% <= 25%)`);
  assert(rel.contributors.penalties.confirmedFault === -52, `Confirmed fault penalty is -52`);
  assert(rel.status.includes('CRITICAL'), 'Status is CRITICAL (ABORT / DIVERT)');
}

// -----------------------------------------------------------------------------
// TEST 4: Sensor Freeze (Quarantined sensor, engine mechanically healthy)
// -----------------------------------------------------------------------------
console.log('\nTest 4: Sensor Freeze (1 sensor quarantined, engine mechanically nominal)');
{
  const conditions = { altitude: 18000, throttle: 0.72, missionPhase: 'cruise' };
  const expectedState = physics.computeExpectedState(conditions);

  const rawState = {
    rpm: 4200,
    map: 28.5,
    fuelFlow: 24.2,
    cht: [166.5, 164.8, 169.2, 165.4],
    egt: [780, 776, 792, 779],
    oilPress: 52.4, // Frozen transducer
    oilTemp: 88.5,
    load: 72,
    throttle: 0.72,
    altitude: 18000,
    missionPhase: 'cruise',
    vibrationRms: 1.75
  };

  // Oil pressure quarantined due to zero variance
  const trustResult = {
    overallTrust: 0.89,
    quarantined: ['oilPress'],
    scores: { rpm: 1.0, map: 1.0, fuelFlow: 1.0, oilPress: 0.20, oilTemp: 1.0, cht: [1.0,1.0,1.0,1.0], egt: [1.0,1.0,1.0,1.0] }
  };

  const physResult = physics.computeResiduals(rawState, expectedState, trustResult);
  assert(physResult.isShielded === true, 'Quarantined sensor is shielded in physics residuals');

  const diagResult = aiNet.evaluate(rawState, trustResult, expectedState.expected, physResult);
  const rel = diagResult.missionReliability;

  console.log(`  Fault Class: ${diagResult.faultClass} | EHI: ${diagResult.healthIndex}`);
  console.log(`  Mission Reliability: ${rel.score}% | Status: ${rel.status}`);
  console.log(`  Contributors:`, rel.contributors.penalties);

  assert(diagResult.faultClass === 'SENSOR_FAULT', 'Classified as SENSOR_FAULT (engine healthy)');
  assert(diagResult.healthIndex >= 93, `EHI is protected from quarantined sensor (${diagResult.healthIndex} >= 93)`);
  assert(rel.contributors.penalties.confirmedFault === 0, 'Confirmed mechanical fault penalty is 0');
  assert(rel.contributors.penalties.sensorTrust <= -3 && rel.contributors.penalties.sensorTrust >= -6, 'Sensor trust carries moderate instrumentation penalty (-4 to -6)');
  assert(rel.score >= 90, `Reliability remains high nominal (${rel.score}% >= 90%) and does not become engine failure`);
}

// -----------------------------------------------------------------------------
// TEST 5: MAP within valid turbo envelope -> 0 reliability penalty
// -----------------------------------------------------------------------------
console.log('\nTest 5: MAP within valid turbo envelope (28.5 inHg at 25,000 ft)');
{
  const envelope = physics.getMapOperatingEnvelope({ altitude: 25000, throttle: 0.72, missionPhase: 'cruise' });
  console.log(`  Cruise envelope bounds: [${envelope.nominalMin} - ${envelope.nominalMax}] inHg`);

  assert(28.5 >= envelope.nominalMin && 28.5 <= envelope.nominalMax, '28.5 inHg is strictly within cruise turbo envelope');

  const rawState = {
    rpm: 4200,
    map: 28.5,
    fuelFlow: 24.2,
    cht: [166.5, 164.8, 169.2, 165.4],
    egt: [780, 776, 792, 779],
    oilPress: 52.4,
    oilTemp: 88.5,
    load: 72,
    throttle: 0.72,
    altitude: 25000,
    missionPhase: 'cruise',
    vibrationRms: 1.75
  };

  const expectedState = physics.computeExpectedState({ altitude: 25000, throttle: 0.72, missionPhase: 'cruise' });
  const trustResult = { overallTrust: 1.0, quarantined: [], scores: {} };
  const physResult = physics.computeResiduals(rawState, expectedState, trustResult);
  const diagResult = aiNet.evaluate(rawState, trustResult, expectedState.expected, physResult);
  const rel = diagResult.missionReliability;

  assert(physResult.status.map === 'NORMAL', 'MAP status in physics table is NORMAL');
  assert(rel.contributors.penalties.mapEnvelope === 0, 'MAP envelope penalty is 0 pts');
}

// -----------------------------------------------------------------------------
// TEST 6: MAP genuinely outside envelope -> reliability penalty
// -----------------------------------------------------------------------------
console.log('\nTest 6: MAP genuinely outside envelope (Severe boost leak 18 inHg & Overboost 40 inHg)');
{
  const conditions = { altitude: 25000, throttle: 0.72, missionPhase: 'cruise' };
  const expectedState = physics.computeExpectedState(conditions);
  const trustResult = { overallTrust: 1.0, quarantined: [], scores: {} };

  // Case 6A: Severe boost leak (18.0 inHg at 72% cruise)
  const rawLeak = {
    rpm: 4200,
    map: 18.0, // Severe boost loss
    fuelFlow: 20.0,
    cht: [165, 164, 168, 165],
    egt: [775, 772, 785, 774],
    oilPress: 52.0,
    oilTemp: 88.0,
    load: 72,
    throttle: 0.72,
    altitude: 25000,
    missionPhase: 'cruise',
    vibrationRms: 1.75
  };

  const physLeak = physics.computeResiduals(rawLeak, expectedState, trustResult);
  const diagLeak = aiNet.evaluate(rawLeak, trustResult, expectedState.expected, physLeak);
  const relLeak = diagLeak.missionReliability;

  console.log(`  Leak: MAP status: ${physLeak.status.map} | Envelope penalty: ${relLeak.contributors.penalties.mapEnvelope} | Rel score: ${relLeak.score}%`);
  assert(physLeak.status.map === 'CRITICAL' || physLeak.status.map === 'LOW', 'Boost leak is classified as CRITICAL/LOW');
  assert(relLeak.contributors.penalties.mapEnvelope === -18, 'Boost leak incurs -18 MAP penalty');
  assert(relLeak.score <= 82, `Reliability drops noticeably due to out-of-envelope MAP (${relLeak.score}% <= 82%)`);

  // Case 6B: Severe overboost (40.0 inHg at 72% cruise)
  const rawOverboost = {
    rpm: 4200,
    map: 40.0, // Stuck wastegate overboost
    fuelFlow: 28.0,
    cht: [175, 174, 178, 175],
    egt: [805, 802, 815, 804],
    oilPress: 52.0,
    oilTemp: 90.0,
    load: 72,
    throttle: 0.72,
    altitude: 25000,
    missionPhase: 'cruise',
    vibrationRms: 1.85
  };

  const physOver = physics.computeResiduals(rawOverboost, expectedState, trustResult);
  const diagOver = aiNet.evaluate(rawOverboost, trustResult, expectedState.expected, physOver);
  const relOver = diagOver.missionReliability;

  console.log(`  Overboost: MAP status: ${physOver.status.map} | Envelope penalty: ${relOver.contributors.penalties.mapEnvelope} | Rel score: ${relOver.score}%`);
  assert(physOver.status.map === 'CRITICAL' || physOver.status.map === 'ELEVATED', 'Overboost is classified as CRITICAL/ELEVATED');
  assert(relOver.contributors.penalties.mapEnvelope === -18, 'Overboost incurs -18 MAP penalty');
  assert(relOver.score <= 82, `Reliability drops noticeably due to overboost MAP (${relOver.score}% <= 82%)`);
}

console.log('\n================================================================');
console.log(`Regression Test Summary: ${passCount} PASSED, ${failCount} FAILED`);
console.log('================================================================\n');

if (failCount > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
