const http = require('http');

const data = JSON.stringify({
  query: 'whats goingon',
  appState: {
    scenario: 'normal',
    missionPhase: 'CRUISE',
    simTime: '14:22',
    rawTelemetry: {
      rpm: 4200,
      map: 33.2,
      cht: [166.5, 164.8, 169.2, 165.4],
      egt: [780, 776, 792, 779],
      oilPress: 52.4,
      oilTemp: 88.5,
      fuelFlow: 24.2,
      load: 72,
      vibrationRms: 1.75
    },
    physics: {
      expected: { rpm: 4200, map: 33.0, chtAvg: 166, egtAvg: 780, oilPress: 52.0 },
      residuals: { egt: 0, cht: 0, oilPress: 0 }
    },
    trustResult: {
      overallTrust: 0.96,
      quarantined: [],
      scores: { rpm: 0.98, oilPress: 0.97 }
    },
    diagnosticResult: {
      faultClass: 'HEALTHY',
      anomalyScore: 0.04,
      healthIndex: 96,
      rulHours: 182,
      degradationPct: 4,
      missionReliability: { score: 96, status: 'GO' }
    },
    ehi: 96,
    overallTrust: 0.96,
    trustedCount: 9,
    totalSensors: 9,
    anomalyScore: 0.04,
    rulHours: 182,
    degradationPct: 4,
    missionReliability: { score: 96, status: 'GO' },
    why: {
      title: 'ALL NOMINAL',
      bullets: ['Nominal parameters'],
      conclusion: 'Engine healthy.'
    }
  }
});

const req = http.request('http://localhost:3000/api/gemini', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(data)
  }
}, res => {
  let body = '';
  res.on('data', chunk => body += chunk);
  res.on('end', () => {
    console.log('HTTP STATUS:', res.statusCode);
    console.log('RESPONSE BODY:\n', JSON.parse(body));
  });
});

req.on('error', err => console.error('Request Error:', err));
req.write(data);
req.end();
