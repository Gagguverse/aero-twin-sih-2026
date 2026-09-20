/* ==========================================================================
   AERO TWIN — Integrated Application Core Controller & Real-Time Pipeline
   SIH 2026 Problem Statement: SIH26054 | DRDO MALE UAV Aero Piston Engine
   Theme: Robotics & Drones | Category: Software

   End-to-End Runtime Pipeline:
   Synthetic Telemetry -> TelemetryEngine -> SensorTrustEngine -> AIDiagnosticNet
   -> EHI -> Degradation/RUL -> WHY Explainability -> Central appState -> UI & 3D
   ========================================================================== */

(function () {
  'use strict';

  // ==========================================================================
  // PIPELINE ENGINES & CORE STATE
  // ==========================================================================
  let telemetryEngine = null;
  let sensorTrustEngine = null;
  let aiDiagnosticNet = null;
  let faultSimulator = null;
  let digitalTwin = null;
  let physicsModel = null;
  let telemetryAdapter = null;
  let missionMap = null;

  let chartCanvas = null;
  let chartCtx = null;
  let selectedComponent = null;
  let currentInspectionMode = 'inspect';
  let currentScenarioKey = 'normal'; // 'normal' | 'sensor_fault' | 'thermal_degradation'

  // Central Application State consumed by all sections
  window.appState = {
    scenario: 'normal',
    missionPhase: 'cruise',
    simTime: '14:22',
    rawTelemetry: null,
    expectedPhysics: null,
    trustResult: null,
    diagnosticResult: null,
    physics: null,
    missionReliability: null,
    rul: null,
    ehiBreakdown: null,
    sensorTrust: null,
    diagnostic: null,
    maintenance: null,
    environment: null,
    ehi: 96,
    ehiStatus: 'NOMINAL',
    aiDiagnosis: 'HEALTHY',
    aiDiagStatus: 'NOMINAL',
    anomalyScore: 0.04,
    overallTrust: 0.96,
    trustedCount: 9,
    totalSensors: 9,
    rulHours: 182,
    rulLabel: '182 h',
    degradationPct: 4,
    degradationTrend: 'STABLE',
    why: {
      title: 'WHY ENGINE IS NOMINAL',
      bullets: [],
      conclusion: ''
    },
    isReplaying: false,
    replayIndex: 0,
    historyBuffer: []
  };

  // ==========================================================================
  // INITIALIZATION
  // ==========================================================================
  document.addEventListener('DOMContentLoaded', () => {
    initPipelineEngines();
    initDigitalTwin();
    initDegradationChart();
    initUIEventListeners();
    initAssistant();

    // Start in Normal scenario baseline
    applyScenario('normal');
  });

  function initPipelineEngines() {
    if (window.AeroPhysicsModel) {
      physicsModel = new window.AeroPhysicsModel();
      window.physicsModel = physicsModel;
    }
    if (window.TelemetryEngine) {
      telemetryEngine = new window.TelemetryEngine();
      window.telemetryEngine = telemetryEngine;
    }
    if (window.TelemetryAdapter && telemetryEngine) {
      telemetryAdapter = new window.TelemetryAdapter(telemetryEngine);
      window.telemetryAdapter = telemetryAdapter;
    }
    if (window.SensorTrustEngine) {
      sensorTrustEngine = new window.SensorTrustEngine();
      window.sensorTrustEngine = sensorTrustEngine;
    }
    if (window.AIDiagnosticNet) {
      aiDiagnosticNet = new window.AIDiagnosticNet();
      window.aiDiagnosticNet = aiDiagnosticNet;
    }
    if (window.FaultSimulator && telemetryEngine) {
      faultSimulator = new window.FaultSimulator(telemetryEngine);
      window.faultSimulator = faultSimulator;
    }

    if (window.MissionMapController) {
      missionMap = new window.MissionMapController('mission-map-container');
      window.missionMap = missionMap;
    }

    if (telemetryEngine && sensorTrustEngine && aiDiagnosticNet) {
      // Connect 10 Hz Telemetry Engine update listener to the full pipeline
      telemetryEngine.onUpdate((rawState, fftBins, expected) => {
        executePipelineStep(rawState, expected);
      });
    }
  }

  function initDigitalTwin() {
    if (window.AeroPistonDigitalTwin) {
      digitalTwin = new window.AeroPistonDigitalTwin('engine-canvas');
      window.digitalTwin = digitalTwin;
      initEngineCalloutsLayer();
    }
  }

  let chartResizeObserver = null;

  function initDegradationChart() {
    chartCanvas = document.getElementById('degradation-chart-canvas');
    if (!chartCanvas) return;
    chartCtx = chartCanvas.getContext('2d');

    setupChartCanvas();

    // Use ResizeObserver on wrapper for smooth responsive resizing
    if (window.ResizeObserver && chartCanvas.parentElement) {
      if (chartResizeObserver) chartResizeObserver.disconnect();
      chartResizeObserver = new ResizeObserver(() => {
        setupChartCanvas();
        renderDegradationChart();
      });
      chartResizeObserver.observe(chartCanvas.parentElement);
    }

    window.addEventListener('resize', () => {
      setupChartCanvas();
      renderDegradationChart();
    });

    renderDegradationChart();
  }

  function setupChartCanvas() {
    if (!chartCanvas || !chartCtx) return;
    const parent = chartCanvas.parentElement;
    const rect = parent ? parent.getBoundingClientRect() : chartCanvas.getBoundingClientRect();
    const w = Math.max(260, rect.width || (parent ? parent.clientWidth : 340));
    const h = Math.max(220, rect.height || (parent ? parent.clientHeight : 260));
    const dpr = window.devicePixelRatio || 1;

    const targetW = Math.round(w * dpr);
    const targetH = Math.round(h * dpr);

    if (chartCanvas.width !== targetW || chartCanvas.height !== targetH) {
      chartCanvas.width = targetW;
      chartCanvas.height = targetH;
    }
    return { w, h, dpr };
  }

  // ==========================================================================
  // CORE RUNTIME PIPELINE EXECUTION (10 Hz)
  // ==========================================================================
  function executePipelineStep(rawState, expected) {
    if (window.appState && window.appState.isReplaying) return;
    if (!sensorTrustEngine || !aiDiagnosticNet) return;

    // 1. SENSOR TRUST EVALUATION (Sensor Trust Before Health Judgment)
    const trustResult = sensorTrustEngine.evaluate(rawState, expected);

    // 2. PHYSICS MODEL & OPERATING RESIDUALS (P0 Technical Depth)
    // If a sensor is quarantined, its residual is shielded to avoid false engine anomalies
    const physicsResult = physicsModel
      ? physicsModel.computeResiduals(rawState, { expected: expected }, trustResult)
      : null;

    // 3. REAL AI / ML DIAGNOSTIC & PROGNOSTIC EVALUATION
    const diagnosticResult = aiDiagnosticNet.evaluate(rawState, trustResult, expected, physicsResult);

    // 4. UPDATE CENTRAL APP STATE
    syncAppState(rawState, expected, trustResult, diagnosticResult, physicsResult);

    // 5. RENDER ALL DASHBOARD SECTIONS FROM appState (Deferred while Pre-UI is active to eliminate main-thread reflows)
    if (!document.body || !document.body.classList.contains('brief-active')) {
      renderDashboard();
    } else {
      updateBriefTelemetryStrip(rawState, diagnosticResult);
    }

    // 6. SYNCHRONIZE 3D ENGINE STATE
    if (digitalTwin) {
      const avgCht = rawState.cht ? (rawState.cht.reduce((a, b) => a + b, 0) / rawState.cht.length) : 178;
      const avgEgt = rawState.egt ? (rawState.egt.reduce((a, b) => a + b, 0) / rawState.egt.length) : 824;
      const oilPressTrust = trustResult.scores && trustResult.scores.oilPress !== undefined ? trustResult.scores.oilPress : 1.0;

      digitalTwin.updateState({
        rpm: rawState.rpm,
        status: diagnosticResult.status,
        oilPressTrust: oilPressTrust,
        cht: avgCht,
        egt: avgEgt
      }, currentScenarioKey);
    }
  }

  function syncAppState(rawState, expected, trustResult, diagnosticResult, physicsResult) {
    const s = window.appState;
    s.rawTelemetry = rawState;
    s.expectedPhysics = expected;
    s.trustResult = trustResult;
    s.diagnosticResult = diagnosticResult;

    // 1. Physics Model State (P0)
    s.physics = physicsResult ? {
      expected: expected,
      residuals: physicsResult.residuals,
      normalizedResiduals: physicsResult.normalizedResiduals,
      status: physicsResult.status,
      tableRows: physicsResult.tableRows,
      isShielded: physicsResult.isShielded,
      mapEnvelope: physicsResult.mapEnvelope,
      operatingConditions: rawState.operatingConditions || {
        altitude: rawState.altitude || 18000,
        throttle: rawState.throttle || 0.72,
        ambientTemp: rawState.ambientTemp !== undefined ? rawState.ambientTemp : -21
      }
    } : null;
    s.physicsResiduals = physicsResult ? physicsResult.residuals : {};

    // 2. Mission Reliability (P0 SIH26054 Core Capability)
    s.missionReliability = diagnosticResult.missionReliability || {
      score: 97,
      status: 'NOMINAL (GO)',
      reasons: ['All propulsion parameters nominal'],
      currentPhase: (rawState.missionPhase || 'cruise').toUpperCase(),
      remainingMissionDuration: '02h 18m'
    };

    // 3. Upgraded RUL Range & Confidence (P0)
    s.rul = {
      estimate: diagnosticResult.rulHours,
      range: diagnosticResult.rulRangeStr || `${Math.max(10, diagnosticResult.rulHours - 15)}–${diagnosticResult.rulHours + 15} h`,
      confidence: diagnosticResult.rulConfidencePct || 92,
      trend: diagnosticResult.degradationTrend || 'STABLE'
    };

    // 4. Sensor Trust Explainability & Per-Sensor details (P1)
    s.sensorTrust = {
      perSensor: trustResult.sensorDetails || {},
      scores: trustResult.scores || {},
      overall: trustResult.overallTrust,
      quarantined: trustResult.quarantined || []
    };

    // 5. Diagnostic Evidence (P1)
    s.diagnostic = {
      class: diagnosticResult.faultClass,
      confidence: diagnosticResult.confidence,
      evidence: diagnosticResult.evidence || []
    };

    // 6. Deterministic Maintenance Advisory (P2)
    s.maintenance = diagnosticResult.maintenanceAdvisory || {
      subsystem: 'All Systems Nominal',
      priority: 'ROUTINE',
      action: 'Standard pre-flight inspection at next turnaround.',
      code: 'MAINT-001-NOM',
      urgency: '50h Inspection'
    };

    // 7. EHI Breakdown (P0/P1)
    s.ehiBreakdown = diagnosticResult.ehiBreakdown || {
      baseline: 100,
      thermalContribution: 0,
      lubricationContribution: 0,
      vibrationContribution: 0,
      sensorShieldContribution: 0,
      finalEhi: diagnosticResult.healthIndex,
      status: diagnosticResult.ehiStatus
    };

    // 8. Environmental Operating Conditions (P1)
    s.environment = {
      altitude: rawState.altitude || 18000,
      ambientTemperature: rawState.ambientTemp !== undefined ? rawState.ambientTemp : -21,
      throttleTransition: !!rawState.throttleTransition
    };

    s.missionPhase = (rawState.missionPhase || 'cruise').toUpperCase();
    const sec = rawState.missionTimeSec || 0;
    const minPart = Math.floor(sec / 60) + 14; // Start at 14:xx mission time
    const secPart = Math.floor(sec % 60);
    s.simTime = `${minPart}:${String(secPart).padStart(2, '0')}`;

    // EHI and Health Cards
    s.ehi = diagnosticResult.healthIndex;
    s.ehiStatus = diagnosticResult.ehiStatus; // 'NOMINAL' | 'WARNING' | 'CRITICAL'

    // AI Diagnosis label & status
    if (diagnosticResult.faultClass === 'SENSOR_FAULT') {
      s.aiDiagnosis = 'SENSOR FAULT';
      s.aiDiagStatus = 'WARNING';
    } else if (diagnosticResult.faultClass === 'THERMAL_DEGRADATION') {
      s.aiDiagnosis = 'THERMAL DEGRADATION';
      s.aiDiagStatus = 'CRITICAL';
    } else if (diagnosticResult.faultClass === 'LUBRICATION_DEGRADATION') {
      s.aiDiagnosis = 'LUBRICATION FAULT';
      s.aiDiagStatus = 'CRITICAL';
    } else if (diagnosticResult.faultClass === 'RPM_INSTABILITY') {
      s.aiDiagnosis = 'RPM INSTABILITY';
      s.aiDiagStatus = 'WARNING';
    } else {
      s.aiDiagnosis = 'HEALTHY';
      s.aiDiagStatus = 'NOMINAL';
    }

    s.anomalyScore = diagnosticResult.anomalyScore;
    s.overallTrust = trustResult.overallTrust;

    // Count trusted primary channels (out of 9 channels)
    const scoreMap = trustResult.scores || {};
    let trustedCount = 0;
    const channels = ['rpm', 'cht', 'egt', 'oilPress', 'oilTemp', 'fuelFlow', 'map'];
    if ((scoreMap.rpm || 1.0) >= 0.6) trustedCount++;
    if ((scoreMap.oilPress || 1.0) >= 0.6) trustedCount++;
    if ((scoreMap.oilTemp || 1.0) >= 0.6) trustedCount++;
    if ((scoreMap.fuelFlow || 1.0) >= 0.6) trustedCount++;
    if ((scoreMap.map || 1.0) >= 0.6) trustedCount++;
    // CHT channels average trust
    const chtScores = scoreMap.cht || [1, 1, 1, 1];
    const avgChtScore = chtScores.reduce((a, b) => a + b, 0) / 4;
    if (avgChtScore >= 0.6) trustedCount++;
    // EGT channels average trust
    const egtScores = scoreMap.egt || [1, 1, 1, 1];
    const avgEgtScore = egtScores.reduce((a, b) => a + b, 0) / 4;
    if (avgEgtScore >= 0.6) trustedCount++;
    // Secondary engine load & vibration
    trustedCount += 2; // Always valid in simulation

    s.trustedCount = Math.min(9, Math.max(1, trustedCount));
    s.totalSensors = 9;

    // RUL and Degradation
    s.rulHours = diagnosticResult.rulHours;
    s.rulLabel = diagnosticResult.rulLabel;
    s.degradationPct = diagnosticResult.degradationPct;
    s.degradationTrend = diagnosticResult.degradationTrend;

    // WHY Explanation
    if (diagnosticResult.explainability) {
      s.why.title = diagnosticResult.explainability.title;
      s.why.bullets = diagnosticResult.explainability.bullets || [];
      s.why.conclusion = diagnosticResult.explainability.conclusion || '';
    }

    // Append to degradation history buffer (up to 120 frames)
    s.historyBuffer.push({
      sec: sec,
      deg: s.degradationPct,
      scenario: currentScenarioKey
    });
    if (s.historyBuffer.length > 120) {
      s.historyBuffer.shift();
    }
  }

  // ==========================================================================
  // DASHBOARD RENDERING (Driven from appState)
  // ==========================================================================
  function renderDashboard() {
    const s = window.appState;
    if (!s.rawTelemetry) return;

    // 1. Top 5 Health Overview Cards (includes Mission Reliability)
    renderOverviewCards(s);

    // 2. Section 3: Live Telemetry & Digital Twin State
    renderLiveTelemetry(s.rawTelemetry, s.trustResult, s.physics);

    // 3. Section 3: Right Column Engine Status + WHY
    renderEngineStatusAndWhy(s);

    // 3B. Section 3B: Physics Expected vs Actual & Operating Residuals (P0 Technical Depth)
    renderPhysicsResiduals(s.physics);

    // 3C. Section 3C: Mission Map & Contingency Decision Support
    if (missionMap) {
      missionMap.update(s);
    }

    // 4. Section 4: Sensor Trust Matrix (Full-Width Core Differentiator)
    renderSensorTrustMatrix(s.rawTelemetry, s.trustResult);

    // 5. Section 5: AI Diagnostic Assessment & Maintenance Advisory
    renderDiagnosticAssessment(s);

    // 6. Section 6: Engine Degradation & RUL
    renderDegradationSection(s);

    // 7. Section 8: Mission Timeline & Scrubber
    renderTimelineDisplay(s);

    // 8. Interactive Component HUD (if active) & Component Callout Telemetry
    if (selectedComponent) {
      updateInspectionHud(selectedComponent);
    }
    updateCalloutTelemetryValues(s);
  }

  // ==========================================================================
  // SECTION 1: HEALTH OVERVIEW CARDS
  // ==========================================================================
  function renderOverviewCards(s) {
    // CARD 1: ENGINE HEALTH
    const ehiCard = document.getElementById('card-ehi');
    const ehiVal = document.getElementById('ehi-val');
    const ehiBadge = document.getElementById('ehi-badge');
    if (ehiVal) ehiVal.textContent = Math.round(s.ehi);
    if (ehiBadge) {
      ehiBadge.textContent = s.ehiStatus;
      ehiBadge.className = `card-status-badge badge-${s.ehiStatus.toLowerCase()}`;
    }
    if (ehiCard) {
      ehiCard.className = `summary-card status-${s.ehiStatus.toLowerCase()}`;
    }

    // CARD 2: AI DIAGNOSIS
    const diagCard = document.getElementById('card-diag');
    const diagVal = document.getElementById('diag-val');
    const diagBadge = document.getElementById('diag-badge');
    const anomalyVal = document.getElementById('anomaly-val');
    if (diagVal) diagVal.textContent = s.aiDiagnosis;
    if (diagBadge) {
      diagBadge.textContent = s.aiDiagStatus;
      diagBadge.className = `card-status-badge badge-${s.aiDiagStatus.toLowerCase()}`;
    }
    if (anomalyVal) anomalyVal.textContent = s.anomalyScore.toFixed(2);
    if (diagCard) {
      diagCard.className = `summary-card status-${s.aiDiagStatus.toLowerCase()}`;
    }

    // CARD 3: SENSOR TRUST
    const trustCard = document.getElementById('card-trust');
    const trustCountVal = document.getElementById('trust-count-val');
    const overallTrustVal = document.getElementById('overall-trust-val');
    const trustBadge = document.getElementById('trust-badge');
    if (trustCountVal) trustCountVal.textContent = `${s.trustedCount} / ${s.totalSensors}`;
    if (overallTrustVal) overallTrustVal.textContent = s.overallTrust.toFixed(2);
    if (trustBadge) {
      const trustStatus = s.trustedCount === s.totalSensors ? 'NOMINAL' : 'WARNING';
      trustBadge.textContent = trustStatus;
      trustBadge.className = `card-status-badge badge-${trustStatus.toLowerCase()}`;
      if (trustCard) trustCard.className = `summary-card status-${trustStatus.toLowerCase()}`;
    }

    // CARD 4: REMAINING USEFUL LIFE (Upgraded Range & Confidence)
    const rulVal = document.getElementById('rul-val');
    const rulRangeChip = document.getElementById('rul-range-chip');
    const rulConfVal = document.getElementById('rul-conf-val');
    const cardRul = document.getElementById('card-rul');

    if (rulVal) rulVal.textContent = s.rul ? s.rul.estimate : s.rulHours;
    if (rulRangeChip && s.rul) rulRangeChip.textContent = `[${s.rul.range}]`;
    if (rulConfVal && s.rul) rulConfVal.textContent = `${s.rul.confidence}%`;
    if (cardRul) {
      const rulStatus = (s.rul && s.rul.estimate < 50) ? 'status-critical' : ((s.rul && s.rul.estimate < 100) ? 'status-warning' : 'status-nominal');
      cardRul.className = `summary-card ${rulStatus}`;
    }

    // CARD 5: MISSION RELIABILITY (SIH26054 P0 REQUIREMENT)
    const cardRel = document.getElementById('card-mission-rel');
    const relVal = document.getElementById('mission-rel-val');
    const relBadge = document.getElementById('mission-rel-badge');
    const relPhase = document.getElementById('mission-phase-label');
    const relRisk = document.getElementById('mission-risk-val');

    if (s.missionReliability) {
      const relScore = s.missionReliability.score;
      if (relVal) relVal.textContent = relScore;
      const badgeType = relScore >= 88 ? 'nominal' : (relScore >= 75 ? 'warning' : 'critical');
      if (relBadge) {
        relBadge.textContent = s.missionReliability.status;
        relBadge.className = `card-status-badge badge-${badgeType}`;
      }
      if (relPhase) {
        relPhase.textContent = `${s.missionReliability.currentPhase || s.missionPhase} • ${s.missionReliability.remainingMissionDuration || '02h 18m'}`;
      }
      if (relRisk) {
        relRisk.textContent = s.missionReliability.riskLevel || s.missionReliability.risk || 'NOMINAL';
        relRisk.style.color = badgeType === 'nominal' ? 'var(--status-nominal)' : (badgeType === 'warning' ? 'var(--status-warning)' : 'var(--status-critical)');
      }
      if (cardRel) {
        cardRel.className = `summary-card status-${badgeType}`;
      }

      // Render on-card contributors preview
      const contribPreview = document.getElementById('mission-rel-contributors-preview');
      if (contribPreview && s.missionReliability.contributors && s.missionReliability.contributors.penalties) {
        const p = s.missionReliability.contributors.penalties;
        contribPreview.textContent = `EHI: ${p.ehi} | Anom: ${p.anomaly} | Trust: ${p.sensorTrust} | Fault: ${p.confirmedFault} | MAP: ${p.mapEnvelope}`;
      }
    }

    // Twin State Pill
    const twinChip = document.getElementById('twin-state-chip');
    if (twinChip) {
      twinChip.textContent = s.aiDiagnosis;
      twinChip.className = `twin-state-chip badge-${s.aiDiagStatus.toLowerCase()}`;
    }

    // Header Mission Phase Display
    const headerPhase = document.getElementById('header-mission-phase');
    if (headerPhase) {
      headerPhase.textContent = s.missionPhase;
    }
  }

  // ==========================================================================
  // SECTION 3B: PHYSICS MODEL & RESIDUALS TABLE (P0 Technical Depth)
  // ==========================================================================
  function renderPhysicsResiduals(physics) {
    const tbody = document.getElementById('physics-table-body');
    if (!tbody || !physics || !physics.tableRows) return;

    const bases = {
      'EGT (Exhaust Gas)': 'Thermodynamic equilibrium & stoichiometric heat release',
      'CHT (Cylinder Head)': 'Transient heat soak balance & fin cooling dissipation',
      'Oil Pressure': 'Gear pump displacement curve vs hydrodynamic load',
      'Oil Temperature': 'Thermal exchanger equilibrium vs sump volume',
      'Fuel Flow Rate': 'Calibrated fuel-air mass ratio across throttle sweep',
      'Engine RPM': 'Propeller governor balance at cruise throttle demand',
      'MAP (Boost Pressure)': 'ISA ambient pressure + single-stage turbo boost ratio'
    };

    tbody.innerHTML = physics.tableRows.map(row => {
      let badgeClass = 'badge-nominal';
      if (row.status === 'ELEVATED') badgeClass = 'badge-elevated';
      else if (row.status === 'LOW') badgeClass = 'badge-low';
      else if (row.status === 'CRITICAL') badgeClass = 'badge-critical';
      else if (row.status === 'QUARANTINED') badgeClass = 'badge-quarantined';

      const basis = bases[row.param] || 'Operating-condition physics mapping';
      const rowClass = row.isQuarantined ? 'row-distrusted' : (row.status === 'CRITICAL' ? 'row-distrusted' : '');

      return `
        <tr class="${rowClass}">
          <td class="trust-sensor-name">
            <strong>${row.param}</strong>
          </td>
          <td class="trust-val-cell">${row.expected}</td>
          <td class="trust-val-cell" style="font-weight: 600;">${row.actual}</td>
          <td style="font-family: var(--font-mono); font-size: 0.74rem; font-weight: 700; color: ${row.status === 'NORMAL' ? 'var(--status-nominal)' : (row.status === 'CRITICAL' ? 'var(--status-critical)' : 'var(--accent-blue)')};">
            ${row.residual}
          </td>
          <td>
            <span class="card-status-badge ${badgeClass}" style="font-size: 0.65rem; padding: 2px 6px;">${row.status}</span>
          </td>
          <td style="font-size: 0.68rem; color: var(--text-muted); line-height: 1.3;">
            ${basis}
          </td>
        </tr>
      `;
    }).join('');
  }

  // ==========================================================================
  // SECTION 3: LIVE TELEMETRY
  // ==========================================================================
  // SECTION 3: LIVE TELEMETRY (Operating-Condition Aware Expected-State Logic)
  // ==========================================================================
  function renderLiveTelemetry(raw, trustResult, physics) {
    const container = document.getElementById('telemetry-list');
    if (!container) return;

    const s = window.appState || {};
    const phys = physics || s.physics || {};
    const exp = phys.expected || {};

    const avgCht = (raw.cht && Array.isArray(raw.cht) && raw.cht.length)
      ? (raw.cht.reduce((a, b) => a + b, 0) / raw.cht.length)
      : (typeof raw.cht === 'number' ? raw.cht : (exp.chtAvg || 172));
    const avgEgt = (raw.egt && Array.isArray(raw.egt) && raw.egt.length)
      ? (raw.egt.reduce((a, b) => a + b, 0) / raw.egt.length)
      : (typeof raw.egt === 'number' ? raw.egt : (exp.egtAvg || 805));
    const isOilQuarantined = trustResult && trustResult.quarantined && trustResult.quarantined.includes('oilPress');

    // Operating-condition aware evaluator: compares actual against physics expected state
    function evalCondition(val, expectedVal, warnDelta, critDelta, options = {}) {
      if (typeof val !== 'number' || isNaN(val)) {
        return { status: 'Normal', trend: 'Normal' };
      }
      const expVal = (typeof expectedVal === 'number' && !isNaN(expectedVal)) ? expectedVal : val;
      const diff = val - expVal;
      const absDiff = Math.abs(diff);

      // 1. Check absolute safety redlines (independent of operating point)
      if (options.hardCritHigh !== undefined && val >= options.hardCritHigh) {
        return { status: 'Critical', trend: '↑ High' };
      }
      if (options.hardCritLow !== undefined && val <= options.hardCritLow) {
        return { status: 'Critical', trend: '↓ Low' };
      }
      if (options.hardWarnHigh !== undefined && val >= options.hardWarnHigh) {
        return { status: 'Warning', trend: '↑ High' };
      }
      if (options.hardWarnLow !== undefined && val <= options.hardWarnLow) {
        return { status: 'Warning', trend: '↓ Low' };
      }

      // 2. Physics-based residual evaluation against current flight phase / operating equilibrium
      if (absDiff > critDelta) {
        return { status: 'Critical', trend: diff > 0 ? '↑ High' : '↓ Low' };
      }
      if (absDiff > warnDelta) {
        return { status: 'Warning', trend: diff > 0 ? '↑ High' : '↓ Low' };
      }
      return { status: 'Normal', trend: 'Normal' };
    }

    // RPM: Expected RPM computed dynamically by physics model for current throttle/phase (e.g. ~4392 in cruise, ~5400 in takeoff)
    // Tolerances from AeroPhysicsModel.nominalRanges.rpm: warn: 250 RPM, crit: 450 RPM
    const expectedRpm = exp.rpm !== undefined ? exp.rpm : 4392;
    const rpmCond = evalCondition(raw.rpm, expectedRpm, 250, 450, {
      hardWarnHigh: 5450,
      hardCritHigh: 5650,
      hardWarnLow: 1600,
      hardCritLow: 1200
    });

    // CHT: Expected cylinder head temperature (~165–175°C in cruise)
    // Tolerances from AeroPhysicsModel: warn: 14°C, crit: 24°C
    const expectedCht = exp.chtAvg !== undefined ? exp.chtAvg : 172;
    const chtCond = evalCondition(avgCht, expectedCht, 14, 24, {
      hardWarnHigh: 195,
      hardCritHigh: 215,
      hardWarnLow: 90
    });

    // EGT: Expected exhaust gas temperature (~780–820°C in cruise)
    // Tolerances from AeroPhysicsModel: warn: 40°C, crit: 70°C
    const expectedEgt = exp.egtAvg !== undefined ? exp.egtAvg : 805;
    const egtCond = evalCondition(avgEgt, expectedEgt, 40, 70, {
      hardWarnHigh: 870,
      hardCritHigh: 910,
      hardWarnLow: 500
    });

    // Oil Temperature: Expected ~85–92°C in cruise
    // Tolerances from AeroPhysicsModel: warn: 10°C, crit: 18°C
    const expectedOilTemp = exp.oilTemp !== undefined ? exp.oilTemp : 90;
    const oilTempCond = evalCondition(raw.oilTemp, expectedOilTemp, 10, 18, {
      hardWarnHigh: 104,
      hardCritHigh: 115,
      hardWarnLow: 55
    });

    // Oil Pressure: Expected ~50–58 PSI in cruise
    // Tolerances from AeroPhysicsModel: warn: 8 PSI, crit: 15 PSI
    // Sensor Trust Priority: If transducer is quarantined, flag as Suspicious / Frozen
    let oilPressCond;
    if (isOilQuarantined) {
      oilPressCond = { status: 'Suspicious', trend: '— Frozen' };
    } else {
      const expectedOilPress = exp.oilPress !== undefined ? exp.oilPress : 54;
      oilPressCond = evalCondition(raw.oilPress, expectedOilPress, 8, 15, {
        hardWarnLow: 38,
        hardCritLow: 28,
        hardWarnHigh: 72,
        hardCritHigh: 85
      });
    }

    // Fuel Flow: Expected ~21–24 L/hr in cruise, ~34 in takeoff
    // Tolerances from AeroPhysicsModel: warn: 3.5 L/hr, crit: 6.0 L/hr
    const expectedFuelFlow = exp.fuelFlow !== undefined ? exp.fuelFlow : 23.5;
    const fuelCond = evalCondition(raw.fuelFlow, expectedFuelFlow, 3.5, 6.0, {
      hardWarnHigh: 40.0,
      hardCritHigh: 45.0
    });

    // MAP: Operating-Condition Aware Turbocharged Envelope Evaluation
    const actualLoad = raw.load !== undefined ? raw.load : 72;
    const mapEnvelope = (physics && physics.mapEnvelope)
      ? physics.mapEnvelope
      : (physicsModel ? physicsModel.getMapOperatingEnvelope({ altitude: raw.altitude, throttle: raw.throttle, missionPhase: raw.missionPhase, load: actualLoad }) : null);

    let mapCond;
    if (mapEnvelope && raw.map >= mapEnvelope.nominalMin && raw.map <= mapEnvelope.nominalMax) {
      mapCond = { status: 'Normal', trend: 'Normal' };
    } else if (mapEnvelope && raw.map >= mapEnvelope.warnMin && raw.map <= mapEnvelope.warnMax) {
      mapCond = { status: 'Warning', trend: raw.map > mapEnvelope.nominalMax ? '↑ High' : '↓ Low' };
    } else if (mapEnvelope) {
      mapCond = { status: 'Critical', trend: raw.map > mapEnvelope.warnMax ? '↑ High' : '↓ Low' };
    } else {
      const expectedMap = exp.map !== undefined ? exp.map : 28.5;
      mapCond = evalCondition(raw.map, expectedMap, 3.5, 6.0, {
        hardWarnHigh: 38.0,
        hardCritHigh: 42.0
      });
    }

    // Engine Load: Expected matches current throttle demand (~72% in cruise, 100% in takeoff)
    // Tolerances from AeroPhysicsModel: warn: 14%, crit: 22%
    const expectedLoad = exp.load !== undefined ? exp.load : 72;
    const loadCond = evalCondition(actualLoad, expectedLoad, 14, 22, {
      hardWarnHigh: 96,
      hardCritHigh: 102
    });

    const items = [
      {
        key: 'rpm',
        name: 'RPM (Engine Speed)',
        val: raw.rpm,
        unit: 'RPM',
        status: rpmCond.status,
        trend: rpmCond.trend
      },
      {
        key: 'cht',
        name: 'CHT (Cylinder Head Temp)',
        val: avgCht,
        unit: '°C',
        status: chtCond.status,
        trend: chtCond.trend
      },
      {
        key: 'egt',
        name: 'EGT (Exhaust Gas Temp)',
        val: avgEgt,
        unit: '°C',
        status: egtCond.status,
        trend: egtCond.trend
      },
      {
        key: 'oilTemp',
        name: 'Oil Temperature',
        val: raw.oilTemp,
        unit: '°C',
        status: oilTempCond.status,
        trend: oilTempCond.trend
      },
      {
        key: 'oilPress',
        name: 'Oil Pressure',
        val: raw.oilPress,
        unit: 'PSI',
        status: oilPressCond.status,
        trend: oilPressCond.trend
      },
      {
        key: 'fuelFlow',
        name: 'Fuel Flow Rate',
        val: raw.fuelFlow,
        unit: 'L/hr',
        status: fuelCond.status,
        trend: fuelCond.trend
      },
      {
        key: 'map',
        name: 'MAP (Manifold Pressure)',
        val: raw.map,
        unit: 'inHg',
        status: mapCond.status,
        trend: mapCond.trend
      },
      {
        key: 'engineLoad',
        name: 'Calculated Engine Load',
        val: actualLoad,
        unit: '%',
        status: loadCond.status,
        trend: loadCond.trend
      }
    ];

    container.innerHTML = items.map(item => {
      const isCrit = item.status === 'Critical';
      const isWarn = item.status === 'Warning' || item.status === 'Suspicious';
      const alertClass = isCrit ? 'alert-critical' : (isWarn ? 'alert-warning' : '');
      const statusClass = isCrit ? 'crit' : (isWarn ? 'warn' : '');

      let trendClass = 'stable';
      if (item.trend.includes('Frozen')) {
        trendClass = 'frozen';
      } else if (item.status === 'Critical') {
        trendClass = item.trend.includes('Low') ? 'down' : 'up';
      } else if (item.status === 'Warning') {
        trendClass = item.trend.includes('Low') ? 'down' : 'warn';
      } else {
        trendClass = 'stable';
      }

      return `
        <div class="telemetry-item ${alertClass}" id="telem-${item.key}">
          <div class="telemetry-name-group">
            <span class="telemetry-name">${item.name}</span>
            <span class="telemetry-status-tag ${statusClass}">${item.status}</span>
          </div>
          <div class="telemetry-val-group">
            <div class="telemetry-val" id="telem-val-${item.key}">${formatTelemVal(item.key, item.val)} <span style="font-size:0.75rem; color:var(--text-muted); font-weight:400;">${item.unit}</span></div>
            <div class="telemetry-trend ${trendClass}">${item.trend}</div>
          </div>
        </div>
      `;
    }).join('');

    const motionRpm = document.getElementById('motion-rpm-chip');
    if (motionRpm) motionRpm.textContent = `${Math.round(raw.rpm).toLocaleString()} RPM`;
  }

  function formatTelemVal(key, val) {
    if (val === undefined || val === null) return '--';
    if (key === 'rpm') return Math.round(val).toLocaleString();
    if (key === 'fuelFlow' || key === 'map') return Number(val).toFixed(1);
    if (key === 'cht' || key === 'egt' || key === 'oilTemp' || key === 'oilPress' || key === 'engineLoad') return Number(val).toFixed(1);
    return val;
  }

  // ==========================================================================
  // SECTION 3: RIGHT COLUMN ENGINE STATUS + WHY
  // ==========================================================================
  function renderEngineStatusAndWhy(s) {
    const curStateVal = document.getElementById('engine-current-state');
    const faultVal = document.getElementById('engine-fault-val');
    const anomScoreVal = document.getElementById('engine-anomaly-val');

    let stateColor = 'var(--status-nominal)';
    let currentStateText = 'HEALTHY';
    let faultText = 'NONE';

    if (s.diagnosticResult.faultClass === 'SENSOR_FAULT') {
      currentStateText = 'SENSOR FAULT';
      faultText = 'OIL PRESS SENSOR FREEZE';
      stateColor = 'var(--status-warning)';
    } else if (s.diagnosticResult.faultClass === 'THERMAL_DEGRADATION') {
      currentStateText = 'THERMAL RUNAWAY';
      faultText = 'CYLINDER THERMAL ANOMALY';
      stateColor = 'var(--status-critical)';
    } else if (s.diagnosticResult.faultClass === 'LUBRICATION_DEGRADATION') {
      currentStateText = 'LUBRICATION CAVITATION';
      faultText = 'OIL PRESSURE LOSS / BEARING WEAR';
      stateColor = 'var(--status-critical)';
    }

    if (curStateVal) {
      curStateVal.textContent = currentStateText;
      curStateVal.style.color = stateColor;
    }
    if (faultVal) faultVal.textContent = faultText;
    if (anomScoreVal) anomScoreVal.textContent = s.anomalyScore.toFixed(2);

    const whyTitle = document.getElementById('why-title');
    const whyBulletsList = document.getElementById('why-bullets');
    const whyConclusion = document.getElementById('why-conclusion');

    if (whyTitle) {
      whyTitle.innerHTML = `<svg width="14" height="14" fill="currentColor" viewBox="0 0 20 20"><path d="M10 2a8 8 0 100 16 8 8 0 000-16zm.75 12h-1.5v-1.5h1.5V14zm0-3h-1.5V6h1.5v5z"/></svg> ${s.why.title}`;
    }
    if (whyBulletsList) {
      whyBulletsList.innerHTML = s.why.bullets.map(b => `<li>${b}</li>`).join('');
    }
    if (whyConclusion) {
      whyConclusion.innerHTML = `<strong>Conclusion:</strong> ${s.why.conclusion}`;
    }
  }

  // ==========================================================================
  // SECTION 4: SENSOR TRUST MATRIX
  // ==========================================================================
  function renderSensorTrustMatrix(raw, trustResult) {
    const tbody = document.getElementById('trust-table-body');
    if (!tbody || !trustResult) return;

    const scores = trustResult.scores || {};
    const reasons = trustResult.reasons || {};
    const quarantined = trustResult.quarantined || [];

    const avgCht = raw.cht ? (raw.cht.reduce((a, b) => a + b, 0) / 4) : 178;
    const avgEgt = raw.egt ? (raw.egt.reduce((a, b) => a + b, 0) / 4) : 824;

    const matrixRows = [
      {
        key: 'rpm',
        name: 'RPM (Crank Sensor)',
        val: `${Math.round(raw.rpm).toLocaleString()} RPM`,
        score: scores.rpm !== undefined ? scores.rpm : 0.98,
        defaultReason: 'Cross-validated with magneto timing & MAP slew'
      },
      {
        key: 'cht',
        name: 'CHT (Cylinder Head Temp)',
        val: `${avgCht.toFixed(1)} °C`,
        score: scores.cht ? (scores.cht.reduce((a, b) => a + b, 0) / 4) : 0.96,
        defaultReason: 'Normal thermal balance across all 4 cylinders'
      },
      {
        key: 'egt',
        name: 'EGT (Exhaust Gas Temp)',
        val: `${avgEgt.toFixed(1)} °C`,
        score: scores.egt ? (scores.egt.reduce((a, b) => a + b, 0) / 4) : 0.95,
        defaultReason: 'Consistent with stoichiometric fuel flow & load'
      },
      {
        key: 'oilTemp',
        name: 'Oil Temperature',
        val: `${raw.oilTemp.toFixed(1)} °C`,
        score: scores.oilTemp !== undefined ? scores.oilTemp : 0.94,
        defaultReason: 'Thermal lag matches heat exchanger model'
      },
      {
        key: 'oilPress',
        name: 'Oil Pressure',
        val: `${raw.oilPress.toFixed(1)} PSI`,
        score: scores.oilPress !== undefined ? scores.oilPress : 0.97,
        defaultReason: 'Dynamic pressure response matches RPM slew'
      },
      {
        key: 'fuelFlow',
        name: 'Fuel Flow Rate',
        val: `${raw.fuelFlow.toFixed(1)} L/hr`,
        score: scores.fuelFlow !== undefined ? scores.fuelFlow : 0.96,
        defaultReason: 'Matches injector pulse-width & throttle angle'
      },
      {
        key: 'map',
        name: 'MAP (Manifold Pressure)',
        val: `${raw.map.toFixed(1)} inHg`,
        score: scores.map !== undefined ? scores.map : 0.95,
        defaultReason: 'Correlates with turbo boost controller'
      },
      {
        key: 'load',
        name: 'Engine Load',
        val: `${(raw.load !== undefined ? raw.load : 72).toFixed(1)}%`,
        score: 0.98,
        defaultReason: 'Calculated load matches torque absorption curve'
      }
    ];

    tbody.innerHTML = matrixRows.map(row => {
      const isQuarantined = quarantined.includes(row.key);
      const isDegraded = row.score < 0.85 && !isQuarantined;
      const status = isQuarantined ? 'FAULTY' : (isDegraded ? 'DEGRADED' : 'TRUSTED');

      let reason = reasons[row.key] || row.defaultReason;
      if (isQuarantined && !reasons[row.key]) {
        reason = 'Signal remained unchanged (frozen variance < 0.005) while correlated parameters varied.';
      }

      const rowClass = isQuarantined || isDegraded ? 'row-distrusted' : '';
      const pillClass = status.toLowerCase();
      const fillWidth = Math.round(row.score * 100);
      const fillColor = isQuarantined ? 'var(--status-critical)' : (isDegraded ? 'var(--status-warning)' : 'var(--status-nominal)');

      return `
        <tr class="${rowClass}">
          <td class="trust-sensor-name">
            <span style="display:inline-block; width:6px; height:6px; border-radius:50%; background:${fillColor};"></span>
            ${row.name}
          </td>
          <td class="trust-val-cell">${row.val}</td>
          <td>
            <div class="trust-bar-container">
              <div class="trust-bar-track">
                <div class="trust-bar-fill" style="width: ${fillWidth}%; background: ${fillColor};"></div>
              </div>
              <span class="trust-score-num" style="color: ${fillColor};">${row.score.toFixed(2)}</span>
            </div>
          </td>
          <td>
            <span class="trust-status-pill ${pillClass}">${status}</span>
          </td>
          <td class="trust-reason-cell ${isQuarantined || isDegraded ? 'has-fault' : ''}">
            ${reason}
          </td>
        </tr>
      `;
    }).join('');
  }

  // ==========================================================================
  // SECTION 5: AI DIAGNOSTIC ASSESSMENT
  // ==========================================================================
  function renderDiagnosticAssessment(s) {
    const diagAssState = document.getElementById('diag-assess-state');
    const diagAssScore = document.getElementById('diag-assess-score');
    const diagAssFault = document.getElementById('diag-assess-fault');

    let stateColor = 'var(--status-nominal)';
    let currentStateText = 'HEALTHY';
    let faultText = 'NONE';

    if (s.diagnosticResult.faultClass === 'SENSOR_FAULT') {
      currentStateText = 'SENSOR FAULT';
      faultText = 'OIL PRESS SENSOR FREEZE';
      stateColor = 'var(--status-warning)';
    } else if (s.diagnosticResult.faultClass === 'THERMAL_DEGRADATION') {
      currentStateText = 'THERMAL RUNAWAY';
      faultText = 'CYLINDER THERMAL ANOMALY';
      stateColor = 'var(--status-critical)';
    } else if (s.diagnosticResult.faultClass === 'LUBRICATION_DEGRADATION') {
      currentStateText = 'LUBRICATION CAVITATION';
      faultText = 'OIL PRESSURE LOSS / BEARING WEAR';
      stateColor = 'var(--status-critical)';
    } else if (s.diagnosticResult.faultClass === 'RPM_INSTABILITY') {
      currentStateText = 'RPM INSTABILITY';
      faultText = 'SPEED GOVERNOR HUNTING';
      stateColor = 'var(--status-warning)';
    }

    if (diagAssState) {
      diagAssState.textContent = currentStateText;
      diagAssState.style.color = stateColor;
    }
    if (diagAssScore) diagAssScore.textContent = s.anomalyScore.toFixed(2);
    if (diagAssFault) diagAssFault.textContent = faultText;

    // Evaluation Evidence List (P1)
    const evidenceList = document.getElementById('diag-evidence-list');
    const confBadge = document.getElementById('diag-conf-badge');
    if (confBadge && s.diagnosticResult.confidencePct !== undefined) {
      confBadge.textContent = `CONF: ${s.diagnosticResult.confidencePct}%`;
    }
    if (evidenceList && s.diagnosticResult.evidence) {
      evidenceList.innerHTML = s.diagnosticResult.evidence.map(item => `
        <div style="display: flex; justify-content: space-between; align-items: center; padding: 2px 0; border-bottom: 1px dashed rgba(255,255,255,0.06);">
          <span>&bull; ${item.param}</span>
          <span style="font-family: var(--font-mono); color: var(--text-primary); font-weight: 600;">${item.val} <span style="font-size: 0.6rem; color: var(--text-muted);">(${item.weight})</span></span>
        </div>
      `).join('');
    }

    // Deterministic Maintenance Advisory (P2)
    const maintSub = document.getElementById('maint-subsystem-val');
    const maintBadge = document.getElementById('maint-priority-badge');
    const maintAction = document.getElementById('maint-action-text');
    const maintCode = document.getElementById('maint-code-val');
    const maintUrgency = document.getElementById('maint-urgency-val');
    const maint = s.maintenance || (s.diagnosticResult && s.diagnosticResult.maintenanceAdvisory);

    if (maint && maintSub && maintBadge && maintAction) {
      maintSub.textContent = maint.subsystem;
      maintBadge.textContent = maint.priority;
      maintBadge.className = `maint-priority-badge badge-${maint.priority === 'ROUTINE' ? 'nominal' : (maint.priority === 'HIGH' ? 'warning' : 'critical')}`;
      maintAction.textContent = maint.action;
      if (maintCode) maintCode.textContent = `CODE: ${maint.code || 'MAINT-001'}`;
      if (maintUrgency) maintUrgency.textContent = maint.urgency || 'Standard cycle';
    }
  }

  // ==========================================================================
  // SECTION 6: ENGINE DEGRADATION & RUL
  // ==========================================================================
  function renderDegradationSection(s) {
    const curDegVal = document.getElementById('deg-current-val');
    const degTrendVal = document.getElementById('deg-trend-val');
    const degRulVal = document.getElementById('deg-rul-val');

    if (curDegVal) curDegVal.textContent = `${s.degradationPct}%`;
    if (degTrendVal) {
      degTrendVal.textContent = s.degradationTrend;
      degTrendVal.style.color = s.degradationPct > 20 ? 'var(--status-critical)' : 'var(--status-nominal)';
    }
    if (degRulVal) degRulVal.textContent = s.rulLabel;

    renderDegradationChart();
  }

  function renderDegradationChart() {
    if (!chartCtx || !chartCanvas) return;
    const dims = setupChartCanvas();
    if (!dims) return;
    const { w, h, dpr } = dims;
    if (w <= 0 || h <= 0) return;

    const ctx = chartCtx;
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const padLeft = 48;
    const padRight = 24;
    const padTop = 34;
    const padBottom = 30;
    const plotW = Math.max(80, w - padLeft - padRight);
    const plotH = Math.max(80, h - padTop - padBottom);

    const s = window.appState || {};
    const isThermal = currentScenarioKey === 'thermal_degradation' || (s.aiDiagnosis && s.aiDiagnosis.includes('THERMAL'));
    const currentDeg = typeof s.degradationPct === 'number' ? s.degradationPct : (isThermal ? 38 : 4.0);

    // 1. Safe Zone Shading (0% to 15%)
    const safeTopY = padTop + plotH - (15 / 50) * plotH;
    const safeH = (15 / 50) * plotH;
    const safeGrad = ctx.createLinearGradient(0, safeTopY, 0, safeTopY + safeH);
    safeGrad.addColorStop(0, 'rgba(16, 185, 129, 0.08)');
    safeGrad.addColorStop(1, 'rgba(16, 185, 129, 0.02)');
    ctx.fillStyle = safeGrad;
    ctx.fillRect(padLeft, safeTopY, plotW, safeH);

    // 2. Critical Zone Shading (40% to 50%)
    const critTopY = padTop;
    const critH = (10 / 50) * plotH;
    const critZoneGrad = ctx.createLinearGradient(0, critTopY, 0, critTopY + critH);
    critZoneGrad.addColorStop(0, 'rgba(239, 68, 68, 0.08)');
    critZoneGrad.addColorStop(1, 'rgba(239, 68, 68, 0.01)');
    ctx.fillStyle = critZoneGrad;
    ctx.fillRect(padLeft, critTopY, plotW, critH);

    // 3. Gridlines & Y-Axis (0% to 50% Degradation)
    ctx.font = '10px JetBrains Mono, monospace';
    ctx.textAlign = 'right';

    for (let pct = 0; pct <= 50; pct += 10) {
      const y = padTop + plotH - (pct / 50) * plotH;
      ctx.strokeStyle = pct === 0 ? '#334155' : 'rgba(255, 255, 255, 0.06)';
      ctx.lineWidth = pct === 0 ? 1.5 : 1;
      ctx.beginPath();
      ctx.moveTo(padLeft, y);
      ctx.lineTo(w - padRight, y);
      ctx.stroke();

      ctx.fillStyle = pct >= 40 ? '#F87171' : (pct >= 25 ? '#FBBF24' : '#94A3B8');
      ctx.fillText(`${pct}%`, padLeft - 8, y + 3.5);
    }

    // 4. X-Axis Time (Mission Timeline: 13:00 to 16:00)
    const timeLabels = ['13:00', '13:30', '14:00', '14:30', '15:00', '15:30', '16:00'];
    ctx.textAlign = 'center';
    ctx.font = '9.5px JetBrains Mono, monospace';
    ctx.fillStyle = '#64748B';

    timeLabels.forEach((t, i) => {
      const x = padLeft + (i / (timeLabels.length - 1)) * plotW;
      // Vertical gridline
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.035)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, padTop);
      ctx.lineTo(x, padTop + plotH);
      ctx.stroke();

      ctx.fillText(t, x, padTop + plotH + 16);
    });

    // 5. Warning Threshold Line (25%)
    const warnY = padTop + plotH - (25 / 50) * plotH;
    ctx.strokeStyle = 'rgba(245, 158, 11, 0.4)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(padLeft, warnY);
    ctx.lineTo(w - padRight, warnY);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#FBBF24';
    ctx.textAlign = 'right';
    ctx.font = '8.5px JetBrains Mono, monospace';
    ctx.fillText('WARNING (25%)', w - padRight - 4, warnY - 4);

    // 6. Critical Degradation Threshold Line (40%)
    const critY = padTop + plotH - (40 / 50) * plotH;
    ctx.strokeStyle = 'rgba(239, 68, 68, 0.65)';
    ctx.lineWidth = 1.2;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(padLeft, critY);
    ctx.lineTo(w - padRight, critY);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#F87171';
    ctx.textAlign = 'right';
    ctx.font = '9px JetBrains Mono, monospace';
    ctx.fillText('CRITICAL THRESHOLD (40%)', w - padRight - 4, critY - 4);

    // 7. Header Legend (at top y = 14)
    ctx.textAlign = 'left';
    ctx.font = '9px Inter, sans-serif';

    // Dot 1: History
    ctx.fillStyle = isThermal ? '#EF4444' : '#10B981';
    ctx.beginPath();
    ctx.arc(padLeft + 4, 14, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#E2E8F0';
    ctx.fillText('Wear History', padLeft + 12, 17);

    // Dash 2: Projection
    ctx.strokeStyle = isThermal ? 'rgba(239, 68, 68, 0.75)' : 'rgba(0, 240, 255, 0.75)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(padLeft + 90, 14);
    ctx.lineTo(padLeft + 104, 14);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#E2E8F0';
    ctx.fillText('Forecast Trajectory', padLeft + 110, 17);

    // Box 3: Safe Zone
    ctx.fillStyle = 'rgba(16, 185, 129, 0.25)';
    ctx.fillRect(padLeft + 224, 10, 10, 8);
    ctx.strokeStyle = 'rgba(16, 185, 129, 0.6)';
    ctx.strokeRect(padLeft + 224, 10, 10, 8);
    ctx.fillStyle = '#10B981';
    ctx.fillText('Nominal Safe Zone (<15%)', padLeft + 238, 17);

    // 8. Plot Data Trajectory
    ctx.lineWidth = 2.5;

    if (isThermal) {
      // Thermal Runaway: Rapid increase past 14:30
      const points = [
        { t: 0, deg: 2.0 },
        { t: 0.2, deg: 2.5 },
        { t: 0.4, deg: 3.2 },
        { t: 0.5, deg: 4.2 },
        { t: 0.55, deg: 14.0 },
        { t: 0.65, deg: Math.max(28, currentDeg) }
      ];

      // Area Fill
      ctx.beginPath();
      points.forEach((p, idx) => {
        const px = padLeft + p.t * plotW;
        const py = padTop + plotH - (p.deg / 50) * plotH;
        if (idx === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      const lastP = points[points.length - 1];
      const lastX = padLeft + lastP.t * plotW;
      const lastY = padTop + plotH - (lastP.deg / 50) * plotH;
      ctx.lineTo(lastX, padTop + plotH);
      ctx.lineTo(padLeft, padTop + plotH);
      ctx.closePath();

      const areaGrad = ctx.createLinearGradient(0, padTop, 0, padTop + plotH);
      areaGrad.addColorStop(0, 'rgba(239, 68, 68, 0.25)');
      areaGrad.addColorStop(1, 'rgba(239, 68, 68, 0.01)');
      ctx.fillStyle = areaGrad;
      ctx.fill();

      // Stroke Line
      ctx.strokeStyle = '#EF4444';
      ctx.beginPath();
      points.forEach((p, idx) => {
        const px = padLeft + p.t * plotW;
        const py = padTop + plotH - (p.deg / 50) * plotH;
        if (idx === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.stroke();

      // Current Point Marker
      ctx.fillStyle = 'rgba(239, 68, 68, 0.25)';
      ctx.beginPath();
      ctx.arc(lastX, lastY, 9, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#EF4444';
      ctx.beginPath();
      ctx.arc(lastX, lastY, 4.5, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.arc(lastX, lastY, 2, 0, Math.PI * 2);
      ctx.fill();

      // Forecast Trajectory (dashed)
      ctx.strokeStyle = 'rgba(239, 68, 68, 0.75)';
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(lastX, lastY);
      const projX = padLeft + 0.88 * plotW;
      const projY = padTop + plotH - (48 / 50) * plotH;
      ctx.lineTo(projX, projY);
      ctx.stroke();
      ctx.setLineDash([]);

      // Callout Tag
      ctx.fillStyle = '#EF4444';
      ctx.font = 'bold 9px JetBrains Mono, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`CURRENT: ${Math.round(currentDeg)}% (THERMAL RUNAWAY)`, Math.min(w - padRight - 80, Math.max(padLeft + 80, lastX)), Math.max(padTop + 24, lastY - 14));

    } else {
      // Normal & Sensor Fault (Stable nominal curve)
      const points = [
        { t: 0, deg: 2.0 },
        { t: 0.2, deg: 2.4 },
        { t: 0.4, deg: 3.1 },
        { t: 0.55, deg: currentDeg }
      ];

      // Area Fill
      ctx.beginPath();
      points.forEach((p, idx) => {
        const px = padLeft + p.t * plotW;
        const py = padTop + plotH - (p.deg / 50) * plotH;
        if (idx === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      const lastP = points[points.length - 1];
      const lastX = padLeft + lastP.t * plotW;
      const lastY = padTop + plotH - (lastP.deg / 50) * plotH;
      ctx.lineTo(lastX, padTop + plotH);
      ctx.lineTo(padLeft, padTop + plotH);
      ctx.closePath();

      const areaGrad = ctx.createLinearGradient(0, padTop, 0, padTop + plotH);
      areaGrad.addColorStop(0, 'rgba(16, 185, 129, 0.18)');
      areaGrad.addColorStop(1, 'rgba(16, 185, 129, 0.01)');
      ctx.fillStyle = areaGrad;
      ctx.fill();

      // Stroke Line
      ctx.strokeStyle = '#10B981';
      ctx.beginPath();
      points.forEach((p, idx) => {
        const px = padLeft + p.t * plotW;
        const py = padTop + plotH - (p.deg / 50) * plotH;
        if (idx === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.stroke();

      // Current Point Marker
      ctx.fillStyle = 'rgba(16, 185, 129, 0.25)';
      ctx.beginPath();
      ctx.arc(lastX, lastY, 8, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#10B981';
      ctx.beginPath();
      ctx.arc(lastX, lastY, 4, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.arc(lastX, lastY, 1.8, 0, Math.PI * 2);
      ctx.fill();

      // Forecast Trajectory (dashed)
      ctx.strokeStyle = 'rgba(0, 240, 255, 0.7)';
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(lastX, lastY);
      const projX = padLeft + 1.0 * plotW;
      const projY = padTop + plotH - (5.4 / 50) * plotH;
      ctx.lineTo(projX, projY);
      ctx.stroke();
      ctx.setLineDash([]);

      // Callout Tag
      ctx.fillStyle = '#10B981';
      ctx.font = 'bold 9px JetBrains Mono, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`CURRENT: ${currentDeg.toFixed(1)}% (NOMINAL)`, Math.min(w - padRight - 60, Math.max(padLeft + 60, lastX)), Math.max(padTop + 24, lastY - 14));
    }

    ctx.restore();
  }

  // ==========================================================================
  // SECTION 8: MISSION TIMELINE & SCRUBBING
  // ==========================================================================
  function renderTimelineDisplay(s) {
    const timeDisplay = document.getElementById('timeline-time-val');
    if (timeDisplay) {
      timeDisplay.style.cursor = 'pointer';
      if (s.isReplaying) {
        const sec = (s.replayIndex !== null && s.replayIndex !== undefined) ? s.replayIndex : 0;
        timeDisplay.textContent = `REPLAY • T+${sec}.0s (${s.simTime})`;
        timeDisplay.style.color = 'var(--status-warning)';
        timeDisplay.title = 'Replaying historical snapshot. Click to return to LIVE simulation.';
      } else {
        timeDisplay.textContent = `LIVE • ${s.simTime}`;
        timeDisplay.style.color = 'var(--accent-blue)';
        timeDisplay.title = 'Live simulation active. Scrub slider below to inspect historical timeline.';
      }
    }

    // Highlight active phase node based on derived phase
    const phaseNames = ['IDLE', 'TAKEOFF', 'CLIMB', 'CRUISE', 'LOITER', 'RETURN', 'LANDING'];
    const currentPhase = (s.missionPhase || 'cruise').toUpperCase();
    const activeIdx = phaseNames.indexOf(currentPhase) >= 0 ? phaseNames.indexOf(currentPhase) : 3;

    const nodes = document.querySelectorAll('.timeline-phase-node');
    nodes.forEach((node, idx) => {
      node.classList.remove('active', 'passed');
      if (idx < activeIdx) node.classList.add('passed');
      else if (idx === activeIdx) node.classList.add('active');
    });
  }

  // ==========================================================================
  // SCENARIO SWITCHING LOGIC (Triggers Real Pipeline)
  // ==========================================================================
  let liveSavedSnapshot = null;

  window.applyScenario = function (scenarioKey) {
    currentScenarioKey = scenarioKey;
    window.appState.scenario = scenarioKey;

    // Update Scenario Buttons
    document.querySelectorAll('.btn-scenario').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.scenario === scenarioKey);
    });

    if (!telemetryEngine || !sensorTrustEngine || !aiDiagnosticNet) return;

    // Reset replay mode back to live simulation
    telemetryEngine.pauseReplay();
    telemetryEngine.isReplaying = false;
    window.appState.isReplaying = false;
    window.appState.replayIndex = null;
    liveSavedSnapshot = null;

    // Reset Sensor Trust history for clean scenario evaluation
    sensorTrustEngine.reset();

    const slider = document.getElementById('timeline-slider');
    if (slider) slider.value = 100;

    if (scenarioKey === 'normal') {
      telemetryEngine.setScenario('nominal');
    } else if (scenarioKey === 'sensor_fault') {
      // SCENARIO B: SENSOR FAULT (FREEZE)
      telemetryEngine.setScenario('sensor_freeze');
      // Pre-seed identical oil pressure points in sensorTrustEngine history for zero-latency detection
      for (let i = 0; i < 12; i++) {
        sensorTrustEngine.history.oilPress.push(52.4);
        sensorTrustEngine.history.rpm.push(4200 + (i % 3) * 15);
        sensorTrustEngine.history.load.push(72 + (i % 2) * 2);
      }
    } else if (scenarioKey === 'sensor_drift') {
      telemetryEngine.setScenario('sensor_drift');
    } else if (scenarioKey === 'thermal_degradation') {
      // SCENARIO C: REAL THERMAL DEGRADATION
      telemetryEngine.setScenario('thermal_degradation');
    } else if (scenarioKey === 'lubrication_degradation') {
      telemetryEngine.setScenario('lubrication_degradation');
    } else if (scenarioKey === 'rpm_instability') {
      telemetryEngine.setScenario('rpm_instability');
    }

    // Force an immediate synchronous compute step so UI updates instantly
    telemetryEngine.computePhysicsStep();
    executePipelineStep(telemetryEngine.state, telemetryEngine.expected);
  };

  // ==========================================================================
  // EXIT REPLAY MODE (Restores Live Simulation)
  // ==========================================================================
  window.exitReplayMode = function () {
    if (!telemetryEngine) return;
    window.appState.isReplaying = false;
    window.appState.replayIndex = null;
    telemetryEngine.isReplaying = false;

    const slider = document.getElementById('timeline-slider');
    if (slider) slider.value = 100;

    if (liveSavedSnapshot) {
      Object.assign(window.appState, liveSavedSnapshot, {
        isReplaying: false,
        replayIndex: null
      });
      liveSavedSnapshot = null;
    }

    telemetryEngine.computePhysicsStep();
    executePipelineStep(telemetryEngine.state, telemetryEngine.expected);
  };

  // ==========================================================================
  // JUMP TO HISTORICAL MISSION REPLAY MOMENT (Pure Immutable Snapshot Restore)
  // ==========================================================================
  window.jumpToReplaySecond = function (sec) {
    if (!telemetryEngine) return;

    const targetSec = Math.max(0, Math.min(100, Math.floor(sec)));

    // Save live state on initial transition from live to replay
    if (!window.appState.isReplaying) {
      liveSavedSnapshot = captureAppStateSnapshot();
    }

    window.appState.isReplaying = true;
    window.appState.replayIndex = targetSec;
    telemetryEngine.isReplaying = true;

    // Sync slider position if not already at targetSec
    const slider = document.getElementById('timeline-slider');
    if (slider && parseInt(slider.value, 10) !== targetSec) {
      slider.value = targetSec;
    }

    // 1. FETCH IMMUTABLE CLONED HISTORICAL SNAPSHOT
    const snapshot = telemetryEngine.getReplaySnapshot(targetSec);
    if (!snapshot) return;

    // 2. RESTORE appState WITH THE EXACT PRE-RECORDED SNAPSHOT
    // CRITICAL: NEVER call telemetry generation, physics recalculation,
    // SensorTrustEngine.evaluate(), or AI diagnostic evaluation during replay!
    Object.assign(window.appState, snapshot, {
      isReplaying: true,
      replayIndex: targetSec
    });

    currentScenarioKey = snapshot.scenario || 'normal';

    // Update scenario button highlights
    document.querySelectorAll('.btn-scenario').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.scenario === currentScenarioKey);
    });

    // 3. RENDER ALL DASHBOARD SECTIONS DIRECTLY FROM appState
    renderDashboard();

    // 4. SYNCHRONIZE 3D ENGINE STATE FROM SNAPSHOT
    if (digitalTwin && snapshot.rawTelemetry) {
      const avgCht = snapshot.rawTelemetry.cht ? (snapshot.rawTelemetry.cht.reduce((a, b) => a + b, 0) / snapshot.rawTelemetry.cht.length) : 178;
      const avgEgt = snapshot.rawTelemetry.egt ? (snapshot.rawTelemetry.egt.reduce((a, b) => a + b, 0) / snapshot.rawTelemetry.egt.length) : 824;
      const oilPressTrust = (snapshot.trustResult && snapshot.trustResult.scores && snapshot.trustResult.scores.oilPress !== undefined)
        ? snapshot.trustResult.scores.oilPress
        : 1.0;

      digitalTwin.updateState({
        rpm: snapshot.rawTelemetry.rpm,
        status: snapshot.diagnosticResult ? snapshot.diagnosticResult.status : 'HEALTHY',
        oilPressTrust: oilPressTrust,
        cht: avgCht,
        egt: avgEgt
      }, currentScenarioKey);
    }
  };

  // Live Telemetry Strip on Mission Brief Screen
  function updateBriefTelemetryStrip(rawState, diagResult) {
    if (!rawState) return;
    const rpmEl = document.getElementById('brief-val-rpm');
    const chtEl = document.getElementById('brief-val-cht');
    const egtEl = document.getElementById('brief-val-egt');
    const oilpEl = document.getElementById('brief-val-oilp');
    const ehiEl = document.getElementById('brief-val-ehi');

    if (rpmEl) rpmEl.textContent = Math.round(rawState.rpm).toLocaleString();
    if (chtEl) {
      const avgCht = Array.isArray(rawState.cht) ? (rawState.cht.reduce((a, b) => a + b, 0) / rawState.cht.length) : (rawState.cht || 166.2);
      chtEl.textContent = `${avgCht.toFixed(1)}°C`;
    }
    if (egtEl) {
      const avgEgt = Array.isArray(rawState.egt) ? (rawState.egt.reduce((a, b) => a + b, 0) / rawState.egt.length) : (rawState.egt || 781.7);
      egtEl.textContent = `${avgEgt.toFixed(1)}°C`;
    }
    if (oilpEl) {
      const oilP = rawState.oilPress !== undefined ? rawState.oilPress : 53.3;
      oilpEl.textContent = `${oilP.toFixed(1)} PSI`;
    }
    if (ehiEl) {
      const ehi = Math.round(diagResult && diagResult.healthIndex !== undefined ? diagResult.healthIndex : 96);
      ehiEl.textContent = ehi;
      ehiEl.style.color = ehi >= 85 ? '#10B981' : (ehi >= 60 ? '#F59E0B' : '#EF4444');
    }
  }

  // ==========================================================================
  // EVENT LISTENERS & MODALS
  // ==========================================================================
  function initUIEventListeners() {
    // 0. Initial Mission Brief Boot Sequence Progression (~1.4s)
    const bootOverlay = document.getElementById('brief-boot-sequence');
    if (bootOverlay) {
      let isBootFinished = false;
      const completeBoot = () => {
        if (isBootFinished) return;
        isBootFinished = true;
        bootOverlay.classList.add('boot-complete');
        setTimeout(() => {
          bootOverlay.style.display = 'none';
        }, 400);
      };

      // Click to skip boot animation immediately
      bootOverlay.addEventListener('click', completeBoot);

      const l1 = bootOverlay.querySelector('.line-1');
      const l2 = bootOverlay.querySelector('.line-2');
      const l3 = bootOverlay.querySelector('.line-3');
      const l4 = bootOverlay.querySelector('.line-4');

      setTimeout(() => { if (l1 && !isBootFinished) l1.classList.add('active'); }, 180);
      setTimeout(() => { if (l2 && !isBootFinished) l2.classList.add('active'); }, 520);
      setTimeout(() => { if (l3 && !isBootFinished) l3.classList.add('active'); }, 840);
      setTimeout(() => { if (l4 && !isBootFinished) l4.classList.add('active'); }, 1140);
      setTimeout(() => { completeBoot(); }, 1450);
    }

    // Mission Brief Pre-UI Landing Transition to Live Dashboard
    const enterMissionBtn = document.getElementById('btn-enter-mission-control');
    const briefScreen = document.getElementById('mission-brief-screen');
    if (enterMissionBtn && briefScreen) {
      enterMissionBtn.addEventListener('click', () => {
        document.body.classList.remove('brief-active');
        briefScreen.classList.add('brief-fade-out');
        // Render dashboard state immediately as transition starts
        renderDashboard();
        setTimeout(() => {
          briefScreen.style.display = 'none';
          // Trigger layout recalculations and resizes for 3D and Mapbox
          window.dispatchEvent(new Event('resize'));
          if (digitalTwin && typeof digitalTwin.resize === 'function') {
            digitalTwin.resize();
          }
          if (missionMap && missionMap.map && typeof missionMap.map.resize === 'function') {
            missionMap.map.resize();
          }
        }, 380);
      });
    }

    window.openMissionBrief = function () {
      if (briefScreen) {
        document.body.classList.add('brief-active');
        briefScreen.style.display = 'flex';
        void briefScreen.offsetHeight;
        briefScreen.classList.remove('brief-fade-out');
      }
    };

    window.enterMissionControl = function () {
      if (enterMissionBtn) {
        enterMissionBtn.click();
      }
    };

    // Scenario Buttons
    document.querySelectorAll('.btn-scenario').forEach(btn => {
      btn.addEventListener('click', () => {
        window.applyScenario(btn.dataset.scenario);
      });
    });

    // 7 Mission Phase Segment Markers (Continuous Timeline Jump Points)
    const phaseTimestamps = {
      idle: 0,
      takeoff: 19,
      climb: 33,
      cruise: 49,
      loiter: 70,
      return: 76,
      landing: 89
    };
    document.querySelectorAll('.timeline-phase-node').forEach(node => {
      node.addEventListener('click', () => {
        const phase = (node.dataset.phase || '').toLowerCase();
        if (phase in phaseTimestamps) {
          window.jumpToReplaySecond(phaseTimestamps[phase]);
        }
      });
    });

    // Fault Injection Severity Slider (P1 Controlled Fault Injection)
    const severitySlider = document.getElementById('fault-severity-slider');
    const severityVal = document.getElementById('fault-severity-val');
    if (severitySlider && telemetryEngine) {
      severitySlider.addEventListener('input', (e) => {
        const val = parseInt(e.target.value, 10);
        if (severityVal) severityVal.textContent = `${val}%`;
        telemetryEngine.setFaultSeverity(val);
        // If in an active fault scenario, re-trigger compute step
        if (currentScenarioKey !== 'normal') {
          telemetryEngine.computePhysicsStep();
          executePipelineStep(telemetryEngine.state, telemetryEngine.expected);
        }
      });
    }

    // Environmental Modifiers (P1)
    const btnEnvAlt = document.getElementById('btn-env-altitude');
    const btnEnvWeather = document.getElementById('btn-env-weather');
    const btnEnvThrottle = document.getElementById('btn-env-throttle');

    if (btnEnvAlt && telemetryEngine) {
      btnEnvAlt.addEventListener('click', () => {
        const mods = telemetryEngine.toggleEnvironmentModifier('highAltitude');
        btnEnvAlt.classList.toggle('active', !!mods.highAltitude);
        telemetryEngine.computePhysicsStep();
        executePipelineStep(telemetryEngine.state, telemetryEngine.expected);
      });
    }

    if (btnEnvWeather && telemetryEngine) {
      btnEnvWeather.addEventListener('click', () => {
        const mods = telemetryEngine.toggleEnvironmentModifier('hotWeather');
        btnEnvWeather.classList.toggle('active', !!mods.hotWeather);
        telemetryEngine.computePhysicsStep();
        executePipelineStep(telemetryEngine.state, telemetryEngine.expected);
      });
    }

    if (btnEnvThrottle && telemetryEngine) {
      btnEnvThrottle.addEventListener('click', () => {
        btnEnvThrottle.classList.add('active');
        telemetryEngine.toggleEnvironmentModifier('rapidThrottle');
        telemetryEngine.computePhysicsStep();
        executePipelineStep(telemetryEngine.state, telemetryEngine.expected);
        setTimeout(() => {
          btnEnvThrottle.classList.remove('active');
        }, 4000);
      });
    }

    // Twin View Buttons (ISO, TOP, FRONT, SENSORS)
    document.querySelectorAll('.btn-twin-mode').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.btn-twin-mode').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        if (digitalTwin) digitalTwin.setView(btn.dataset.view);
      });
    });

    // Continuous Mission Replay Timeline Scrubbing (0s to 100s)
    // Every integer second 0s through 100s corresponds to an immutable recorded historical frame.
    const slider = document.getElementById('timeline-slider');
    if (slider && telemetryEngine) {
      slider.addEventListener('input', (e) => {
        const val = parseInt(e.target.value, 10);
        window.jumpToReplaySecond(val);
      });
    }

    // Clicking Mission Elapsed Time Display exits replay mode and returns to live simulation
    const timeDisplay = document.getElementById('timeline-time-val');
    if (timeDisplay) {
      timeDisplay.addEventListener('click', () => {
        if (window.appState && window.appState.isReplaying) {
          window.exitReplayMode();
        }
      });
    }

    // Event Milestones (Navigates to exact event seconds on continuous timeline):
    // 1. Baseline Cruise (t=60s)
    // 2. Oil Transducer Frozen (t=64s)
    // 3. Sensor Quarantined (t=71s)
    // 4. Thermal Distress Injected (t=80s)
    // 5. Thermal Runaway Classified (t=82s)
    // 6. EHI Reduced / RUL 48h (t=84s)
    const markerBaseline = document.getElementById('marker-norm-baseline');
    const markerSensorFault = document.getElementById('marker-sensor-fault');
    const markerSensorQuar = document.getElementById('marker-sensor-quar');
    const markerThermalDeg = document.getElementById('marker-thermal-deg');
    const markerThermalClass = document.getElementById('marker-thermal-class');
    const markerRulRevise = document.getElementById('marker-rul-revise');

    if (markerBaseline) markerBaseline.addEventListener('click', () => window.jumpToReplaySecond(60));
    if (markerSensorFault) markerSensorFault.addEventListener('click', () => window.jumpToReplaySecond(64));
    if (markerSensorQuar) markerSensorQuar.addEventListener('click', () => window.jumpToReplaySecond(71));
    if (markerThermalDeg) markerThermalDeg.addEventListener('click', () => window.jumpToReplaySecond(80));
    if (markerThermalClass) markerThermalClass.addEventListener('click', () => window.jumpToReplaySecond(82));
    if (markerRulRevise) markerRulRevise.addEventListener('click', () => window.jumpToReplaySecond(84));

    // Modal: Contributing Parameters
    const btnExplainParams = document.getElementById('btn-explain-params');
    const modalParams = document.getElementById('modal-params');
    const btnCloseParams = document.getElementById('btn-close-params');

    if (btnExplainParams && modalParams) {
      btnExplainParams.addEventListener('click', () => {
        renderModalParameters();
        modalParams.classList.add('open');
      });
    }
    if (btnCloseParams && modalParams) {
      btnCloseParams.addEventListener('click', () => modalParams.classList.remove('open'));
    }

    // Modal: Explain Diagnosis
    const btnExplainDiag = document.getElementById('btn-explain-diag');
    const modalDiag = document.getElementById('modal-diagnosis');
    const btnCloseDiag = document.getElementById('btn-close-diag');

    if (btnExplainDiag && modalDiag) {
      btnExplainDiag.addEventListener('click', () => {
        renderModalDiagnosis();
        modalDiag.classList.add('open');
      });
    }
    if (btnCloseDiag && modalDiag) {
      btnCloseDiag.addEventListener('click', () => modalDiag.classList.remove('open'));
    }

    // Modal: EHI Explainability Breakdown (P0/P1)
    const btnInspectEhi = document.getElementById('btn-inspect-ehi');
    const modalEhi = document.getElementById('modal-ehi-breakdown');
    const btnCloseEhi = document.getElementById('btn-close-ehi');

    if (btnInspectEhi && modalEhi) {
      btnInspectEhi.addEventListener('click', () => {
        renderModalEhiBreakdown();
        modalEhi.classList.add('open');
      });
    }
    if (btnCloseEhi && modalEhi) {
      btnCloseEhi.addEventListener('click', () => modalEhi.classList.remove('open'));
    }

    // Modal: Mission Reliability Contributor Breakdown (Operating-Condition Aware)
    const btnInspectRel = document.getElementById('btn-inspect-reliability');
    const modalRel = document.getElementById('modal-reliability-breakdown');
    const btnCloseRel = document.getElementById('btn-close-reliability');

    if (btnInspectRel && modalRel) {
      btnInspectRel.addEventListener('click', () => {
        renderModalReliabilityBreakdown();
        modalRel.classList.add('open');
      });
    }
    if (btnCloseRel && modalRel) {
      btnCloseRel.addEventListener('click', () => modalRel.classList.remove('open'));
    }

    // Modal: ML Validation Report (P2)
    const btnOpenMl = document.getElementById('btn-ml-validation-open');
    const modalMl = document.getElementById('modal-ml-validation');
    const btnCloseMl = document.getElementById('btn-close-ml');

    if (btnOpenMl && modalMl) {
      btnOpenMl.addEventListener('click', () => {
        modalMl.classList.add('open');
      });
    }
    if (btnCloseMl && modalMl) {
      btnCloseMl.addEventListener('click', () => modalMl.classList.remove('open'));
    }

    // Close Modals on Backdrop Click
    document.querySelectorAll('.modal-backdrop').forEach(modal => {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.classList.remove('open');
      });
    });
  }

  // ==========================================================================
  // DYNAMIC MODALS: CONTRIBUTING PARAMETERS & EXPLAIN DIAGNOSIS
  // ==========================================================================
  function renderModalParameters() {
    const list = document.getElementById('param-bars-list');
    const note = document.getElementById('param-modal-note');
    if (!list) return;

    const s = window.appState;
    const diag = s.diagnosticResult;
    const params = (diag && diag.contributingParameters && diag.contributingParameters.length > 0)
      ? diag.contributingParameters.slice(0, 4)
      : [
          { label: 'EGT Residual', impact: 0.12 },
          { label: 'CHT Residual', impact: 0.10 },
          { label: 'Oil Press Slew', impact: 0.08 },
          { label: 'Engine Load', impact: 0.06 }
        ];

    list.innerHTML = params.map(item => {
      const pct = Math.round(item.impact * 100);
      let barColor = 'var(--status-nominal)';
      if (pct > 70) barColor = 'var(--status-critical)';
      else if (pct > 35) barColor = 'var(--status-warning)';
      else if (item.label.includes('RPM')) barColor = 'var(--accent-blue)';

      return `
        <div class="feature-bar-item">
          <span class="feature-lbl">${item.label}</span>
          <div class="feature-track">
            <div class="feature-fill" style="width: ${pct}%; background: ${barColor};"></div>
          </div>
          <span class="feature-val">${pct}%</span>
        </div>
      `;
    }).join('');

    if (note) {
      const isSensorFault = s.aiDiagnosis === 'SENSOR FAULT' || (s.diagnosticResult && s.diagnosticResult.faultClass === 'SENSOR_FAULT');
      const isThermal = s.aiDiagnosis === 'THERMAL DEGRADATION' || (s.diagnosticResult && s.diagnosticResult.faultClass === 'THERMAL_DEGRADATION');
      if (isSensorFault) {
        note.textContent = 'Decoupling observed: Oil pressure remained invariant during dynamic RPM perturbation. The Sensor Trust Engine isolated the fault to the sensor itself, leaving engine health score intact.';
      } else if (isThermal) {
        note.textContent = 'High thermal cross-correlation: Exhaust gas and cylinder head temperatures both breached nominal bounds while sensor trust remained verified. Authentic thermodynamic degradation confirmed.';
      } else {
        note.textContent = 'All parameter deviations are within ±3% of the calibrated physics baseline model. Combustion and lubrication systems are operating in optimal balance.';
      }
    }
  }

  function renderModalDiagnosis() {
    const content = document.getElementById('diag-modal-content');
    if (!content) return;

    const s = window.appState;
    const trust = s.trustResult;
    const diag = s.diagnosticResult;
    const isSensorFault = s.aiDiagnosis === 'SENSOR FAULT' || (diag && diag.faultClass === 'SENSOR_FAULT');
    const isThermal = s.aiDiagnosis === 'THERMAL DEGRADATION' || (diag && diag.faultClass === 'THERMAL_DEGRADATION');

    if (isSensorFault) {
      const oilScore = trust && trust.scores && trust.scores.oilPress !== undefined ? trust.scores.oilPress.toFixed(2) : (trust && trust.quarantined && trust.quarantined.includes('oilPress') ? '0.25' : '1.00');
      content.innerHTML = `
        <div style="background: var(--surface-0); padding: 12px; border-radius: var(--radius-sm); border: 1px solid var(--border-subtle); margin-bottom: 10px;">
          <strong style="color: var(--status-warning); font-size: 0.85rem;">Stage 1: Sensor Trust Gatekeeper</strong>
          <p style="margin-top: 4px; font-size: 0.78rem;">Evaluated signal variance of oil pressure against expected RPM correlation. Variance dropped below physical jitter threshold (0.005 PSI) while RPM fluctuated. Sensor trust penalized to <strong>${oilScore} (FAULTY)</strong> and quarantined.</p>
        </div>
        <div style="background: var(--surface-0); padding: 12px; border-radius: var(--radius-sm); border: 1px solid var(--border-subtle); margin-bottom: 10px;">
          <strong style="color: var(--accent-blue); font-size: 0.85rem;">Stage 2: Isolation Forest Anomaly Detection</strong>
          <p style="margin-top: 4px; font-size: 0.78rem;">Anomaly score computed at <strong>${s.anomalyScore.toFixed(2)}</strong>. Pre-filtered by Sensor Trust Gatekeeper to isolate transducer artifact from mechanical engine state.</p>
        </div>
        <div style="background: var(--surface-0); padding: 12px; border-radius: var(--radius-sm); border: 1px solid var(--border-subtle);">
          <strong style="color: var(--status-nominal); font-size: 0.85rem;">Stage 3: Decision Engine Conclusion</strong>
          <p style="margin-top: 4px; font-size: 0.78rem;">Classified as <strong>SENSOR FAULT</strong>. Engine Health Index protected at <strong>${Math.round(s.ehi)}/100</strong> to prevent false emergency abort of UAV cruise mission.</p>
        </div>
      `;
    } else if (isThermal) {
      const egtScore = (trust && trust.scores && trust.scores.egt) ? (trust.scores.egt.reduce((a, b) => a + b, 0) / 4).toFixed(2) : '0.95';
      const chtScore = (trust && trust.scores && trust.scores.cht) ? (trust.scores.cht.reduce((a, b) => a + b, 0) / 4).toFixed(2) : '0.96';
      content.innerHTML = `
        <div style="background: var(--surface-0); padding: 12px; border-radius: var(--radius-sm); border: 1px solid var(--border-subtle); margin-bottom: 10px;">
          <strong style="color: var(--status-nominal); font-size: 0.85rem;">Stage 1: Sensor Trust Gatekeeper</strong>
          <p style="margin-top: 4px; font-size: 0.78rem;">Cross-correlated EGT (${egtScore}) and CHT (${chtScore}) channels with fuel flow rate. Signals exhibit natural physics noise and continuous derivative. Sensors declared <strong>TRUSTED</strong>.</p>
        </div>
        <div style="background: var(--surface-0); padding: 12px; border-radius: var(--radius-sm); border: 1px solid var(--border-subtle); margin-bottom: 10px;">
          <strong style="color: var(--status-critical); font-size: 0.85rem;">Stage 2: Isolation Forest Anomaly Detection</strong>
          <p style="margin-top: 4px; font-size: 0.78rem;">Severe multi-dimensional out-of-distribution point detected. Anomaly score surged to <strong>${s.anomalyScore.toFixed(2)}</strong> across cylinder heads and exhaust manifolds.</p>
        </div>
        <div style="background: var(--surface-0); padding: 12px; border-radius: var(--radius-sm); border: 1px solid var(--border-subtle);">
          <strong style="color: var(--status-critical); font-size: 0.85rem;">Stage 3: Random Forest Classifier</strong>
          <p style="margin-top: 4px; font-size: 0.78rem;">Identified failure signature matching <strong>CYLINDER THERMAL RUNAWAY</strong>. EHI downgraded to <strong>${Math.round(s.ehi)}/100</strong>; RUL forecast depleted to <strong>${s.rulLabel}</strong>.</p>
        </div>
      `;
    } else {
      content.innerHTML = `
        <div style="background: var(--surface-0); padding: 12px; border-radius: var(--radius-sm); border: 1px solid var(--border-subtle); margin-bottom: 10px;">
          <strong style="color: var(--status-nominal); font-size: 0.85rem;">Stage 1: Sensor Trust Gatekeeper</strong>
          <p style="margin-top: 4px; font-size: 0.78rem;">All 9 telemetry streams verified for slew rate, variance, and cross-correlation. Overall trust index: <strong>${s.overallTrust.toFixed(2)} (NOMINAL)</strong>.</p>
        </div>
        <div style="background: var(--surface-0); padding: 12px; border-radius: var(--radius-sm); border: 1px solid var(--border-subtle); margin-bottom: 10px;">
          <strong style="color: var(--status-nominal); font-size: 0.85rem;">Stage 2: Isolation Forest Anomaly Detection</strong>
          <p style="margin-top: 4px; font-size: 0.78rem;">Anomaly score is <strong>${s.anomalyScore.toFixed(2)}</strong>, well inside the nominal operating envelope threshold (0.20).</p>
        </div>
        <div style="background: var(--surface-0); padding: 12px; border-radius: var(--radius-sm); border: 1px solid var(--border-subtle);">
          <strong style="color: var(--accent-blue); font-size: 0.85rem;">Stage 3: Health Aggregation</strong>
          <p style="margin-top: 4px; font-size: 0.78rem;">Engine is categorized as <strong>HEALTHY</strong>. EHI is <strong>${Math.round(s.ehi)}/100</strong>. Projected RUL is stable at <strong>${s.rulLabel}</strong>.</p>
        </div>
      `;
    }
  }

  function renderModalEhiBreakdown() {
    const container = document.getElementById('ehi-breakdown-details');
    if (!container) return;
    const s = window.appState;
    const b = s.ehiBreakdown || {
      baseline: 100,
      thermalContribution: 0,
      lubricationContribution: 0,
      vibrationContribution: 0,
      sensorShieldContribution: 0,
      finalEhi: s.ehi,
      status: s.ehiStatus
    };

    container.innerHTML = `
      <div style="display: flex; justify-content: space-between; padding: 6px 10px; background: var(--surface-0); border-radius: var(--radius-sm);">
        <span>Initial Theoretical Baseline</span>
        <strong style="color: var(--status-nominal);">100.0 pts</strong>
      </div>
      <div style="display: flex; justify-content: space-between; padding: 6px 10px; background: var(--surface-0); border-radius: var(--radius-sm);">
        <span>Thermodynamic Penalty (EGT/CHT Deviation)</span>
        <strong style="color: ${b.thermalContribution < 0 ? 'var(--status-critical)' : 'var(--status-nominal)'}; font-family: var(--font-mono);">${b.thermalContribution >= 0 ? '+' : ''}${b.thermalContribution} pts</strong>
      </div>
      <div style="display: flex; justify-content: space-between; padding: 6px 10px; background: var(--surface-0); border-radius: var(--radius-sm);">
        <span>Lubrication Penalty (Trusted Oil Pressure/Temp)</span>
        <strong style="color: ${b.lubricationContribution < 0 ? 'var(--status-critical)' : 'var(--status-nominal)'}; font-family: var(--font-mono);">${b.lubricationContribution >= 0 ? '+' : ''}${b.lubricationContribution} pts</strong>
      </div>
      <div style="display: flex; justify-content: space-between; padding: 6px 10px; background: var(--surface-0); border-radius: var(--radius-sm);">
        <span>Mechanical Vibration Penalty (RMS > 2.5 mm/s)</span>
        <strong style="color: ${b.vibrationContribution < 0 ? 'var(--status-warning)' : 'var(--status-nominal)'}; font-family: var(--font-mono);">${b.vibrationContribution >= 0 ? '+' : ''}${b.vibrationContribution} pts</strong>
      </div>
      <div style="display: flex; justify-content: space-between; padding: 6px 10px; background: rgba(59, 130, 246, 0.08); border: 1px solid var(--accent-blue-border); border-radius: var(--radius-sm);">
        <span>Sensor Trust Shielding (Distrusted Transducer Compensation)</span>
        <strong style="color: var(--accent-blue); font-family: var(--font-mono);">+${b.sensorShieldContribution} pts (Protected)</strong>
      </div>
      <div style="display: flex; justify-content: space-between; padding: 8px 10px; background: var(--surface-2); border-radius: var(--radius-sm); margin-top: 4px; border: 1px solid var(--border-subtle);">
        <span style="font-weight: 700; color: var(--text-primary);">Calculated Engine Health Index (EHI)</span>
        <strong style="font-size: 1.1rem; color: ${s.ehiStatus === 'NOMINAL' ? 'var(--status-nominal)' : (s.ehiStatus === 'WARNING' ? 'var(--status-warning)' : 'var(--status-critical)')}; font-family: var(--font-mono);">${Math.round(s.ehi)} / 100 (${s.ehiStatus})</strong>
      </div>
    `;
  }

  function renderModalReliabilityBreakdown() {
    const container = document.getElementById('reliability-breakdown-details');
    const debugPre = document.getElementById('reliability-debug-pre');
    const scoreVal = document.getElementById('modal-rel-score-val');
    const statusVal = document.getElementById('modal-rel-status-val');
    const riskVal = document.getElementById('modal-rel-risk-val');
    if (!container) return;
    const s = window.appState;
    const rel = s.missionReliability || {};
    const score = rel.score !== undefined ? rel.score : 97;
    const risk = rel.riskLevel || rel.risk || 'NOMINAL';
    const status = rel.status || 'NOMINAL (GO)';

    const badgeType = score >= 88 ? 'nominal' : (score >= 75 ? 'warning' : 'critical');
    if (scoreVal) {
      scoreVal.textContent = `${score}%`;
      scoreVal.style.color = badgeType === 'nominal' ? 'var(--status-nominal)' : (badgeType === 'warning' ? 'var(--status-warning)' : 'var(--status-critical)');
    }
    if (statusVal) {
      statusVal.textContent = status;
      statusVal.className = `card-status-badge badge-${badgeType}`;
    }
    if (riskVal) {
      riskVal.textContent = risk;
      riskVal.style.color = badgeType === 'nominal' ? 'var(--status-nominal)' : (badgeType === 'warning' ? 'var(--status-warning)' : 'var(--status-critical)');
    }

    const contribs = rel.contributors || {
      baseScore: 100,
      penalties: { ehi: -1, anomaly: -1, sensorTrust: 0, confirmedFault: 0, mapEnvelope: 0, rul: 0 },
      reasons: {}
    };

    const p = contribs.penalties || {};
    const r = contribs.reasons || {};

    const items = [
      { name: 'Reliability Base Score', val: '100%', penalty: 0, reason: 'Theoretical nominal propulsion baseline under equilibrium', isBase: true },
      { name: 'Engine Health Index (EHI)', val: `${p.ehi !== undefined ? p.ehi : 0} pts`, penalty: p.ehi || 0, reason: r.ehi || `EHI evaluated at ${Math.round(s.ehi || 96)}/100` },
      { name: 'Statistical Anomaly Score', val: `${p.anomaly !== undefined ? p.anomaly : 0} pts`, penalty: p.anomaly || 0, reason: r.anomaly || `Isolation Forest anomaly score ${s.anomalyScore?.toFixed(2) || '0.18'}` },
      { name: 'Sensor Trust Confidence', val: `${p.sensorTrust !== undefined ? p.sensorTrust : 0} pts`, penalty: p.sensorTrust || 0, reason: r.sensorTrust || 'All sensor telemetry streams trusted' },
      { name: 'Confirmed Mechanical Fault', val: `${p.confirmedFault !== undefined ? p.confirmedFault : 0} pts`, penalty: p.confirmedFault || 0, reason: r.confirmedFault || 'No confirmed propulsion faults' },
      { name: 'MAP Operating Envelope', val: `${p.mapEnvelope !== undefined ? p.mapEnvelope : 0} pts`, penalty: p.mapEnvelope || 0, reason: r.mapEnvelope || 'MAP within turbocharger operating envelope' }
    ];

    if (p.rul && p.rul < 0) {
      items.push({ name: 'RUL Reserve Margin', val: `${p.rul} pts`, penalty: p.rul, reason: r.rul || 'RUL margin reserve' });
    }

    container.innerHTML = items.map(item => {
      const isBase = !!item.isBase;
      const color = isBase ? 'var(--status-nominal)' : (item.penalty < 0 ? 'var(--status-critical)' : 'var(--status-nominal)');
      return `
        <div style="display: flex; justify-content: space-between; align-items: center; padding: 7px 10px; background: var(--surface-0); border-radius: var(--radius-sm); border: 1px solid var(--border-subtle);">
          <div>
            <strong style="color: var(--text-primary); font-size: 0.78rem;">${item.name}</strong>
            <div style="font-size: 0.68rem; color: var(--text-secondary); line-height: 1.25; margin-top: 1px;">${item.reason}</div>
          </div>
          <span style="font-family: var(--font-mono); font-weight: 700; color: ${color}; font-size: 0.85rem; margin-left: 12px; white-space: nowrap;">${item.val}</span>
        </div>
      `;
    }).join('') + `
      <div style="display: flex; justify-content: space-between; padding: 8px 10px; background: var(--surface-2); border-radius: var(--radius-sm); margin-top: 4px; border: 1px solid var(--border-subtle);">
        <span style="font-weight: 700; color: var(--text-primary);">Evaluated Mission Reliability</span>
        <strong style="font-size: 1.1rem; color: ${scoreVal ? scoreVal.style.color : 'var(--status-nominal)'}; font-family: var(--font-mono);">${score}% &bull; ${risk}</strong>
      </div>
    `;

    if (debugPre) {
      debugPre.textContent = rel.debugText || `Mission Reliability: ${score}%\nRisk Level: ${risk}\n\nContributors:\nEHI: ${p.ehi !== undefined ? p.ehi : -1}\nAnomaly: ${p.anomaly !== undefined ? p.anomaly : -1}\nSensor Trust: ${p.sensorTrust !== undefined ? p.sensorTrust : 0}\nConfirmed Fault: ${p.confirmedFault !== undefined ? p.confirmedFault : 0}\nMAP envelope: ${p.mapEnvelope !== undefined ? p.mapEnvelope : 0}`;
    }
  }

  // ==========================================================================
  // AI ENGINE ASSISTANT (Context-Aware Grounded in appState)
  // ==========================================================================
  function initAssistant() {
    const chatInput = document.getElementById('chat-input');
    const sendBtn = document.getElementById('btn-chat-send');
    const chipsContainer = document.getElementById('assistant-chips');

    if (sendBtn && chatInput) {
      sendBtn.addEventListener('click', () => {
        handleUserQuery(chatInput.value);
        chatInput.value = '';
      });
      chatInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          handleUserQuery(chatInput.value);
          chatInput.value = '';
        }
      });
    }

    if (chipsContainer) {
      chipsContainer.addEventListener('click', (e) => {
        const chip = e.target.closest('.query-chip');
        if (chip) {
          handleUserQuery(chip.textContent.trim());
        }
      });
    }

    // Initial greeting
    appendAssistantMessage('ai', 'AERO TWIN Decision-Support Assistant active. All telemetry is synchronized with the physical engine digital twin. How can I assist you with the engine condition?');
  }

  // ==========================================================================
  // ASSISTANT STATE SNAPSHOT (Single Source of Truth)
  // ==========================================================================
  function getAssistantSnapshot() {
    const s = window.appState || {};
    const safeClone = (obj) => {
      if (typeof structuredClone === 'function') {
        try { return structuredClone(obj); } catch (e) {}
      }
      try {
        return JSON.parse(JSON.stringify(obj));
      } catch (e) {
        return Object.assign({}, obj);
      }
    };

    const raw = s.rawTelemetry || {};
    const exp = s.expectedPhysics || (s.physics ? s.physics.expected : {}) || {};
    const phys = s.physics || {};
    const resi = s.physicsResiduals || (phys.residuals || {});
    const trust = s.trustResult || {};
    const diag = s.diagnosticResult || {};
    const rel = s.missionReliability || {};
    const rul = s.rul || {};

    const isReplaying = !!s.isReplaying;
    const replayIndex = isReplaying ? (s.replayIndex !== undefined && s.replayIndex !== null ? s.replayIndex : 0) : null;
    const timestamp = isReplaying
      ? `T+${replayIndex}.0s (${s.simTime || 'N/A'})`
      : (s.simTime || (raw.missionTimeSec !== undefined ? `T+${raw.missionTimeSec}s` : 'LIVE'));

    const quarantined = s.quarantinedSensors || (trust.quarantined ? [...trust.quarantined] : []);

    let confidenceVal = 95;
    if (diag.confidencePct !== undefined) {
      confidenceVal = diag.confidencePct;
    } else if (diag.confidence !== undefined) {
      confidenceVal = diag.confidence > 1 ? diag.confidence : Math.round(diag.confidence * 100);
    }

    const telemetry = {
      rpm: raw.rpm !== undefined ? raw.rpm : null,
      map: raw.map !== undefined ? raw.map : null,
      fuelFlow: raw.fuelFlow !== undefined ? raw.fuelFlow : null,
      oilPress: raw.oilPress !== undefined ? raw.oilPress : null,
      oilTemp: raw.oilTemp !== undefined ? raw.oilTemp : null,
      load: raw.load !== undefined ? raw.load : null,
      vibrationRms: raw.vibrationRms !== undefined ? raw.vibrationRms : null,
      altitude: raw.altitude !== undefined ? raw.altitude : null,
      ambientTemp: raw.ambientTemp !== undefined ? raw.ambientTemp : null,
      cht: Array.isArray(raw.cht) ? [...raw.cht] : (raw.cht !== undefined ? [raw.cht] : []),
      egt: Array.isArray(raw.egt) ? [...raw.egt] : (raw.egt !== undefined ? [raw.egt] : []),
      avgCht: (Array.isArray(raw.cht) && raw.cht.length) ? (raw.cht.reduce((a, b) => a + b, 0) / raw.cht.length) : null,
      avgEgt: (Array.isArray(raw.egt) && raw.egt.length) ? (raw.egt.reduce((a, b) => a + b, 0) / raw.egt.length) : null
    };

    const expectedState = {
      rpm: exp.rpm !== undefined ? exp.rpm : telemetry.rpm,
      map: exp.map !== undefined ? exp.map : (exp.manifoldPressure !== undefined ? exp.manifoldPressure : telemetry.map),
      fuelFlow: exp.fuelFlow !== undefined ? exp.fuelFlow : telemetry.fuelFlow,
      oilPress: exp.oilPress !== undefined ? exp.oilPress : (exp.oilPressure !== undefined ? exp.oilPressure : telemetry.oilPress),
      oilTemp: exp.oilTemp !== undefined ? exp.oilTemp : telemetry.oilTemp,
      load: exp.load !== undefined ? exp.load : telemetry.load,
      cht: Array.isArray(exp.cht) ? [...exp.cht] : [],
      egt: Array.isArray(exp.egt) ? [...exp.egt] : [],
      chtAvg: exp.chtAvg !== undefined ? exp.chtAvg : (Array.isArray(exp.cht) && exp.cht.length ? (exp.cht.reduce((a, b) => a + b, 0) / exp.cht.length) : null),
      egtAvg: exp.egtAvg !== undefined ? exp.egtAvg : (Array.isArray(exp.egt) && exp.egt.length ? (exp.egt.reduce((a, b) => a + b, 0) / exp.egt.length) : null)
    };

    const residuals = {
      rpm: resi.rpm !== undefined ? resi.rpm : 0,
      map: resi.map !== undefined ? resi.map : 0,
      fuelFlow: resi.fuelFlow !== undefined ? resi.fuelFlow : 0,
      oilPress: resi.oilPress !== undefined ? resi.oilPress : 0,
      oilTemp: resi.oilTemp !== undefined ? resi.oilTemp : 0,
      cht: resi.cht !== undefined ? resi.cht : 0,
      egt: resi.egt !== undefined ? resi.egt : 0
    };

    const sensorTrust = {
      overall: s.overallTrust !== undefined ? s.overallTrust : (trust.overallTrust !== undefined ? trust.overallTrust : 1.0),
      trustedCount: s.trustedCount !== undefined ? s.trustedCount : (quarantined.length > 0 ? 8 : 9),
      totalSensors: s.totalSensors !== undefined ? s.totalSensors : 9,
      quarantined: quarantined,
      scores: trust.scores || {},
      perSensor: trust.sensorDetails || {}
    };

    const degradation = s.degradationPct !== undefined ? s.degradationPct : (diag.degradationPct !== undefined ? diag.degradationPct : 4);
    const rulVal = rul.estimate !== undefined ? rul.estimate : (s.rulHours !== undefined ? s.rulHours : (diag.rulHours !== undefined ? diag.rulHours : 115));
    const ehiVal = s.ehi !== undefined ? s.ehi : (diag.healthIndex !== undefined ? diag.healthIndex : 96);
    const anomalyScore = s.anomalyScore !== undefined ? s.anomalyScore : (diag.anomalyScore !== undefined ? diag.anomalyScore : 0.04);
    const diagnosis = s.aiDiagnosis || diag.faultClass || 'HEALTHY';

    const snapshot = {
      timestamp,
      isReplaying,
      replayIndex,
      missionPhase: s.missionPhase || (raw.missionPhase ? raw.missionPhase.toUpperCase() : 'CRUISE'),
      telemetry,
      expectedState,
      residuals,
      sensorTrust,
      quarantinedSensors: quarantined,
      anomalyScore,
      diagnosis,
      diagnosisConfidence: confidenceVal,
      ehi: ehiVal,
      degradation,
      rul: rulVal,
      missionReliability: {
        score: rel.score !== undefined ? rel.score : 96,
        status: rel.status || 'GO',
        reasons: rel.reasons || ['All propulsion parameters nominal'],
        currentPhase: rel.currentPhase || s.missionPhase || 'CRUISE',
        remainingMissionDuration: rel.remainingMissionDuration || '02h 10m'
      },

      // Legacy compatibility aliases
      scenario: s.scenario || 'normal',
      simTime: s.simTime,
      rawTelemetry: raw,
      expectedPhysics: exp,
      trustResult: trust,
      diagnosticResult: diag,
      physics: phys,
      physicsResiduals: resi,
      ehiStatus: s.ehiStatus || diag.ehiStatus || 'NOMINAL',
      ehiBreakdown: s.ehiBreakdown || diag.ehiBreakdown,
      aiDiagnosis: diagnosis,
      aiDiagStatus: s.aiDiagStatus || 'NOMINAL',
      overallTrust: sensorTrust.overall,
      trustedCount: sensorTrust.trustedCount,
      totalSensors: sensorTrust.totalSensors,
      rulHours: rulVal,
      rulLabel: s.rulLabel || `${rulVal} h`,
      degradationPct: degradation,
      degradationTrend: s.degradationTrend || diag.degradationTrend || 'STABLE',
      why: s.why || diag.explainability || {},
      maintenance: s.maintenance || diag.maintenanceAdvisory || {},
      environment: s.environment || {}
    };

    return safeClone(snapshot);
  }

  const captureAppStateSnapshot = getAssistantSnapshot;
  window.getAssistantSnapshot = getAssistantSnapshot;
  window.captureAppStateSnapshot = getAssistantSnapshot;

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

  function routeDeterministicIntent(query) {
    if (!query || typeof query !== 'string') return null;
    const qLower = query.trim().toLowerCase();
    const qClean = qLower.replace(/[?!.]+$/, '').trim().replace(/\s+/g, ' ');

    // 1. GREETING (Fast-path: direct greeting only if not asking an engineering question)
    if (/^(hi|hello|hey|greetings|good\s+(morning|afternoon|evening))\b/i.test(qLower) && qLower.length < 25 && !isEngineeringQuery(qLower)) {
      return "Hello. I’m the AERO TWIN Decision-Support Assistant. How can I assist you with the engine condition?";
    }

    // 2. GROK SPECIFIC QUERY (Fast-path)
    if (/^grok\??$/i.test(qClean) || /^(are\s+(you|u)|is\s+this)\s+grok\??$/i.test(qClean)) {
      return "I’m the AERO TWIN Decision-Support Assistant. Groq Cloud powers the natural-language explanation layer.";
    }

    // 2. IDENTITY / MODEL (Fast-path: direct accurate answer)
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
      return "The AERO TWIN diagnostic pipeline uses Isolation Forest for anomaly detection and Random Forest for fault classification. Groq Cloud using openai/gpt-oss-120b is used as the natural-language explanation layer.";
    }

    // 3. ENGINEERING / DIGITAL TWIN
    if (isEngineeringQuery(qLower)) {
      return null; // Passes through to Groq / Digital Twin pipeline
    }

    // 4. UNKNOWN / CASUAL / OFF-TOPIC
    return "Yes, I’m here. Ask me about the engine condition, sensor trust, diagnostics, degradation, or RUL.";
  }

  window.routeDeterministicIntent = routeDeterministicIntent;
  window.isEngineeringQuery = isEngineeringQuery;
  window.sanitizeUnicode = sanitizeUnicode;

  function formatAssistantMarkdown(rawText) {
    if (!rawText) return '';
    let text = sanitizeUnicode(rawText.trim());
    
    // Markdown headers ### Title -> **Title**
    text = text.replace(/^#{1,4}\s+(.+)$/gm, '**$1**');

    // If first line is a title without **
    const lines = text.split('\n');
    if (lines.length > 0) {
      const firstLine = lines[0].trim();
      if (/^[A-Z0-9\s—–\-_:]{4,60}$/.test(firstLine) && !firstLine.startsWith('**') && !firstLine.startsWith('•')) {
        lines[0] = `**${firstLine}**`;
        text = lines.join('\n');
      }
    }

    // Convert **bold** to <strong>
    let html = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

    // Ensure section headers like Conclusion:, Evidence:, Why:, Mission implication: are bolded
    html = html.replace(/(?:^|<br>|\n)(Conclusion|Evidence|Why|Mission implication):/gi, '<br><strong>$1:</strong>');

    // Normalize markdown bullets "- " or "* " to "• "
    html = html.replace(/(?:^|\n)[-*]\s+/g, '\n• ');

    // Convert newlines cleanly to <br>
    html = html.replace(/\n\n+/g, '<br>').replace(/\n/g, '<br>');
    // Clean up excessive leading/trailing breaks and consecutive breaks
    html = html.replace(/(?:<br\s*\/?>\s*){2,}/gi, '<br>');
    html = html.replace(/^(<br\s*\/?>)+/i, '').replace(/(<br\s*\/?>)+$/i, '');

    return html;
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  let isAssistantResponding = false;

  function handleUserQuery(query) {
    if (!query || !query.trim() || isAssistantResponding) return;
    const cleanQuery = query.trim();
    isAssistantResponding = true;
    const sendBtn = document.getElementById('btn-chat-send');
    if (sendBtn) sendBtn.disabled = true;

    appendAssistantMessage('user', cleanQuery);

    const isEng = isEngineeringQuery(cleanQuery);
    console.log(`[AI ROUTE] Query: "${cleanQuery}"`);
    console.log(`[AI ROUTE] Engineering query: ${isEng}`);
    console.log(`[AI ROUTE] Calling Groq: true`);

    // CAPTURE EXACTLY ONE IMMUTABLE SNAPSHOT OF CURRENT appState AT SUBMISSION MOMENT
    const snapshot = getAssistantSnapshot();

    // SHOW TYPING INDICATOR
    showTypingIndicator();

    // DISPATCH TO GROQ (NO SILENT BYPASS OR DETERMINISTIC HIJACKING)
    tryGrokQuery(cleanQuery, snapshot)
      .then(grokResult => {
        removeTypingIndicator();
        const source = grokResult ? (grokResult.source || (grokResult.error ? 'groq_error' : 'unknown')) : 'unknown';
        console.log(`[AI ROUTE] Response source: ${source}`);

        if (grokResult && grokResult.source === 'grok' && grokResult.response) {
          // Groq succeeded — convert markdown cleanly to HTML
          const html = formatAssistantMarkdown(grokResult.response);
          appendAssistantMessage('ai', html, 'grok');
        } else if (grokResult && (grokResult.error || grokResult.source === 'groq_error' || grokResult.source === 'missing_api_key')) {
          // Requirement 9: If Groq returns 429/401/403/500/error, show ACTUAL error in UI
          // Requirement 10: Keep local fallback as emergency fallback without hiding Groq failure
          const errStatus = grokResult.status === 429 ? 'HTTP 429 (TPM Rate Limit)' : (grokResult.status ? `HTTP ${grokResult.status}` : 'API Error');
          const errMsg = grokResult.message || 'Groq inference failure';
          const errBanner = `<div class="ai-error-banner" style="background: rgba(239, 68, 68, 0.15); border: 1px solid rgba(239, 68, 68, 0.4); border-radius: 6px; padding: 6px 10px; margin-bottom: 8px; color: #fca5a5; font-size: 0.78rem; line-height: 1.35;"><strong>Groq API Error (${escapeHtml(errStatus)}):</strong> ${escapeHtml(errMsg)}<div style="font-size: 0.72rem; color: #94a3b8; margin-top: 2px;">Displaying emergency local analysis below:</div></div>`;
          const fallbackText = grokResult.fallback || generateLocalAnalysis(cleanQuery, snapshot);
          const fallbackHtml = formatAssistantMarkdown(fallbackText);
          appendAssistantMessage('ai', errBanner + fallbackHtml, 'groq_error');
        } else if (grokResult && grokResult.response) {
          const html = formatAssistantMarkdown(grokResult.response);
          appendAssistantMessage('ai', html, grokResult.source || 'local');
        } else {
          // Emergency Fallback
          const localResponse = generateLocalAnalysis(cleanQuery, snapshot);
          const html = formatAssistantMarkdown(localResponse);
          appendAssistantMessage('ai', html, 'local');
        }
      })
      .catch((err) => {
        removeTypingIndicator();
        console.log(`[AI ROUTE] Response source: client_exception`);
        console.error('[AI DEBUG] Groq error:', err);
        const errMsg = err && err.message ? err.message : 'Unknown client exception';
        const errBanner = `<div class="ai-error-banner" style="background: rgba(239, 68, 68, 0.15); border: 1px solid rgba(239, 68, 68, 0.4); border-radius: 6px; padding: 6px 10px; margin-bottom: 8px; color: #fca5a5; font-size: 0.78rem; line-height: 1.35;"><strong>Groq Client Error:</strong> ${escapeHtml(errMsg)}<div style="font-size: 0.72rem; color: #94a3b8; margin-top: 2px;">Displaying emergency local analysis below:</div></div>`;
        const localResponse = generateLocalAnalysis(cleanQuery, snapshot);
        const html = formatAssistantMarkdown(localResponse);
        appendAssistantMessage('ai', errBanner + html, 'groq_error');
      })
      .finally(() => {
        removeTypingIndicator();
        isAssistantResponding = false;
        if (sendBtn) sendBtn.disabled = false;
      });
  }

  window.handleUserQuery = handleUserQuery;

  async function tryGrokQuery(query, snapshot) {
    console.log('[AI DEBUG] Chat request started');
    console.log('[AI DEBUG] Endpoint: /api/grok');
    try {
      const response = await fetch('/api/grok', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: query,
          appState: snapshot || getAssistantSnapshot()
        })
      });
      console.log(`[AI ROUTE] Groq response status: ${response.status}`);
      console.log(`[AI DEBUG] Groq response status: ${response.status}`);

      let data = null;
      try {
        data = await response.json();
      } catch (jsonErr) {
        data = null;
      }

      if (!response.ok) {
        const errorMsg = (data && (data.groqError || data.error || data.message)) || `HTTP ${response.status} ${response.statusText}`;
        console.error(`[AI DEBUG] Groq error: ${errorMsg}`);
        return {
          error: true,
          status: response.status,
          message: errorMsg,
          fallback: data ? (data.fallback || data.response) : null,
          source: (data && data.source) ? data.source : 'groq_error'
        };
      }

      if (data && data.source === 'groq_error') {
        return {
          error: true,
          status: data.statusCode || 500,
          message: data.groqError || data.error || 'Groq error occurred',
          fallback: data.fallback || data.response,
          source: 'groq_error'
        };
      }

      if (data && data.source === 'grok' && data.response) {
        return { source: 'grok', response: data.response };
      }

      if (data && data.source === 'local_fallback' && data.response) {
        console.warn('[AI DEBUG] Groq served via local fallback');
        return { source: 'local', response: data.response };
      }

      return (data && data.response) ? { source: 'grok', response: data.response } : null;
    } catch (err) {
      console.error(`[AI DEBUG] Groq network error: ${err.message}`);
      return {
        error: true,
        status: 0,
        message: err.message || 'Network error communicating with /api/grok',
        source: 'groq_error'
      };
    }
  }

  function formatEngineeringResponse(title, conclusion, evidenceLines, whyExplanation, missionImplication, replayTag) {
    const replayPrefix = replayTag ? `<strong>[REPLAY ${replayTag}]</strong><br>` : '';
    const evidenceHtml = evidenceLines.map(line => `• ${line}`).join('<br>');
    const missionHtml = missionImplication ? `<br><strong>Mission implication:</strong><br>${missionImplication}` : '';
    return `${replayPrefix}<strong>${title}</strong><br>${conclusion}<br><strong>Evidence:</strong><br>${evidenceHtml}<br><strong>Why:</strong><br>${whyExplanation}${missionHtml}`;
  }

  const format3PartResponse = formatEngineeringResponse;

  function generateLocalAnalysis(query, stateSnapshot) {
    const qLower = (query || '').trim().toLowerCase();
    // Strict Single Source of Truth: Grounded strictly in supplied state snapshot
    const s = stateSnapshot || getAssistantSnapshot();
    const raw = s.rawTelemetry || s.telemetry || {};
    const phys = s.physics || {};
    const resi = s.residuals || s.physicsResiduals || (phys.residuals || {});
    const exp = s.expectedState || s.expectedPhysics || (phys.expected || {});
    const trust = s.trustResult || s.sensorTrust || {};
    const scores = trust.scores || {};
    const quarantined = s.quarantinedSensors || trust.quarantined || [];

    // Helper formatting with zero fabrication
    const notAvail = 'That value is not currently available in the Digital Twin state.';
    const getScalarOrAvg = (arrOrNum) => {
      if (arrOrNum === undefined || arrOrNum === null) return null;
      if (Array.isArray(arrOrNum)) {
        return arrOrNum.length ? (arrOrNum.reduce((a, b) => a + b, 0) / arrOrNum.length).toFixed(1) : null;
      }
      return typeof arrOrNum === 'number' ? arrOrNum.toFixed(1) : String(arrOrNum);
    };
    const chtVal = getScalarOrAvg(raw.cht !== undefined ? raw.cht : (s.telemetry ? s.telemetry.avgCht : null));
    const egtVal = getScalarOrAvg(raw.egt !== undefined ? raw.egt : (s.telemetry ? s.telemetry.avgEgt : null));
    const avgChtStr = chtVal !== null ? `${chtVal}°C` : notAvail;
    const avgEgtStr = egtVal !== null ? `${egtVal}°C` : notAvail;
    const expChtStr = exp.chtAvg !== undefined ? `${Math.round(exp.chtAvg)}°C` : (exp.cht && exp.cht.length ? `${Math.round(exp.cht[0])}°C` : '175°C');
    const expEgtStr = exp.egtAvg !== undefined ? `${Math.round(exp.egtAvg)}°C` : (exp.egt && exp.egt.length ? `${Math.round(exp.egt[0])}°C` : '720°C');
    const oilPressStr = raw.oilPress !== undefined && raw.oilPress !== null ? `${Number(raw.oilPress).toFixed(1)} PSI` : notAvail;
    const expOilPressStr = exp.oilPress !== undefined ? `${Number(exp.oilPress).toFixed(1)} PSI` : (exp.oilPressure !== undefined ? `${Number(exp.oilPressure).toFixed(1)} PSI` : '45.0 PSI');
    const oilTempStr = raw.oilTemp !== undefined && raw.oilTemp !== null ? `${Number(raw.oilTemp).toFixed(1)}°C` : notAvail;
    const rpmStr = raw.rpm !== undefined && raw.rpm !== null ? `${Math.round(raw.rpm)} RPM` : notAvail;
    const expRpmStr = exp.rpm !== undefined ? `${Math.round(exp.rpm)} RPM` : notAvail;
    const oilTrustScore = scores.oilPress !== undefined ? Number(scores.oilPress).toFixed(2) : (quarantined.includes('oilPress') ? '0.12' : '1.00');

    const ehiVal = s.ehi !== undefined ? Math.round(s.ehi) : notAvail;
    const overallTrustVal = s.overallTrust !== undefined ? Number(s.overallTrust).toFixed(2) : (s.sensorTrust && s.sensorTrust.overall !== undefined ? Number(s.sensorTrust.overall).toFixed(2) : '1.00');
    const rulStr = s.rulLabel || (s.rul !== undefined ? `${s.rul} h` : (s.rulHours !== undefined ? `${s.rulHours} h` : notAvail));
    const degPctStr = s.degradation !== undefined ? `${s.degradation}%` : (s.degradationPct !== undefined ? `${s.degradationPct}%` : notAvail);
    const isReplay = !!s.isReplaying;
    const replaySec = (s.replayIndex !== null && s.replayIndex !== undefined) ? s.replayIndex : (s.simTime ? s.simTime.replace(/^14:/, '').replace(/^0+/, '') || '0' : '0');
    const replayTag = isReplay ? `@ ${replaySec}s` : '';

    const isSensorFault = s.diagnosis === 'SENSOR FAULT' || s.aiDiagnosis === 'SENSOR FAULT' || (s.diagnosticResult && s.diagnosticResult.faultClass === 'SENSOR_FAULT') || (quarantined && quarantined.length > 0);
    const isThermal = s.diagnosis === 'THERMAL DEGRADATION' || s.diagnosis === 'THERMAL RUNAWAY' || s.aiDiagnosis === 'THERMAL DEGRADATION' || s.aiDiagnosis === 'THERMAL RUNAWAY' || (s.diagnosticResult && s.diagnosticResult.faultClass === 'THERMAL_DEGRADATION') || (ehiVal !== notAvail && ehiVal < 75);

    // INTENT: SENSOR TRUST / QUARANTINED SENSORS / RELIABILITY
    if (qLower.includes('quarantine') || qLower.includes('unreliable') || qLower.includes('which sensor') || qLower.includes('sensor trust') || qLower.includes('sensor fault') || qLower.includes('sensor problem') || qLower.includes('sensor or engine') || qLower.includes('is this a sensor') || qLower.includes('is the oil pressure sensor reliable') || qLower.includes('reliable') || qLower.includes('sensor')) {
      if (quarantined.length > 0 || isSensorFault) {
        const qList = quarantined.length > 0 ? quarantined.join(', ') : 'oil pressure';
        const qChan = qList === 'oilPress' || qList === 'oilPressure' ? 'OIL PRESSURE' : qList.toUpperCase();
        return formatEngineeringResponse(
          `SENSOR ISSUE — ${qChan}`,
          `The ${qList} signal is unreliable and has been quarantined.`,
          [
            `Oil-pressure trust: ${oilTrustScore}`,
            `Overall trust: ${overallTrustVal}`,
            `Trusted sensors: ${s.sensorTrust.trustedCount}/${s.sensorTrust.totalSensors}`,
            `EHI: ${ehiVal}/100`
          ],
          `The ${qList} channel is inconsistent with the rest of the engine state, so it is excluded from health judgment. Current trusted evidence does not indicate confirmed engine degradation.`,
          `Telemetry redundancy is reduced for this channel, but engine mechanical condition remains intact.`,
          replayTag
        );
      } else {
        return formatEngineeringResponse(
          `SENSOR TRUST — NOMINAL`,
          `All engine sensor channels are verified trusted and operating nominally.`,
          [
            `Overall trust: ${overallTrustVal}`,
            `Trusted sensors: ${s.sensorTrust.trustedCount}/${s.sensorTrust.totalSensors}`,
            `Quarantined channels: None`,
            `EHI: ${ehiVal}/100`
          ],
          `Analytical redundancy and cross-sensor variance checks confirm all instrumentation streams track calibrated baseline models without drift or artifacts.`,
          `Full instrumentation reliability is maintained for the current mission phase.`,
          replayTag
        );
      }
    }

    // INTENT: THERMAL DEGRADATION / EGT / CHT / RUNNING HOT
    if (qLower.includes('egt') || qLower.includes('exhaust') || qLower.includes('cht') || qLower.includes('cylinder head') || qLower.includes('running hot') || qLower.includes('hot') || qLower.includes('overheat') || qLower.includes('thermal')) {
      if (isThermal || (resi.egt !== undefined && resi.egt > 15) || (resi.cht !== undefined && resi.cht > 5)) {
        return formatEngineeringResponse(
          `ENGINE DEGRADATION — THERMAL`,
          `The engine is showing a thermal degradation pattern.`,
          [
            `CHT: ${avgChtStr} vs ${expChtStr} expected`,
            `EGT: ${avgEgtStr} vs ${expEgtStr} expected`,
            `Sensor trust: ${overallTrustVal}`,
            `EHI: ${ehiVal}/100`
          ],
          `Trusted CHT and EGT measurements are both significantly above their expected values, supporting a genuine thermal condition rather than an isolated sensor fault.`,
          `Thermal stress accelerates component wear, decreasing Remaining Useful Life endurance margins.`,
          replayTag
        );
      } else {
        return formatEngineeringResponse(
          `ENGINE STATUS — NOMINAL`,
          `Cylinder and exhaust temperatures remain within normal thermal margins.`,
          [
            `CHT: ${avgChtStr} vs ${expChtStr} expected`,
            `EGT: ${avgEgtStr} vs ${expEgtStr} expected`,
            `Sensor trust: ${overallTrustVal}`,
            `EHI: ${ehiVal}/100`
          ],
          `Combustion heat release and convective cylinder cooling match expected baseline models for current power output.`,
          `Thermal margins remain sufficient for ongoing mission legs.`,
          replayTag
        );
      }
    }

    // INTENT: OIL PRESSURE
    if (qLower.includes('oil pressure') || qLower.includes('oil press')) {
      if (isSensorFault || quarantined.includes('oilPress')) {
        return formatEngineeringResponse(
          `SENSOR ISSUE — OIL PRESSURE`,
          `The oil-pressure signal is unreliable and has been quarantined.`,
          [
            `Oil-pressure trust: ${oilTrustScore}`,
            `Overall trust: ${overallTrustVal}`,
            `Trusted sensors: ${s.sensorTrust.trustedCount}/${s.sensorTrust.totalSensors}`,
            `EHI: ${ehiVal}/100`
          ],
          `The oil-pressure channel is inconsistent with the rest of the engine state, so it is excluded from health judgment. Current trusted evidence does not indicate confirmed engine degradation.`,
          `Telemetry redundancy is reduced for this channel, but engine mechanical condition remains intact.`,
          replayTag
        );
      } else {
        return formatEngineeringResponse(
          `ENGINE STATUS — NOMINAL`,
          `Engine oil pressure is operating within nominal delivery specifications.`,
          [
            `Oil Pressure: ${oilPressStr} vs ${expOilPressStr} expected`,
            `Oil Temperature: ${oilTempStr}`,
            `Sensor Trust: ${oilTrustScore}`,
            `EHI: ${ehiVal}/100`
          ],
          `Positive displacement engine oil pump maintains stable hydrodynamic lubrication film across crankshaft bearings.`,
          `Engine lubrication delivery remains fully nominal.`,
          replayTag
        );
      }
    }

    // INTENT: RUL / REMAINING USEFUL LIFE / DEGRADATION
    if (qLower.includes('rul') || qLower.includes('remaining useful life') || qLower.includes('how much life') || qLower.includes('life remains') || qLower.includes('degrading') || qLower.includes('degradation') || qLower.includes('when will it fail') || qLower.includes('life')) {
      return formatEngineeringResponse(
        `PROGNOSTICS — REMAINING USEFUL LIFE`,
        `Remaining Useful Life is estimated at ${rulStr} under current operational conditions.`,
        [
          `Projected RUL: ${rulStr}`,
          `Cumulative degradation: ${degPctStr}`,
          `Degradation trend: ${s.degradationTrend || 'STABLE'}`,
          `Engine Health Index: ${ehiVal}/100`
        ],
        `Prognostic estimation models Arrhenius thermal fatigue and mechanical stress against baseline component endurance envelopes.`,
        `Projected endurance remains sufficient for nominal mission completion under current flight loads.`,
        replayTag
      );
    }

    // INTENT: EHI (ENGINE HEALTH INDEX)
    if (qLower.includes('health index') || qLower.includes('why is engine health changing') || qLower.includes('why did health drop') || qLower.includes('why is ehi low') || qLower.includes('ehi') || qLower.includes('engine health')) {
      if (isSensorFault) {
        return formatEngineeringResponse(
          `SENSOR ISSUE — OIL PRESSURE`,
          `Engine Health Index remains protected at ${ehiVal}/100 despite the quarantined oil pressure sensor.`,
          [
            `Oil-pressure trust: ${oilTrustScore}`,
            `Overall trust: ${overallTrustVal}`,
            `Trusted sensors: ${s.sensorTrust.trustedCount}/${s.sensorTrust.totalSensors}`,
            `EHI: ${ehiVal}/100`
          ],
          `The Sensor Trust Layer identified the anomalous transducer and shielded EHI from false degradation penalties. Current evidence does not indicate mechanical failure.`,
          `Propulsion integrity remains intact while instrumentation redundancy is degraded.`,
          replayTag
        );
      } else if (isThermal) {
        return formatEngineeringResponse(
          `ENGINE DEGRADATION — THERMAL`,
          `Engine Health Index has dropped to ${ehiVal}/100 due to active cylinder thermal degradation.`,
          [
            `CHT: ${avgChtStr} vs ${expChtStr} expected`,
            `EGT: ${avgEgtStr} vs ${expEgtStr} expected`,
            `Sensor trust: ${overallTrustVal}`,
            `EHI: ${ehiVal}/100`
          ],
          `Dual trusted thermal sensors confirm authentic thermodynamic stress exceeding baseline boundaries, which decrements the health index.`,
          `Thermal stress accelerates component wear, decreasing Remaining Useful Life endurance margins.`,
          replayTag
        );
      } else {
        return formatEngineeringResponse(
          `ENGINE STATUS — NOMINAL`,
          `Engine Health Index is robust at ${ehiVal}/100 in the current simulation phase.`,
          [
            `RPM: ${rpmStr} vs ${expRpmStr} expected`,
            `EHI: ${ehiVal}/100`,
            `Sensor trust: ${overallTrustVal} (${s.sensorTrust.trustedCount}/${s.sensorTrust.totalSensors} trusted)`,
            `Projected RUL: ${rulStr}`
          ],
          `Current trusted telemetry remains consistent with the expected operating state and no significant degradation is detected.`,
          `Propulsion system operates within calibrated margins for the ${s.missionPhase || 'CRUISE'} flight envelope.`,
          replayTag
        );
      }
    }

    // DEFAULT / GENERAL ENGINE STATUS & DIAGNOSTIC
    if (isSensorFault) {
      const qList = quarantined.length > 0 ? quarantined.join(', ') : 'oil pressure';
      const qChan = qList === 'oilPress' || qList === 'oilPressure' ? 'OIL PRESSURE' : qList.toUpperCase();
      return formatEngineeringResponse(
        `SENSOR ISSUE — ${qChan}`,
        `The ${qList} signal is unreliable and has been quarantined.`,
        [
          `Oil-pressure trust: ${oilTrustScore}`,
          `Overall trust: ${overallTrustVal}`,
          `Trusted sensors: ${s.sensorTrust.trustedCount}/${s.sensorTrust.totalSensors}`,
          `EHI: ${ehiVal}/100`
        ],
        `The ${qList} channel is inconsistent with the rest of the engine state, so it is excluded from health judgment. Current trusted evidence does not indicate confirmed engine degradation.`,
        `Instrumentation redundancy is reduced on the affected channel, while propulsion integrity is preserved.`,
        replayTag
      );
    } else if (isThermal) {
      return formatEngineeringResponse(
        `ENGINE DEGRADATION — THERMAL`,
        `The engine is showing a thermal degradation pattern.`,
        [
          `CHT: ${avgChtStr} vs ${expChtStr} expected`,
          `EGT: ${avgEgtStr} vs ${expEgtStr} expected`,
          `Sensor trust: ${overallTrustVal}`,
          `EHI: ${ehiVal}/100`
        ],
        `Trusted CHT and EGT measurements are both significantly above their expected values, supporting a genuine thermal condition rather than an isolated sensor fault.`,
        `Thermal stress accelerates component wear, decreasing Remaining Useful Life endurance margins.`,
        replayTag
      );
    } else {
      return formatEngineeringResponse(
        `ENGINE STATUS — NOMINAL`,
        `The engine is operating normally in the current simulation phase.`,
        [
          `RPM: ${rpmStr} vs ${expRpmStr} expected`,
          `EHI: ${ehiVal}/100`,
          `Sensor trust: ${overallTrustVal} (${s.sensorTrust.trustedCount}/${s.sensorTrust.totalSensors} trusted)`,
          `Projected RUL: ${rulStr}`
        ],
        `Current trusted telemetry remains consistent with the expected operating state and no significant degradation is detected.`,
        `Propulsion system operates within calibrated margins for the ${s.missionPhase || 'CRUISE'} flight envelope.`,
        replayTag
      );
    }
  }

  function showTypingIndicator() {
    const historyBox = document.getElementById('chat-history');
    if (!historyBox) return null;
    // Always remove any existing indicators first to avoid duplicate visual gaps
    historyBox.querySelectorAll('.typing-indicator').forEach(el => el.remove());

    const bubble = document.createElement('div');
    bubble.className = 'chat-bubble ai typing-indicator';
    bubble.innerHTML = '<span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span>';
    historyBox.appendChild(bubble);
    historyBox.scrollTop = historyBox.scrollHeight;
    return bubble;
  }

  function removeTypingIndicator() {
    const historyBox = document.getElementById('chat-history');
    if (!historyBox) return;
    historyBox.querySelectorAll('.typing-indicator').forEach(el => el.remove());
  }

  function appendAssistantMessage(sender, htmlText, source) {
    const historyBox = document.getElementById('chat-history');
    if (!historyBox) return;

    // Guaranteed cleanup of any active typing indicator before inserting real bubble
    if (sender === 'ai') {
      removeTypingIndicator();
    }

    const bubble = document.createElement('div');
    bubble.className = `chat-bubble ${sender}`;

    // Add source badge for AI responses
    if (sender === 'ai' && source) {
      const badge = document.createElement('span');
      let badgeClass = 'badge-local';
      let badgeLabel = '⚙ LOCAL ENGINE ANALYSIS';
      if (source === 'grok') {
        badgeClass = 'badge-grok';
        badgeLabel = '✦ GROK AI';
      } else if (source === 'groq_error') {
        badgeClass = 'badge-error';
        badgeLabel = '⚠ GROQ ERROR / LOCAL FALLBACK';
      } else if (source === 'local') {
        badgeClass = 'badge-local';
        badgeLabel = '⚙ LOCAL ENGINE ANALYSIS';
      }
      badge.className = `ai-source-badge ${badgeClass}`;
      badge.textContent = badgeLabel;
      bubble.appendChild(badge);
    }

    const content = document.createElement('span');
    content.innerHTML = htmlText;
    bubble.appendChild(content);

    historyBox.appendChild(bubble);
    historyBox.scrollTop = historyBox.scrollHeight;
  }

  function addAssistantSystemNotice(scenarioKey) {
    const notices = {
      normal: 'Scenario: <strong>NORMAL MISSION</strong> loaded. Engine running nominally.',
      sensor_fault: 'Scenario: <strong>SENSOR FAULT</strong> active. Oil pressure transducer quarantined; Engine Health preserved.',
      thermal_degradation: 'Scenario: <strong>THERMAL DEGRADATION</strong> active. Genuine multi-cylinder thermal runaway verified.'
    };
    if (notices[scenarioKey]) {
      appendAssistantMessage('ai', notices[scenarioKey]);
    }
  }

  // ==========================================================================
  // INTERACTIVE ENGINE INSPECTION & X-RAY CUTAWAY MODE
  // ==========================================================================
  // ==========================================================================
  // PHYSICAL ENGINE COMPONENT LABELING LAYER (12 Subsystems)
  // ==========================================================================
  const PHYSICAL_COMPONENTS = [
    {
      id: 'spark_plug',
      name: 'SPARK PLUG',
      category: 'IGNITION SYSTEM',
      type: 'spark_plug',
      group: 'core',
      function: 'Delivers timed high-voltage electrical discharge to ignite the compressed fuel-air mixture.',
      side: 'left',
      metricKey: 'cht',
      metricUnit: '°C'
    },
    {
      id: 'intake_valve',
      name: 'INTAKE VALVE',
      category: 'VALVETRAIN',
      type: 'intake_valve',
      group: 'core',
      function: 'Regulates air-fuel mixture induction into combustion chamber according to camshaft timing.',
      side: 'left',
      metricKey: 'map',
      metricUnit: 'inHg'
    },
    {
      id: 'cylinder',
      name: 'CYLINDER',
      category: 'COMBUSTION CHAMBER',
      type: 'cylinder',
      group: 'core',
      function: 'Contains the combustion process and guides reciprocating piston motion.',
      side: 'left',
      metricKey: 'cht',
      metricUnit: '°C'
    },
    {
      id: 'piston',
      name: 'PISTON',
      category: 'RECIPROCATING ASSEMBLY',
      type: 'piston',
      group: 'core',
      function: 'Converts combustion pressure into linear mechanical motion.',
      side: 'left',
      metricKey: 'load',
      metricUnit: '%'
    },
    {
      id: 'conrod',
      name: 'CONNECTING ROD',
      category: 'KINEMATIC LINKAGE',
      type: 'conrod',
      group: 'core',
      function: 'Transfers reciprocating piston pressure directly to the rotating crankshaft journal.',
      side: 'left',
      metricKey: 'rpm',
      metricUnit: 'RPM'
    },
    {
      id: 'exhaust_valve',
      name: 'EXHAUST VALVE',
      category: 'VALVETRAIN',
      type: 'exhaust_valve',
      group: 'core',
      function: 'Carries high-temperature combustion gases away from cylinder into exhaust header.',
      side: 'left',
      metricKey: 'egt',
      metricUnit: '°C'
    },
    {
      id: 'crankshaft',
      name: 'CRANKSHAFT',
      category: 'ROTATIONAL ASSEMBLY',
      type: 'crankshaft',
      group: 'core',
      function: 'Converts reciprocating piston motion into rotational motion to drive PRSU and propeller.',
      side: 'right',
      metricKey: 'rpm',
      metricUnit: 'RPM'
    },
    {
      id: 'camshaft',
      name: 'CAMSHAFT',
      category: 'TIMING & VALVETRAIN',
      type: 'camshaft',
      group: 'core',
      function: 'Controls valve lift timing and duration synchronized at 1:2 ratio with crankshaft.',
      side: 'right',
      metricKey: 'rpm_half',
      metricUnit: 'RPM'
    },
    {
      id: 'intake_manifold',
      name: 'INTAKE MANIFOLD',
      category: 'INDUCTION SYSTEM',
      type: 'intake',
      group: 'systems',
      function: 'Distributes pressurized air charge from compressor plenum evenly across cylinders.',
      side: 'right',
      metricKey: 'map',
      metricUnit: 'inHg'
    },
    {
      id: 'fuel_system',
      name: 'FUEL SYSTEM / INJECTOR',
      category: 'FUEL INJECTION',
      type: 'fuel_system',
      group: 'systems',
      function: 'Delivers metered, atomized high-pressure fuel pulse into intake runners for combustion.',
      side: 'right',
      metricKey: 'fuelFlow',
      metricUnit: 'L/h'
    },
    {
      id: 'lubrication_system',
      name: 'LUBRICATION / OIL PUMP',
      category: 'LUBRICATION SYSTEM',
      type: 'lubrication_system',
      group: 'systems',
      function: 'Pressurizes and circulates engine oil through main gallery to bearings, journals, and sumps.',
      side: 'right',
      metricKey: 'oilPress',
      metricUnit: 'PSI'
    },
    {
      id: 'exhaust_manifold',
      name: 'EXHAUST MANIFOLD',
      category: 'EXHAUST & TURBO',
      type: 'exhaust',
      group: 'systems',
      function: 'Channels high-temperature combustion exhaust gases away from cylinders to turbo turbine.',
      side: 'right',
      metricKey: 'egt',
      metricUnit: '°C'
    }
  ];

  let activeCalloutFilter = 'all'; // 'all' | 'core' | 'systems'
  let calloutsVisible = true;

  function initEngineCalloutsLayer() {
    const container = document.getElementById('twin-callouts-container');
    if (!container) return;
    container.innerHTML = '';

    PHYSICAL_COMPONENTS.forEach(comp => {
      const card = document.createElement('div');
      card.className = `twin-callout-card callout-side-${comp.side}`;
      card.id = `callout-${comp.id}`;
      card.setAttribute('data-comp-id', comp.id);
      card.setAttribute('data-group', comp.group);
      card.setAttribute('role', 'button');
      card.setAttribute('tabindex', '0');
      card.setAttribute('aria-label', `Engine Component: ${comp.name}`);

      card.innerHTML = `
        <div class="callout-header">
          <span class="callout-name">${comp.name}</span>
          <span class="callout-status-dot" id="dot-${comp.id}"></span>
        </div>
        <div class="callout-subrow">
          <span class="callout-metric-val" id="metric-${comp.id}">--</span>
          <span class="callout-status-tag" id="tag-${comp.id}">NOMINAL</span>
        </div>
      `;

      card.addEventListener('click', (e) => {
        e.stopPropagation();
        inspectComponent(comp.id);
      });

      card.addEventListener('mouseenter', () => {
        if (digitalTwin && typeof digitalTwin.highlightMesh === 'function') {
          const c = digitalTwin.selectableComponents && digitalTwin.selectableComponents.get(comp.id);
          if (c && c.mesh) {
            digitalTwin.highlightMesh(c.mesh, 0x38bdf8, 0.6);
          }
        }
        const line = document.getElementById(`line-${comp.id}`);
        if (line) line.classList.add('active');
      });

      card.addEventListener('mouseleave', () => {
        if (selectedComponent?.id !== comp.id && digitalTwin) {
          digitalTwin.clearHighlights();
          if (selectedComponent) {
            digitalTwin.selectComponent(selectedComponent.id || selectedComponent.componentId);
          }
        }
        const line = document.getElementById(`line-${comp.id}`);
        if (line && selectedComponent?.id !== comp.id) line.classList.remove('active');
      });

      container.appendChild(card);
    });

    // Toggle Button
    const btnToggle = document.getElementById('btn-toggle-callouts');
    if (btnToggle) {
      btnToggle.addEventListener('click', (e) => {
        e.stopPropagation();
        calloutsVisible = !calloutsVisible;
        btnToggle.classList.toggle('active', calloutsVisible);
        const overlay = document.getElementById('twin-callouts-overlay');
        if (overlay) overlay.classList.toggle('hidden', !calloutsVisible);
      });
    }

    // Filter Buttons
    const filterBtns = document.querySelectorAll('.btn-comp-filter');
    filterBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        filterBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        activeCalloutFilter = btn.getAttribute('data-filter') || 'all';
        applyCalloutFilter();
      });
    });

    applyCalloutFilter();
  }

  function applyCalloutFilter() {
    PHYSICAL_COMPONENTS.forEach(comp => {
      const card = document.getElementById(`callout-${comp.id}`);
      const line = document.getElementById(`line-${comp.id}`);
      const dot = document.getElementById(`anchor-${comp.id}`);
      const visible = activeCalloutFilter === 'all' || comp.group === activeCalloutFilter;
      if (card) card.style.display = visible ? 'flex' : 'none';
      if (line) line.style.display = visible ? 'block' : 'none';
      if (dot) dot.style.display = visible ? 'block' : 'none';
    });
  }

  window.update3DCallouts = function () {
    if (!calloutsVisible || !digitalTwin || !digitalTwin.canvas || !digitalTwin.camera) return;

    const svg = document.getElementById('twin-callouts-svg');
    const container = document.getElementById('twin-callouts-container');
    if (!svg || !container) return;

    const rect = digitalTwin.canvas.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;
    if (w <= 0 || h <= 0) return;

    // Filtered list
    const visibleComponents = PHYSICAL_COMPONENTS.filter(c => activeCalloutFilter === 'all' || c.group === activeCalloutFilter);
    const leftComps = visibleComponents.filter(c => c.side === 'left');
    const rightComps = visibleComponents.filter(c => c.side === 'right');

    const leftTotal = leftComps.length;
    const rightTotal = rightComps.length;

    const topPad = 44;
    const botPad = 40;
    const availH = Math.max(120, h - topPad - botPad);

    let svgLines = '';

    // Position left column
    leftComps.forEach((comp, idx) => {
      const card = document.getElementById(`callout-${comp.id}`);
      if (!card) return;

      const cardY = topPad + (idx * (availH / Math.max(1, leftTotal)));
      const cardX = 12;
      card.style.left = `${cardX}px`;
      card.style.top = `${Math.round(cardY)}px`;
      const isSel = selectedComponent && (selectedComponent.id === comp.id || selectedComponent.componentId === comp.id || (comp.id === 'piston' && selectedComponent.type === 'piston') || (comp.id === 'cylinder' && selectedComponent.type === 'cylinder') || (comp.id === 'conrod' && selectedComponent.type === 'conrod'));
      card.classList.toggle('active', !!isSel);

      const anchorPos = digitalTwin.getComponentAnchor(comp.id);
      if (anchorPos) {
        const screenPos = digitalTwin.projectToScreen(anchorPos);
        if (screenPos && screenPos.inFront) {
          const cardRight = cardX + (card.offsetWidth || 120);
          const cardMidY = cardY + 14;
          const lineCls = isSel ? 'callout-leader-line active' : 'callout-leader-line';
          const elbowX = Math.min(screenPos.x - 8, cardRight + 16);
          svgLines += `
            <path id="line-${comp.id}" class="${lineCls}" d="M ${Math.round(screenPos.x)},${Math.round(screenPos.y)} L ${Math.round(elbowX)},${Math.round(cardMidY)} L ${Math.round(cardRight)},${Math.round(cardMidY)}" />
            <circle id="anchor-${comp.id}" class="callout-anchor-dot" cx="${Math.round(screenPos.x)}" cy="${Math.round(screenPos.y)}" r="${isSel ? 3.5 : 2.5}" />
          `;
        }
      }
    });

    // Position right column
    rightComps.forEach((comp, idx) => {
      const card = document.getElementById(`callout-${comp.id}`);
      if (!card) return;

      const cardY = topPad + (idx * (availH / Math.max(1, rightTotal)));
      const cardW = card.offsetWidth || 120;
      const cardX = w - cardW - 12;
      card.style.left = `${Math.round(cardX)}px`;
      card.style.top = `${Math.round(cardY)}px`;
      const isSel = selectedComponent && (selectedComponent.id === comp.id || selectedComponent.componentId === comp.id || (comp.id === 'crankshaft' && selectedComponent.type === 'crankshaft') || (comp.id === 'lubrication_system' && selectedComponent.type === 'lubrication_system'));
      card.classList.toggle('active', !!isSel);

      const anchorPos = digitalTwin.getComponentAnchor(comp.id);
      if (anchorPos) {
        const screenPos = digitalTwin.projectToScreen(anchorPos);
        if (screenPos && screenPos.inFront) {
          const cardLeft = cardX;
          const cardMidY = cardY + 14;
          const lineCls = isSel ? 'callout-leader-line active' : 'callout-leader-line';
          const elbowX = Math.max(screenPos.x + 8, cardLeft - 16);
          svgLines += `
            <path id="line-${comp.id}" class="${lineCls}" d="M ${Math.round(screenPos.x)},${Math.round(screenPos.y)} L ${Math.round(elbowX)},${Math.round(cardMidY)} L ${Math.round(cardLeft)},${Math.round(cardMidY)}" />
            <circle id="anchor-${comp.id}" class="callout-anchor-dot" cx="${Math.round(screenPos.x)}" cy="${Math.round(screenPos.y)}" r="${isSel ? 3.5 : 2.5}" />
          `;
        }
      }
    });

    svg.innerHTML = svgLines;
  };

  function updateCalloutTelemetryValues(s) {
    if (!s || !s.rawTelemetry) return;
    const raw = s.rawTelemetry;
    const avgCht = (raw.cht && raw.cht.length) ? (raw.cht.reduce((a, b) => a + b, 0) / raw.cht.length) : 178;
    const avgEgt = (raw.egt && raw.egt.length) ? (raw.egt.reduce((a, b) => a + b, 0) / raw.egt.length) : 824;

    const isThermal = s.aiDiagnosis === 'THERMAL DEGRADATION' || s.diagnosticResult?.faultClass === 'THERMAL_DEGRADATION' || currentScenarioKey === 'thermal_degradation';
    const isSensorFault = s.aiDiagnosis === 'SENSOR FAULT' || s.diagnosticResult?.faultClass === 'SENSOR_FAULT' || currentScenarioKey === 'sensor_freeze' || currentScenarioKey === 'sensor_drop';
    const isLubricationFault = s.diagnosticResult?.faultClass === 'LUBRICATION_DEGRADATION' || currentScenarioKey === 'lubrication_degradation';
    const isRpmInstability = s.diagnosticResult?.faultClass === 'RPM_INSTABILITY' || currentScenarioKey === 'rpm_instability';

    PHYSICAL_COMPONENTS.forEach(comp => {
      const metricEl = document.getElementById(`metric-${comp.id}`);
      const tagEl = document.getElementById(`tag-${comp.id}`);
      const dotEl = document.getElementById(`dot-${comp.id}`);

      // Metric string
      let metricStr = '--';
      switch (comp.metricKey) {
        case 'cht':
          metricStr = `${avgCht.toFixed(1)} °C`;
          break;
        case 'egt':
          metricStr = `${avgEgt.toFixed(0)} °C`;
          break;
        case 'rpm':
          metricStr = `${Math.round(raw.rpm).toLocaleString()} RPM`;
          break;
        case 'rpm_half':
          metricStr = `${Math.round(raw.rpm * 0.5).toLocaleString()} RPM`;
          break;
        case 'oilPress':
          metricStr = `${raw.oilPress.toFixed(1)} PSI`;
          break;
        case 'fuelFlow':
          metricStr = `${raw.fuelFlow.toFixed(1)} L/h`;
          break;
        case 'map':
          metricStr = `${raw.map.toFixed(1)} inHg`;
          break;
        case 'load':
          metricStr = `${raw.load.toFixed(0)}% LOAD`;
          break;
      }
      if (metricEl) metricEl.textContent = metricStr;

      // Status tag & dot class
      let statusTag = 'NOMINAL';
      let statusCls = '';

      if (isSensorFault) {
        if (comp.id === 'lubrication_system') {
          statusTag = 'SENSOR FAULT';
          statusCls = 'warn';
        } else {
          statusTag = 'NOMINAL';
          statusCls = '';
        }
      } else if (isThermal) {
        if (comp.id === 'cylinder' || comp.id === 'exhaust_manifold' || comp.id === 'exhaust_valve' || comp.id === 'piston' || comp.id === 'spark_plug') {
          statusTag = 'OVERHEAT';
          statusCls = 'crit';
        } else {
          statusTag = 'HEAT SOAK';
          statusCls = 'warn';
        }
      } else if (isLubricationFault) {
        if (comp.id === 'lubrication_system') {
          statusTag = 'LOW OIL P';
          statusCls = 'crit';
        } else if (comp.id === 'crankshaft' || comp.id === 'camshaft' || comp.id === 'conrod') {
          statusTag = 'WEAR RISK';
          statusCls = 'warn';
        } else {
          statusTag = 'NOMINAL';
          statusCls = '';
        }
      } else if (isRpmInstability) {
        if (comp.id === 'crankshaft' || comp.id === 'camshaft') {
          statusTag = 'UNSTABLE';
          statusCls = 'warn';
        } else {
          statusTag = 'NOMINAL';
          statusCls = '';
        }
      } else {
        statusTag = 'NOMINAL';
        statusCls = '';
      }

      if (tagEl) {
        tagEl.textContent = statusTag;
        tagEl.className = `callout-status-tag ${statusCls}`;
      }
      if (dotEl) {
        dotEl.className = `callout-status-dot ${statusCls}`;
      }
    });
  }

  function getCylinderDeltas(cylIndex) {
    if (!cylIndex) return { cht: 0, egt: 0 };
    switch (cylIndex) {
      case 1: return { cht: 0.8, egt: 3.2 };
      case 2: return { cht: -1.2, egt: -4.1 };
      case 3: return { cht: 2.1, egt: 5.6 };
      case 4: return { cht: -1.5, egt: -2.8 };
      default: return { cht: 0, egt: 0 };
    }
  }

  function updateInspectionHud(comp) {
    if (!comp) return;

    const backBtn = document.getElementById('btn-back-to-engine');
    if (backBtn) backBtn.style.display = 'inline-flex';

    const syncLabel = document.getElementById('twin-sync-label');
    if (syncLabel) syncLabel.style.display = 'none';

    const compId = comp.componentId || comp.id || comp.type || 'piston';
    const normId = compId.replace(/_[1-4]$/, ''); // e.g. piston_1 -> piston
    const physComp = PHYSICAL_COMPONENTS.find(p => p.id === compId || p.id === normId || p.type === comp.type);

    const catEl = document.getElementById('hud-category');
    const nameEl = document.getElementById('hud-name');
    const descEl = document.getElementById('hud-desc');
    const funcEl = document.getElementById('hud-function-text');
    const statusEl = document.getElementById('hud-status');
    const relevanceEl = document.getElementById('hud-relevance-text');

    const compName = comp.name || physComp?.name || 'ENGINE COMPONENT';
    const compCat = comp.category || physComp?.category || 'POWERTRAIN COMPONENT';
    const compDesc = comp.desc || physComp?.function || 'Aero piston engine mechanical component.';
    const compFunc = physComp?.function || comp.function || 'Converts chemical energy from aviation fuel into UAV propeller thrust.';

    if (catEl) catEl.textContent = compCat;
    if (nameEl) nameEl.textContent = compName;
    if (descEl) descEl.textContent = compDesc;
    if (funcEl) funcEl.textContent = compFunc;

    // Kinematic Chain Association
    const motionPill = document.getElementById('hud-motion-pill');
    const motionText = document.getElementById('hud-motion-text');
    const chainBox = document.getElementById('hud-kinematic-chain');
    const chainCyl = document.getElementById('chain-cyl');
    const chainPiston = document.getElementById('chain-piston');
    const chainRod = document.getElementById('chain-rod');
    const chainCrank = document.getElementById('chain-crank');

    if (chainBox) {
      if (comp.type === 'piston' || comp.type === 'conrod' || normId === 'piston' || normId === 'conrod') {
        chainBox.style.display = 'block';
        if (chainCyl) chainCyl.textContent = `CYLINDER ${comp.cylIndex || 1}`;
        if (chainPiston) chainPiston.className = (comp.type === 'piston' || normId === 'piston') ? 'chain-node active' : 'chain-node';
        if (chainRod) chainRod.className = (comp.type === 'conrod' || normId === 'conrod') ? 'chain-node active' : 'chain-node';
        if (chainCrank) chainCrank.className = 'chain-node';
      } else if (comp.type === 'crankshaft' || normId === 'crankshaft' || normId === 'camshaft') {
        chainBox.style.display = 'block';
        if (chainPiston) chainPiston.className = 'chain-node';
        if (chainRod) chainRod.className = 'chain-node';
        if (chainCrank) chainCrank.className = 'chain-node active';
      } else {
        chainBox.style.display = 'none';
      }
    }

    if (motionPill && motionText) {
      if (comp.type === 'piston' || normId === 'piston') {
        motionPill.style.display = 'inline-flex';
        motionText.textContent = 'MOTION: RECIPROCATING';
      } else if (comp.type === 'conrod' || normId === 'conrod') {
        motionPill.style.display = 'inline-flex';
        motionText.textContent = 'MOTION: OSCILLATING & TRANSLATING';
      } else if (comp.type === 'crankshaft' || normId === 'crankshaft') {
        motionPill.style.display = 'inline-flex';
        motionText.textContent = 'MOTION: CONTINUOUS ROTATION';
      } else if (normId === 'camshaft') {
        motionPill.style.display = 'inline-flex';
        motionText.textContent = 'MOTION: 1:2 ROTATION (HALF CRANK SPEED)';
      } else {
        motionPill.style.display = 'none';
      }
    }

    // Status & Diagnostic Relevance (preserves "BAD SENSOR != BAD ENGINE")
    const s = window.appState;
    const isSensorFault = s.aiDiagnosis === 'SENSOR FAULT' || (s.diagnosticResult && s.diagnosticResult.faultClass === 'SENSOR_FAULT') || currentScenarioKey === 'sensor_freeze' || currentScenarioKey === 'sensor_drop';
    const isThermal = s.aiDiagnosis === 'THERMAL DEGRADATION' || (s.diagnosticResult && s.diagnosticResult.faultClass === 'THERMAL_DEGRADATION') || currentScenarioKey === 'thermal_degradation';
    const isLubricationFault = (s.diagnosticResult && s.diagnosticResult.faultClass === 'LUBRICATION_DEGRADATION') || currentScenarioKey === 'lubrication_degradation';
    const isRpmInstability = (s.diagnosticResult && s.diagnosticResult.faultClass === 'RPM_INSTABILITY') || currentScenarioKey === 'rpm_instability';

    if (isSensorFault) {
      const isLubricationOrSensor = (normId === 'lubrication_system' || normId === 'oil_pump' || normId === 'oil_system' || comp.type === 'sensor' || (compName && compName.toLowerCase().includes('oil')));
      const rawOil = s.rawTelemetry && s.rawTelemetry.oilPress !== undefined ? s.rawTelemetry.oilPress.toFixed(1) : '--';
      if (isLubricationOrSensor) {
        if (statusEl) {
          statusEl.textContent = 'SENSOR FAULT';
          statusEl.className = 'hud-status-badge badge-warning';
        }
        if (relevanceEl) {
          relevanceEl.textContent = `⚠️ SENSOR FAULT DETECTED: The oil pressure transducer has flatlined at ${rawOil} PSI (zero variance). Mechanical oil lubrication and flow remain intact. SENSOR TRUST: FAULTY (Quarantined).`;
        }
      } else {
        if (statusEl) {
          statusEl.textContent = 'NOMINAL (PROTECTED)';
          statusEl.className = 'hud-status-badge badge-nominal';
        }
        if (relevanceEl) {
          relevanceEl.textContent = `✅ BAD SENSOR ≠ BAD ENGINE REASSURANCE: ${compName} is mechanically healthy. Despite the faulty oil pressure sensor reading, engine core integrity is shielded at EHI ${Math.round(s.ehi)}/100 to prevent false mission abort.`;
        }
      }
    } else if (isThermal) {
      const isHotCombustionPart = (normId === 'cylinder' || normId === 'exhaust_manifold' || normId === 'exhaust_valve' || normId === 'piston' || normId === 'spark_plug' || comp.type === 'head' || comp.type === 'cylinder' || comp.type === 'piston' || comp.type === 'exhaust');
      if (isHotCombustionPart) {
        if (statusEl) {
          statusEl.textContent = 'THERMAL RUNAWAY';
          statusEl.className = 'hud-status-badge badge-critical';
        }
        if (relevanceEl) {
          relevanceEl.textContent = `🔥 AUTHENTIC MECHANICAL OVERHEAT: Dual trusted sensors corroborate severe combustion runaway on ${compName}. EHI downgraded to ${Math.round(s.ehi)}/100; RUL revised to ${s.rulLabel || (s.rulHours + ' h')}.`;
        }
      } else {
        if (statusEl) {
          statusEl.textContent = 'ELEVATED HEAT SOAK';
          statusEl.className = 'hud-status-badge badge-warning';
        }
        if (relevanceEl) {
          relevanceEl.textContent = `Secondary thermal load: Heat soak from combustion chambers is elevating crankcase and component temperatures.`;
        }
      }
    } else if (isLubricationFault) {
      if (normId === 'lubrication_system' || normId === 'oil_pump' || normId === 'oil_system') {
        if (statusEl) {
          statusEl.textContent = 'LUBRICATION FAULT';
          statusEl.className = 'hud-status-badge badge-critical';
        }
        if (relevanceEl) {
          relevanceEl.textContent = `⚠️ AUTHENTIC OIL SYSTEM FAILURE: Actual mechanical oil pressure drop (${s.rawTelemetry?.oilPress?.toFixed(1)} PSI). Hydrodynamic oil film compromised.`;
        }
      } else if (normId === 'crankshaft' || normId === 'camshaft' || normId === 'conrod' || normId === 'piston') {
        if (statusEl) {
          statusEl.textContent = 'BEARING WEAR RISK';
          statusEl.className = 'hud-status-badge badge-warning';
        }
        if (relevanceEl) {
          relevanceEl.textContent = `Boundary lubrication regime: Journal bearings and piston skirts experiencing elevated friction due to low oil pressure.`;
        }
      } else {
        if (statusEl) {
          statusEl.textContent = 'NOMINAL';
          statusEl.className = 'hud-status-badge badge-nominal';
        }
        if (relevanceEl) {
          relevanceEl.textContent = `Component operating within acceptable envelope under current lubrication state.`;
        }
      }
    } else if (isRpmInstability) {
      if (normId === 'crankshaft' || normId === 'camshaft' || normId === 'conrod') {
        if (statusEl) {
          statusEl.textContent = 'RPM INSTABILITY';
          statusEl.className = 'hud-status-badge badge-warning';
        }
        if (relevanceEl) {
          relevanceEl.textContent = `Torsional oscillation: Engine RPM fluctuating across drivetrain assembly (governor hunt / fuel delivery variation).`;
        }
      } else {
        if (statusEl) {
          statusEl.textContent = 'NOMINAL';
          statusEl.className = 'hud-status-badge badge-nominal';
        }
        if (relevanceEl) {
          relevanceEl.textContent = `Component maintaining structural nominal status despite transient RPM oscillation.`;
        }
      }
    } else {
      if (statusEl) {
        statusEl.textContent = 'NOMINAL';
        statusEl.className = 'hud-status-badge badge-nominal';
      }
      if (relevanceEl) {
        relevanceEl.textContent = `Nominal thermal & mechanical profile. Combustion pressure and heat dissipation across ${compName} correlate perfectly with calibrated 4-stroke aero piston physics model.`;
      }
    }

    // Telemetry items in HUD
    if (s.rawTelemetry) {
      const raw = s.rawTelemetry;
      const deltas = getCylinderDeltas(comp.cylIndex || (physComp && physComp.cylIndex));
      const avgCht = (raw.cht && raw.cht.length) ? (raw.cht.reduce((a, b) => a + b, 0) / raw.cht.length) : 178;
      const avgEgt = (raw.egt && raw.egt.length) ? (raw.egt.reduce((a, b) => a + b, 0) / raw.egt.length) : 824;
      const trustScore = (s.trustResult && s.trustResult.scores && s.trustResult.scores.oilPress !== undefined) ? s.trustResult.scores.oilPress : 0.96;

      const chtEl = document.getElementById('hud-cht');
      const egtEl = document.getElementById('hud-egt');
      const rpmEl = document.getElementById('hud-rpm');
      const loadEl = document.getElementById('hud-load');
      const oilPEl = document.getElementById('hud-oil-p');
      const oilTEl = document.getElementById('hud-oil-t');
      const mapEl = document.getElementById('hud-map');
      const fuelEl = document.getElementById('hud-fuel');
      const trustEl = document.getElementById('hud-trust');

      if (chtEl) chtEl.textContent = `${(avgCht + deltas.cht).toFixed(1)} °C`;
      if (egtEl) egtEl.textContent = `${(avgEgt + deltas.egt).toFixed(1)} °C`;
      if (rpmEl) rpmEl.textContent = raw.rpm !== undefined ? `${Math.round(raw.rpm).toLocaleString()}` : '--';
      if (loadEl) loadEl.textContent = raw.load !== undefined ? `${raw.load.toFixed(1)} %` : '--';
      if (oilPEl) oilPEl.textContent = raw.oilPress !== undefined ? `${raw.oilPress.toFixed(1)} PSI` : '--';
      if (oilTEl) oilTEl.textContent = raw.oilTemp !== undefined ? `${raw.oilTemp.toFixed(1)} °C` : '--';
      if (mapEl) mapEl.textContent = raw.map !== undefined ? `${raw.map.toFixed(1)} inHg` : '--';
      if (fuelEl) fuelEl.textContent = raw.fuelFlow !== undefined ? `${raw.fuelFlow.toFixed(1)} L/h` : '--';
      if (trustEl) trustEl.textContent = trustScore.toFixed(2);
    }
  }

  window.setInspectionMode = function (mode) {
    currentInspectionMode = mode;

    const btnInspect = document.getElementById('btn-mode-inspect');
    const btnXray = document.getElementById('btn-mode-xray');
    const btnExploded = document.getElementById('btn-mode-exploded');

    if (btnInspect) btnInspect.classList.toggle('active', mode === 'inspect');
    if (btnXray) btnXray.classList.toggle('active', mode === 'xray');
    if (btnExploded) btnExploded.classList.toggle('active', mode === 'exploded');

    if (digitalTwin) {
      digitalTwin.setInspectionMode(mode);
    }

    const xrayBanner = document.getElementById('twin-xray-overview');
    if (xrayBanner) {
      if (mode === 'xray' && !selectedComponent) {
        xrayBanner.style.display = 'block';
      } else {
        xrayBanner.style.display = 'none';
      }
    }
  };

  window.resetEngineInspection = function () {
    selectedComponent = null;
    currentInspectionMode = 'inspect';

    const btnInspect = document.getElementById('btn-mode-inspect');
    const btnXray = document.getElementById('btn-mode-xray');
    const btnExploded = document.getElementById('btn-mode-exploded');
    if (btnInspect) btnInspect.classList.add('active');
    if (btnXray) btnXray.classList.remove('active');
    if (btnExploded) btnExploded.classList.remove('active');

    const backBtn = document.getElementById('btn-back-to-engine');
    if (backBtn) backBtn.style.display = 'none';

    const syncLabel = document.getElementById('twin-sync-label');
    if (syncLabel) syncLabel.style.display = '';

    const hud = document.getElementById('twin-inspection-hud');
    if (hud) hud.style.display = 'none';

    const xrayBanner = document.getElementById('twin-xray-overview');
    if (xrayBanner) xrayBanner.style.display = 'none';

    if (digitalTwin) {
      digitalTwin.resetInspection();
    }
  };

  window.onEngineComponentSelected = function (comp) {
    selectedComponent = comp;

    const xrayBanner = document.getElementById('twin-xray-overview');
    if (xrayBanner) xrayBanner.style.display = 'none';

    const syncLabel = document.getElementById('twin-sync-label');
    if (syncLabel) syncLabel.style.display = 'none';

    const backBtn = document.getElementById('btn-back-to-engine');
    if (backBtn) backBtn.style.display = 'inline-flex';

    const hud = document.getElementById('twin-inspection-hud');
    if (hud) {
      hud.style.display = 'flex';
    }

    updateInspectionHud(comp);
  };

  window.inspectComponent = function (compKey) {
    if (digitalTwin) {
      digitalTwin.selectComponent(compKey);
    }
  };

  window.toggleEngineMotion = function () {
    if (!digitalTwin) return;
    const isPlaying = digitalTwin.toggleMotion();
    const playBtn = document.getElementById('btn-motion-play');
    const playIcon = document.getElementById('motion-play-icon');
    if (playBtn) playBtn.classList.toggle('active', isPlaying);
    if (playIcon) playIcon.innerHTML = isPlaying ? '&#10074;&#10074;' : '&#9654;';
  };

  window.setEngineSpeed = function (factor) {
    if (!digitalTwin) return;
    digitalTwin.setSpeedFactor(factor);
    const btnHalf = document.getElementById('btn-speed-half');
    const btnFull = document.getElementById('btn-speed-full');
    if (btnHalf) btnHalf.classList.toggle('active', factor === 0.5);
    if (btnFull) btnFull.classList.toggle('active', factor === 1.0);
  };

  // Public exports on window for testability and developer tools
  window.captureAppStateSnapshot = captureAppStateSnapshot;
  window.generateLocalAnalysis = generateLocalAnalysis;
  window.routeDeterministicIntent = routeDeterministicIntent;
  window.handleUserQuery = handleUserQuery;
  window.renderLiveTelemetry = renderLiveTelemetry;

})();
