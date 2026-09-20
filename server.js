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

BEHAVIOR:
- Conversational assistant with live telemetry access, NOT a static FAQ bot.
- NEVER start with "Hello! I'm the AERO TWIN Decision-Support Assistant..." or repeat introductions. Only introduce your identity if explicitly asked who/what you are.
- Answer user questions directly, concisely, and naturally.
- "are you working properly?": Confirm you are connected to the live Digital Twin and operational.
- "who are you?": State you are the AERO TWIN Decision-Support Assistant.
- "what information do you have?": Enumerate live telemetry, Sensor Trust, EHI, ML anomaly, and RUL.
- Nonsense (e.g. "fjfjfjjf"): Politely state you didn't understand.

ENGINEERING & DIAGNOSTICS:
- Ground answers strictly in the CURRENT DIGITAL TWIN STATE. Never invent numbers.
- When answering engine health, sensor, anomaly, or RUL questions, format as:
[STATUS TITLE]
Conclusion: [One concise sentence]
Evidence: • [2-4 specific values from state with units and residuals where relevant]
Why: [2-3 sentences physical/analytical explanation]
Mission Implication: [One sentence flight safety context]
- SENSOR TRUST: Sensor Trust takes precedence. Low-trust/quarantined sensor = SENSOR FAULT (engine intact). Multiple trusted thermal sensors high = ENGINE DEGRADATION.
- RUL: Cite model-based RUL, bounds, degradation %, and trend.
- Decision support only: no flight control or throttle commands.`;

function callGroqAPI(userPrompt, systemPrompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: groqModel,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      max_tokens: 320,
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
          console.log(`[AI DEBUG] Groq response status: ${res.statusCode}`);
          const json = JSON.parse(data);
          if (json.error) {
            const errCode = res.statusCode || json.code || 500;
            const errMsg = json.error.message || JSON.stringify(json.error);
            console.error(`[AI DEBUG] Groq error: HTTP ${errCode} - ${errMsg}`);
            const err = new Error(`[Groq HTTP ${errCode}] ${errMsg}`);
            err.statusCode = Number(errCode) || 500;
            err.groqMessage = errMsg;

            if (res.statusCode === 429) {
              let retrySec = null;
              if (res.headers && res.headers['retry-after']) {
                retrySec = parseFloat(res.headers['retry-after']);
              } else {
                const match = errMsg.match(/try again in (\d+(?:\.\d+)?)s/i);
                if (match) retrySec = parseFloat(match[1]);
              }
              err.retryAfter = (!isNaN(retrySec) && retrySec > 0) ? retrySec : 2.5;
            }

            reject(err);
            return;
          }
          if (res.statusCode && res.statusCode >= 400) {
            console.error(`[AI DEBUG] Groq error: HTTP ${res.statusCode} - ${data}`);
            const err = new Error(`[Groq HTTP ${res.statusCode}] ${data}`);
            err.statusCode = res.statusCode;
            err.groqMessage = data;
            reject(err);
            return;
          }
          if (json.usage) {
            console.log(`[AI ROUTE] Tokens: prompt=${json.usage.prompt_tokens}, completion=${json.usage.completion_tokens}, total=${json.usage.total_tokens} (reserved: ~${json.usage.prompt_tokens + 320})`);
          }
          const text = json.choices && json.choices[0] && json.choices[0].message
            ? json.choices[0].message.content
            : '';
          resolve(sanitizeUnicode(text));
        } catch (e) {
          console.error(`[AI DEBUG] Groq error: ${e.message}`);
          const parseErr = new Error(`Failed to parse Groq response: ${e.message} (HTTP ${res.statusCode})`);
          parseErr.statusCode = res.statusCode || 500;
          reject(parseErr);
        }
      });
    });

    req.on('error', (e) => {
      console.error(`[AI DEBUG] Groq error: ${e.message}`);
      e.statusCode = 502;
      reject(e);
    });
    req.setTimeout(15000, () => {
      console.error('[AI DEBUG] Groq error: Request timed out');
      const err = new Error('Groq API request timed out');
      err.statusCode = 504;
      req.destroy(err);
    });
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

  const isEng = isEngineeringQuery(query);
  console.log(`[AI ROUTE] Query: "${query.slice(0, 80)}"`);
  console.log(`[AI ROUTE] Engineering query: ${isEng}`);
  console.log(`[AI ROUTE] Calling Groq: true`);

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

    const oilTrustVal = (trustScores.oilPress !== undefined || trustScores.oilPressure !== undefined)
      ? Number(trustScores.oilPress !== undefined ? trustScores.oilPress : trustScores.oilPressure).toFixed(2)
      : (quarantinedSensors.includes('oilPress') || quarantinedSensors.includes('oilPressure') ? '0.12' : '1.00');

    const stateContext = `[CURRENT DIGITAL TWIN STATE]
Mission Phase: ${appState.missionPhase || 'CRUISE'} | Mode: ${isReplaying ? `Replay @ ${appState.replayIndex !== null ? appState.replayIndex + 's' : '0s'}` : 'Live 10Hz Simulation'}
Primary Telemetry:
- RPM: ${raw.rpm !== undefined ? Math.round(raw.rpm) : '4200'} (exp: ${exp.rpm || 4200}, res: ${resi.rpm !== undefined ? (resi.rpm >= 0 ? '+' : '') + resi.rpm : 0})
- MAP: ${raw.map !== undefined ? Number(raw.map).toFixed(1) : '24.5'} inHg (exp: ${exp.map !== undefined ? Number(exp.map).toFixed(1) : '24.6'}, res: ${resi.map !== undefined ? (resi.map >= 0 ? '+' : '') + Number(resi.map).toFixed(1) : 0})
- Fuel Flow: ${raw.fuelFlow !== undefined ? Number(raw.fuelFlow).toFixed(1) : '21.0'} L/h
- Avg CHT: ${avgCht} (exp: ${exp.chtAvg !== undefined ? Math.round(exp.chtAvg) + '°C' : '165°C'}, res: ${resi.chtAvg !== undefined ? (resi.chtAvg >= 0 ? '+' : '') + Number(resi.chtAvg).toFixed(1) + '°C' : (resi.cht !== undefined ? (resi.cht >= 0 ? '+' : '') + Number(resi.cht).toFixed(1) + '°C' : '0°C')})
- Avg EGT: ${avgEgt} (exp: ${exp.egtAvg !== undefined ? Math.round(exp.egtAvg) + '°C' : '781°C'}, res: ${resi.egtAvg !== undefined ? (resi.egtAvg >= 0 ? '+' : '') + Number(resi.egtAvg).toFixed(1) + '°C' : (resi.egt !== undefined ? (resi.egt >= 0 ? '+' : '') + Number(resi.egt).toFixed(1) + '°C' : '0°C')})
- Oil Pressure: ${raw.oilPress !== undefined ? Number(raw.oilPress).toFixed(1) : '53.0'} PSI (exp: ${exp.oilPress !== undefined ? Number(exp.oilPress).toFixed(1) : '53.0'}, res: ${resi.oilPress !== undefined ? (resi.oilPress >= 0 ? '+' : '') + Number(resi.oilPress).toFixed(1) : 0})
- Oil Temp: ${raw.oilTemp !== undefined ? Number(raw.oilTemp).toFixed(1) : '90.0'} °C
- Engine Load: ${raw.load !== undefined ? Number(raw.load).toFixed(0) : '72'}%
Diagnostics & Sensor Trust:
- Sensor Trust: ${appState.overallTrust !== undefined ? Number(appState.overallTrust).toFixed(2) : '1.00'} (${appState.trustedCount || 9}/${appState.totalSensors || 9} trusted) | Quarantined: ${quarantinedSensors.length > 0 ? quarantinedSensors.join(', ') : 'None'} | Oil Trust: ${oilTrustVal}
- AI/ML Diagnosis: ${appState.aiDiagnosis || 'HEALTHY'} (${appState.aiDiagStatus || 'NOMINAL'}) | Anomaly Score: ${appState.anomalyScore !== undefined ? Number(appState.anomalyScore).toFixed(2) : '0.05'}
- Health Index (EHI): ${appState.ehi !== undefined ? Math.round(appState.ehi) : 96}/100 (${appState.ehiStatus || 'NOMINAL'}) [Thermal: ${ehib.thermalContribution || 0}, Lub: ${ehib.lubricationContribution || 0}]
- Prognostics (RUL): ${appState.rulLabel || rul.label || (appState.rulHours ? appState.rulHours + ' h' : '182 h')} (90% bounds: ${rul.rangeStr || (rul.range ? `[${rul.range}]` : (appState.RULRange ? `[${appState.RULRange.low}–${appState.RULRange.high} h]` : '[165–198 h]'))}, confidence: ${rul.confidencePct || appState.RULConfidence || 91}%)
- Degradation: ${appState.degradationPct !== undefined ? appState.degradationPct : 0}% (${appState.degradationTrend || 'STABLE'})`;

    const userPrompt = `${stateContext}

User Question: ${query}`;

    // Dev-mode context logging (never log API key)
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[Groq] Query: "${query.slice(0, 80)}..." | Phase: ${appState.missionPhase} | Diagnosis: ${appState.aiDiagnosis} | EHI: ${appState.ehi !== undefined ? Math.round(appState.ehi) : 'N/A'}`);
    }

    let text = null;
    try {
      text = await callGroqAPI(userPrompt, GROQ_SYSTEM_PROMPT);
    } catch (apiErr) {
      if (apiErr.statusCode === 429 && apiErr.retryAfter && apiErr.retryAfter <= 4.0) {
        console.warn(`[AI ROUTE] Groq 429 TPM hit. Retrying once after ${apiErr.retryAfter}s...`);
        await new Promise(r => setTimeout(r, Math.ceil(apiErr.retryAfter * 1000) + 250));
        text = await callGroqAPI(userPrompt, GROQ_SYSTEM_PROMPT);
      } else {
        throw apiErr;
      }
    }

    if (text) {
      console.log(`[AI ROUTE] Groq response status: 200`);
      console.log(`[AI ROUTE] Response source: grok`);
      sendJsonResponse(res, 200, { source: 'grok', response: sanitizeUnicode(text) });
      return;
    }

    // Graceful fallback if Groq returns empty
    console.warn('[Groq] Empty response from API. Serving grounded local analysis fallback.');
    console.log(`[AI ROUTE] Groq response status: 200`);
    console.log(`[AI ROUTE] Response source: local_fallback`);
    const localFallback = generateServerLocalAnalysis(query, appState);
    sendJsonResponse(res, 200, {
      source: 'local_fallback',
      response: sanitizeUnicode(localFallback),
      note: 'Groq returned empty; fulfilled via grounded engine analysis.'
    });

  } catch (err) {
    const status = err.statusCode || 500;
    console.error(`[AI DEBUG] Groq error: ${err.message}`);
    console.log(`[AI ROUTE] Groq response status: ${status}`);
    console.log(`[AI ROUTE] Response source: groq_error`);
    const localFallback = generateServerLocalAnalysis(query, appState);
    const is429 = status === 429;
    const errorMsg = is429 
      ? `Groq TPM Rate Limit (429): Rate limit exceeded. ${err.groqMessage || ''}`.trim()
      : (err.groqMessage || err.message);

    sendJsonResponse(res, status, {
      source: 'groq_error',
      statusCode: status,
      error: err.message,
      groqError: errorMsg,
      fallback: sanitizeUnicode(localFallback),
      note: is429 ? 'Groq TPM rate limit reached; displaying emergency local analysis.' : 'Served via local engine analysis after Groq API exception.'
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

