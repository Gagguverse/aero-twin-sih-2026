/* ==========================================================================
   AERO-TWIN: INTERACTIVE FAULT INJECTION SANDBOX & SCENARIO MANAGER
   Pre-configured Judge Evaluation Scenarios & Plausibility Injection
   ========================================================================== */

class FaultSimulator {
  constructor(telemetryEngine, soundFx) {
    this.telemetryEngine = telemetryEngine;
    this.soundFx = soundFx;
    this.currentScenario = 'nominal';
  }

  resetToNominalBaseline() {
    this.currentScenario = 'nominal';
    this.telemetryEngine.setScenario('nominal');
    if (this.soundFx) this.soundFx.playChirp();
  }

  loadScenario(scenarioKey) {
    this.currentScenario = scenarioKey;

    switch (scenarioKey) {
      case 'nominal':
        this.telemetryEngine.setScenario('nominal');
        if (this.soundFx) this.soundFx.playChirp();
        break;

      case 'sensor_freeze':
      case 'sensor_drift':
        // SCENARIO B: SENSOR FAULT (Oil Pressure Signal Frozen)
        this.telemetryEngine.setScenario('sensor_freeze');
        if (this.soundFx) this.soundFx.playCaution();
        break;

      case 'sensor_drop':
        // SCENARIO B2: SENSOR FAULT (Oil Pressure Wire Disconnect / Drop to 0)
        this.telemetryEngine.setScenario('sensor_drop');
        if (this.soundFx) this.soundFx.playCaution();
        break;

      case 'thermal_degradation':
      case 'cyl3_thermal':
        // SCENARIO C: REAL ENGINE FAULT (Thermal Degradation)
        this.telemetryEngine.setScenario('thermal_degradation');
        if (this.soundFx) this.soundFx.playAlarm();
        break;

      case 'lubrication_degradation':
      case 'oil_cavitation':
        // SCENARIO D: REAL LUBRICATION FAILURE
        this.telemetryEngine.setScenario('lubrication_degradation');
        if (this.soundFx) this.soundFx.playAlarm();
        break;

      case 'rpm_instability':
      case 'combustion_instability':
        // SCENARIO E: RPM / GOVERNOR INSTABILITY
        this.telemetryEngine.setScenario('rpm_instability');
        if (this.soundFx) this.soundFx.playCaution();
        break;

      default:
        this.telemetryEngine.setScenario('nominal');
        break;
    }
  }

  triggerComponentEmergency(compKey) {
    switch (compKey) {
      case 'cyl1':
      case 'cyl2':
      case 'cyl3':
      case 'cyl4':
        this.loadScenario('thermal_degradation');
        break;
      case 'oil_system':
      case 'crankshaft':
        this.loadScenario('lubrication_degradation');
        break;
      default:
        this.loadScenario('thermal_degradation');
        break;
    }
  }

  clearComponentEmergency() {
    this.loadScenario('nominal');
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = FaultSimulator;
}
if (typeof window !== 'undefined') {
  window.FaultSimulator = FaultSimulator;
}
