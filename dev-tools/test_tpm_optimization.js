const http = require('http');

function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

async function ask(query, customState = {}) {
  const baseState = {
    rawTelemetry: {
      rpm: 4210,
      map: 24.5,
      fuelFlow: 21.3,
      oilPress: 52.8,
      oilTemp: 91.2,
      cht: [166.1, 167.2, 165.8, 166.9],
      egt: [780.5, 782.1, 781.0, 782.4],
      load: 72,
      vibration: 1.15
    },
    physics: {
      expected: { rpm: 4200, map: 24.6, chtAvg: 165.0, egtAvg: 781.0, oilPress: 53.0 },
      residuals: { rpm: 10, map: -0.1, chtAvg: 1.5, egtAvg: 0.8, oilPress: -0.2 }
    },
    sensorTrust: {
      overall: 1.0,
      trustedCount: 9,
      totalSensors: 9,
      quarantined: []
    },
    ehi: 96,
    ehiStatus: 'NOMINAL',
    aiDiagnosis: 'HEALTHY',
    anomalyScore: 0.04,
    rulLabel: '182 h',
    rulHours: 182,
    RULRange: { low: 165, high: 198 },
    RULConfidence: 91,
    degradationPct: 0.5,
    degradationTrend: 'STABLE',
    missionPhase: 'CRUISE',
    simTime: '00:14:32'
  };

  const appState = { ...baseState, ...customState };

  return new Promise(resolve => {
    const req = http.request({
      hostname: 'localhost',
      port: 3000,
      path: '/api/grok',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try {
          const j = JSON.parse(d);
          resolve({ status: res.statusCode, data: j });
        } catch(e) {
          resolve({ status: res.statusCode, raw: d });
        }
      });
    });
    req.write(JSON.stringify({ query, appState }));
    req.end();
  });
}

async function runAudit() {
  console.log('======================================================================');
  console.log('  AERO TWIN — GROQ TPM TOKEN REDUCTION & BEHAVIOR AUDIT');
  console.log('======================================================================\n');

  const tests = [
    {
      name: 'TEST 1: "are you working properly?"',
      query: 'are you working properly?',
      state: {}
    },
    {
      name: 'TEST 2: "what is the current engine status?"',
      query: 'what is the current engine status?',
      state: {}
    },
    {
      name: 'TEST 3: "how much RUL remains?"',
      query: 'how much RUL remains?',
      state: {}
    },
    {
      name: 'TEST 4: "is this a sensor fault?"',
      query: 'is this a sensor fault?',
      state: {
        rawTelemetry: { oilPress: 12.0, cht: 165, egt: 780 },
        sensorTrust: {
          overall: 0.89,
          trustedCount: 8,
          totalSensors: 9,
          quarantined: ['oilPress'],
          scores: { oilPress: 0.12, cht: 0.98, egt: 0.97 }
        },
        aiDiagnosis: 'SENSOR FAULT',
        ehi: 94
      }
    },
    {
      name: 'TEST 5: Thermal degradation scenario',
      query: 'why is engine health changing?',
      state: {
        rawTelemetry: { cht: [218.4, 219.1, 217.9, 218.8], egt: [811.2, 813.0, 812.5, 814.1], rpm: 4200 },
        physics: { expected: { chtAvg: 165, egtAvg: 780 }, residuals: { chtAvg: 53.5, egtAvg: 32.7 } },
        aiDiagnosis: 'THERMAL DEGRADATION',
        ehi: 64,
        ehiStatus: 'WARNING',
        ehiBreakdown: { thermalContribution: -32.0, lubricationContribution: 0, baseline: 100 },
        sensorTrust: { overall: 1.0, trustedCount: 9, totalSensors: 9, quarantined: [] }
      }
    }
  ];

  for (const t of tests) {
    console.log(`--- ${t.name} ---`);
    console.log(`Query: "${t.query}"`);
    const start = Date.now();
    const res = await ask(t.query, t.state);
    const duration = Date.now() - start;

    console.log(`HTTP Status: ${res.status}`);
    console.log(`Source: ${res.data ? res.data.source : 'unknown'}`);
    console.log(`Fallback Occurred: ${res.data && res.data.source === 'local_fallback' ? 'YES' : 'NO'}`);
    console.log(`Duration: ${duration}ms`);
    if (res.data && res.data.response) {
      console.log('Response Snippet:');
      const lines = res.data.response.split('\n').filter(l => l.trim().length > 0);
      lines.slice(0, 8).forEach(l => console.log('  ' + l));
      if (lines.length > 8) console.log('  ...');
    } else {
      console.log('Response Data:', JSON.stringify(res.data || res.raw));
    }
    console.log('');
    // Brief pause to stay well within minute rate limits
    await wait(1500);
  }

  console.log('======================================================================');
  console.log('  ALL SCENARIOS COMPLETED');
  console.log('======================================================================');
}

runAudit().catch(console.error);
