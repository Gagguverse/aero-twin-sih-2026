/* ==========================================================================
   AERO TWIN — OPERATING-CONDITION AWARE ENGINE PHYSICS MODEL & RESIDUAL LAYER
   SIH26054 | DRDO MALE UAV Aero Piston Engine Digital Twin
   
   Explicit Lightweight Physics Model:
   - Evaluates expected thermodynamic & mechanical equilibrium based on:
     RPM, Engine Load, Throttle Demand, Ambient Temperature, Altitude & Density, Mission Phase.
   - Computes real-time Actual - Expected residuals and normalized deviations.
   - Integrates with Sensor Trust: Distrusted/quarantined sensors use expected baselines
     so that faulty instrumentation does NOT create false engine residuals!
   ========================================================================== */

class AeroPhysicsModel {
  constructor() {
    // Nominal baseline ranges for normalization & semantic status thresholds
    this.nominalRanges = {
      rpm: { range: 800, warn: 250, crit: 450 },
      egt: { range: 85, warn: 35, crit: 65 },          // °C
      cht: { range: 30, warn: 12, crit: 22 },          // °C
      oilPress: { range: 18, warn: 7, crit: 14 },      // PSI
      oilTemp: { range: 16, warn: 8, crit: 16 },       // °C
      fuelFlow: { range: 8.0, warn: 3.0, crit: 5.5 },  // L/hr
      map: { range: 8.0, warn: 3.0, crit: 5.0 },       // inHg
      load: { range: 25, warn: 12, crit: 20 }          // %
    };
  }

  /**
   * Computes expected engine thermodynamic & mechanical parameters
   * based on current operating conditions & environmental state.
   */
  computeExpectedState(conditions = {}) {
    const altitude = typeof conditions.altitude === 'number' ? conditions.altitude : 18000;
    const envTempMod = typeof conditions.ambientTempMod === 'number' ? conditions.ambientTempMod : 0;
    const throttle = typeof conditions.throttle === 'number' ? conditions.throttle : 0.72;
    const missionPhase = conditions.missionPhase || 'cruise';

    // Standard atmospheric pressure at altitude (inHg)
    const ambientPress = Number((29.92 * Math.pow(1 - 6.875e-6 * Math.max(0, altitude), 5.256)).toFixed(1));
    // Standard ISA temperature at altitude + environment modifier (°C)
    const baseIsaTemp = Math.round(15 - (altitude * 0.00198));
    const ambientTemp = baseIsaTemp + envTempMod;

    // Atmospheric density ratio relative to sea level
    const seaLevelTempK = 288.15;
    const ambientTempK = Math.max(200, ambientTemp + 273.15);
    const densityRatio = (ambientPress / 29.92) * (seaLevelTempK / ambientTempK);

    // Target Engine Load
    const normThrottle = Math.max(0.15, Math.min(1.0, throttle));
    const load = Math.round(normThrottle * 100);
    const normLoad = load / 100;

    // 1. Expected RPM based on throttle and phase governor
    let expectedRpm = Math.round(1800 + (normThrottle * 3600));
    if (missionPhase === 'idle') expectedRpm = 1800;
    else if (missionPhase === 'takeoff') expectedRpm = 5400;

    // 2. Expected Manifold Absolute Pressure (MAP, inHg)
    // Turbocharged aero piston engine with automatic density/wastegate regulation
    // Up to critical altitude (~28,000 ft MSL), wastegate maintains throttle-demanded manifold pressure
    const criticalAltitude = 28000;
    const maxBoostInHg = 28.0; // Max compressor boost capability
    let targetRegulatedMap;
    if (missionPhase === 'takeoff') {
      targetRegulatedMap = 39.2;
    } else if (missionPhase === 'idle') {
      targetRegulatedMap = 15.5;
    } else if (missionPhase === 'loiter') {
      targetRegulatedMap = 25.5;
    } else {
      // Cruise / Climb: nominal cruise at 72% throttle is ~28.5 inHg
      targetRegulatedMap = 14.0 + (normThrottle * 20.14);
    }

    let expectedMap;
    const requiredBoost = targetRegulatedMap - ambientPress;
    if (altitude <= criticalAltitude && requiredBoost <= maxBoostInHg) {
      expectedMap = Number(targetRegulatedMap.toFixed(1));
    } else {
      expectedMap = Number((ambientPress + (maxBoostInHg * normThrottle)).toFixed(1));
    }

    // 3. Expected Fuel Flow (L/hr)
    const normRpm = expectedRpm / 5000;
    const expectedFuelFlow = Number((34.0 * normLoad * normRpm * Math.pow(densityRatio, 0.25)).toFixed(1));

    // 4. Expected EGT (°C) — fast thermal response to load and ambient
    const hotWeatherDelta = Math.max(0, ambientTemp - (-21)) * 0.35;
    const baseEgt = Math.round(720 + (normLoad * 85) + hotWeatherDelta);
    const expectedEgt = [baseEgt + 3, baseEgt - 3, baseEgt + 8, baseEgt - 2];
    const expectedEgtAvg = baseEgt;

    // 5. Expected CHT (°C) — cylinder heat soak equilibrium
    // High ambient temp reduces cooling air effectiveness
    const coolingPenalty = Math.max(0, ambientTemp - (-21)) * 0.45 + (densityRatio < 0.55 ? 4.0 : 0);
    const baseCht = Math.round(145 + (normLoad * 28) + coolingPenalty);
    const expectedCht = [baseCht, baseCht - 1, baseCht + 4, baseCht];
    const expectedChtAvg = baseCht;

    // 6. Expected Oil Temperature (°C)
    const expectedOilTemp = Math.round(82 + (normLoad * 12) + (coolingPenalty * 0.5));

    // 7. Expected Oil Pressure (PSI)
    const rpmOilContrib = (expectedRpm / 5000) * 18;
    const tempOilDrop = Math.max(0, (expectedOilTemp - 85) * 0.12);
    const expectedOilPress = Number((38 + rpmOilContrib - tempOilDrop).toFixed(1));

    return {
      operatingConditions: {
        altitude,
        ambientPress,
        ambientTemp,
        densityRatio: Number(densityRatio.toFixed(3)),
        throttle: normThrottle,
        load,
        missionPhase
      },
      expected: {
        rpm: expectedRpm,
        map: expectedMap,
        fuelFlow: Math.max(5.0, expectedFuelFlow),
        egt: expectedEgt,
        egtAvg: expectedEgtAvg,
        cht: expectedCht,
        chtAvg: expectedChtAvg,
        oilTemp: expectedOilTemp,
        oilPress: expectedOilPress,
        load
      }
    };
  }

  /**
   * Evaluates expected operating envelope for MAP based on
   * altitude, mission phase, engine load, throttle, and turbo operating state.
   */
  getMapOperatingEnvelope(conditions = {}) {
    const altitude = typeof conditions.altitude === 'number' ? conditions.altitude : 18000;
    const throttle = typeof conditions.throttle === 'number' ? conditions.throttle : 0.72;
    const missionPhase = (conditions.missionPhase || 'cruise').toLowerCase();
    const load = typeof conditions.load === 'number' ? conditions.load : Math.round(throttle * 100);

    let nominalMin, nominalMax, warnMin, warnMax;

    if (missionPhase === 'takeoff' || throttle >= 0.88) {
      nominalMin = 34.0;
      nominalMax = 41.5;
      warnMin = 31.0;
      warnMax = 43.5;
    } else if (missionPhase === 'idle' || throttle <= 0.35) {
      nominalMin = 13.0;
      nominalMax = 20.0;
      warnMin = 11.0;
      warnMax = 23.0;
    } else if (missionPhase === 'loiter' || (throttle >= 0.45 && throttle <= 0.60)) {
      nominalMin = 22.0;
      nominalMax = 28.5;
      warnMin = 19.0;
      warnMax = 31.5;
    } else {
      // Cruise / General flight at 60-85% throttle:
      // Valid turbocharged operating envelope: 25.0 to 33.5 inHg
      nominalMin = 25.0;
      nominalMax = 33.5;
      warnMin = 22.0;
      warnMax = 36.5;
    }

    return {
      nominalMin,
      nominalMax,
      warnMin,
      warnMax,
      phase: missionPhase,
      altitude,
      throttle,
      load
    };
  }

  /**
   * Computes actual - expected residuals and assigns semantic status.
   * Incorporates SENSOR TRUST: If a sensor is quarantined, its residual
   * is marked as quarantined/shielded so it doesn't declare false engine failure!
   */
  computeResiduals(rawTelemetry, expectedState, trustResult = {}) {
    const exp = expectedState.expected;
    const quarantined = trustResult.quarantined || [];
    const isOilQuarantined = quarantined.includes('oilPress');

    // Actual values (using cylinder averages for thermal)
    const actualRpm = rawTelemetry.rpm;
    const actualMap = rawTelemetry.map;
    const actualFuelFlow = rawTelemetry.fuelFlow;
    const actualChtAvg = rawTelemetry.cht ? (rawTelemetry.cht.reduce((a, b) => a + b, 0) / rawTelemetry.cht.length) : exp.chtAvg;
    const actualEgtAvg = rawTelemetry.egt ? (rawTelemetry.egt.reduce((a, b) => a + b, 0) / rawTelemetry.egt.length) : exp.egtAvg;
    const actualOilTemp = rawTelemetry.oilTemp;
    const actualOilPress = rawTelemetry.oilPress;
    const actualLoad = rawTelemetry.load !== undefined ? rawTelemetry.load : (rawTelemetry.throttle * 100);

    // Residuals: actual - expected
    const resRpm = actualRpm - exp.rpm;
    const resMap = actualMap - exp.map;
    const resFuelFlow = actualFuelFlow - exp.fuelFlow;
    const resCht = actualChtAvg - exp.chtAvg;
    const resEgt = actualEgtAvg - exp.egtAvg;
    const resOilTemp = actualOilTemp - exp.oilTemp;
    // For oil pressure: if quarantined, record raw residual but flag as shielded
    const resOilPressRaw = actualOilPress - exp.oilPress;
    const resOilPressEffective = isOilQuarantined ? 0.0 : resOilPressRaw;

    const residuals = {
      rpm: Math.round(resRpm),
      map: Number(resMap.toFixed(1)),
      fuelFlow: Number(resFuelFlow.toFixed(1)),
      cht: Number(resCht.toFixed(1)),
      egt: Number(resEgt.toFixed(1)),
      oilTemp: Number(resOilTemp.toFixed(1)),
      oilPress: Number(resOilPressEffective.toFixed(1)),
      oilPressRaw: Number(resOilPressRaw.toFixed(1)),
      load: Math.round(actualLoad - exp.load)
    };

    // Normalized Residuals (residual / nominalRange)
    const norm = {
      rpm: Number((residuals.rpm / this.nominalRanges.rpm.range).toFixed(3)),
      map: Number((residuals.map / this.nominalRanges.map.range).toFixed(3)),
      fuelFlow: Number((residuals.fuelFlow / this.nominalRanges.fuelFlow.range).toFixed(3)),
      cht: Number((residuals.cht / this.nominalRanges.cht.range).toFixed(3)),
      egt: Number((residuals.egt / this.nominalRanges.egt.range).toFixed(3)),
      oilTemp: Number((residuals.oilTemp / this.nominalRanges.oilTemp.range).toFixed(3)),
      oilPress: Number((residuals.oilPress / this.nominalRanges.oilPress.range).toFixed(3)),
      load: Number((residuals.load / this.nominalRanges.load.range).toFixed(3))
    };

    // Operating-condition aware MAP envelope evaluation
    const envelope = this.getMapOperatingEnvelope({
      altitude: (expectedState.operatingConditions && expectedState.operatingConditions.altitude) !== undefined
        ? expectedState.operatingConditions.altitude
        : rawTelemetry.altitude,
      throttle: (expectedState.operatingConditions && expectedState.operatingConditions.throttle) !== undefined
        ? expectedState.operatingConditions.throttle
        : rawTelemetry.throttle,
      missionPhase: (expectedState.operatingConditions && expectedState.operatingConditions.missionPhase)
        || rawTelemetry.missionPhase,
      load: actualLoad
    });

    let mapStatus = 'NORMAL';
    if (actualMap >= envelope.nominalMin && actualMap <= envelope.nominalMax) {
      // Legitimate reading within operating envelope -> NORMAL
      mapStatus = 'NORMAL';
    } else if (actualMap >= envelope.warnMin && actualMap <= envelope.warnMax) {
      mapStatus = actualMap > envelope.nominalMax ? 'ELEVATED' : 'LOW';
    } else {
      mapStatus = 'CRITICAL';
    }

    // Semantic Status Classifier: 'NORMAL' | 'ELEVATED' | 'LOW' | 'CRITICAL'
    const status = {
      rpm: this._classifyStatus(residuals.rpm, this.nominalRanges.rpm),
      map: mapStatus,
      fuelFlow: this._classifyStatus(residuals.fuelFlow, this.nominalRanges.fuelFlow),
      cht: this._classifyStatus(residuals.cht, this.nominalRanges.cht),
      egt: this._classifyStatus(residuals.egt, this.nominalRanges.egt),
      oilTemp: this._classifyStatus(residuals.oilTemp, this.nominalRanges.oilTemp),
      oilPress: isOilQuarantined ? 'QUARANTINED' : this._classifyStatus(residuals.oilPress, this.nominalRanges.oilPress)
    };

    // Detailed table rows formatted for UI display
    const tableRows = [
      {
        param: 'EGT (Exhaust Gas)',
        unit: '°C',
        expected: `${Math.round(exp.egtAvg)} °C`,
        actual: `${Math.round(actualEgtAvg)} °C`,
        residual: `${residuals.egt >= 0 ? '+' : ''}${residuals.egt.toFixed(1)} °C`,
        status: status.egt,
        isQuarantined: false
      },
      {
        param: 'CHT (Cylinder Head)',
        unit: '°C',
        expected: `${Math.round(exp.chtAvg)} °C`,
        actual: `${Math.round(actualChtAvg)} °C`,
        residual: `${residuals.cht >= 0 ? '+' : ''}${residuals.cht.toFixed(1)} °C`,
        status: status.cht,
        isQuarantined: false
      },
      {
        param: 'Oil Pressure',
        unit: 'PSI',
        expected: `${exp.oilPress.toFixed(1)} PSI`,
        actual: isOilQuarantined ? `${actualOilPress.toFixed(1)} PSI (Frozen)` : `${actualOilPress.toFixed(1)} PSI`,
        residual: isOilQuarantined ? `0.0 PSI (Shielded)` : `${residuals.oilPress >= 0 ? '+' : ''}${residuals.oilPress.toFixed(1)} PSI`,
        status: status.oilPress,
        isQuarantined: isOilQuarantined
      },
      {
        param: 'Oil Temperature',
        unit: '°C',
        expected: `${Math.round(exp.oilTemp)} °C`,
        actual: `${Math.round(actualOilTemp)} °C`,
        residual: `${residuals.oilTemp >= 0 ? '+' : ''}${residuals.oilTemp.toFixed(1)} °C`,
        status: status.oilTemp,
        isQuarantined: false
      },
      {
        param: 'Fuel Flow Rate',
        unit: 'L/hr',
        expected: `${exp.fuelFlow.toFixed(1)} L/hr`,
        actual: `${actualFuelFlow.toFixed(1)} L/hr`,
        residual: `${residuals.fuelFlow >= 0 ? '+' : ''}${residuals.fuelFlow.toFixed(1)} L/hr`,
        status: status.fuelFlow,
        isQuarantined: false
      },
      {
        param: 'Engine RPM',
        unit: 'RPM',
        expected: `${exp.rpm} RPM`,
        actual: `${actualRpm} RPM`,
        residual: `${residuals.rpm >= 0 ? '+' : ''}${residuals.rpm} RPM`,
        status: status.rpm,
        isQuarantined: false
      },
      {
        param: 'MAP (Boost Pressure)',
        unit: 'inHg',
        expected: `${exp.map.toFixed(1)} inHg`,
        actual: `${actualMap.toFixed(1)} inHg`,
        residual: `${residuals.map >= 0 ? '+' : ''}${residuals.map.toFixed(1)} inHg`,
        status: status.map,
        isQuarantined: false,
        envelope: envelope
      }
    ];

    return {
      residuals,
      normalizedResiduals: norm,
      status,
      tableRows,
      isShielded: isOilQuarantined,
      mapEnvelope: envelope
    };
  }

  _classifyStatus(val, cfg) {
    const absVal = Math.abs(val);
    if (absVal <= cfg.warn) return 'NORMAL';
    if (absVal <= cfg.crit) return val > 0 ? 'ELEVATED' : 'LOW';
    return 'CRITICAL';
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = AeroPhysicsModel;
}
if (typeof window !== 'undefined') {
  window.AeroPhysicsModel = AeroPhysicsModel;
}
