const http = require('http');

async function sendGeminiRequest(query, appState) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ query, appState });
    const req = http.request('http://localhost:3000/api/gemini', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            json: JSON.parse(body)
          });
        } catch (err) {
          resolve({
            statusCode: res.statusCode,
            raw: body,
            error: err.message
          });
        }
      });
    });

    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function createMockAppState(scenario, options = {}) {
  const isSensorFault = scenario === 'sensor_fault';
  const isThermal = scenario === 'thermal_degradation';

  return {
    scenario: scenario,
    missionPhase: options.missionPhase || 'CRUISE',
    simTime: options.simTime || '14:22',
    isReplaying: !!options.isReplaying,
    replayIndex: options.replayIndex || 0,
    rawTelemetry: {
      rpm: isThermal ? 4380 : 4200,
      map: isThermal ? 37.8 : 33.2,
      cht: isThermal ? [186.0, 184.3, 188.7, 184.9] : [166.5, 164.8, 169.2, 165.4],
      egt: isThermal ? [872, 868, 884, 871] : [780, 776, 792, 779],
      oilPress: isSensorFault ? 52.4 : (isThermal ? 38.5 : 52.4),
      oilTemp: isThermal ? 108.5 : 88.5,
      fuelFlow: isThermal ? 31.4 : 24.2,
      load: isThermal ? 89 : 72,
      vibrationRms: 1.75,
      ambientTemp: -21,
      altitude: 18000
    },
    expectedPhysics: {
      rpm: 4200,
      map: 33.0,
      cht: [166, 165, 168, 165],
      egt: [780, 775, 790, 778],
      oilPress: 52.0,
      oilTemp: 88.0,
      fuelFlow: 24.0,
      load: 72
    },
    physics: {
      expected: { rpm: 4200, map: 33.0, chtAvg: 166, egtAvg: 780, oilPress: 52.0, oilTemp: 88.0, fuelFlow: 24.0, load: 72 },
      residuals: isThermal ? { egt: 92, cht: 19.5, oilPress: -13.5, rpm: 180, fuelFlow: 7.2 } : { egt: 0, cht: 0, oilPress: 0, rpm: 0, fuelFlow: 0 },
      status: isThermal ? 'ANOMALOUS' : 'NORMAL'
    },
    trustResult: {
      overallTrust: isSensorFault ? 0.88 : 0.96,
      quarantined: isSensorFault ? ['oilPress'] : [],
      scores: {
        rpm: 0.98,
        cht: [0.96, 0.96, 0.96, 0.96],
        egt: [0.95, 0.95, 0.95, 0.95],
        oilPress: isSensorFault ? 0.25 : 0.97,
        oilTemp: 0.94,
        fuelFlow: 0.96,
        map: 0.95
      }
    },
    diagnosticResult: {
      faultClass: isSensorFault ? 'SENSOR_FAULT' : (isThermal ? 'THERMAL_DEGRADATION' : 'HEALTHY'),
      confidencePct: 98,
      confidence: 0.98,
      anomalyScore: isThermal ? 0.88 : (isSensorFault ? 0.35 : 0.04),
      healthIndex: isThermal ? 64 : (isSensorFault ? 94 : 96),
      rulHours: isThermal ? 48 : 182,
      rulRangeStr: isThermal ? '43–53 h' : '165–198 h',
      rulConfidencePct: 92,
      degradationPct: isThermal ? 28 : 4,
      degradationTrend: isThermal ? 'ACCELERATING' : 'STABLE',
      missionReliability: {
        score: isThermal ? 35 : (isSensorFault ? 88 : 96),
        status: isThermal ? 'ABORT_RECOMMENDED' : (isSensorFault ? 'DEGRADED_CONTINUE' : 'GO'),
        reasons: isThermal ? ['THERMAL RUNAWAY LIMITS ENDURANCE'] : (isSensorFault ? ['OIL TRANSDUCER QUARANTINED'] : ['All parameters nominal']),
        currentPhase: options.missionPhase || 'CRUISE',
        remainingMissionDuration: '02h 18m'
      }
    },
    overallTrust: isSensorFault ? 0.88 : 0.96,
    trustedCount: isSensorFault ? 8 : 9,
    totalSensors: 9,
    ehi: isThermal ? 64 : (isSensorFault ? 94 : 96),
    ehiStatus: isThermal ? 'CRITICAL' : 'NOMINAL',
    aiDiagnosis: isSensorFault ? 'SENSOR FAULT' : (isThermal ? 'THERMAL DEGRADATION' : 'HEALTHY'),
    aiDiagStatus: isThermal ? 'CRITICAL' : (isSensorFault ? 'WARNING' : 'NOMINAL'),
    anomalyScore: isThermal ? 0.88 : (isSensorFault ? 0.35 : 0.04),
    rulHours: isThermal ? 48 : 182,
    rulLabel: isThermal ? '48 h' : '182 h',
    degradationPct: isThermal ? 28 : 4,
    degradationTrend: isThermal ? 'ACCELERATING' : 'STABLE',
    missionReliability: {
      score: isThermal ? 35 : (isSensorFault ? 88 : 96),
      status: isThermal ? 'ABORT_RECOMMENDED' : (isSensorFault ? 'DEGRADED_CONTINUE' : 'GO'),
      reasons: isThermal ? ['THERMAL RUNAWAY LIMITS ENDURANCE'] : (isSensorFault ? ['OIL TRANSDUCER QUARANTINED'] : ['All parameters nominal']),
      currentPhase: options.missionPhase || 'CRUISE',
      remainingMissionDuration: '02h 18m'
    },
    maintenance: isThermal ? {
      subsystem: 'Cylinder Head Assembly & Fuel Injection',
      priority: 'CRITICAL',
      action: 'Immediate engine teardown, borescope inspection, and injector calibration.',
      code: 'MAINT-901-THERM',
      urgency: 'Prior to next flight'
    } : (isSensorFault ? {
      subsystem: 'Oil Pressure Transducer Channel',
      priority: 'HIGH',
      action: 'Bench test and recalibrate transducer harness. Verify sensor ground.',
      code: 'MAINT-404-SNSR',
      urgency: 'Next Turnaround'
    } : {
      subsystem: 'All Systems Nominal',
      priority: 'ROUTINE',
      action: 'Standard turnaround inspection.',
      code: 'MAINT-001-NOM',
      urgency: '50h Inspection'
    }),
    why: {
      title: isThermal ? 'WHY THERMAL RUNAWAY IS CONFIRMED' : (isSensorFault ? 'WHY SENSOR FAULT IS ISOLATED' : 'WHY ENGINE IS NOMINAL'),
      bullets: isThermal ? ['Dual trusted EGT and CHT channels elevated', 'Sensor trust verified >0.94'] : (isSensorFault ? ['Zero variance on oil pressure', 'Engine health preserved'] : ['All parameters within ±3% of baseline']),
      conclusion: isThermal ? 'Genuine thermodynamic degradation.' : (isSensorFault ? 'Instrument artifact quarantined.' : 'Combustion equilibrium nominal.')
    }
  };
}

async function runTests() {
  console.log('================================================================');
  console.log('AERO TWIN — GEMINI & TIMELINE REAL-TIME INTEGRATION VERIFICATION');
  console.log('================================================================\n');

  let passCount = 0;
  let totalCount = 0;

  async function testQuery(name, query, scenario, options = {}) {
    totalCount++;
    process.stdout.write(`[TEST ${totalCount}] ${name} ... `);
    const appState = createMockAppState(scenario, options);
    try {
      const res = await sendGeminiRequest(query, appState);
      await new Promise(r => setTimeout(r, 600));
      if (res.statusCode === 200 && res.json && res.json.source === 'gemini' && res.json.response) {
        console.log('PASS (HTTP 200, source: gemini)');
        console.log(`       Query: "${query}"`);
        console.log(`       Response: "${res.json.response.replace(/\n/g, ' ').slice(0, 140)}..."\n`);
        passCount++;
        return true;
      } else {
        console.log(`FAIL (Status: ${res.statusCode}, Error: ${JSON.stringify(res.json || res.error)})`);
        return false;
      }
    } catch (e) {
      console.log(`FAIL (Exception: ${e.message})`);
      return false;
    }
  }

  // STEP 2: General summary
  await testQuery('Concise Summary Query', 'Give a concise summary of the current engine state.', 'normal');

  // STEP 8: The 8 Exact Queries
  await testQuery('Query 1: hi (Natural Greeting)', 'hi', 'normal');
  await testQuery('Query 2: whats goingon (Status Overview)', 'whats goingon', 'normal');
  await testQuery('Query 3: Is this a sensor fault? (Sensor Fault scenario)', 'Is this a sensor fault?', 'sensor_fault');
  await testQuery('Query 4: Why is engine health changing? (Thermal Degradation)', 'Why is engine health changing?', 'thermal_degradation');
  await testQuery('Query 5: How much RUL remains?', 'How much RUL remains?', 'thermal_degradation');
  await testQuery('Query 6: Which sensor is unreliable? (Sensor Fault scenario)', 'Which sensor is unreliable?', 'sensor_fault');
  await testQuery('Query 7: What caused the anomaly? (Thermal Degradation)', 'What caused the anomaly?', 'thermal_degradation');
  await testQuery('Query 8: What is the mission reliability?', 'What is the mission reliability?', 'thermal_degradation');

  // STEP 9: Test all 3 Scenarios
  await testQuery('Scenario 1: NORMAL MISSION', 'Summarize the current engine.', 'normal');
  await testQuery('Scenario 2: SENSOR FAULT', 'Is this a sensor fault or engine degradation? Explain.', 'sensor_fault');
  await testQuery('Scenario 3: THERMAL DEGRADATION', 'What is causing the degradation and how does it affect mission reliability?', 'thermal_degradation');

  // Replay Mode Grounding Test
  await testQuery('Replay Grounding: Oil Transducer Frozen at t=18s', 'Why did the engine health not fall?', 'sensor_fault', { isReplaying: true, simTime: '14:18' });
  await testQuery('Replay Grounding: Thermal Runaway at t=38s', 'What caused the degradation?', 'thermal_degradation', { isReplaying: true, simTime: '14:38' });

  console.log('================================================================');
  console.log(`RESULTS: ${passCount}/${totalCount} tests passed.`);
  console.log('================================================================');

  if (passCount === totalCount) {
    process.exit(0);
  } else {
    process.exit(1);
  }
}

runTests();
