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

  _dispatch(rawState, fftBins, expected) {
    this.lastPacketTimestamp = Date.now();
    for (let i = 0; i < this.subscribers.length; i++) {
      try {
        this.subscribers[i](rawState, fftBins, expected);
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
        // Fallback or network error
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
      timestamp: this.lastPacketTimestamp,
      subscribersCount: this.subscribers.length
    };
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = TelemetryAdapter;
}
if (typeof window !== 'undefined') {
  window.TelemetryAdapter = TelemetryAdapter;
}
