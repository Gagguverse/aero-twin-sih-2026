/* ==========================================================================
   AERO TWIN — TELEMETRY VALIDATION GATE
   SIH Problem Statement: SIH26054 | DRDO MALE UAV Aero Piston Engine
   
   Pre-Pipeline Validation Layer:
   Runs BEFORE SensorTrustEngine — strictly structural and physical-range
   checks only. Does NOT make engine health judgments.
   
   Pipeline position:
     Raw Telemetry → [THIS MODULE] → SensorTrustEngine → AIDiagnosticNet
   
   Rules:
   1. Never throws — always returns a result object.
   2. Never silently converts invalid values into fake valid values.
   3. Invalid sensor value → null sentinel → SensorTrustEngine handles trust.
   4. Malformed payload (wrong structure) → rejected outright, last state preserved.
   ========================================================================== */

class TelemetryValidator {
  constructor() {
    // Hard physical-impossibility limits.
    // If a value is outside these bounds the SENSOR is INVALID — not the engine.
    // These are deliberately wide — SensorTrustEngine applies tighter operational limits.
    this.hardLimits = {
      rpm:      { min: 0,    max: 7000,  unit: 'RPM',  name: 'Engine RPM' },
      oilPress: { min: 0,    max: 150,   unit: 'PSI',  name: 'Oil Pressure' },
      oilTemp:  { min: -50,  max: 300,   unit: '°C',   name: 'Oil Temperature' },
      fuelFlow: { min: 0,    max: 200,   unit: 'L/hr', name: 'Fuel Flow' },
      map:      { min: 0,    max: 100,   unit: 'inHg', name: 'MAP' },
      load:     { min: 0,    max: 110,   unit: '%',    name: 'Engine Load' },
      cht:      { min: -50,  max: 500,   unit: '°C',   name: 'Cylinder Head Temp' },
      egt:      { min: -50,  max: 1500,  unit: '°C',   name: 'Exhaust Gas Temp' },
      vibrationRms: { min: 0, max: 50,  unit: 'mm/s', name: 'Vibration RMS' },
      throttle: { min: 0,    max: 1.05, unit: '',      name: 'Throttle' },
      altitude: { min: -1000, max: 60000, unit: 'ft', name: 'Altitude' }
    };

    // Required scalar fields in every telemetry packet
    this.requiredScalars = ['rpm', 'oilPress', 'oilTemp', 'fuelFlow', 'map'];

    // Required array fields (must be arrays of length 4)
    this.requiredArrays = ['cht', 'egt'];

    // Statistics for debugging
    this.stats = {
      totalPackets: 0,
      malformedPackets: 0,
      invalidFieldPackets: 0,
      cleanPackets: 0
    };
  }

  /**
   * Main entry point.
   * 
   * @param {*} rawState - Incoming telemetry packet (any type)
   * @returns {{
   *   isValid: boolean,          // true if all required fields present and valid
   *   malformed: boolean,        // true if packet structure is broken (reject outright)
   *   sanitized: Object|null,    // sanitized state with null sentinels for invalid fields
   *   invalidFields: string[],   // list of sensor keys that were invalid/null
   *   warnings: string[]         // human-readable warnings for console/UI
   * }}
   */
  validatePayload(rawState) {
    this.stats.totalPackets++;

    const result = {
      isValid: false,
      malformed: false,
      sanitized: null,
      invalidFields: [],
      warnings: []
    };

    // --- STAGE 1: Structural check ---
    if (!this._isStructurallyValid(rawState, result)) {
      this.stats.malformedPackets++;
      result.malformed = true;
      console.warn('[TelemetryValidator] Malformed packet rejected:', result.warnings.join('; '), rawState);
      return result;
    }

    // --- STAGE 2: Deep clone for sanitization (never mutate the original) ---
    let sanitized;
    try {
      sanitized = this._shallowCloneState(rawState);
    } catch (cloneErr) {
      result.malformed = true;
      result.warnings.push('Failed to clone telemetry state: ' + cloneErr.message);
      this.stats.malformedPackets++;
      return result;
    }

    // --- STAGE 3: Scalar field validation ---
    const allScalars = [
      'rpm', 'oilPress', 'oilTemp', 'fuelFlow', 'map',
      'load', 'throttle', 'vibrationRms', 'altitude', 'oilTemp'
    ];
    for (const key of allScalars) {
      if (key in sanitized) {
        const val = sanitized[key];
        const checkResult = this._checkScalar(key, val);
        if (!checkResult.valid) {
          result.invalidFields.push(key);
          result.warnings.push(checkResult.reason);
          sanitized[key] = null; // null sentinel — not a fake value
          sanitized._invalidFields = sanitized._invalidFields || [];
          sanitized._invalidFields.push(key);
        }
      }
    }

    // --- STAGE 4: Array field validation (CHT, EGT) ---
    for (const arrKey of this.requiredArrays) {
      if (arrKey in sanitized) {
        const arr = sanitized[arrKey];
        if (!Array.isArray(arr)) {
          // Type error — replace with null array
          result.invalidFields.push(arrKey);
          result.warnings.push(`${arrKey}: expected Array but got ${typeof arr} — marked null`);
          sanitized[arrKey] = [null, null, null, null];
          sanitized._invalidFields = sanitized._invalidFields || [];
          sanitized._invalidFields.push(arrKey);
        } else {
          // Validate each element
          const limits = this.hardLimits[arrKey];
          for (let i = 0; i < arr.length; i++) {
            const elem = arr[i];
            if (elem === null || elem === undefined) {
              sanitized[arrKey][i] = null;
              if (!result.invalidFields.includes(`${arrKey}[${i}]`)) {
                result.invalidFields.push(`${arrKey}[${i}]`);
                result.warnings.push(`${arrKey}[${i}]: null/undefined value — marked null`);
              }
            } else if (typeof elem !== 'number' || !isFinite(elem)) {
              sanitized[arrKey][i] = null;
              result.invalidFields.push(`${arrKey}[${i}]`);
              result.warnings.push(`${arrKey}[${i}]: non-finite value ${elem} — marked null`);
            } else if (limits && (elem < limits.min || elem > limits.max)) {
              sanitized[arrKey][i] = null;
              result.invalidFields.push(`${arrKey}[${i}]`);
              result.warnings.push(
                `${arrKey}[${i}]: value ${elem} ${limits.unit} out of physical range ` +
                `[${limits.min}, ${limits.max}] — sensor INVALID (not engine failure)`
              );
              sanitized._invalidFields = sanitized._invalidFields || [];
              if (!sanitized._invalidFields.includes(arrKey)) {
                sanitized._invalidFields.push(arrKey);
              }
            }
          }
        }
      } else if (this.requiredArrays.includes(arrKey)) {
        // Missing required array — fill with nulls
        sanitized[arrKey] = [null, null, null, null];
        result.invalidFields.push(arrKey);
        result.warnings.push(`${arrKey}: required field missing — filled with null sentinels`);
      }
    }

    result.sanitized = sanitized;
    result.isValid = result.invalidFields.length === 0;

    if (result.invalidFields.length > 0) {
      this.stats.invalidFieldPackets++;
      console.warn(
        `[TelemetryValidator] ${result.invalidFields.length} invalid field(s) sanitized:`,
        result.invalidFields.join(', '),
        '— SensorTrustEngine will evaluate trust, NOT engine health.'
      );
    } else {
      this.stats.cleanPackets++;
    }

    return result;
  }

  /**
   * Check if rawState has the minimum required structure to be processed.
   * Returns false for: null, non-object, missing all required fields.
   */
  _isStructurallyValid(rawState, result) {
    if (rawState === null || rawState === undefined) {
      result.warnings.push('Telemetry packet is null/undefined');
      return false;
    }
    if (typeof rawState !== 'object' || Array.isArray(rawState)) {
      result.warnings.push(`Expected object, got ${Array.isArray(rawState) ? 'array' : typeof rawState}`);
      return false;
    }

    // At minimum we need at least ONE of: rpm, oilPress, cht, egt
    const hasAnyKey = this.requiredScalars.some(k => k in rawState) ||
                      this.requiredArrays.some(k => k in rawState);
    if (!hasAnyKey) {
      result.warnings.push('Packet missing all required telemetry fields (rpm, oilPress, cht, egt, etc.)');
      return false;
    }

    return true;
  }

  /**
   * Validate a single scalar value against hard physical limits.
   */
  _checkScalar(key, val) {
    // Missing/null/undefined
    if (val === null || val === undefined) {
      return { valid: false, reason: `${key}: null/undefined value` };
    }
    // Non-numeric
    if (typeof val !== 'number' || !isFinite(val)) {
      return { valid: false, reason: `${key}: non-numeric value "${val}" (type: ${typeof val})` };
    }
    // NaN
    if (isNaN(val)) {
      return { valid: false, reason: `${key}: NaN value` };
    }
    // Hard limits
    const limits = this.hardLimits[key];
    if (limits) {
      if (val < limits.min) {
        return {
          valid: false,
          reason: `${key}: value ${val} ${limits.unit} is below physical minimum ${limits.min} ${limits.unit} — sensor INVALID`
        };
      }
      if (val > limits.max) {
        return {
          valid: false,
          reason: `${key}: value ${val} ${limits.unit} exceeds physical maximum ${limits.max} ${limits.unit} — sensor INVALID`
        };
      }
    }
    return { valid: true };
  }

  /**
   * Shallow clone preserving array references as new arrays (arrays copied element-by-element).
   * Does NOT deep-clone nested objects to keep it fast at 10 Hz.
   */
  _shallowCloneState(state) {
    const cloned = {};
    for (const key of Object.keys(state)) {
      const val = state[key];
      if (Array.isArray(val)) {
        cloned[key] = val.slice(); // copy array
      } else {
        cloned[key] = val;
      }
    }
    return cloned;
  }

  /**
   * Returns a summary of validation statistics for debugging.
   */
  getStats() {
    return { ...this.stats };
  }

  /**
   * Reset statistics counters.
   */
  resetStats() {
    this.stats = { totalPackets: 0, malformedPackets: 0, invalidFieldPackets: 0, cleanPackets: 0 };
  }
}

// Export for both browser and Node.js environments
if (typeof module !== 'undefined' && module.exports) {
  module.exports = TelemetryValidator;
}
if (typeof window !== 'undefined') {
  window.TelemetryValidator = TelemetryValidator;
}
