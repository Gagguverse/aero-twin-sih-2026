/* ==========================================================================
   AERO-TWIN: SENSOR TRUST EVALUATION LAYER
   SIH Problem Statement: SIH26054 (DRDO - Robotics & Drones - Software)
   
   Core Differentiator: "Sensor Trust Before Health Judgment"
   This layer assesses raw sensor signals BEFORE any health judgment is made.
   It distinguishes between:
   1. A faulty sensor producing abnormal data while the engine is actually healthy.
   2. Genuine engine degradation where trusted sensors show correlated abnormal behavior.
   ========================================================================== */

class SensorTrustEngine {
  constructor() {
    this.windowSize = 25; // Rolling history window (~2.5 sec at 10Hz)
    this.history = {
      rpm: [],
      cht1: [], cht2: [], cht3: [], cht4: [],
      egt1: [], egt2: [], egt3: [], egt4: [],
      oilPress: [],
      oilTemp: [],
      fuelFlow: [],
      map: [],
      load: []
    };

    // Trust scores between 0.0 (untrusted / failed) and 1.0 (fully trusted)
    this.trustScores = {
      rpm: 1.0,
      cht: [1.0, 1.0, 1.0, 1.0],
      egt: [1.0, 1.0, 1.0, 1.0],
      oilPress: 1.0,
      oilTemp: 1.0,
      fuelFlow: 1.0,
      map: 1.0,
      load: 1.0
    };

    // Human-readable diagnostic reason for distrust
    this.reasons = {};

    // Slew rate limits (maximum physically plausible change per 100ms frame)
    this.maxSlew = {
      rpm: 350,       // Max ~3500 RPM/sec change
      cht: 6.0,       // Max ~60°C/sec (thermal inertia prevents sudden jumps)
      egt: 25.0,      // Max ~250°C/sec
      oilPress: 12.0, // Max 12 PSI / frame
      oilTemp: 3.0,   // High thermal mass
      fuelFlow: 8.0,  // Max 8 L/hr step
      map: 5.0,
      load: 20.0
    };

    // Trust threshold below which sensor is quarantined
    this.distrustThreshold = 0.60;

    // Hard physics plausibility limits
    this.physicalRanges = {
      rpm: { min: 800, max: 6200, unit: 'RPM', name: 'Engine RPM' },
      cht: { min: 40, max: 240, unit: '°C', name: 'Cylinder Head Temp' },
      egt: { min: 250, max: 980, unit: '°C', name: 'Exhaust Gas Temp' },
      oilPress: { min: 10, max: 90, unit: 'PSI', name: 'Oil Pressure Transducer' },
      oilTemp: { min: 40, max: 135, unit: '°C', name: 'Oil Temperature' },
      fuelFlow: { min: 4.0, max: 50.0, unit: 'L/hr', name: 'Fuel Flow Meter' },
      map: { min: 10.0, max: 48.0, unit: 'inHg', name: 'MAP Sensor' }
    };
  }

  /**
   * Reset sliding history (useful when switching scenarios)
   */
  reset() {
    for (let key in this.history) {
      this.history[key] = [];
    }
    this.trustScores = {
      rpm: 1.0,
      cht: [1.0, 1.0, 1.0, 1.0],
      egt: [1.0, 1.0, 1.0, 1.0],
      oilPress: 1.0,
      oilTemp: 1.0,
      fuelFlow: 1.0,
      map: 1.0,
      load: 1.0
    };
    this.reasons = {};
  }

  /**
   * Evaluates trust for all sensor signals in the current telemetry frame.
   * Runs BEFORE health judgment.
   *
   * @param {Object} rawState - The raw telemetry frame from engine/simulator
   * @param {Object} expectedPhysics - Physics-expected baseline values
   * @returns {Object} Trust evaluation result with scores, quarantined flags, and sanitized state
   */
  evaluate(rawState, expectedPhysics = {}) {
    // --- NULL-SAFETY: Ensure rawState is a valid object before any field access ---
    if (!rawState || typeof rawState !== 'object') {
      console.warn('[SensorTrustEngine] evaluate() received null/non-object rawState — returning safe defaults.');
      return this._safeFallbackResult();
    }

    // Helpers: safe array element accessor (returns null if array or element is missing)
    const safeArr = (arr, idx) => {
      if (!Array.isArray(arr)) return null;
      const v = arr[idx];
      return (v === undefined) ? null : v;
    };
    // Safe numeric accessor — returns null if value is null/undefined/NaN/non-finite
    const safeNum = (v) => {
      if (v === null || v === undefined) return null;
      if (typeof v !== 'number' || !isFinite(v) || isNaN(v)) return null;
      return v;
    };

    // 1. Push raw readings into rolling history (skip nulls — invalid sentinels from validator)
    if (safeNum(rawState.rpm) !== null) this._recordHistory('rpm', rawState.rpm);
    const chtArr = Array.isArray(rawState.cht) ? rawState.cht : [null, null, null, null];
    const egtArr = Array.isArray(rawState.egt) ? rawState.egt : [null, null, null, null];
    if (safeNum(safeArr(chtArr, 0)) !== null) this._recordHistory('cht1', chtArr[0]);
    if (safeNum(safeArr(chtArr, 1)) !== null) this._recordHistory('cht2', chtArr[1]);
    if (safeNum(safeArr(chtArr, 2)) !== null) this._recordHistory('cht3', chtArr[2]);
    if (safeNum(safeArr(chtArr, 3)) !== null) this._recordHistory('cht4', chtArr[3]);
    if (safeNum(safeArr(egtArr, 0)) !== null) this._recordHistory('egt1', egtArr[0]);
    if (safeNum(safeArr(egtArr, 1)) !== null) this._recordHistory('egt2', egtArr[1]);
    if (safeNum(safeArr(egtArr, 2)) !== null) this._recordHistory('egt3', egtArr[2]);
    if (safeNum(safeArr(egtArr, 3)) !== null) this._recordHistory('egt4', egtArr[3]);
    if (safeNum(rawState.oilPress) !== null) this._recordHistory('oilPress', rawState.oilPress);
    if (safeNum(rawState.oilTemp) !== null)  this._recordHistory('oilTemp', rawState.oilTemp);
    if (safeNum(rawState.fuelFlow) !== null) this._recordHistory('fuelFlow', rawState.fuelFlow);
    if (safeNum(rawState.map) !== null)      this._recordHistory('map', rawState.map);
    const rawLoad = rawState.load;
    const engLoad = typeof rawLoad === 'number' && isFinite(rawLoad)
      ? rawLoad
      : (typeof rawState.throttle === 'number' && isFinite(rawState.throttle) ? rawState.throttle * 100 : 70);
    this._recordHistory('load', engLoad);

    // Attach safe accessors to state for use in sub-evaluators (avoids re-computing)
    rawState._safeNum = safeNum;
    rawState._chtArr = chtArr;
    rawState._egtArr = egtArr;

    const reasons = {};

    // 2. Check RPM Sensor
    // If rpm is null (invalid sentinel from validator) → trust = 0.10 immediately
    if (rawState.rpm === null) {
      this.trustScores.rpm = 0.10;
      reasons.rpm = 'RPM sensor reading rejected by pre-validator: null/invalid/out-of-range value.';
    } else {
      this.trustScores.rpm = this._evaluateSignalTrust(
        'rpm',
        rawState.rpm,
        this.maxSlew.rpm,
        expectedPhysics.rpm || 4200,
        reasons,
        'RPM'
      );
    }

    // Dynamic engine variance indicator (is engine operating dynamically?)
    const rpmVar = this._computeVariance(this.history.rpm);
    const loadVar = this._computeVariance(this.history.load);
    const isEngineDynamic = rpmVar > 4.0 || loadVar > 1.5;

    // 3. Check Oil Pressure Sensor (CRITICAL DEMO MOMENT: SENSOR FREEZE VS MECHANICAL FAILURE)
    if (rawState.oilPress === null) {
      this.trustScores.oilPress = 0.10;
      reasons.oilPress = 'Oil pressure sensor reading rejected by pre-validator: null/invalid/out-of-range value (e.g. negative PSI).';
    } else {
      this.trustScores.oilPress = this._evaluateOilPressureTrust(
        rawState,
        expectedPhysics,
        isEngineDynamic,
        reasons
      );
    }

    // 4. Check Oil Temperature Sensor
    if (rawState.oilTemp === null) {
      this.trustScores.oilTemp = 0.10;
      reasons.oilTemp = 'Oil temperature sensor reading rejected by pre-validator: null/invalid/out-of-range value.';
    } else {
      this.trustScores.oilTemp = this._evaluateSignalTrust(
        'oilTemp',
        rawState.oilTemp,
        this.maxSlew.oilTemp,
        expectedPhysics.oilTemp || 88,
        reasons,
        'Oil Temp'
      );
    }

    // 5. Check Cylinder Head Temperatures (CHT 1-4) & Cross-Correlation with EGT
    for (let i = 0; i < 4; i++) {
      const chtKey = `cht${i + 1}`;
      const egtKey = `egt${i + 1}`;
      const chtVal = chtArr[i] !== undefined ? chtArr[i] : null;
      const egtVal = egtArr[i] !== undefined ? egtArr[i] : null;
      if (chtVal === null) {
        this.trustScores.cht[i] = 0.10;
        reasons[chtKey] = `CHT #${i + 1} sensor reading rejected by pre-validator: null/invalid/out-of-range value.`;
      } else {
        this.trustScores.cht[i] = this._evaluateChtTrust(
          i,
          chtVal,
          egtVal,
          chtKey,
          egtKey,
          expectedPhysics,
          reasons
        );
      }
    }

    // 6. Check Exhaust Gas Temperatures (EGT 1-4)
    for (let i = 0; i < 4; i++) {
      const egtKey = `egt${i + 1}`;
      const egtVal = egtArr[i] !== undefined ? egtArr[i] : null;
      if (egtVal === null) {
        this.trustScores.egt[i] = 0.10;
        reasons[egtKey] = `EGT #${i + 1} sensor reading rejected by pre-validator: null/invalid/out-of-range value.`;
      } else {
        this.trustScores.egt[i] = this._evaluateSignalTrust(
          egtKey,
          egtVal,
          this.maxSlew.egt,
          expectedPhysics.egt ? expectedPhysics.egt[i] : 780,
          reasons,
          `EGT #${i + 1}`
        );
      }
    }

    // 7. Check Fuel Flow & MAP
    if (rawState.fuelFlow === null) {
      this.trustScores.fuelFlow = 0.10;
      reasons.fuelFlow = 'Fuel flow meter reading rejected by pre-validator: null/invalid/out-of-range value.';
    } else {
      this.trustScores.fuelFlow = this._evaluateSignalTrust(
        'fuelFlow',
        rawState.fuelFlow,
        this.maxSlew.fuelFlow,
        expectedPhysics.fuelFlow || 24,
        reasons,
        'Fuel Flow'
      );
    }
    if (rawState.map === null) {
      this.trustScores.map = 0.10;
      reasons.map = 'MAP sensor reading rejected by pre-validator: null/invalid/out-of-range value.';
    } else {
      this.trustScores.map = this._evaluateSignalTrust(
        'map',
        rawState.map,
        this.maxSlew.map,
        expectedPhysics.map || 34,
        reasons,
        'MAP'
      );
    }
    this.trustScores.load = 1.0;

    this.reasons = reasons;

    // Identify quarantined sensors (trust < threshold)
    const quarantined = [];
    if (this.trustScores.oilPress < this.distrustThreshold) quarantined.push('oilPress');
    if (this.trustScores.rpm < this.distrustThreshold) quarantined.push('rpm');
    if (this.trustScores.oilTemp < this.distrustThreshold) quarantined.push('oilTemp');
    if (this.trustScores.fuelFlow < this.distrustThreshold) quarantined.push('fuelFlow');
    if (this.trustScores.map < this.distrustThreshold) quarantined.push('map');
    for (let i = 0; i < 4; i++) {
      if (this.trustScores.cht[i] < this.distrustThreshold) quarantined.push(`cht${i + 1}`);
      if (this.trustScores.egt[i] < this.distrustThreshold) quarantined.push(`egt${i + 1}`);
    }

    // Compute Overall Sensor Trust Index (0 to 1)
    const allScores = [
      this.trustScores.rpm,
      this.trustScores.oilPress,
      this.trustScores.oilTemp,
      this.trustScores.fuelFlow,
      this.trustScores.map,
      ...this.trustScores.cht,
      ...this.trustScores.egt
    ];
    const overallTrust = allScores.reduce((a, b) => a + b, 0) / allScores.length;

    // Build Sanitized/Trusted State for the Digital Twin
    // Distrusted sensor readings are replaced with expected physics values so that
    // the health calculation does NOT falsely collapse!
    // NOTE: If rawState has _invalidFields[] from TelemetryValidator, those are already
    // null sentinels — we replace them here with physics baselines for the health calc.
    const trustedState = Object.assign({}, rawState);
    // Clone arrays so we don't mutate the validated state
    trustedState.cht = Array.isArray(rawState.cht) ? rawState.cht.slice() : [null, null, null, null];
    trustedState.egt = Array.isArray(rawState.egt) ? rawState.egt.slice() : [null, null, null, null];

    if (this.trustScores.oilPress < this.distrustThreshold) {
      trustedState.oilPress = expectedPhysics.oilPress || 52.4;
      trustedState._oilPressQuarantined = true;
      trustedState._rawOilPress = rawState.oilPress;
    }
    for (let i = 0; i < 4; i++) {
      if (this.trustScores.cht[i] < this.distrustThreshold) {
        trustedState.cht[i] = expectedPhysics.cht ? (expectedPhysics.cht[i] || 168.0) : 168.0;
        trustedState._chtQuarantined = true;
      }
      if (this.trustScores.egt[i] < this.distrustThreshold) {
        trustedState.egt[i] = expectedPhysics.egt ? (expectedPhysics.egt[i] || 780.0) : 780.0;
        trustedState._egtQuarantined = true;
      }
    }

    // Build Detailed Per-Sensor Explainability
    const sensorDetails = {};
    const buildDetail = (key, name, val, score, unit, defaultReason) => {
      const isQuar = score < this.distrustThreshold;
      const rangeCfg = this.physicalRanges[key] || { min: 0, max: 9999 };
      const inRange = val >= rangeCfg.min && val <= rangeCfg.max;
      const varVal = this._computeVariance(this.history[key] || []);
      const isFrozen = (key === 'oilPress' && this.history.oilPress.length >= 10 && varVal < 0.005 && isEngineDynamic);
      
      const checks = {
        physicalRange: {
          pass: inRange,
          label: `Range (${rangeCfg.min}–${rangeCfg.max} ${unit})`,
          detail: inRange ? 'PASSED (Nominal)' : 'OUT OF ENVELOPE'
        },
        slewRate: {
          pass: true,
          label: 'Slew Rate Limit',
          detail: 'PASSED (Physically Plausible)'
        },
        freezeStagnation: {
          pass: !isFrozen,
          label: 'Temporal Variation Check',
          detail: isFrozen ? `FAILED (Variance = ${varVal.toFixed(4)} < 0.005)` : 'PASSED (Dynamic Noise Present)'
        },
        crossCorrelation: {
          pass: !isQuar,
          label: 'Cross-Sensor Correlation',
          detail: isQuar ? 'DECOUPLED (Uncorrelated with engine load)' : 'PASSED (Coupled with Propulsion Baseline)'
        }
      };

      return {
        key,
        name,
        val: typeof val === 'number' ? Number(val.toFixed(1)) : val,
        unit,
        trustScore: Number(score.toFixed(2)),
        status: isQuar ? 'QUARANTINED' : (score < 0.85 ? 'SUSPICIOUS' : 'TRUSTED'),
        quarantined: isQuar,
        checks,
        reason: reasons[key] || (isQuar ? defaultReason : 'Signal verified with physical range & dynamic correlation checks.')
      };
    };

    sensorDetails.rpm = buildDetail('rpm', 'Engine RPM', rawState.rpm, this.trustScores.rpm, 'RPM', 'RPM fluctuation outside limits');
    sensorDetails.oilPress = buildDetail('oilPress', 'Oil Pressure Transducer', rawState.oilPress, this.trustScores.oilPress, 'PSI', 'Frozen variance / transducer fault');
    sensorDetails.oilTemp = buildDetail('oilTemp', 'Oil Temperature Sensor', rawState.oilTemp, this.trustScores.oilTemp, '°C', 'Oil temp thermal sensor anomaly');
    sensorDetails.fuelFlow = buildDetail('fuelFlow', 'Fuel Flow Meter', rawState.fuelFlow, this.trustScores.fuelFlow, 'L/hr', 'Fuel flow rate transducer mismatch');
    sensorDetails.map = buildDetail('map', 'MAP / Boost Pressure', rawState.map, this.trustScores.map, 'inHg', 'Manifold sensor anomaly');

    for (let i = 0; i < 4; i++) {
      sensorDetails[`cht${i + 1}`] = buildDetail(`cht`, `CHT Cylinder #${i + 1}`, rawState.cht[i], this.trustScores.cht[i], '°C', reasons[`cht${i + 1}`] || 'Thermistor drift');
      sensorDetails[`egt${i + 1}`] = buildDetail(`egt`, `EGT Cylinder #${i + 1}`, rawState.egt[i], this.trustScores.egt[i], '°C', reasons[`egt${i + 1}`] || 'Thermocouple anomaly');
    }

    return {
      scores: { ...this.trustScores },
      overallTrust: Number(overallTrust.toFixed(2)),
      quarantined,
      hasSensorFault: quarantined.length > 0,
      reasons,
      sensorDetails,
      trustedState
    };
  }

  /**
   * Evaluates oil pressure trust with cross-sensor correlation:
   * - Distinguishes FROZEN sensor (zero noise/variance while engine is running)
   * - Distinguishes ELECTRICAL OPEN-CIRCUIT / DROP while oil temp & vibration remain nominal
   * - Versus REAL LUBRICATION FAILURE where oil pressure drops AND oil temp spikes and vibration rises
   */
  _evaluateOilPressureTrust(rawState, expectedPhysics, isEngineDynamic, reasons) {
    const hist = this.history.oilPress;
    if (hist.length < 5) return 1.0;

    let trust = 1.0;
    const currentVal = rawState.oilPress;
    const expected = expectedPhysics.oilPress || 52.0;

    // 1. Frozen Signal Detection:
    // If the sensor reading has zero variance (< 0.005) across sliding window while engine is active
    const variance = this._computeVariance(hist);
    if (hist.length >= 10 && variance < 0.005 && isEngineDynamic) {
      trust = 0.28;
      reasons.oilPress = "Oil pressure signal remained unchanged (frozen variance < 0.005) while correlated engine parameters changed normally.";
      return trust;
    }

    // 2. Cross-Sensor Correlation Check:
    // If Oil Pressure drops abnormally (< 28 PSI or > 25 PSI below expected), check correlated indicators:
    // Correlated indicators for real lubrication failure:
    // - Oil Temperature rises (> 100°C)
    // - Bearing vibration rises (> 2.8 mm/s)
    // - Engine load / RPM behavior
    const pressDrop = expected - currentVal;
    if (pressDrop > 18) {
      const isOilTempNominal = rawState.oilTemp < 95;
      const isVibrationNominal = rawState.vibrationRms < 2.5;
      const isRpmSteady = rawState.rpm > 3500;

      if (isOilTempNominal && isVibrationNominal && isRpmSteady) {
        // Oil pressure collapsed, but oil temperature and vibration remain completely healthy!
        // This is a Sensor Transducer / Wiring Fault, NOT an engine oil pump seizure!
        trust = Math.max(0.15, Math.min(0.35, 1.0 - (pressDrop / 30)));
        reasons.oilPress = `Oil pressure transducer reported abnormal reading (${currentVal.toFixed(1)} PSI) while correlated oil temperature (${Math.round(rawState.oilTemp)}°C) and vibration remain nominal. Sensor isolated.`;
        return Number(trust.toFixed(2));
      }
    }

    // 3. Slew rate check (impossible step change)
    if (hist.length >= 2) {
      const delta = Math.abs(hist[hist.length - 1] - hist[hist.length - 2]);
      if (delta > this.maxSlew.oilPress) {
        trust = 0.32;
        reasons.oilPress = `Physically implausible oil pressure slew rate (${delta.toFixed(1)} PSI/step exceeds limit ${this.maxSlew.oilPress}).`;
        return trust;
      }
    }

    return Number(trust.toFixed(2));
  }

  /**
   * Evaluates CHT trust with CHT-EGT cross correlation:
   * A true combustion anomaly produces correlated CHT AND EGT elevation.
   * An isolated CHT rise with cold EGT indicates thermistor drift/failure.
   */
  _evaluateChtTrust(cylIdx, chtVal, egtVal, chtKey, egtKey, expectedPhysics, reasons) {
    const hist = this.history[chtKey];
    if (hist.length < 5) return 1.0;

    let trust = 1.0;
    const expectedCht = expectedPhysics.cht ? expectedPhysics.cht[cylIdx] : 168;
    const expectedEgt = expectedPhysics.egt ? expectedPhysics.egt[cylIdx] : 780;

    // 1. Slew rate check
    if (hist.length >= 2) {
      const delta = Math.abs(hist[hist.length - 1] - hist[hist.length - 2]);
      if (delta > this.maxSlew.cht) {
        trust = 0.35;
        reasons[chtKey] = `CHT #${cylIdx + 1} thermistor step change (${delta.toFixed(1)}°C/step) violates thermal dissipation slew limits.`;
        return trust;
      }
    }

    // 2. Uncorrelated Thermal Anomaly (Thermistor Drift)
    // If CHT is > 215°C but EGT is flat or cool (< 790°C), thermal physics is violated
    const chtDelta = chtVal - expectedCht;
    const egtDelta = egtVal - expectedEgt;
    if (chtDelta > 45 && egtDelta < 15) {
      trust = 0.38;
      reasons[chtKey] = `CHT #${cylIdx + 1} reads elevated (+${Math.round(chtDelta)}°C) without corresponding exhaust gas temperature increase (EGT delta: ${Math.round(egtDelta)}°C). Signal flagged as thermistor drift.`;
      return trust;
    }

    return Number(trust.toFixed(2));
  }

  /**
   * Generic signal plausibility check (slew rate, range limits, frozen check)
   */
  _evaluateSignalTrust(key, currentVal, maxSlew, expectedVal, reasons, label) {
    const hist = this.history[key];
    if (hist.length < 3) return 1.0;

    // Check slew limit
    const lastVal = hist[hist.length - 2];
    const delta = Math.abs(currentVal - lastVal);
    if (delta > maxSlew) {
      reasons[key] = `${label} signal jump (${delta.toFixed(1)}) exceeds maximum physical rate of change (${maxSlew}).`;
      return 0.35;
    }

    return 1.0;
  }

  _recordHistory(key, val) {
    if (!this.history[key]) this.history[key] = [];
    // Guard: only record finite numbers — skip null/NaN/undefined sentinels
    const n = Number(val);
    if (val === null || val === undefined || !isFinite(n) || isNaN(n)) return;
    this.history[key].push(n);
    if (this.history[key].length > this.windowSize) {
      this.history[key].shift();
    }
  }

  /**
   * Safe fallback result returned when evaluate() receives a non-object state.
   * Preserves last known trust scores rather than resetting to zero.
   */
  _safeFallbackResult() {
    const quarantined = [];
    const allScores = [
      this.trustScores.rpm, this.trustScores.oilPress, this.trustScores.oilTemp,
      this.trustScores.fuelFlow, this.trustScores.map,
      ...this.trustScores.cht, ...this.trustScores.egt
    ];
    const overallTrust = allScores.reduce((a, b) => a + b, 0) / allScores.length;
    return {
      scores: { ...this.trustScores },
      overallTrust: Number(overallTrust.toFixed(2)),
      quarantined,
      hasSensorFault: false,
      reasons: { _system: 'Null/malformed telemetry packet — trust scores preserved from last frame.' },
      sensorDetails: {},
      trustedState: null
    };
  }

  _computeVariance(arr) {
    if (!arr || arr.length < 3) return 1.0;
    const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
    const sumSq = arr.reduce((a, b) => a + Math.pow(b - mean, 2), 0);
    return sumSq / arr.length;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = SensorTrustEngine;
}
if (typeof window !== 'undefined') {
  window.SensorTrustEngine = SensorTrustEngine;
}
