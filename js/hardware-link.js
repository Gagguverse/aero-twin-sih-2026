/* ==========================================================================
   AERO-TWIN: HARDWARE INGESTION LINK & WEB SERIAL / REST BRIDGE
   Connects Physical Aero Piston Engine Sensors, Arduino/ESP32, or CAN-bus
   ========================================================================== */

class HardwareLink {
  constructor(telemetryEngine) {
    this.telemetry = telemetryEngine;
    this.port = null;
    this.reader = null;
    this.isConnected = false;
    this.connectionType = 'NONE'; // 'SERIAL' or 'API'
    this.baudRate = 115200;
    this.packetsReceived = 0;
    this.pollIntervalId = null;

    this.onStatusChangeCallbacks = [];
  }

  onStatusChange(cb) {
    this.onStatusChangeCallbacks.push(cb);
  }

  notifyStatus(status) {
    this.onStatusChangeCallbacks.forEach(cb => cb(status));
  }

  /**
   * Connect to real engine via Web Serial API (Direct USB / COM Port)
   * Works with Arduino, ESP32, STM32, USB-CAN converters (CANable, MCP2515, ELM327)
   */
  async connectSerial(baudRate = 115200) {
    if (!('serial' in navigator)) {
      throw new Error("Web Serial API is not supported in this browser. Please use Google Chrome, Edge, or Opera.");
    }

    try {
      this.baudRate = Number(baudRate) || 115200;
      // Request user to select COM port
      this.port = await navigator.serial.requestPort();
      await this.port.open({ baudRate: this.baudRate });

      this.isConnected = true;
      this.connectionType = 'SERIAL';
      this.telemetry.setSource('HARDWARE_SERIAL', `USB Serial (${this.baudRate} bps)`);

      this.notifyStatus({
        connected: true,
        type: 'SERIAL',
        label: `USB COM PORT @ ${this.baudRate} BPS`
      });

      this.readSerialStream();
      return true;
    } catch (err) {
      this.disconnect();
      throw err;
    }
  }

  async readSerialStream() {
    const textDecoder = new TextDecoderStream();
    const readableStreamClosed = this.port.readable.pipeTo(textDecoder.writable);
    this.reader = textDecoder.readable.getReader();

    let buffer = '';

    try {
      while (this.isConnected) {
        const { value, done } = await this.reader.read();
        if (done) break;
        if (value) {
          buffer += value;
          const lines = buffer.split('\n');
          buffer = lines.pop(); // Keep partial line for next chunk

          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.length > 0) {
              this.parseIncomingLine(trimmed);
            }
          }
        }
      }
    } catch (err) {
      console.warn("Serial stream read finished or aborted:", err);
    } finally {
      if (this.reader) {
        try { this.reader.releaseLock(); } catch (e) {}
      }
    }
  }

  /**
   * Parse incoming serial line - supports both JSON and comma-separated CSV:
   * JSON: {"rpm": 4200, "map": 34.5, "cht": [168,166,171,167], "egt": [780,775,790,780], "oilPress": 52, "oilTemp": 88}
   * CSV: RPM,MAP,CHT1,CHT2,CHT3,CHT4,EGT1,EGT2,EGT3,EGT4,OIL_PRESS,OIL_TEMP,VIBE_RMS
   */
  parseIncomingLine(line) {
    try {
      if (line.startsWith('{') && line.endsWith('}')) {
        const packet = JSON.parse(line);
        this.packetsReceived++;
        this.telemetry.ingestHardwarePacket(packet);
        return;
      }

      // Check CSV format
      if (line.includes(',')) {
        const parts = line.split(',').map(Number);
        if (parts.length >= 6) {
          const packet = {
            rpm: parts[0] || 0,
            map: parts[1] || 29.9,
            cht: [parts[2] || 160, parts[3] || 160, parts[4] || 160, parts[5] || 160],
            egt: parts.length >= 10 ? [parts[6] || 780, parts[7] || 780, parts[8] || 780, parts[9] || 780] : [780, 780, 780, 780],
            oilPress: parts[10] || 50,
            oilTemp: parts[11] || 85,
            vibrationRms: parts[12] || 1.8
          };
          this.packetsReceived++;
          this.telemetry.ingestHardwarePacket(packet);
        }
      }
    } catch (err) {
      // Ignore corrupted or partial frame
    }
  }

  /**
   * Connect to REST Ingestion Endpoint (/api/telemetry)
   * Useful when a Python script (hardware_bridge.py) or MATLAB/LabVIEW pushes data
   */
  startApiBridgePolling() {
    this.stopApiBridgePolling();
    this.connectionType = 'API';
    this.lastPacketTimestamp = 0;

    // Immediately notify UI that polling is active and waiting for packets
    this.notifyStatus({
      connected: true,
      type: 'API_WAITING',
      label: 'NETWORK API: LISTENING ON /api/telemetry (WAITING FOR TEST BENCH FEED)'
    });

    this.pollIntervalId = setInterval(async () => {
      try {
        const res = await fetch('/api/telemetry');
        if (!res.ok) return;
        const data = await res.json();

        if (data.telemetry && data.timestamp && data.timestamp !== this.lastPacketTimestamp) {
          this.lastPacketTimestamp = data.timestamp;
          this.packetsReceived++;
          this.isConnected = true;
          this.telemetry.setSource('HARDWARE_API', 'Network Telemetry Ingestion Bridge (/api/telemetry)');
          this.notifyStatus({
            connected: true,
            type: 'API_ACTIVE',
            label: `LIVE ENGINE TEST BENCH (${this.packetsReceived} PKTS RX)`
          });
          this.telemetry.ingestHardwarePacket(data.telemetry);
        } else if (this.isConnected && data.active === false && (Date.now() - this.lastPacketTimestamp > 6000)) {
          this.notifyStatus({
            connected: true,
            type: 'API_WAITING',
            label: 'NETWORK API: LISTENING (WAITING FOR DATA)'
          });
        }
      } catch (err) {
        // Backend not reachable
      }
    }, 100);
  }

  stopApiBridgePolling() {
    if (this.pollIntervalId) {
      clearInterval(this.pollIntervalId);
      this.pollIntervalId = null;
    }
  }

  /**
   * Virtual Test Bench Feeder (Option 2 Simulator)
   * Generates realistic dynamic dyno test-bench telemetry and POSTs to /api/telemetry
   */
  startVirtualFeeder() {
    this.stopVirtualFeeder();
    this.isFeederActive = true;
    this.startApiBridgePolling();

    let step = 0;
    this.feederIntervalId = setInterval(async () => {
      if (!this.isFeederActive) return;
      step++;
      const packet = {
        rpm: Math.round(4250 + Math.sin(step * 0.1) * 140 + (Math.random() - 0.5) * 15),
        map: Number((34.8 + Math.sin(step * 0.08) * 1.2 + (Math.random() - 0.5) * 0.2).toFixed(1)),
        cht: [
          Math.round(168 + Math.sin(step * 0.05) * 3),
          Math.round(166 + Math.cos(step * 0.05) * 3),
          Math.round(173 + Math.sin(step * 0.04) * 4),
          Math.round(167 + Math.cos(step * 0.04) * 3)
        ],
        egt: [782, 776, 794, 780],
        oilPress: Number((52.8 + (Math.random() - 0.5) * 0.6).toFixed(1)),
        oilTemp: Number((88.6 + (Math.random() - 0.5) * 0.3).toFixed(1)),
        fuelFlow: Number((25.1 + Math.sin(step * 0.1) * 1.1).toFixed(1)),
        vibrationRms: Number((1.84 + (Math.random() - 0.5) * 0.08).toFixed(2)),
        rawCan: {
          id: '0x290',
          raw: `1B 04 ${Math.floor(Math.random() * 255).toString(16).padStart(2, '0')} FF`,
          eng: `DYNO BENCH STREAM #${step}`
        }
      };

      let postSucceeded = false;
      try {
        const res = await fetch('/api/telemetry', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(packet)
        });
        if (res.ok) postSucceeded = true;
      } catch (e) {}

      // Fallback for static hosting environments (e.g. Surge / GitHub Pages): ingest directly
      if (!postSucceeded) {
        this.packetsReceived++;
        this.isConnected = true;
        this.telemetry.setSource('HARDWARE_API', 'Virtual Dyno Bench Stream (In-Memory HIL)');
        this.notifyStatus({
          connected: true,
          type: 'API_ACTIVE',
          label: `LIVE ENGINE TEST BENCH (${this.packetsReceived} PKTS RX)`
        });
        this.telemetry.ingestHardwarePacket(packet);
      }
    }, 150);
  }

  stopVirtualFeeder() {
    this.isFeederActive = false;
    if (this.feederIntervalId) {
      clearInterval(this.feederIntervalId);
      this.feederIntervalId = null;
    }
  }

  /**
   * Virtual Serial Emulator (Option 1 Simulator)
   * Simulates USB Arduino sensor feed for testing without physical hardware
   */
  simulateSerialStream() {
    this.disconnect();
    this.isConnected = true;
    this.connectionType = 'SERIAL_EMU';
    this.telemetry.setSource('HARDWARE_SERIAL', 'Emulated Arduino USB Serial (COM3)');
    this.notifyStatus({
      connected: true,
      type: 'SERIAL',
      label: 'USB SERIAL (EMULATED ARDUINO CH340 @ 115200)'
    });

    let count = 0;
    this.serialEmuInterval = setInterval(() => {
      if (this.connectionType !== 'SERIAL_EMU') {
        clearInterval(this.serialEmuInterval);
        return;
      }
      count++;
      const frame = {
        rpm: Math.round(4180 + Math.sin(count * 0.12) * 120),
        map: Number((34.2 + Math.sin(count * 0.1) * 1.1).toFixed(1)),
        cht: [169, 166, 172, 167],
        egt: [780, 775, 792, 778],
        oilPress: 51.8,
        oilTemp: 87.9,
        fuelFlow: 24.5,
        vibrationRms: 1.78,
        rawCan: { id: '0x108', raw: 'AA 55 01 02', eng: `SERIAL PACKET #${count}` }
      };
      this.packetsReceived++;
      this.telemetry.ingestHardwarePacket(frame);
      this.notifyStatus({
        connected: true,
        type: 'SERIAL',
        label: `USB SERIAL ACTIVE (${this.packetsReceived} PKTS RX)`
      });
    }, 120);
  }

  /**
   * Sends a single sample telemetry packet to /api/telemetry
   */
  async sendSingleTestPacket() {
    const testPacket = {
      rpm: 4320,
      map: 35.6,
      cht: [172, 169, 176, 171],
      egt: [790, 785, 802, 788],
      oilPress: 53.5,
      oilTemp: 89.2,
      fuelFlow: 26.0,
      vibrationRms: 1.95,
      rawCan: { id: '0x290', raw: 'DE AD BE EF', eng: 'SINGLE TEST PACKET' }
    };
    try {
      const res = await fetch('/api/telemetry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(testPacket)
      });
      if (res.ok) return true;
    } catch (e) {}

    // Fallback for static hosts
    this.packetsReceived++;
    this.isConnected = true;
    this.telemetry.setSource('HARDWARE_API', 'Single Packet Ingestion (HIL Dyno)');
    this.notifyStatus({
      connected: true,
      type: 'API_ACTIVE',
      label: `SINGLE TEST PACKET INGESTED (${this.packetsReceived} PKTS RX)`
    });
    this.telemetry.ingestHardwarePacket(testPacket);
    return true;
  }

  async disconnect() {
    this.isConnected = false;
    this.stopApiBridgePolling();
    this.stopVirtualFeeder();
    if (this.serialEmuInterval) {
      clearInterval(this.serialEmuInterval);
      this.serialEmuInterval = null;
    }

    if (this.reader) {
      try { await this.reader.cancel(); } catch (e) {}
      try { this.reader.releaseLock(); } catch (e) {}
      this.reader = null;
    }

    if (this.port) {
      try { await this.port.close(); } catch (e) {}
      this.port = null;
    }

    this.telemetry.setSource('SIMULATED', 'None');
    this.connectionType = 'NONE';
    this.notifyStatus({
      connected: false,
      type: 'NONE',
      label: 'SIMULATION MODE (INTERNAL 0D/1D MODEL)'
    });
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = HardwareLink;
}
if (typeof window !== 'undefined') {
  window.HardwareLink = HardwareLink;
}
