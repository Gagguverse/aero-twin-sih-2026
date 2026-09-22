/* ==========================================================================
   AERO TWIN — UNIFIED TELEMETRY INGESTION ADAPTER
   SIH26054 | DRDO MALE UAV Aero Piston Engine Digital Twin
   
   Multi-Source Telemetry Ingestion Layer:
   Simulator ─┐
   CAN ───────┼──> Telemetry Adapter ──> Aero Twin Core Pipeline
   REST ──────┤
   WebSocket ─┘
   
   Default Mode: SIMULATOR (10 Hz Synthetic Simulation)
   Extensible for real-world UAV avionics ground station ingestion (CAN/REST/WS).
   ========================================================================== */

class TelemetryAdapter {
  constructor(telemetryEngine) {
    this.engine = telemetryEngine;
    this.mode = 'SIMULATOR'; // 'SIMULATOR' | 'REST' | 'CAN_BRIDGE' | 'WEBSOCKET'
    this.subscribers = [];
    this.restPollInterval = null;
    this.lastPacketTimestamp = 0;

    // -----------------------------------------------------------------------
    // ERROR HANDLING: Last valid state buffer
    // Preserved on every successful dispatch; restored during disconnect / bad packets.
    // -----------------------------------------------------------------------
    this.lastValidState = null;
    this.lastValidFft = null;
    this.lastValidExpected = null;

    // -----------------------------------------------------------------------
    // ERROR HANDLING: Connection watchdog
    // Fires telemetry:disconnect after 3 s of silence; fires telemetry:reconnect
    // when a valid packet arrives after a disconnect.
    // -----------------------------------------------------------------------
    this.isConnected = true;
    this.watchdogTimeoutMs = 3000; // 3 seconds
    this._watchdogTimer = null;
    this._startWatchdog();

    // Connect to local simulator by default
    if (this.engine) {
      this.engine.onUpdate((state, fft, exp) => {
        if (this.mode === 'SIMULATOR') {
          this._dispatch(state, fft, exp);
        }
      });
    }
  }

  setMode(newMode) {
    this.mode = newMode;
    console.log(`[TelemetryAdapter] Ingestion mode switched to: ${newMode}`);
    if (newMode === 'REST') {
      this.startRestPolling();
    } else {
      this.stopRestPolling();
    }
  }

  onTelemetry(callback) {
    this.subscribers.push(callback);
  }

  /**
   * Dispatch a telemetry packet to all subscribers.
   * Validates the packet first using TelemetryValidator (if available).
   * Malformed packets are rejected and last valid state is preserved.
   */
  _dispatch(rawState, fftBins, expected) {
    // -----------------------------------------------------------------------
    // VALIDATION GATE: Run TelemetryValidator before dispatching
    // -----------------------------------------------------------------------
    if (typeof window !== 'undefined' && window.TelemetryValidator) {
      const validator = window._telemetryValidatorInstance =
        window._telemetryValidatorInstance || new window.TelemetryValidator();

      const validation = validator.validatePayload(rawState);

      if (validation.malformed) {
        // Structurally broken packet — reject outright, preserve last valid state
        console.error(
          '[TelemetryAdapter] Malformed packet REJECTED:',
          validation.warnings.join(' | '),
          '\nPreserving last valid state.'
        );
        // Dispatch a custom event for the UI error banner
        this._emitSystemEvent('telemetry:malformed_packet', {
          warnings: validation.warnings
        });
        return; // Do not dispatch to subscribers
      }

      if (validation.invalidFields.length > 0) {
        // Packet has invalid sensor values — dispatch the sanitized version
        // (invalid fields replaced with null sentinels; SensorTrustEngine will quarantine them)
        this._doDispatch(validation.sanitized, fftBins, expected);
        return;
      }

      // Packet is fully valid — dispatch as-is
      this._doDispatch(rawState, fftBins, expected);

    } else {
      // TelemetryValidator not loaded (fallback — dispatch raw, no validation)
      this._doDispatch(rawState, fftBins, expected);
    }
  }

  /**
   * Internal: actually dispatch a validated/sanitized state to subscribers.
   */
  _doDispatch(state, fftBins, expected) {
    this.lastPacketTimestamp = Date.now();

    // Store last valid state for preservation during disconnect
    if (state) {
      this.lastValidState = state;
      this.lastValidFft = fftBins;
      this.lastValidExpected = expected;
    }

    // If we were disconnected, emit reconnect event
    if (!this.isConnected) {
      this.isConnected = true;
      console.log('[TelemetryAdapter] Telemetry reconnected.');
      this._emitSystemEvent('telemetry:reconnect', {});
    }

    // Reset watchdog on every valid packet
    this._resetWatchdog();

    for (let i = 0; i < this.subscribers.length; i++) {
      try {
        this.subscribers[i](state, fftBins, expected);
      } catch (err) {
        console.error('[TelemetryAdapter] Error dispatching telemetry packet:', err);
      }
    }
  }

  startRestPolling(endpoint = '/api/telemetry', intervalMs = 100) {
    this.stopRestPolling();
    this.restPollInterval = setInterval(async () => {
      try {
        const res = await fetch(endpoint);
        if (!res.ok) return;
        const data = await res.json();
        if (data.active && data.telemetry) {
          // Wrap REST packet into pipeline
          this._dispatch(data.telemetry, null, null);
        }
      } catch (e) {
        // Fallback or network error — watchdog will detect the gap
      }
    }, intervalMs);
  }

  stopRestPolling() {
    if (this.restPollInterval) {
      clearInterval(this.restPollInterval);
      this.restPollInterval = null;
    }
  }

  getStatus() {
    return {
      mode: this.mode,
      active: (Date.now() - this.lastPacketTimestamp) < 2000,
      connected: this.isConnected,
      timestamp: this.lastPacketTimestamp,
      subscribersCount: this.subscribers.length,
      hasLastValidState: this.lastValidState !== null
    };
  }

  // -------------------------------------------------------------------------
  // WATCHDOG: Detects telemetry silence and emits disconnect/reconnect events
  // -------------------------------------------------------------------------

  _startWatchdog() {
    this._clearWatchdog();
    this._watchdogTimer = setTimeout(() => this._onWatchdogFired(), this.watchdogTimeoutMs);
  }

  _resetWatchdog() {
    this._clearWatchdog();
    this._watchdogTimer = setTimeout(() => this._onWatchdogFired(), this.watchdogTimeoutMs);
  }

  _clearWatchdog() {
    if (this._watchdogTimer) {
      clearTimeout(this._watchdogTimer);
      this._watchdogTimer = null;
    }
  }

  _onWatchdogFired() {
    if (this.isConnected) {
      this.isConnected = false;
      const silenceSec = ((Date.now() - this.lastPacketTimestamp) / 1000).toFixed(1);
      console.warn(`[TelemetryAdapter] Watchdog fired — no telemetry for ${silenceSec}s. Emitting disconnect.`);
      this._emitSystemEvent('telemetry:disconnect', { silenceSeconds: parseFloat(silenceSec) });
    }
  }

  /**
   * Emit a window CustomEvent for UI layers to listen to.
   */
  _emitSystemEvent(eventName, detail) {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(eventName, { detail }));
    }
  }

  // -------------------------------------------------------------------------
  // TEST HELPER: Simulate a telemetry disconnect for a given duration
  // -------------------------------------------------------------------------

  /**
   * Simulates a temporary telemetry disconnect by pausing the simulator's
   * listener and manually firing the watchdog after 1 tick.
   * Used for TEST 4.
   *
   * @param {number} durationMs - How long to simulate disconnect (ms)
   */
  simulateDisconnect(durationMs = 5000) {
    console.log(`[TelemetryAdapter] TEST: Simulating ${durationMs}ms telemetry disconnect...`);

    // Pause the engine tick from dispatching
    const originalMode = this.mode;
    this.mode = '_DISCONNECTED_TEST';

    // Force immediate watchdog trigger by clearing watchdog and firing manually
    this._clearWatchdog();
    this._onWatchdogFired();

    // Resume after duration
    setTimeout(() => {
      this.mode = originalMode;
      console.log('[TelemetryAdapter] TEST: Reconnecting telemetry...');
      // The next real packet will trigger _doDispatch which fires telemetry:reconnect
    }, durationMs);
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = TelemetryAdapter;
}
if (typeof window !== 'undefined') {
  window.TelemetryAdapter = TelemetryAdapter;
}
