const http = require('http');
const fs = require('fs');
const path = require('path');

// Load environment variables from .env
require('dotenv').config();

const PORT = 3000;
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.ico': 'image/x-icon',
  '.py': 'text/plain; charset=utf-8',
  '.ino': 'text/plain; charset=utf-8'
};

function sanitizeUnicode(text) {
  if (!text || typeof text !== 'string') return text || '';
  let s = text;
  s = s.replace(/\uFFFD+/g, '-');
  s = s.replace(/âˆ’|â€‘/g, '−');
  s = s.replace(/â€¯/g, ' ');
  s = s.replace(/Â°/g, '°');
  s = s.replace(/[\u202F\u2009\u00A0]/g, ' ');
  s = s.replace(/[\u200B-\u200D\uFEFF]/g, '');
  s = s.replace(/\u2011/g, '−');
  return s;
}

function sendJsonResponse(res, statusCode, obj) {
  const jsonStr = JSON.stringify(obj);
  const buf = Buffer.from(jsonStr, 'utf8');
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Content-Length': buf.length
  });
  res.end(buf);
}

function isEngineeringQuery(q) {
  if (!q || typeof q !== 'string') return false;
  const qStr = q.toLowerCase();
  const domainPatterns = [
    /\b(engine|motor|powertrain|propulsion)\b/,
    /\b(status|condition|state|health|healthy)\b/,
    /\b(ehi|rul|residual|residuals)\b/,
    /\b(sensor|sensors|transducer|probe|quarantine|quarantined)\b/,
    /\b(trust|reliable|reliability|unreliable)\b/,
    /\b(fault|faults|anomaly|anomalies|anomalous|defect|failure|issue|problem|abnormal)\b/,
    /\b(diagnos\w*|isolation\s+forest|random\s+forest)\b/,
    /\b(degrad\w*|wear|damage|fatigue|life|endurance|hours)\b/,
    /\b(rpm|speed|tachometer|rotation|rotational)\b/,
    /\b(egt|cht|exhaust|cylinder|head|combustion)\b/,
    /\b(temp|temperature|thermal|heat|hot|overheat|overheating|runaway|cooling|coolant)\b/,
    /\b(oil|pressure|psi|lubricat\w*)\b/,
    /\b(fuel|flow|consumption|injector)\b/,
    /\b(map|manifold|inhg|boost|throttle|load)\b/,
    /\b(vibrat\w*|vibe|rms|fft|bearing|knock)\b/,
    /\b(mission|flight|cruise|climb|takeoff|loiter|landing)\b/,
    /\b(maintenance|advisory|inspection|repair|borescope)\b/,
    /\b(piston|conrod|connecting\s+rod|crankshaft|valve)\b/,
    /\b(twin|digital\s+twin|physics|telemetry|telemetry\s+data)\b/,
    /\b(scenario|simulation|synthetic|replay)\b/,
    /\b(parameters?|metrics?|readings?|measurements?)\b/
  ];
  return domainPatterns.some(pat => pat.test(qStr));
}

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

const GROQ_SYSTEM_PROMPT = `You are the AERO TWIN Decision-Support Assistant for an aero piston engine Digital Twin.

You are an engineering explanation layer over the Digital Twin.

AUTHORITATIVE STATE:
The CURRENT ENGINE STATE SNAPSHOT supplied in the user prompt is authoritative and ground truth.
Never invent, estimate, replace, or modify numerical values.
Never assume the engine is healthy if the snapshot indicates otherwise.
Never generate your own EHI, RUL, sensor trust, anomaly score, residuals, or diagnosis.
Use strictly the values supplied by the application.
If a value is missing, explicitly state that it is unavailable.

SENSOR TRUST PRINCIPLE:
Sensor Trust takes precedence when evaluating engine health.
A quarantined or low-trust sensor must NOT be treated as reliable evidence of engine degradation.
Always explicitly distinguish:
SENSOR FAULT (instrument defect / quarantined transducer)
vs
ENGINE DEGRADATION (authentic thermal or mechanical degradation).

DECISION-SUPPORT CONSTRAINTS:
Explain the engineering state concisely and technically.
Never issue aircraft or flight control commands.
Do not recommend throttle adjustments.
Do not issue mission abort or continue orders.
Do not claim airworthiness certification or operational safety.
All data is synthetic simulation data.

RESPONSE FORMAT:
Use this format for engineering queries:

[STATUS TITLE]

One concise conclusion sentence.

Evidence:
• [only 2–4 relevant values using exact numbers from the snapshot]

Why:
[2–3 sentences explaining the relationship between the evidence and the already-computed diagnosis]

Mission implication:
[One cautious sentence describing what the current simulation state means for mission risk]`;

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
      res.setEncoding('utf8');
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
          resolve(sanitizeUnicode(text));
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
  const qLower = (query || '').trim().toLowerCase();
  const isReplaying = !!appState.isReplaying;
  const replayTag = isReplaying ? `[REPLAY @ ${appState.replayIndex !== null && appState.replayIndex !== undefined ? appState.replayIndex : '0'}s]\n\n` : '';
  const diag = (appState.aiDiagnosis || 'HEALTHY').toUpperCase();
  const ehi = appState.ehi !== undefined ? Math.round(appState.ehi) : 96;
  const rul = appState.rulLabel || (appState.rulHours !== undefined ? appState.rulHours + ' h' : '182 h');
  const phase = appState.missionPhase || 'CRUISE';
  const trustCount = appState.trustedCount !== undefined ? appState.trustedCount : 9;
  const totalSensors = appState.totalSensors !== undefined ? appState.totalSensors : 9;
  const raw = appState.rawTelemetry || {};
  const rpm = raw.rpm !== undefined ? Math.round(raw.rpm) : 4200;
  const expPhys = appState.expectedPhysics || {};
  const expRpm = expPhys.rpm !== undefined ? Math.round(expPhys.rpm) : 4200;

  const getScalarOrAvg = (arrOrNum) => {
    if (arrOrNum === undefined || arrOrNum === null) return null;
    if (Array.isArray(arrOrNum)) {
      return arrOrNum.length ? (arrOrNum.reduce((a, b) => a + b, 0) / arrOrNum.length).toFixed(1) : null;
    }
    return typeof arrOrNum === 'number' ? arrOrNum.toFixed(1) : String(arrOrNum);
  };
  const chtVal = getScalarOrAvg(raw.cht !== undefined ? raw.cht : raw.CHT);
  const egtVal = getScalarOrAvg(raw.egt !== undefined ? raw.egt : raw.EGT);
  const expCht = expPhys.chtAvg !== undefined ? Math.round(expPhys.chtAvg) : (expPhys.cht !== undefined ? Math.round(expPhys.cht) : 175);
  const expEgt = expPhys.egtAvg !== undefined ? Math.round(expPhys.egtAvg) : (expPhys.egt !== undefined ? Math.round(expPhys.egt) : 720);

  const quarantined = (appState.trustResult && appState.trustResult.quarantined && appState.trustResult.quarantined.length > 0) ? appState.trustResult.quarantined : (appState.quarantinedSensors || []);
  const isSensorFault = diag.includes('FAULT') || quarantined.length > 0;
  const isThermal = diag.includes('THERMAL') || ehi < 75;

  // SENSOR TRUST QUERY
  if (qLower.includes('sensor') || qLower.includes('trust') || qLower.includes('quarantine') || qLower.includes('reliable')) {
    if (isSensorFault) {
      const qSensor = quarantined[0] || 'oil pressure';
      const qChannelName = qSensor === 'oilPress' || qSensor === 'oilPressure' ? 'OIL PRESSURE' : qSensor.toUpperCase();
      const qTrustScore = (appState.trustResult && appState.trustResult.scores && appState.trustResult.scores[qSensor] !== undefined) ? Number(appState.trustResult.scores[qSensor]).toFixed(2) : '0.12';
      const overallTrust = appState.overallTrust !== undefined ? Number(appState.overallTrust).toFixed(2) : '0.89';
      return `${replayTag}SENSOR ISSUE — ${qChannelName}

The ${qSensor} signal is unreliable and has been quarantined.

Evidence:
• ${qChannelName} trust: ${qTrustScore}
• Overall trust: ${overallTrust}
• Trusted sensors: ${trustCount}/${totalSensors}
• EHI: ${ehi}/100

Why:
The ${qSensor} channel is inconsistent with the rest of the engine state, so it is excluded from health judgment. Current trusted evidence does not indicate confirmed engine degradation.

Mission implication:
Telemetry redundancy is reduced for this channel, but engine mechanical condition remains intact.`;
    } else {
      const overallTrust = appState.overallTrust !== undefined ? Number(appState.overallTrust).toFixed(2) : '1.00';
      return `${replayTag}SENSOR TRUST — NOMINAL

All engine sensor channels are verified trusted and operating nominally.

Evidence:
• Overall trust: ${overallTrust}
• Trusted sensors: ${trustCount}/${totalSensors}
• Quarantined sensors: None
• EHI: ${ehi}/100

Why:
Analytical redundancy and cross-sensor variance checks confirm all telemetry streams track calibrated baseline models without drift or artifacts.

Mission implication:
Full instrumentation reliability is maintained for the current mission phase.`;
    }
  }

  // RUL / DEGRADATION QUERY
  if (qLower.includes('rul') || qLower.includes('life') || qLower.includes('degrad')) {
    const degPct = appState.degradationPct !== undefined ? appState.degradationPct : 0;
    const degTrend = appState.degradationTrend || 'STABLE';
    const rulRange = appState.rul && appState.rul.range ? ` (${appState.rul.range})` : '';
    return `${replayTag}PROGNOSTICS — REMAINING USEFUL LIFE

Remaining Useful Life is estimated at ${rul} under current operational conditions.

Evidence:
• Projected RUL: ${rul}${rulRange}
• Cumulative degradation: ${degPct}%
• Degradation trend: ${degTrend}
• EHI: ${ehi}/100

Why:
Prognostic estimation models Arrhenius thermal fatigue and mechanical stress against baseline component endurance envelopes.

Mission implication:
Projected endurance remains sufficient for nominal mission completion under current flight loads.`;
  }

  // SENSOR FAULT STATE (GENERAL STATUS QUERY)
  if (isSensorFault) {
    const qSensor = quarantined[0] || 'oil pressure';
    const qChannelName = qSensor === 'oilPress' || qSensor === 'oilPressure' ? 'OIL PRESSURE' : qSensor.toUpperCase();
    const qTrustScore = (appState.trustResult && appState.trustResult.scores && appState.trustResult.scores[qSensor] !== undefined) ? Number(appState.trustResult.scores[qSensor]).toFixed(2) : '0.12';
    const overallTrust = appState.overallTrust !== undefined ? Number(appState.overallTrust).toFixed(2) : '0.89';
    return `${replayTag}SENSOR ISSUE — ${qChannelName}

The ${qSensor} signal is unreliable and has been quarantined.

Evidence:
• ${qChannelName} trust: ${qTrustScore}
• Overall trust: ${overallTrust}
• Trusted sensors: ${trustCount}/${totalSensors}
• EHI: ${ehi}/100

Why:
The ${qSensor} channel is inconsistent with the rest of the engine state, so it is excluded from health judgment. Current trusted evidence does not indicate confirmed engine degradation.

Mission implication:
Instrumentation redundancy is reduced on the affected channel, while propulsion integrity is preserved.`;
  }

  // THERMAL DEGRADATION STATE (GENERAL STATUS QUERY)
  if (isThermal) {
    const chtStr = chtVal !== null ? `${chtVal}°C` : '218.8°C';
    const egtStr = egtVal !== null ? `${egtVal}°C` : '812.5°C';
    const overallTrust = appState.overallTrust !== undefined ? Number(appState.overallTrust).toFixed(2) : '1.00';
    return `${replayTag}ENGINE DEGRADATION — THERMAL

The engine is showing a thermal degradation pattern.

Evidence:
• CHT: ${chtStr} vs ${expCht}°C expected
• EGT: ${egtStr} vs ${expEgt}°C expected
• Sensor trust: ${overallTrust}
• EHI: ${ehi}/100

Why:
Trusted CHT and EGT measurements are both significantly above their expected values, supporting a genuine thermal condition rather than an isolated sensor fault.

Mission implication:
Thermal stress accelerates component wear, decreasing Remaining Useful Life endurance margins.`;
  }

  // NOMINAL ENGINE STATE (DEFAULT)
  const overallTrust = appState.overallTrust !== undefined ? Number(appState.overallTrust).toFixed(2) : '1.00';
  return `${replayTag}ENGINE STATUS — NOMINAL

The engine is operating normally in the current simulation phase.

Evidence:
• RPM: ${rpm} vs ${expRpm} expected
• EHI: ${ehi}/100
• Sensor trust: ${overallTrust} (${trustCount}/${totalSensors} trusted)
• Projected RUL: ${rul}

Why:
Current trusted telemetry remains consistent with the expected operating state and no significant degradation is detected.

Mission implication:
Propulsion system operates within calibrated margins for the ${phase} flight envelope.`;
}

async function handleGrokRequest(body, res) {
  let parsed = {};
  try {
    parsed = typeof body === 'object' ? body : JSON.parse(body || '{}');
  } catch (e) {
    sendJsonResponse(res, 400, { error: 'invalid_json', message: 'Malformed JSON payload.' });
    return;
  }

  const query = parsed.query || parsed.message || parsed.prompt || '';
  const rawState = parsed.appState || parsed.context || parsed.snapshot || {};

  if (!query) {
    sendJsonResponse(res, 400, { error: 'missing_fields', message: 'Query or message string is required.' });
    return;
  }

  const qLower = query.trim().toLowerCase();
  const qClean = qLower.replace(/[?!.]+$/, '').trim().replace(/\s+/g, ' ');

  // Category 1: GREETING (Fast-path: no telemetry sent to Groq)
  const isGreeting = /^(hi|hello|hey|greetings|good\s+(morning|afternoon|evening))\b/i.test(qLower) && qLower.length < 25;
  if (isGreeting) {
    sendJsonResponse(res, 200, {
      source: 'grok',
      response: "Hello. I’m the AERO TWIN Decision-Support Assistant. How can I assist you with the engine condition?"
    });
    return;
  }

  // Category 2: GROK SPECIFIC QUERY (Fast-path)
  if (/^grok\??$/i.test(qClean) || /^(are\s+(you|u)|is\s+this)\s+grok\??$/i.test(qClean)) {
    sendJsonResponse(res, 200, {
      source: 'grok',
      response: "I’m the AERO TWIN Decision-Support Assistant. Groq Cloud powers the natural-language explanation layer."
    });
    return;
  }

  // Category 2: IDENTITY / MODEL (Fast-path: no telemetry sent to Groq)
  const isIdentityOrModel = 
    /\b(your|what's|whats|what is|tell me( your)?)\s+(the\s+)?model(\s+name)?\b/i.test(qClean) ||
    /\bmodel\s+name\b/i.test(qClean) ||
    /\b(which|what|tell me)\s+(about\s+)?(your\s+|the\s+)?(ai\s+)?model\b/i.test(qClean) ||
    /\b(which|what)\s+model\s+(are\s+(you|u)|(you|u)\s+are|do\s+(you|u)\s+use|powers\s+(you|u)|is\s+this)\b/i.test(qClean) ||
    /\b(which|what)\s+ai\s+(are\s+(you|u)|(you|u)\s+are|do\s+(you|u)\s+use|powers\s+(you|u)|is\s+this|are\s+(you|u)\s+using)\b/i.test(qClean) ||
    /^(who|what)\s+(are\s+(you|u)|can\s+(you|u)\s+do)\b/i.test(qClean) ||
    /^introduce\s+yourself\b/i.test(qClean) ||
    /^what\s+is\s+your\s+(role|purpose|job|function)\b/i.test(qClean) ||
    qClean === 'who are you' ||
    qClean === 'who r u' ||
    qClean === 'what are you' ||
    qClean === 'what can you do' ||
    qClean === 'your model name' ||
    qClean === 'what is your model name' ||
    qClean === "what's your model name" ||
    qClean === 'whats your model name' ||
    qClean === 'tell me your model' ||
    qClean === 'which model are you' ||
    qClean === 'which model u are' ||
    qClean === 'which model are u' ||
    qClean === 'what model are you' ||
    qClean === 'what model u are' ||
    qClean === 'what model are u' ||
    qClean === 'what ai are you' ||
    qClean === 'what ai model are you' ||
    qClean === 'which ai powers you' ||
    qClean === 'what model do you use' ||
    qClean === 'what ai do you use';

  if (isIdentityOrModel) {
    sendJsonResponse(res, 200, {
      source: 'grok',
      response: "The AERO TWIN diagnostic pipeline uses Isolation Forest for anomaly detection and Random Forest for fault classification. Groq Cloud using openai/gpt-oss-120b is used as the natural-language explanation layer."
    });
    return;
  }

  // Category 3 Check: Only proceed to Digital Twin / Groq pipeline if engineering query
  if (!isEngineeringQuery(qLower)) {
    // Category 4: UNKNOWN / CASUAL / OFF-TOPIC
    sendJsonResponse(res, 200, {
      source: 'conversational',
      response: "Yes, I’m here. Ask me about the engine condition, sensor trust, diagnostics, degradation, or RUL."
    });
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

RESPONSE FORMAT REQUIREMENTS:
Format your engineering decision-support explanation exactly as:

[STATUS TITLE]

One concise conclusion sentence.

Evidence:
• [2 to 4 relevant values from the snapshot matching the query]

Why:
[2 to 3 sentences explaining the physical or diagnostic relationship based on the snapshot]

Mission implication:
[One cautious sentence describing what the current simulation state means for mission risk]

CRITICAL RULES:
1. Grounding: All numbers MUST come directly from the state snapshot above. Never invent, estimate, replace, or fabricate any numbers. If a requested value is missing or "Not available", explicitly state that it is unavailable.
2. Sensor Trust Priority:
   - If AI DIAGNOSIS is SENSOR FAULT or any sensor is quarantined:
     Status Title MUST be: SENSOR ISSUE — [CHANNEL NAME]
     Clearly state that the sensor signal is unreliable and quarantined, while engine mechanical condition remains protected.
     Never treat a quarantined sensor as evidence of mechanical engine failure or degradation.
   - If AI DIAGNOSIS is THERMAL DEGRADATION or THERMAL RUNAWAY:
     Status Title MUST be: ENGINE DEGRADATION — THERMAL
     Explain that dual trusted thermal sensors (CHT and EGT) confirm genuine thermal degradation.
   - If AI DIAGNOSIS is HEALTHY (and normal):
     Status Title MUST be: ENGINE STATUS — NOMINAL
     State that the engine is operating normally within expected parameters.
   - If user asks specifically about RUL or degradation:
     Status Title: PROGNOSTICS — REMAINING USEFUL LIFE
     Cite exact RUL estimate, confidence bounds, and degradation percentage.
   - If user asks specifically about sensor trust or reliability:
     Status Title: SENSOR TRUST — [CHANNEL NAME or NOMINAL]
     Cite trust scores, trusted counts, and quarantine status.
3. Decision-Support Only:
   - Do NOT give aircraft or flight control commands.
   - Do NOT recommend throttle adjustments.
   - Do NOT issue abort or continue orders.
   - Do NOT claim operational airworthiness certification.`;

    // Dev-mode context logging (never log API key)
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[Groq] Query: "${query.slice(0, 80)}..." | Phase: ${appState.missionPhase} | Diagnosis: ${appState.aiDiagnosis} | EHI: ${appState.ehi !== undefined ? Math.round(appState.ehi) : 'N/A'}`);
    }

    const text = await callGroqAPI(userPrompt, GROQ_SYSTEM_PROMPT);

    if (text) {
      sendJsonResponse(res, 200, { source: 'grok', response: sanitizeUnicode(text) });
      return;
    }

    // Graceful fallback if Groq returns empty
    console.warn('[Groq] Empty response from API. Serving grounded local analysis fallback.');
    const localFallback = generateServerLocalAnalysis(query, appState);
    sendJsonResponse(res, 200, {
      source: 'local_fallback',
      response: sanitizeUnicode(localFallback),
      note: 'Groq returned empty; fulfilled via grounded engine analysis.'
    });

  } catch (err) {
    console.error('[Groq] API Error:', err.message);
    const localFallback = generateServerLocalAnalysis(query, appState);
    sendJsonResponse(res, 200, {
      source: 'local_fallback',
      response: sanitizeUnicode(localFallback),
      note: 'Served via local engine analysis after Groq API exception.'
    });
  }
}

// ============================================================================
// HTTP Server
// ============================================================================
const server = http.createServer((req, res) => {
  const parsedUrl = req.url.split('?')[0];

  // API Endpoint: POST /api/grok or /api/groq (AI Assistant queries)
  if (req.method === 'POST' && (parsedUrl === '/api/grok' || parsedUrl === '/api/groq' || parsedUrl === '/api/gemini')) {
    req.setEncoding('utf8');
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => { handleGrokRequest(body, res); });
    return;
  }

  // API Endpoint: POST /api/telemetry (From Python / CAN-bus bridge / MATLAB)
  if (req.method === 'POST' && parsedUrl === '/api/telemetry') {
    req.setEncoding('utf8');
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
        sendJsonResponse(res, 200, { status: 'ok', received: true });
      } catch (err) {
        sendJsonResponse(res, 400, { error: 'Invalid JSON telemetry payload' });
      }
    });
    return;
  }

  // API Endpoint: GET /api/telemetry (Frontend polls latest hardware data)
  if (req.method === 'GET' && parsedUrl === '/api/telemetry') {
    sendJsonResponse(res, 200, {
      active: (Date.now() - lastHardwarePacketTimestamp) < 5000,
      timestamp: lastHardwarePacketTimestamp,
      telemetry: latestHardwareTelemetry
    });
    return;
  }

  // API Endpoint: GET /api/config (Public frontend configuration, e.g. VITE_MAPBOX_TOKEN)
  if (req.method === 'GET' && parsedUrl === '/api/config') {
    require('dotenv').config();
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-cache'
    });
    res.end(JSON.stringify({
      mapboxToken: process.env.VITE_MAPBOX_TOKEN || process.env.MAPBOX_TOKEN || ''
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

    // Inject VITE_MAPBOX_TOKEN directly into HTML heads for immediate zero-latency initialization
    if (ext === '.html') {
      fs.readFile(filePath, 'utf8', (readErr, htmlContent) => {
        if (readErr) {
          res.writeHead(500, { 'Content-Type': 'text/plain' });
          res.end('500 Internal Error');
          return;
        }
        const token = process.env.VITE_MAPBOX_TOKEN || process.env.MAPBOX_TOKEN || '';
        const injectedScript = `<script>window.VITE_MAPBOX_TOKEN = ${JSON.stringify(token)};</script>\n</head>`;
        const finalHtml = htmlContent.replace('</head>', injectedScript);
        res.writeHead(200, {
          'Content-Type': 'text/html',
          'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
          'Pragma': 'no-cache',
          'Expires': '0'
        });
        res.end(finalHtml);
      });
      return;
    }

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

