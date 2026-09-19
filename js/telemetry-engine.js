/* ==========================================================================
   AERO-TWIN: REAL-TIME TELEMETRY & MULTI-PHASE MISSION SIMULATOR
   SIH Problem Statement: SIH26054 (DRDO - Robotics & Drones - Software)
   
   Synthetic Engine Telemetry Engine with Directionally-Correct Thermodynamics:
   Load ↑ → Fuel Flow ↑ → EGT ↑ → CHT ↑ (with thermal lag)
   
   IMPORTANT: Clearly marked as SYNTHETIC SIMULATION DATA for decision-support prototype.
   ========================================================================== */

class TelemetryEngine {
  constructor() {
    // Environmental Baseline
    this.altitude = 18000;    // Feet MSL (MALE UAV typical cruise)
    this.ambientTemp = -21;   // Standard ISA temperature at 18k ft (°C)
    this.ambientPress = 14.9; // inHg (~50.5 kPa at 18k ft)
    this.throttle = 0.72;     // 72% nominal cruise throttle
    this.engineLoad = 72;     // % Engine Load

    // Active Mission Phase
    // Phases: 'idle' | 'takeoff' | 'climb' | 'cruise' | 'loiter' | 'return' | 'landing'
    this.missionPhase = 'cruise';
    this.missionTimeSeconds = 1420; // Simulated mission elapsed time (sec)

    // Active Fault Injection Configuration
    this.activeScenario = 'nominal'; // 'nominal' | 'sensor_freeze' | 'sensor_drift' | 'thermal_degradation' | 'lubrication_degradation' | 'rpm_instability'
    this.faultSeverity = 1.0; // 0.1 to 1.0 (scales fault deviation magnitude)
    this.envModifiers = {
      highAltitude: false,
      hotWeather: false,
      rapidThrottle: false
    };
    this.ambientTempMod = 0; // Environment temperature modifier (°C)
    this._transientTargetThrottle = null;
    this.physicsModel = (typeof AeroPhysicsModel !== 'undefined') ? new AeroPhysicsModel() : null;

    this.faults = {
      oilPressSensorFreeze: false,
      oilPressFrozenValue: 52.4,
      oilPressSensorDrop: false,
      thermalDegradation: false,
      thermalDegradationProgress: 0.0, // 0 to 1.0 (progressive heat accumulation)
      lubricationDegradation: false,
      rpmInstability: false,
      sensorDriftCht4: false,
      fuelWallCutoff: false
    };

    // Telemetry State Buffer
    this.state = {
      rpm: 4200,
      map: 33.2,                 // Manifold Absolute Pressure (inHg)
      cht: [166.5, 164.8, 169.2, 165.4], // Cylinder Head Temp (°C)
      egt: [780, 776, 792, 779],         // Exhaust Gas Temp (°C)
      oilPress: 52.4,            // Oil Pressure (PSI)
      oilTemp: 88.5,             // Oil Temperature (°C)
      fuelFlow: 24.2,            // Fuel Flow (L/hr)
      load: 72,                  // Engine Load (%)
      ambientTemp: -21,          // Ambient Temperature (°C)
      altitude: 18000,           // Feet
      throttle: 0.72,
      vibrationRms: 1.75,        // Vibration RMS (mm/s)
      fuelRemainingKg: 182.4,    // Fuel remaining (kg)
      enduranceHrs: 10.4,        // Endurance calculation
      missionPhase: 'cruise',
      missionTimeSec: 1420,
      scenario: 'nominal',
      faultSeverity: 1.0,
      envModifiers: { ...this.envModifiers },
      faults: { ...this.faults },
      isSimulation: true         // PROMINENT DISCLAIMER
    };

    // Physics Expected Baselines (for Sensor Trust comparison)
    this.expected = {
      rpm: 4200,
      map: 33.0,
      cht: [166, 165, 168, 165],
      egt: [780, 775, 790, 778],
      oilPress: 52.0,
      oilTemp: 88.0,
      fuelFlow: 24.0,
      load: 72
    };

    // Thermal inertia buffer for lagged CHT response (CHT lags EGT by ~4 seconds)
    this._chtThermalLag = [166.5, 164.8, 169.2, 165.4];

    // FFT Vibration Spectrum (for 3D visualizer animation)
    this.fftBins = new Float32Array(64);
    for (let i = 0; i < 64; i++) {
      this.fftBins[i] = 0.05 + Math.sin(i * 0.2) * 0.04;
    }

    // Callbacks & Update Listeners
    this.listeners = [];

    // Historical Mission Blackbox Replay System
    this.isReplaying = false;
    this.replaySpeed = 1.0;
    this.replayIndex = 0;
    this.replayLog = this.generateMissionReplayLog();
    this.replaySnapshots = [];
    this.buildImmutableReplaySnapshots();

    // Loop interval: 10 Hz (100ms)
    this.tickInterval = 100;
    this.timerId = null;
    this.startTick();
  }

  onUpdate(callback) {
    this.listeners.push(callback);
  }

  notifyListeners() {
    for (let i = 0; i < this.listeners.length; i++) {
      try {
        this.listeners[i](this.state, this.fftBins, this.expected);
      } catch (err) {
        console.error('[TelemetryEngine] Listener error:', err);
      }
    }
  }

  // Set predefined mission phase with directionally-correct physics baselines
  setMissionPhase(phase) {
    const p = (phase || 'cruise').toLowerCase();
    this.missionPhase = p;
    this.state.missionPhase = p;

    switch (p) {
      case 'idle':
        this.throttle = 0.25;
        this.setAltitude(1500);
        this.engineLoad = 25;
        this.state.load = 25;
        break;
      case 'takeoff':
        this.throttle = 1.0;
        this.setAltitude(2500);
        this.engineLoad = 100;
        this.state.load = 100;
        break;
      case 'climb':
        this.throttle = 0.85;
        this.setAltitude(12000);
        this.engineLoad = 85;
        this.state.load = 85;
        break;
      case 'cruise':
        this.throttle = 0.72;
        this.setAltitude(18000);
        this.engineLoad = 72;
        this.state.load = 72;
        break;
      case 'loiter':
        this.throttle = 0.60;
        this.setAltitude(20000);
        this.engineLoad = 60;
        this.state.load = 60;
        break;
      case 'return':
        this.throttle = 0.70;
        this.setAltitude(16000);
        this.engineLoad = 70;
        this.state.load = 70;
        break;
      case 'landing':
        this.throttle = 0.35;
        this.setAltitude(3000);
        this.engineLoad = 35;
        this.state.load = 35;
        break;
    }
  }

  setThrottle(val) {
    this.throttle = Math.max(0.15, Math.min(1.0, val));
  }

  setFaultSeverity(pct) {
    this.faultSeverity = Math.max(0.1, Math.min(1.0, (typeof pct === 'number' ? pct : 100) / 100));
    this.state.faultSeverity = this.faultSeverity;
    console.log(`[TelemetryEngine] Fault severity set to: ${(this.faultSeverity * 100).toFixed(0)}%`);
  }

  toggleEnvironmentModifier(key) {
    if (key === 'highAltitude') {
      this.envModifiers.highAltitude = !this.envModifiers.highAltitude;
      this.setAltitude(this.envModifiers.highAltitude ? 25000 : 18000);
    } else if (key === 'hotWeather') {
      this.envModifiers.hotWeather = !this.envModifiers.hotWeather;
      this.ambientTempMod = this.envModifiers.hotWeather ? 38 : 0;
      this.state.ambientTemp = this.ambientTemp + this.ambientTempMod;
    } else if (key === 'rapidThrottle') {
      this.envModifiers.rapidThrottle = true;
      this.throttle = 0.40;
      this._transientTargetThrottle = 0.88;
      setTimeout(() => {
        this.envModifiers.rapidThrottle = false;
        this._transientTargetThrottle = null;
      }, 4000);
    }
    this.state.envModifiers = { ...this.envModifiers };
    return { ...this.envModifiers };
  }

  setAltitude(altFt) {
    this.altitude = Math.max(0, Math.min(30000, altFt));
    this.ambientPress = Number((29.92 * Math.pow(1 - 6.875e-6 * this.altitude, 5.256)).toFixed(1));
    this.ambientTemp = Math.round(15 - (this.altitude * 0.00198));
    this.state.altitude = this.altitude;
    this.state.ambientTemp = this.ambientTemp + this.ambientTempMod;
  }

  /**
   * Deterministic Scenario Selector for Judge Demos
   */
  setScenario(scenarioKey) {
    this.activeScenario = scenarioKey;
    this.state.scenario = scenarioKey;
    this.resetFaults();

    switch (scenarioKey) {
      case 'nominal':
        // Clean healthy cruise
        this.setMissionPhase('cruise');
        this.throttle = 0.72;
        this.engineLoad = 72;
        this.state.load = 72;
        this.state.rpm = 4200;
        this.state.map = 33.2;
        this.state.oilPress = 52.4;
        this.state.oilTemp = 88.5;
        this.state.fuelFlow = 24.2;
        this._chtThermalLag = [166.5, 164.8, 169.2, 165.4];
        this.state.cht = [166.5, 164.8, 169.2, 165.4];
        this.state.egt = [780, 776, 792, 779];
        break;

      case 'sensor_freeze':
        // SCENARIO B: SENSOR FAILURE
        // Oil Pressure frozen at fixed value without natural micro-noise,
        // while throttle and RPM vary normally!
        this.faults.oilPressSensorFreeze = true;
        this.faults.oilPressFrozenValue = 52.4;
        this.state.oilPress = 52.4;
        break;

      case 'sensor_drift':
        // SCENARIO B2: Sensor Drift on Cylinder 4 CHT thermistor
        this.faults.sensorDriftCht4 = true;
        break;

      case 'sensor_drop':
        // Electrical wire open-circuit: Oil pressure drops to 0 PSI
        // while oil temp & vibration remain completely healthy
        this.faults.oilPressSensorDrop = true;
        this.state.oilPress = 0.0;
        break;

      case 'thermal_degradation':
        // SCENARIO C: REAL ENGINE THERMAL DEGRADATION
        // High load sustained, EGT rises by +8.4%, CHT follows with lag (+6.1%)
        // Sensors are trusted, indicating genuine mechanical distress!
        this.throttle = 0.89;
        this.engineLoad = 89;
        this.state.load = 89;
        this.state.rpm = 4380;
        this.state.map = 37.8;
        this.state.oilPress = 38.5;
        this.state.oilTemp = 108.5;
        this.state.fuelFlow = 31.4;
        this.faults.thermalDegradation = true;
        this.faults.thermalDegradationProgress = 1.0;
        const egtDelta = 92 * this.faultSeverity;
        const chtDelta = 19.5 * this.faultSeverity;
        this._chtThermalLag = [166.5 + chtDelta, 164.8 + chtDelta, 169.2 + chtDelta, 165.4 + chtDelta];
        this.state.cht = [166.5 + chtDelta, 164.8 + chtDelta, 169.2 + chtDelta, 165.4 + chtDelta];
        this.state.egt = [780 + egtDelta, 776 + egtDelta, 792 + egtDelta, 779 + egtDelta];
        break;

      case 'lubrication_degradation':
        // Genuine oil pump cavitation: pressure drops + oil temp rises + vibration rises
        this.faults.lubricationDegradation = true;
        break;

      case 'rpm_instability':
        // Ignition timing surge / governor flutter
        this.faults.rpmInstability = true;
        break;
    }
  }

  resetFaults() {
    this.faults = {
      oilPressSensorFreeze: false,
      oilPressFrozenValue: 52.4,
      oilPressSensorDrop: false,
      thermalDegradation: false,
      thermalDegradationProgress: 0.0,
      lubricationDegradation: false,
      rpmInstability: false,
      sensorDriftCht4: false,
      fuelWallCutoff: false
    };
  }

  startTick() {
    if (this.timerId) clearInterval(this.timerId);
    this.timerId = setInterval(() => {
      if (this.isReplaying) {
        // Scrubbed historical frame holds static until user moves slider or returns to live
        return;
      }
      this.computePhysicsStep();
      this.updateFftVibration();
      this.notifyListeners();
    }, this.tickInterval);
  }

  /**
   * Physics computation loop:
   * Enforces directionally-correct relationships:
   * Load ↑ → Fuel Flow ↑ → EGT ↑ → CHT ↑ (with lag)
   */
  computePhysicsStep() {
    this.missionTimeSeconds += 0.1;
    this.state.missionTimeSec = Math.round(this.missionTimeSeconds);

    // Natural micro-noise (0.3% Gaussian jitter)
    const jitter = () => (Math.random() - 0.5) * 2;

    // 1. Engine Load (%)
    let targetLoad = Math.round(this.throttle * 100);
    this.engineLoad += (targetLoad - this.engineLoad) * 0.15;
    this.state.load = Math.round(this.engineLoad);
    this.state.throttle = Number(this.throttle.toFixed(2));

    // 2. Engine RPM
    // Nominal curve: 1800 (idle) to 5400 (WOT)
    let targetRpm = 1800 + (this.throttle * 3600);
    if (this.faults.rpmInstability) {
      targetRpm += Math.sin(this.missionTimeSeconds * 4) * 260 + jitter() * 45;
    } else {
      targetRpm += jitter() * 12;
    }
    this.state.rpm += (targetRpm - this.state.rpm) * 0.18;
    this.state.rpm = Math.max(1400, Math.min(5800, this.state.rpm));

    // 3. Manifold Absolute Pressure (MAP, inHg)
    // Boost depends on throttle and ambient pressure
    const baseBoost = 19.0 * this.throttle;
    const targetMap = this.ambientPress + baseBoost;
    this.state.map += (targetMap - this.state.map) * 0.2 + jitter() * 0.1;

    // 4. Fuel Flow (L/hr)
    // Directly proportional to Load * RPM
    const normLoad = this.engineLoad / 100;
    const normRpm = this.state.rpm / 5000;
    const targetFuel = (34.0 * normLoad * normRpm) + jitter() * 0.15;
    this.state.fuelFlow += (targetFuel - this.state.fuelFlow) * 0.2;
    this.state.fuelFlow = Math.max(5.0, this.state.fuelFlow);

    // Continuous Fuel Burn
    this.state.fuelRemainingKg = Math.max(0, this.state.fuelRemainingKg - ((this.state.fuelFlow * 0.72) / 3600) * 0.1);
    this.state.enduranceHrs = Number(((this.state.fuelRemainingKg / 0.72) / Math.max(1, this.state.fuelFlow)).toFixed(1));

    // Handle rapid throttle transition transient
    if (this._transientTargetThrottle !== null) {
      this.throttle += (this._transientTargetThrottle - this.throttle) * 0.12;
    }

    // 5. Exhaust Gas Temperature (EGT 1-4, °C)
    // Fast thermal response to Fuel Flow and Load
    const baseEgt = 720 + (normLoad * 85) + (this.ambientTempMod * 0.35);
    for (let i = 0; i < 4; i++) {
      let cylTargetEgt = baseEgt + (i % 2 === 0 ? 5 : -4);
      // Thermal degradation scenario: EGT increases scaled by faultSeverity
      if (this.faults.thermalDegradation) {
        if (this.faults.thermalDegradationProgress < 1.0) {
          this.faults.thermalDegradationProgress += 0.02;
        }
        cylTargetEgt += (this.faults.thermalDegradationProgress * 72 * this.faultSeverity);
      }
      cylTargetEgt += jitter() * 2.0;
      this.state.egt[i] += (cylTargetEgt - this.state.egt[i]) * 0.18;
    }

    // 6. Cylinder Head Temperature (CHT 1-4, °C)
    // Thermal lag behind EGT: CHT warms up gradually as engine block soaks heat
    const baseCht = 145 + (normLoad * 28) + (this.ambientTempMod * 0.45);
    for (let i = 0; i < 4; i++) {
      let cylTargetCht = baseCht + (i === 2 ? 4 : 0); // Cyl 3 naturally runs slightly warmer
      if (this.faults.thermalDegradation) {
        cylTargetCht += (this.faults.thermalDegradationProgress * 15.5 * this.faultSeverity);
      }
      if (this.faults.sensorDriftCht4 && i === 3) {
        cylTargetCht += (55 * this.faultSeverity); // Uncorrelated thermistor drift
      }
      // Exponential thermal lag filter (smooth response)
      this._chtThermalLag[i] += (cylTargetCht - this._chtThermalLag[i]) * 0.12;
      this.state.cht[i] = this._chtThermalLag[i] + jitter() * 0.35;
    }

    // 7. Oil Temperature (°C)
    // High thermal mass: slowly tracks load
    let targetOilTemp = 82 + (normLoad * 12) + (this.ambientTempMod * 0.25);
    if (this.faults.lubricationDegradation) {
      targetOilTemp += (28 * this.faultSeverity); // Spikes up
    }
    this.state.oilTemp += (targetOilTemp - this.state.oilTemp) * 0.03 + jitter() * 0.1;

    // 8. Oil Pressure (PSI)
    // Follows RPM with slight negative thermal coefficient
    const rpmOilContrib = (this.state.rpm / 5000) * 18;
    const tempOilDrop = Math.max(0, (this.state.oilTemp - 85) * 0.12);
    let expectedOilPress = 38 + rpmOilContrib - tempOilDrop;

    // Compute operating-condition-aware expected state via AeroPhysicsModel
    if (this.physicsModel) {
      const computed = this.physicsModel.computeExpectedState({
        altitude: this.altitude,
        ambientTempMod: this.ambientTempMod,
        throttle: this.throttle,
        missionPhase: this.missionPhase
      });
      this.expected = computed.expected;
      this.operatingConditions = computed.operatingConditions;
    } else {
      this.expected = {
        rpm: Math.round(targetRpm),
        map: Number(targetMap.toFixed(1)),
        cht: [baseCht, baseCht, baseCht + 4, baseCht].map(v => Math.round(v)),
        egt: [baseEgt, baseEgt, baseEgt, baseEgt].map(v => Math.round(v)),
        oilPress: Number(expectedOilPress.toFixed(1)),
        oilTemp: Math.round(targetOilTemp),
        fuelFlow: Number(targetFuel.toFixed(1)),
        load: targetLoad
      };
    }

    // Apply active fault injection to Oil Pressure Sensor:
    if (this.faults.oilPressSensorFreeze) {
      // SCENARIO B: Sensor Frozen! Value remains exactly flat, ZERO variance!
      this.state.oilPress = this.faults.oilPressFrozenValue;
    } else if (this.faults.oilPressSensorDrop) {
      // Electrical drop / disconnect
      this.state.oilPress = 2.0 + jitter() * 0.4;
    } else if (this.faults.lubricationDegradation) {
      // Genuine mechanical pump cavitation / bearing wear (scales by severity)
      const targetCavPress = 52.0 - (30.0 * this.faultSeverity);
      this.state.oilPress += (targetCavPress - this.state.oilPress) * 0.1 + jitter() * 0.3;
    } else {
      // Normal healthy oil pressure with natural micro-noise
      this.state.oilPress += (expectedOilPress - this.state.oilPress) * 0.15 + jitter() * 0.25;
    }

    // 9. Vibration RMS (mm/s)
    let targetVibe = 1.65 + (normLoad * 0.4);
    if (this.faults.lubricationDegradation) targetVibe += (2.4 * this.faultSeverity);
    if (this.faults.rpmInstability) targetVibe += (1.6 * this.faultSeverity);
    this.state.vibrationRms += (targetVibe - this.state.vibrationRms) * 0.1 + jitter() * 0.05;
    this.state.vibrationRms = Math.max(0.5, this.state.vibrationRms);
    this.state.vibrationRms += (targetVibe - this.state.vibrationRms) * 0.1 + jitter() * 0.05;
    this.state.vibrationRms = Math.max(0.5, this.state.vibrationRms);
  }

  updateFftVibration() {
    const rpmFund = (this.state.rpm / 60); // Fundamental Hz (~70 Hz)
    const fundBin = Math.min(63, Math.max(1, Math.round((rpmFund / 1000) * 64)));

    for (let i = 0; i < 64; i++) {
      let energy = 0.05 + Math.random() * 0.03;
      if (Math.abs(i - fundBin) <= 1) {
        energy += 0.65 * (this.state.vibrationRms / 2.0);
      }
      if (Math.abs(i - (fundBin * 2)) <= 1 && (fundBin * 2) < 64) {
        energy += 0.35 * (this.state.vibrationRms / 2.0);
      }
      this.fftBins[i] += (energy - this.fftBins[i]) * 0.3;
    }
  }

  // =========================================================================
  // MISSION BLACKBOX SIMULATION & IMMUTABLE REPLAY ENGINE
  // =========================================================================

  static deepFreeze(obj) {
    if (!obj || typeof obj !== 'object' || Object.isFrozen(obj)) return obj;
    Object.freeze(obj);
    Object.getOwnPropertyNames(obj).forEach(prop => {
      const val = obj[prop];
      if (val !== null && (typeof val === 'object' || typeof val === 'function')) {
        TelemetryEngine.deepFreeze(val);
      }
    });
    return obj;
  }

  // Continuous Phase Derivation from Mission Timestamp (0s to 100s)
  // Complete 7-Phase MALE UAV Simulated Flight Profile:
  // 1. IDLE:    0s - 18s (Jump: 0s  | e.g. T+10s -> IDLE)
  // 2. TAKEOFF: 19s - 32s (Jump: 19s | e.g. T+25s -> TAKEOFF)
  // 3. CLIMB:   33s - 48s (Jump: 33s | e.g. T+40s -> CLIMB)
  // 4. CRUISE:  49s - 69s (Jump: 49s | e.g. T+60s -> CRUISE, T+64s -> SENSOR_FREEZE)
  // 5. LOITER:  70s - 75s (Jump: 70s | e.g. T+70s -> LOITER, T+71s -> SENSOR_QUARANTINED)
  // 6. RETURN:  76s - 88s (Jump: 76s | e.g. T+80s -> THERMAL_DISTRESS, T+82s -> THERMAL_RUNAWAY)
  // 7. LANDING: 89s - 100s (Jump: 89s | e.g. T+89s -> APPROACH, T+95s -> ROLLOUT, T+100s -> TOUCHDOWN)
  static deriveMissionPhase(sec) {
    const s = Math.max(0, Math.min(100, Math.floor(sec)));
    if (s <= 18) return 'idle';       // 0s-18s: IDLE (jump: 0)
    if (s <= 32) return 'takeoff';    // 19s-32s: TAKEOFF (jump: 19)
    if (s <= 48) return 'climb';      // 33s-48s: CLIMB (jump: 33)
    if (s <= 69) return 'cruise';     // 49s-69s: CRUISE (jump: 49)
    if (s <= 75) return 'loiter';     // 70s-75s: LOITER (jump: 70)
    if (s <= 88) return 'return';     // 76s-88s: RETURN (jump: 76)
    return 'landing';                 // 89s-100s: LANDING (jump: 89)
  }

  generateMissionReplayLog() {
    const log = [];
    for (let sec = 0; sec <= 100; sec++) {
      const phase = TelemetryEngine.deriveMissionPhase(sec);
      let rpm, map, fuelFlow, cht, egt, oilPress, oilTemp, load, vibrationRms, altitude, ambientTemp, throttle, eventMarker = null;

      if (phase === 'idle') {
        // T=0..18 (e.g. T=10s)
        load = 25;
        throttle = 0.25;
        rpm = 1600;
        map = 14.5;
        fuelFlow = 8.2;
        cht = [135.0, 134.2, 136.1, 135.5];
        egt = [620, 615, 628, 618];
        oilPress = 45.0;
        oilTemp = 72.0;
        vibrationRms = 0.85;
        ambientTemp = 15;
        altitude = 2500;
      } else if (phase === 'takeoff') {
        // T=19..32 (e.g. T=25s)
        load = 100;
        throttle = 1.0;
        rpm = 4380;
        map = 39.2;
        fuelFlow = 32.5;
        cht = [172.0, 170.5, 174.2, 171.0];
        egt = [810, 805, 822, 808];
        oilPress = 58.5;
        oilTemp = 85.0;
        vibrationRms = 2.10;
        ambientTemp = 14;
        altitude = Math.round(2500 + (sec - 19) * 60);
      } else if (phase === 'climb') {
        // T=33..48 (e.g. T=40s)
        load = 85;
        throttle = 0.85;
        rpm = 4250;
        map = 35.0;
        fuelFlow = 28.0;
        cht = [168.0, 166.2, 170.1, 167.5];
        egt = [795, 790, 806, 792];
        oilPress = 54.0;
        oilTemp = 87.0;
        vibrationRms = 1.80;
        ambientTemp = Math.round(14 - (sec - 33) * 2.3);
        altitude = Math.round(3300 + (sec - 33) * 980);
      } else if (phase === 'cruise') {
        // T=49..69 (e.g. T=60s)
        load = 72;
        throttle = 0.72;
        rpm = 4200;
        map = 31.5;
        fuelFlow = 23.5;
        cht = [165.0, 163.5, 167.0, 164.2];
        egt = [780, 775, 790, 778];
        oilPress = (sec >= 63 && sec <= 69) ? 52.4 : 52.0;
        oilTemp = 88.5;
        vibrationRms = 1.65;
        ambientTemp = -21;
        altitude = 18000;

        if (sec >= 63 && sec <= 69) {
          eventMarker = 'SENSOR_FREEZE';
        } else if (sec >= 50 && sec <= 62) {
          eventMarker = 'BASELINE_CRUISE';
        }
      } else if (phase === 'loiter') {
        // T=70..75 (e.g. T=70s) - On-station surveillance & loiter
        load = 60;
        throttle = 0.60;
        rpm = 3950;
        map = 26.5;
        fuelFlow = 19.5;
        cht = [158.0, 156.5, 160.0, 157.2];
        egt = [740, 735, 748, 738];
        oilPress = (sec >= 70 && sec <= 75) ? 52.4 : 50.0;
        oilTemp = 86.0;
        vibrationRms = 1.45;
        ambientTemp = -22;
        altitude = 20000;

        if (sec >= 70 && sec <= 75) {
          eventMarker = 'SENSOR_QUARANTINED';
        } else {
          eventMarker = 'LOITER_STATION';
        }
      } else if (phase === 'return') {
        // T=76..88 (includes thermal runaway at T=80..85)
        if (sec >= 80 && sec <= 85) {
          load = 88;
          throttle = 0.88;
          rpm = 4380;
          map = 37.8;
          fuelFlow = 31.4;
          cht = [172.5, 170.8, 175.2, 171.4];
          egt = [810, 806, 822, 809]; // Cyl 3 hot
          oilPress = 39.5;
          oilTemp = 108.5;
          vibrationRms = 2.45;
          ambientTemp = -15;
          altitude = 14500;
          eventMarker = sec >= 82 ? 'THERMAL_RUNAWAY' : 'THERMAL_DISTRESS';
        } else {
          load = 70;
          throttle = 0.70;
          rpm = 4100;
          map = 30.5;
          fuelFlow = 22.0;
          cht = [162.0, 160.5, 164.0, 161.2];
          egt = [760, 755, 768, 758];
          oilPress = 51.0;
          oilTemp = 90.0;
          vibrationRms = 1.60;
          ambientTemp = -12;
          altitude = Math.round(18000 - (sec - 76) * 800);
        }
      } else {
        // landing: T=89..100
        const progress = (sec - 89) / 11;
        load = Math.round(35 - progress * 10);
        throttle = Number((0.35 - progress * 0.10).toFixed(2));
        rpm = Math.round(2200 - progress * 600);
        map = Number((20.0 - progress * 5.5).toFixed(1));
        fuelFlow = Number((12.0 - progress * 3.8).toFixed(1));
        cht = [145.0, 143.5, 146.0, 144.2];
        egt = [660, 652, 670, 658];
        oilPress = 48.0;
        oilTemp = 80.0;
        vibrationRms = 0.95;
        altitude = Math.round(5000 - progress * 2500);
        ambientTemp = 15;
        eventMarker = 'LANDING';
      }

      log.push({
        second: sec,
        timeStr: `00:${String(sec).padStart(2, '0')}`,
        simTime: `14:${String(sec).padStart(2, '0')}`,
        phase,
        rpm,
        map,
        fuelFlow,
        cht,
        egt,
        oilPress,
        oilTemp,
        load,
        throttle,
        vibrationRms,
        ambientTemp,
        altitude,
        eventMarker
      });
    }
    return log;
  }

  buildImmutableReplaySnapshots() {
    this.replaySnapshots = [];

    for (let sec = 0; sec <= 100; sec++) {
      const frame = this.replayLog[sec];
      const phaseUpper = frame.phase.toUpperCase();
      const isSensorFault = (sec >= 63 && sec <= 75);
      const isThermal = (sec >= 80 && sec <= 85);
      const scenario = isSensorFault ? 'sensor_fault' : (isThermal ? 'thermal_degradation' : 'normal');

      // 1. Raw Telemetry
      const rawTelemetry = {
        rpm: frame.rpm,
        map: frame.map,
        cht: [...frame.cht],
        egt: [...frame.egt],
        oilPress: frame.oilPress,
        oilTemp: frame.oilTemp,
        fuelFlow: frame.fuelFlow,
        load: frame.load,
        throttle: frame.throttle,
        vibrationRms: frame.vibrationRms,
        ambientTemp: frame.ambientTemp,
        altitude: frame.altitude,
        missionPhase: frame.phase,
        missionTimeSec: frame.second,
        eventMarker: frame.eventMarker,
        isSimulation: true
      };

      // 2. Expected Physics
      const expectedPhysics = {
        rpm: frame.rpm,
        map: frame.map,
        manifoldPressure: frame.map,
        fuelFlow: frame.fuelFlow,
        cht: [...frame.cht],
        egt: [...frame.egt],
        oilPress: isSensorFault ? 52.0 : (isThermal ? 52.0 : frame.oilPress),
        oilPressure: isSensorFault ? 52.0 : (isThermal ? 52.0 : frame.oilPress),
        oilTemp: isThermal ? 88.5 : frame.oilTemp,
        load: frame.load
      };

      // 3. Sensor Trust
      let trustResult;
      if (isSensorFault) {
        trustResult = {
          overallTrust: 0.89,
          quarantined: ['oilPress'],
          scores: { rpm: 1.0, map: 1.0, fuelFlow: 1.0, oilPress: 0.12, oilTemp: 1.0, cht: [1.0, 1.0, 1.0, 1.0], egt: [1.0, 1.0, 1.0, 1.0] },
          sensorDetails: {
            oilPress: { score: 0.12, status: 'QUARANTINED', reason: 'Zero variance / Transducer freeze' }
          }
        };
      } else {
        trustResult = {
          overallTrust: 1.00,
          quarantined: [],
          scores: { rpm: 1.0, map: 1.0, fuelFlow: 1.0, oilPress: 1.0, oilTemp: 1.0, cht: [1.0, 1.0, 1.0, 1.0], egt: [1.0, 1.0, 1.0, 1.0] },
          sensorDetails: {}
        };
      }

      // 4. Diagnostic Result & Health
      let diagnosticResult;
      if (isSensorFault) {
        diagnosticResult = {
          status: 'SENSOR_FAULT',
          faultClass: 'SENSOR_FAULT',
          anomalyScore: 0.58,
          confidence: 89,
          healthIndex: 96,
          ehiStatus: 'NOMINAL',
          ehiBreakdown: {
            baseline: 100,
            thermalContribution: 0,
            lubricationContribution: 0,
            vibrationContribution: 0,
            sensorShieldContribution: 0,
            finalEhi: 96,
            status: 'NOMINAL'
          },
          rulHours: 115,
          rulRangeStr: '100–130 h',
          rulConfidencePct: 92,
          degradationPct: 4,
          degradationTrend: 'STABLE',
          missionReliability: {
            score: 92,
            status: 'CAUTION',
            reasons: ['Oil Pressure sensor quarantined; digital twin virtual sensor online'],
            currentPhase: phaseUpper,
            remainingMissionDuration: '01h 55m'
          },
          maintenanceAdvisory: {
            subsystem: 'Sensor Instrumentation',
            priority: 'MEDIUM',
            action: 'Inspect and recalibrate oil pressure transducer upon landing.',
            code: 'MAINT-204-SNS',
            urgency: 'Next Turnaround'
          },
          explainability: {
            title: 'Oil Pressure Sensor Inconsistency Detected',
            bullets: [
              'Transducer variance collapsed to zero (52.4 PSI locked) during engine modulation',
              'Secondary sensors (oil temperature, bearing vibration) confirm physical lubrication is nominal',
              'Analytical redundancy algorithm shielded the health index from false alarm'
            ],
            conclusion: 'Sensor quarantined; digital twin synthesis active.'
          },
          evidence: [
            'Zero variance detected on oil pressure signal',
            'MAP/RPM cross-correlation confirms engine running nominally'
          ]
        };
      } else if (isThermal) {
        diagnosticResult = {
          status: 'CRITICAL',
          faultClass: 'THERMAL_DEGRADATION',
          anomalyScore: 0.95,
          confidence: 94,
          healthIndex: 64,
          ehiStatus: 'CRITICAL',
          ehiBreakdown: {
            baseline: 100,
            thermalContribution: -28,
            lubricationContribution: -8,
            vibrationContribution: 0,
            sensorShieldContribution: 0,
            finalEhi: 64,
            status: 'CRITICAL'
          },
          rulHours: 48,
          rulRangeStr: '35–61 h',
          rulConfidencePct: 88,
          degradationPct: 36,
          degradationTrend: 'ACCELERATING',
          missionReliability: {
            score: 48,
            status: 'ABORT',
            reasons: ['Thermal runaway on Cylinder #3; high EGT excursion (+30.5°C)'],
            currentPhase: phaseUpper,
            remainingMissionDuration: '00h 25m'
          },
          maintenanceAdvisory: {
            subsystem: 'Combustion Chamber / Cooling Jacket',
            priority: 'CRITICAL',
            action: 'Immediate borescope inspection of Cylinder #3 and oil cooler flush.',
            code: 'MAINT-911-THM',
            urgency: 'Immediate (AOG)'
          },
          explainability: {
            title: 'Cylinder #3 Thermal Runaway',
            bullets: [
              'EGT residual exceeded +30.5°C above expected physics baseline',
              'CHT residual elevated +6.0°C under cruise power',
              'Oil temperature elevated to 108.5°C with concomitant viscosity thinning'
            ],
            conclusion: 'Immediate power reduction and thermal mitigation required.'
          },
          evidence: [
            'EGT #3 residual +30.5°C',
            'CHT #3 residual +6.0°C',
            'High oil temperature 108.5°C'
          ]
        };
      } else {
        // Nominal across all phases
        const ehiVal = (frame.phase === 'idle') ? 98 : (frame.phase === 'takeoff') ? 97 : 96;
        const degVal = (frame.phase === 'idle') ? 2 : (frame.phase === 'takeoff') ? 3 : 4;
        const rulVal = (frame.phase === 'idle') ? 120 : (frame.phase === 'takeoff') ? 118 : 115;
        const relVal = (frame.phase === 'idle') ? 99 : (frame.phase === 'takeoff') ? 98 : 96;

        let whyTitle, whyBullets, whyConclusion;
        if (frame.phase === 'idle') {
          whyTitle = 'Nominal Ground Idle State';
          whyBullets = [
            'Engine operating at stabilized idle RPM (1600 RPM)',
            'Cylinder head and exhaust gas temperatures within pre-flight warm envelope',
            'Oil pressure nominal at 45.0 PSI'
          ];
          whyConclusion = 'Engine ready for takeoff sequence.';
        } else if (frame.phase === 'takeoff') {
          whyTitle = 'Full Power Takeoff Sequence';
          whyBullets = [
            'Takeoff thrust output nominal (4380 RPM @ 100% Load)',
            'Dynamic manifold pressure 39.2 inHg within boost limits',
            'All four cylinder thermal gradients matched'
          ];
          whyConclusion = 'Nominal aircraft rotation and initial climbout.';
        } else if (frame.phase === 'climb') {
          whyTitle = 'Steady Climb Envelope';
          whyBullets = [
            'Continuous climb power 85% with 4250 RPM',
            'Cylinder head temperatures stabilized under active airspeed cooling',
            'Pressure ratio consistent with barometric ascent'
          ];
          whyConclusion = 'Ascending to designated cruising flight level.';
        } else if (frame.phase === 'cruise') {
          whyTitle = 'Steady-State Cruise Baseline';
          whyBullets = [
            'BSFC fuel consumption optimized at 23.5 L/hr',
            'Manifold pressure 31.5 inHg steady at FL180',
            'Oil pressure steady at 52.0 PSI across crank bearings'
          ];
          whyConclusion = 'Cruise envelope within certified long-endurance parameters.';
        } else if (frame.phase === 'loiter') {
          whyTitle = 'On-Station Loiter Surveillance Orbit';
          whyBullets = [
            'Propulsion optimized for maximum endurance at 60% load (3950 RPM)',
            'Stabilized at FL200 surveillance ceiling',
            'All cylinder head and oil temperatures steady in loiter pattern'
          ];
          whyConclusion = 'Extended surveillance station-keeping nominal.';
        } else if (frame.phase === 'return') {
          whyTitle = 'Nominal Ingress / Return to Base';
          whyBullets = [
            'Transit power set to 70% load for efficient return',
            'Descent rate and barometric manifold pressure matched',
            'All primary engine telemetry channels nominal'
          ];
          whyConclusion = 'Transit to recovery waypoint nominal.';
        } else {
          whyTitle = 'Final Approach & Landing Sequence';
          whyBullets = [
            'Power reduced to approach idle (35% load, 2200 to 1600 RPM)',
            'Cylinder head temperatures cooling within thermal gradient limits',
            'Touchdown and runway rollout complete'
          ];
          whyConclusion = 'Successful mission recovery complete.';
        }

        diagnosticResult = {
          status: 'HEALTHY',
          faultClass: 'NORMAL',
          anomalyScore: (frame.phase === 'takeoff') ? 0.04 : 0.02,
          confidence: 96,
          healthIndex: ehiVal,
          ehiStatus: 'NOMINAL',
          ehiBreakdown: {
            baseline: 100,
            thermalContribution: 0,
            lubricationContribution: 0,
            vibrationContribution: 0,
            sensorShieldContribution: 0,
            finalEhi: ehiVal,
            status: 'NOMINAL'
          },
          rulHours: rulVal,
          rulRangeStr: `${rulVal - 15}–${rulVal + 15} h`,
          rulConfidencePct: 95,
          degradationPct: degVal,
          degradationTrend: 'STABLE',
          missionReliability: {
            score: relVal,
            status: 'GO',
            reasons: [`All propulsion parameters nominal for ${phaseUpper}`],
            currentPhase: phaseUpper,
            remainingMissionDuration: (frame.phase === 'idle') ? '02h 30m' : (frame.phase === 'takeoff') ? '02h 25m' : (frame.phase === 'climb') ? '02h 20m' : (frame.phase === 'cruise') ? '02h 10m' : (frame.phase === 'loiter') ? '01h 45m' : (frame.phase === 'return') ? '00h 40m' : '00h 00m'
          },
          maintenanceAdvisory: {
            subsystem: 'All Systems Nominal',
            priority: 'ROUTINE',
            action: 'Standard pre-flight / turnaround checklist complete.',
            code: 'MAINT-001-NOM',
            urgency: '50h Inspection'
          },
          explainability: {
            title: whyTitle,
            bullets: whyBullets,
            conclusion: whyConclusion
          },
          evidence: []
        };
      }

        const residualsMap = {
          cht: isThermal ? 6.0 : 0.0,
          egt: isThermal ? 30.5 : 0.0,
          oilPress: isSensorFault ? 0.4 : (isThermal ? -12.5 : 0.0),
          oilTemp: isThermal ? 20.0 : 0.0,
          rpm: 0.0,
          map: 0.0,
          fuelFlow: 0.0
        };

        const snapshot = {
        scenario,
        missionPhase: phaseUpper,
        simTime: frame.simTime,
        timeStr: frame.timeStr,
        rawTelemetry,
        expectedPhysics,
        trustResult,
        sensorTrust: {
          overall: trustResult.overallTrust,
          trustedCount: isSensorFault ? 8 : 9,
          totalSensors: 9,
          scores: trustResult.scores || {},
          perSensor: trustResult.sensorDetails || {},
          quarantined: trustResult.quarantined || []
        },
        quarantinedSensors: trustResult.quarantined || [],
        diagnosticResult,
        physics: {
          expected: expectedPhysics,
          residuals: residualsMap,
          normalizedResiduals: residualsMap,
          status: isThermal ? 'ANOMALOUS' : 'NORMAL',
          tableRows: [],
          isShielded: isSensorFault,
          operatingConditions: {
            altitude: frame.altitude,
            throttle: frame.throttle,
            ambientTemp: frame.ambientTemp
          }
        },
        physicsResiduals: residualsMap,
        ehi: diagnosticResult.healthIndex,
        ehiStatus: diagnosticResult.ehiStatus,
        ehiBreakdown: diagnosticResult.ehiBreakdown,
        aiDiagnosis: isSensorFault ? 'SENSOR FAULT' : (isThermal ? 'THERMAL DEGRADATION' : 'HEALTHY'),
        aiDiagStatus: isSensorFault ? 'WARNING' : (isThermal ? 'CRITICAL' : 'NOMINAL'),
        anomalyScore: diagnosticResult.anomalyScore,
        overallTrust: trustResult.overallTrust,
        trustedCount: isSensorFault ? 8 : 9,
        totalSensors: 9,
        rul: {
          estimate: diagnosticResult.rulHours,
          range: diagnosticResult.rulRangeStr,
          confidence: diagnosticResult.rulConfidencePct,
          trend: diagnosticResult.degradationTrend
        },
        rulHours: diagnosticResult.rulHours,
        rulLabel: `${diagnosticResult.rulHours}h`,
        degradationPct: diagnosticResult.degradationPct,
        degradationTrend: diagnosticResult.degradationTrend,
        missionReliability: diagnosticResult.missionReliability,
        why: diagnosticResult.explainability,
        maintenance: diagnosticResult.maintenanceAdvisory,
        environment: {
          altitude: frame.altitude,
          ambientTemperature: frame.ambientTemp,
          throttleTransition: false
        },
        isReplaying: true,
        replayIndex: sec
      };

      // CRITICAL: Deep freeze snapshot to guarantee immutability
      TelemetryEngine.deepFreeze(snapshot);
      this.replaySnapshots.push(snapshot);
    }
  }

  getReplaySnapshot(sec) {
    const s = Math.max(0, Math.min(100, Math.floor(sec)));
    const snap = this.replaySnapshots[s];
    if (!snap) return null;
    // Return an isolated deep copy so the original frozen record can never be modified
    return JSON.parse(JSON.stringify(snap));
  }

  startReplay() {
    this.isReplaying = true;
  }

  pauseReplay() {
    this.isReplaying = false;
  }

  toggleReplay() {
    this.isReplaying = !this.isReplaying;
    return this.isReplaying;
  }

  seekReplay(sec) {
    this.replayIndex = Math.max(0, Math.min(100, Math.floor(sec)));
    const snap = this.getReplaySnapshot(this.replayIndex);
    if (snap && snap.rawTelemetry) {
      this.applyReplayFrame(snap.rawTelemetry);
    }
  }

  setReplaySpeed(spd) {
    this.replaySpeed = Number(spd) || 1.0;
  }

  stepReplay() {
    if (!this.replayLog || this.replayLog.length === 0) return;
    this.replayIndex += (this.tickInterval / 1000) * this.replaySpeed;
    if (this.replayIndex > 100) {
      this.replayIndex = 0; // Loop replay
    }
    const idx = Math.floor(this.replayIndex);
    const snap = this.getReplaySnapshot(idx);
    if (snap && snap.rawTelemetry) {
      this.applyReplayFrame(snap.rawTelemetry);
    }
  }

  applyReplayFrame(frame) {
    this.state.rpm = frame.rpm;
    this.state.map = frame.map;
    this.state.cht = [...frame.cht];
    this.state.egt = [...frame.egt];
    this.state.oilPress = frame.oilPress;
    this.state.oilTemp = frame.oilTemp;
    this.state.fuelFlow = frame.fuelFlow;
    this.state.load = frame.load;
    this.state.vibrationRms = frame.vibrationRms;
    this.state.missionPhase = frame.phase;
    this.state.missionTimeSec = frame.second;
    this.state.eventMarker = frame.eventMarker;

    // Synchronize expected physics state for replayed operating condition
    if (this.physicsModel) {
      const computed = this.physicsModel.computeExpectedState({
        altitude: frame.altitude || 18000,
        ambientTempMod: 0,
        throttle: (frame.load || 72) / 100,
        missionPhase: frame.phase || 'cruise'
      });
      this.expected = computed.expected;
      this.operatingConditions = computed.operatingConditions;
    }
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = TelemetryEngine;
}
if (typeof window !== 'undefined') {
  window.TelemetryEngine = TelemetryEngine;
}
