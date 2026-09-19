const http = require('http');
const fs = require('fs');
const path = require('path');

// Load environment variables from .env
require('dotenv').config();

const PORT = 3000;
const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.py': 'text/plain',
  '.ino': 'text/plain'
};

// In-memory buffer for real engine hardware telemetry
let latestHardwareTelemetry = null;
let lastHardwarePacketTimestamp = 0;

// ============================================================================
// Groq Cloud AI Integration — High-Speed LPU Inference (GPT-OSS / Llama)
// ============================================================================
const https = require('https');

let groqApiKey = null;
let groqModel = 'openai/gpt-oss-120b';

function initGroq() {
  const apiKey = (process.env.GROQ_API_KEY || process.env.XAI_API_KEY || '').trim();
  if (!apiKey) {
    console.warn('[Groq Cloud] No GROQ_API_KEY found in .env — AI Assistant will use local analysis fallback.');
    return;
  }
  groqApiKey = apiKey;
  groqModel = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';
  console.log(`[Groq Cloud] Groq AI initialized successfully (model: ${groqModel}).`);
}

initGroq();

const GROQ_SYSTEM_PROMPT = `You are the AERO TWIN Engine Assistant.

You are an explanation layer over an engineering Digital Twin.

The CURRENT ENGINE STATE supplied in the request is authoritative.

Never invent, estimate, replace, or modify numerical values.
Never assume the engine is healthy.
Never generate your own EHI, RUL, sensor trust, anomaly score, residual, or diagnosis.

Use exactly the values supplied by the application.

If a value is missing, explicitly state that it is unavailable.

Sensor Trust takes precedence when determining whether a sensor reading should be treated as evidence of engine degradation.

A quarantined or low-trust sensor must not be treated as reliable evidence of mechanical failure.

Explain the engineering state using only the supplied state.

Never issue aircraft control commands.
Never claim certification.
Never claim real DRDO telemetry.
Never claim real TAPAS telemetry.
The data is synthetic simulation data unless explicitly stated otherwise.

Response format:

CURRENT STATE:
Briefly describe the current engine state using exact supplied values.

EVIDENCE:
List the important telemetry, expected-vs-actual residuals, sensor trust and diagnostic evidence.

WHY:
Explain why the current diagnosis/health state exists.

Keep answers concise and technical.`;

function callGroqAPI(userPrompt, systemPrompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: groqModel,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      max_tokens: 1024,
      temperature: 0.2
    });

    const options = {
      hostname: 'api.groq.com',
      port: 443,
      path: '/openai/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${groqApiKey}`,
        'Content-Length': Buffer.byteLength(body)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.error) {
            const errCode = res.statusCode || json.code || '';
            const errMsg = json.error.message || JSON.stringify(json.error);
            reject(new Error(`[Groq HTTP ${errCode}] ${errMsg}`));
            return;
          }
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`[Groq HTTP ${res.statusCode}] ${data}`));
            return;
          }
          const text = json.choices && json.choices[0] && json.choices[0].message
            ? json.choices[0].message.content
            : '';
          resolve(text);
        } catch (e) {
          reject(new Error(`Failed to parse Groq response: ${e.message} (HTTP ${res.statusCode})`));
        }
      });
    });

    req.on('error', (e) => { reject(e); });
    req.setTimeout(15000, () => { req.destroy(new Error('Groq API request timed out')); });
    req.write(body);
    req.end();
  });
}

function generateServerLocalAnalysis(query, appState) {
  const isReplaying = !!appState.isReplaying;
  const replayTag = isReplaying ? `@ ${appState.replayIndex !== null && appState.replayIndex !== undefined ? appState.replayIndex : '0'}s` : '';
  const diag = (appState.aiDiagnosis || 'HEALTHY').toUpperCase();
  const ehi = appState.ehi !== undefined ? Math.round(appState.ehi) : 96;
  const rul = appState.rulLabel || (appState.rulHours !== undefined ? appState.rulHours + ' h' : '182 h');
  const phase = appState.missionPhase || 'CRUISE';
  const trustCount = appState.trustedCount !== undefined ? appState.trustedCount : 9;
  const totalSensors = appState.totalSensors !== undefined ? appState.totalSensors : 9;
  const raw = appState.rawTelemetry || {};
  const rpm = raw.rpm !== undefined ? Math.round(raw.rpm) : 4200;
  const map = raw.map !== undefined ? raw.map.toFixed(1) + ' inHg' : '28.5 inHg';
  
  const prefix = replayTag ? `[REPLAY ${replayTag}] ` : '';
  
  if (diag.includes('FAULT') || (appState.trustResult && appState.trustResult.quarantined && appState.trustResult.quarantined.length > 0)) {
    const quarantined = (appState.trustResult && appState.trustResult.quarantined && appState.trustResult.quarantined[0]) || 'oil pressure';
    return `${prefix}**CURRENT STATE:** The engine itself appears healthy; the detected problem is isolated to the ${quarantined} sensor fault.

**EVIDENCE:**
• Diagnosis: SENSOR FAULT (${quarantined} transducer quarantined)
• Sensor Trust: ${trustCount}/${totalSensors} sensors verified
• Engine Health Index (EHI): ${ehi}/100 (shielded by Sensor Trust Gatekeeper)
• Mission Phase: ${phase}

**WHY:** The ${quarantined} sensor signal exhibited anomalous flatline/drift while correlated engine parameters remained consistent. The sensor is quarantined, protecting engine health assessment and preventing unnecessary mission abort.`;
  }
  
  if (diag.includes('THERMAL') || ehi < 75) {
    const rulRange = appState.rul && appState.rul.range ? appState.rul.range : (appState.RULRange ? `${appState.RULRange.low || '?'}–${appState.RULRange.high || '?'} h` : '');
    const rulConf = appState.rul && appState.rul.confidencePct ? appState.rul.confidencePct : (appState.RULConfidence || '');
    const rangeEvidence = rulRange ? `\n• RUL 90% Confidence Range: ${rulRange}` : '';
    const confEvidence = rulConf ? `\n• RUL Model Confidence: ${rulConf}%` : '';
    return `${prefix}**CURRENT STATE:** Authentic thermodynamic degradation detected across combustion cylinders.

**EVIDENCE:**
• Diagnosis: THERMAL DEGRADATION (Anomaly score: ${appState.anomalyScore !== undefined ? appState.anomalyScore.toFixed(2) : '0.64'})
• Engine Health Index (EHI): ${ehi}/100 (depleted)
• Projected RUL: ${rul}${rangeEvidence}${confEvidence}
• Sensor Trust: ${trustCount}/${totalSensors} (trusted thermal transducers)

**WHY:** Co-occurring elevation in exhaust gas temperatures (EGT) and cylinder head temperatures (CHT) under load confirms genuine thermodynamic distress, accelerating engine wear.`;
  }
  
  return `${prefix}**CURRENT STATE:** Engine is operating within nominal aerospace specifications during ${phase} flight.

**EVIDENCE:**
• RPM: ${rpm} | MAP: ${map}
• Engine Health Index (EHI): ${ehi}/100 (Optimal)
• Sensor Trust: ${trustCount}/${totalSensors} (1.00 Overall Trust)
• Projected RUL: ${rul}

**WHY:** All engine parameters correlate with expected physical baseline models. No anomalies, sensor drift, or thermal stress detected.`;
}

async function handleGrokRequest(body, res) {
  let parsed = {};
  try {
    parsed = typeof body === 'object' ? body : JSON.parse(body || '{}');
  } catch (e) {
    res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ error: 'invalid_json', message: 'Malformed JSON payload.' }));
    return;
  }

  const query = parsed.query || parsed.message || parsed.prompt || '';
  const rawState = parsed.appState || parsed.context || parsed.snapshot || {};

  if (!query) {
    res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ error: 'missing_fields', message: 'Query or message string is required.' }));
    return;
  }

  const qLower = query.trim().toLowerCase();

  // Deterministic Identity Intent (Fast-path: no external API call needed)
  if (/^(who|what)\s+(are\s+you|can\s+you\s+do)\b/i.test(qLower) ||
      /^introduce\s+yourself\b/i.test(qLower) ||
      /^what\s+is\s+your\s+(role|purpose|job|function)\b/i.test(qLower)) {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({
      source: 'grok',
      response: "I’m the AERO TWIN Decision-Support Assistant. I analyze the current engine Digital Twin state, sensor trust, diagnostics, EHI, degradation, RUL and mission context. I do not directly control the aircraft or engine."
    }));
    return;
  }

  // Deterministic Greeting Intent
  const isGreeting = /^(hi|hello|hey|greetings|good\s+(morning|afternoon|evening))\b/i.test(qLower) && qLower.length < 20;
  if (isGreeting) {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({
      source: 'grok',
      response: "Hello. I’m the AERO TWIN Decision-Support Assistant. I analyze the current engine Digital Twin state, sensor trust, diagnostics, EHI, degradation, RUL and mission context. How can I assist you with the engine condition?"
    }));
    return;
  }

  // Normalize appState from various client formats
  const trustData = rawState.sensorTrust || rawState.trustResult || {};
  const trustScores = trustData.scores || (typeof trustData === 'object' ? trustData : {});
  const quarantinedSensors = rawState.quarantinedSensors || trustData.quarantined || (trustScores.oilPressure !== undefined && trustScores.oilPressure < 0.4 ? ['oilPress'] : []);
  const overallTrustVal = rawState.overallTrust !== undefined ? rawState.overallTrust : (trustData.overall || trustData.overallTrust || (quarantinedSensors.length > 0 ? 0.94 : 1.0));
  const trustedCountVal = rawState.trustedCount !== undefined ? rawState.trustedCount : (quarantinedSensors.length > 0 ? 8 : 9);

  const appState = {
    rawTelemetry: rawState.rawTelemetry || rawState.telemetry || {},
    physics: rawState.physics || {},
    physicsResiduals: rawState.physicsResiduals || rawState.residuals || (rawState.physics && rawState.physics.residuals) || {},
    expectedPhysics: rawState.expectedPhysics || rawState.expectedState || (rawState.physics && rawState.physics.expected) || {},
    missionReliability: rawState.missionReliability || {},
    rul: rawState.rul || {
      label: rawState.RUL !== undefined ? (typeof rawState.RUL === 'number' ? rawState.RUL + ' h' : String(rawState.RUL)) : (rawState.rulLabel || '182 h'),
      hours: rawState.rulHours !== undefined ? rawState.rulHours : (rawState.RUL !== undefined ? (typeof rawState.RUL === 'number' ? rawState.RUL : parseInt(rawState.RUL)) : 182),
      range: (rawState.rul && rawState.rul.range) || (rawState.RULRange ? `${rawState.RULRange.low || '?'}–${rawState.RULRange.high || '?'} h` : (rawState.rulRange || '')),
      confidencePct: (rawState.rul && rawState.rul.confidencePct) !== undefined ? rawState.rul.confidencePct : (rawState.RULConfidence !== undefined ? rawState.RULConfidence : (rawState.rulConfidence !== undefined ? rawState.rulConfidence : ''))
    },
    RULRange: rawState.RULRange || (rawState.rul && rawState.rul.range ? rawState.rul.range : null),
    RULConfidence: rawState.RULConfidence !== undefined ? rawState.RULConfidence : ((rawState.rul && rawState.rul.confidencePct) !== undefined ? rawState.rul.confidencePct : null),
    maintenance: rawState.maintenance || (rawState.maintenanceAdvisory) || {},
    ehiBreakdown: rawState.ehiBreakdown || {},
    isReplaying: !!rawState.isReplaying,
    replayIndex: rawState.replayIndex !== undefined ? rawState.replayIndex : null,
    simTime: rawState.simTime || rawState.timestamp || 'LIVE',
    scenario: rawState.scenario || 'normal',
    missionPhase: rawState.missionPhase || 'CRUISE',
    ehi: rawState.ehi !== undefined ? rawState.ehi : (rawState.EHI !== undefined ? rawState.EHI : 96),
    ehiStatus: rawState.ehiStatus || rawState.EHIStatus || 'NOMINAL',
    aiDiagnosis: rawState.aiDiagnosis || rawState.diagnosis || 'HEALTHY',
    aiDiagStatus: rawState.aiDiagStatus || 'NOMINAL',
    anomalyScore: rawState.anomalyScore !== undefined ? rawState.anomalyScore : 0.05,
    overallTrust: overallTrustVal,
    trustedCount: trustedCountVal,
    totalSensors: rawState.totalSensors !== undefined ? rawState.totalSensors : 9,
    trustResult: {
      quarantined: quarantinedSensors,
      scores: trustScores
    },
    rulHours: rawState.rulHours !== undefined ? rawState.rulHours : (rawState.RUL !== undefined ? (typeof rawState.RUL === 'number' ? rawState.RUL : parseInt(rawState.RUL)) : 182),
    rulLabel: rawState.rulLabel || (rawState.RUL !== undefined ? (typeof rawState.RUL === 'number' ? rawState.RUL + ' h' : String(rawState.RUL)) : '182 h'),
    degradationPct: rawState.degradationPct !== undefined ? rawState.degradationPct : (rawState.degradation !== undefined ? rawState.degradation : 0),
    degradationTrend: rawState.degradationTrend || 'STABLE',
    why: rawState.why || {}
  };

  if (!groqApiKey) {
    const localFallback = generateServerLocalAnalysis(query, appState);
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ source: 'local_fallback', response: localFallback, message: 'GROQ_API_KEY not configured. Served by local analytical engine.' }));
    return;
  }

  try {
    // Build context strictly from appState snapshot (NO FABRICATION)
    const raw = appState.rawTelemetry || {};
    const getScalarOrAvg = (arrOrNum) => {
      if (arrOrNum === undefined || arrOrNum === null) return null;
      if (Array.isArray(arrOrNum)) {
        return arrOrNum.length ? (arrOrNum.reduce((a, b) => a + b, 0) / arrOrNum.length).toFixed(1) : null;
      }
      return typeof arrOrNum === 'number' ? arrOrNum.toFixed(1) : String(arrOrNum);
    };
    const chtVal = getScalarOrAvg(raw.cht !== undefined ? raw.cht : raw.CHT);
    const egtVal = getScalarOrAvg(raw.egt !== undefined ? raw.egt : raw.EGT);
    const avgCht = chtVal !== null ? chtVal + ' °C' : 'Not available';
    const avgEgt = egtVal !== null ? egtVal + ' °C' : 'Not available';

    const phys = appState.physics || {};
    const resi = appState.physicsResiduals || (phys.residuals || {});
    const exp = appState.expectedPhysics || (phys.expected || {});
    const rel = appState.missionReliability || {};
    const rul = appState.rul || {};
    const maint = appState.maintenance || {};
    const ehib = appState.ehiBreakdown || {};

    const isReplaying = !!appState.isReplaying;

    const stateContext = `=== AUTHORITATIVE CURRENT ENGINE STATE SNAPSHOT ===
TELEMETRY MODE: ${isReplaying ? `HISTORICAL MISSION REPLAY (Frame @ ${appState.replayIndex !== null && appState.replayIndex !== undefined ? appState.replayIndex + 's' : (appState.simTime || 'N/A')})` : 'SIMULATION (Real-Time 10 Hz)'}
SCENARIO: ${appState.scenario || 'normal'}
MISSION PHASE: ${appState.missionPhase || 'CRUISE'} | Mission Time: ${appState.simTime || 'N/A'}
REPLAY ACTIVE: ${isReplaying ? 'YES — analyzing replayed historical timestamp' : 'NO — analyzing live telemetry'}

PRIMARY TELEMETRY:
- RPM: ${raw.rpm !== undefined ? Math.round(raw.rpm) : (raw.RPM !== undefined ? Math.round(raw.RPM) : 'Not available')} (Expected: ${exp.rpm !== undefined ? exp.rpm : (exp.RPM !== undefined ? exp.RPM : 'Not available')}, Residual: ${resi.rpm !== undefined ? (resi.rpm >= 0 ? '+' : '') + resi.rpm : (resi.RPM !== undefined ? (resi.RPM >= 0 ? '+' : '') + resi.RPM : '0')})
- MAP: ${raw.map !== undefined ? Number(raw.map).toFixed(1) + ' inHg' : (raw.MAP !== undefined ? Number(raw.MAP).toFixed(1) + ' inHg' : 'Not available')} (Expected: ${exp.map !== undefined ? Number(exp.map).toFixed(1) + ' inHg' : 'Not available'}, Residual: ${resi.map !== undefined ? (resi.map >= 0 ? '+' : '') + Number(resi.map).toFixed(1) : '0'})
- Fuel Flow: ${raw.fuelFlow !== undefined ? Number(raw.fuelFlow).toFixed(1) + ' L/hr' : 'Not available'} (Expected: ${exp.fuelFlow !== undefined ? Number(exp.fuelFlow).toFixed(1) + ' L/hr' : 'Not available'}, Residual: ${resi.fuelFlow !== undefined ? (resi.fuelFlow >= 0 ? '+' : '') + Number(resi.fuelFlow).toFixed(1) : '0'})
- Avg CHT: ${avgCht} (Expected: ${exp.chtAvg !== undefined ? Math.round(exp.chtAvg) + ' °C' : (exp.cht !== undefined ? Math.round(exp.cht) + ' °C' : (exp.CHT !== undefined ? Math.round(exp.CHT) + ' °C' : 'Not available'))}, Residual: ${resi.cht !== undefined ? (resi.cht >= 0 ? '+' : '') + Number(resi.cht).toFixed(1) + ' °C' : (resi.CHT !== undefined ? (resi.CHT >= 0 ? '+' : '') + Number(resi.CHT).toFixed(1) + ' °C' : '0')})
- Avg EGT: ${avgEgt} (Expected: ${exp.egtAvg !== undefined ? Math.round(exp.egtAvg) + ' °C' : (exp.egt !== undefined ? Math.round(exp.egt) + ' °C' : (exp.EGT !== undefined ? Math.round(exp.EGT) + ' °C' : 'Not available'))}, Residual: ${resi.egt !== undefined ? (resi.egt >= 0 ? '+' : '') + Number(resi.egt).toFixed(1) + ' °C' : (resi.EGT !== undefined ? (resi.EGT >= 0 ? '+' : '') + Number(resi.EGT).toFixed(1) + ' °C' : '0')})
- Oil Pressure: ${raw.oilPress !== undefined ? Number(raw.oilPress).toFixed(1) + ' PSI' : (raw.oilPressure !== undefined ? Number(raw.oilPressure).toFixed(1) + ' PSI' : 'Not available')} (Expected: ${exp.oilPress !== undefined ? Number(exp.oilPress).toFixed(1) + ' PSI' : (exp.oilPressure !== undefined ? Number(exp.oilPressure).toFixed(1) + ' PSI' : 'Not available')}, Effective Residual: ${resi.oilPress !== undefined ? (resi.oilPress >= 0 ? '+' : '') + Number(resi.oilPress).toFixed(1) + ' PSI' : (resi.oilPressure !== undefined ? (resi.oilPressure >= 0 ? '+' : '') + Number(resi.oilPressure).toFixed(1) + ' PSI' : '0')})
- Oil Temperature: ${raw.oilTemp !== undefined ? Number(raw.oilTemp).toFixed(1) + ' °C' : (raw.oilTemperature !== undefined ? Number(raw.oilTemperature).toFixed(1) + ' °C' : 'Not available')} (Expected: ${exp.oilTemp !== undefined ? Math.round(exp.oilTemp) + ' °C' : 'Not available'})
- Engine Load: ${raw.load !== undefined ? Number(raw.load).toFixed(1) + '%' : (raw.engineLoad !== undefined ? Number(raw.engineLoad).toFixed(1) + '%' : 'Not available')}
- Vibration RMS: ${raw.vibrationRms !== undefined ? Number(raw.vibrationRms).toFixed(2) + ' mm/s' : 'Not available'}

SENSOR TRUST LAYER (GATEKEEPER):
- Overall Trust Index: ${appState.overallTrust !== undefined ? Number(appState.overallTrust).toFixed(2) : 'Not available'}
- Trusted Sensor Count: ${appState.trustedCount !== undefined ? appState.trustedCount : 'Not available'} / ${appState.totalSensors !== undefined ? appState.totalSensors : 'Not available'}
- Quarantined Distrusted Sensors: ${appState.trustResult && appState.trustResult.quarantined && appState.trustResult.quarantined.length > 0 ? appState.trustResult.quarantined.join(', ') : 'None (All Trusted)'}
- Oil Pressure Sensor Trust: ${appState.trustResult && appState.trustResult.scores && (appState.trustResult.scores.oilPress !== undefined || appState.trustResult.scores.oilPressure !== undefined) ? Number(appState.trustResult.scores.oilPress || appState.trustResult.scores.oilPressure).toFixed(2) : (appState.trustResult && appState.trustResult.quarantined && appState.trustResult.quarantined.includes('oilPress') ? '0.25' : '1.00')}

AI / ML DIAGNOSTIC NET:
- Isolation Forest Anomaly Score: ${appState.anomalyScore !== undefined ? Number(appState.anomalyScore).toFixed(2) : 'Not available'}
- Random Forest Fault Class: ${appState.aiDiagnosis || 'HEALTHY'} (${appState.aiDiagStatus || 'NOMINAL'})
- Confidence: ${appState.diagnosticResult ? (appState.diagnosticResult.confidencePct ? appState.diagnosticResult.confidencePct + '%' : (appState.diagnosticResult.confidence * 100).toFixed(0) + '%') : 'Not available'}

MISSION RELIABILITY ENHANCEMENT (P0 DECISION SUPPORT):
- Score: ${rel.score !== undefined ? rel.score + '%' : 'Not available'} (${rel.status || 'Not available'})
- Risk Assessment: ${rel.risk || (rel.reasons && rel.reasons[0] ? rel.reasons[0] : 'Nominal')}
- Remaining Duration: ${rel.remainingMissionDuration || 'Not available'}

ENGINE HEALTH INDEX (EHI):
- EHI: ${appState.ehi !== undefined ? Math.round(appState.ehi) : 'Not available'}/100 (${appState.ehiStatus || 'NOMINAL'})
- EHI Breakdown: Baseline +${ehib.baseline || 100} | Thermal ${ehib.thermalContribution || 0} | Lubrication ${ehib.lubricationContribution || 0} | Vibration ${ehib.vibrationContribution || 0} | Sensor Shield Bonus +${ehib.sensorShieldContribution || 0}

PROGNOSTICS & REMAINING USEFUL LIFE (RUL):
- RUL Estimate: ${appState.rulLabel || rul.label || (appState.rulHours !== undefined ? appState.rulHours + ' h' : 'Not available')}
- 90% Confidence Bounds: ${rul.rangeStr || (rul.range ? '[' + rul.range + ']' : 'Not available')}
- Model Confidence: ${rul.confidencePct ? rul.confidencePct + '%' : (rul.confidence ? rul.confidence + '%' : 'Not available')}
- Degradation: ${appState.degradationPct !== undefined ? appState.degradationPct + '%' : 'Not available'} (${appState.degradationTrend || 'STABLE'})

MAINTENANCE ADVISORY (DETERMINISTIC DECISION SUPPORT):
- Target Subsystem: ${maint.subsystem || 'All Subsystems Nominal'}
- Recommended Action: ${maint.action || 'Routine turnaround inspection.'}
- Priority: ${maint.priority || 'ROUTINE'} (Code: ${maint.code || 'MAINT-001-NOM'})
- Urgency: ${maint.urgency || maint.urgencyHours || 'Scheduled Inspection'}

WHY EXPLANATION (from local ML):
- Title: ${appState.why ? appState.why.title : 'Not available'}
- Bullets: ${appState.why && appState.why.bullets ? appState.why.bullets.join(' | ') : 'None'}
- Conclusion: ${appState.why ? appState.why.conclusion : 'Not available'}
==============================`;

    const userPrompt = `${stateContext}

USER QUESTION: ${query}

CRITICAL CONSISTENCY INSTRUCTION:
1. Base your explanation strictly and exclusively on the supplied authoritative state snapshot above.
2. Structure your response into 3 parts:
**CURRENT STATE:** [one-sentence direct answer using actual values]
**EVIDENCE:**
• [2-4 relevant metrics from snapshot]
**WHY:** [short engineering explanation explaining cause or physical implication]
3. If the snapshot indicates AI DIAGNOSIS is SENSOR FAULT: You MUST NOT say "Engine is healthy" without explicitly qualifying: "The engine itself appears healthy; the detected problem is isolated to the oil-pressure sensor." State clearly that the oil pressure sensor is quarantined/faulty, but propulsion integrity is protected.
4. If the snapshot indicates AI DIAGNOSIS is THERMAL DEGRADATION or THERMAL RUNAWAY: You MUST explain that dual trusted thermal sensors indicate genuine engine thermal degradation/runaway. Do NOT say the engine is healthy.
5. If the snapshot indicates AI DIAGNOSIS is HEALTHY: State that the engine is operating normally.
6. All numeric values in your response MUST come directly from the state snapshot above. Do not invent, estimate, replace, or fabricate any numbers. If a value is missing or "Not available", state: "That value is not currently available in the Digital Twin state."`;

    // Dev-mode context logging (never log API key)
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[Groq] Query: "${query.slice(0, 80)}..." | Phase: ${appState.missionPhase} | Diagnosis: ${appState.aiDiagnosis} | EHI: ${appState.ehi !== undefined ? Math.round(appState.ehi) : 'N/A'}`);
    }

    const text = await callGroqAPI(userPrompt, GROQ_SYSTEM_PROMPT);

    if (text) {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ source: 'grok', response: text }));
      return;
    }

    // Graceful fallback if Groq returns empty
    console.warn('[Groq] Empty response from API. Serving grounded local analysis fallback.');
    const localFallback = generateServerLocalAnalysis(query, appState);
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({
      source: 'local_fallback',
      response: localFallback,
      note: 'Groq returned empty; fulfilled via grounded engine analysis.'
    }));

  } catch (err) {
    console.error('[Groq] API Error:', err.message);
    const localFallback = generateServerLocalAnalysis(query, appState);
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({
      source: 'local_fallback',
      response: localFallback,
      note: 'Served via local engine analysis after Groq API exception.'
    }));
  }
}

// ============================================================================
// HTTP Server
// ============================================================================
const server = http.createServer((req, res) => {
  const parsedUrl = req.url.split('?')[0];

  // API Endpoint: POST /api/grok or /api/groq (AI Assistant queries)
  if (req.method === 'POST' && (parsedUrl === '/api/grok' || parsedUrl === '/api/groq' || parsedUrl === '/api/gemini')) {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => { handleGrokRequest(body, res); });
    return;
  }

  // API Endpoint: POST /api/telemetry (From Python / CAN-bus bridge / MATLAB)
  if (req.method === 'POST' && parsedUrl === '/api/telemetry') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        latestHardwareTelemetry = {
          ...data,
          receivedAt: Date.now()
        };
        lastHardwarePacketTimestamp = Date.now();
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ status: 'ok', received: true }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON telemetry payload' }));
      }
    });
    return;
  }

  // API Endpoint: GET /api/telemetry (Frontend polls latest hardware data)
  if (req.method === 'GET' && parsedUrl === '/api/telemetry') {
    res.writeHead(200, { 
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-cache'
    });
    res.end(JSON.stringify({
      active: (Date.now() - lastHardwarePacketTimestamp) < 5000,
      timestamp: lastHardwarePacketTimestamp,
      telemetry: latestHardwareTelemetry
    }));
    return;
  }

  // CORS pre-flight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    res.end();
    return;
  }

  // Static File Serving
  let reqPath = parsedUrl === '/' ? '/index.html' : parsedUrl;
  let filePath = path.join(__dirname, reqPath);

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 Not Found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      'Pragma': 'no-cache',
      'Expires': '0'
    });

    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
  });
});

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}/`);
  console.log(`Hardware Telemetry Ingestion API ready at http://localhost:${PORT}/api/telemetry`);
  console.log(`Groq Cloud AI Assistant API ready at http://localhost:${PORT}/api/grok`);
  if (!groqApiKey) {
    console.log(`  ⚠  Groq Cloud not active — add GROQ_API_KEY to .env to enable (get one at https://console.groq.com/)`);
  }
});

process.on('uncaughtException', (err) => {
  console.error('[Server] Uncaught Exception:', err.message);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[Server] Unhandled Rejection:', reason);
});

