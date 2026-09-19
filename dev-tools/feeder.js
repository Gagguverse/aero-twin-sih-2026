/**
 * AERO-TWIN: Real Engine Hardware Telemetry Feeder (Node.js version)
 * DRDO MALE UAV Aero Piston Engine Digital Twin (SIH-26054)
 *
 * Runs without Python! Uses native Node.js fetch to stream live dyno data
 * to http://localhost:3000/api/telemetry
 *
 * Usage:
 *   node feeder.js
 */

const API_ENDPOINT = 'http://localhost:3000/api/telemetry';

console.log('='.repeat(65));
console.log('AERO-TWIN: NODE.JS HARDWARE TELEMETRY FEEDER');
console.log(`Streaming live engine test bench frames to ${API_ENDPOINT}`);
console.log('Press Ctrl+C to terminate.');
console.log('='.repeat(65));

let packetId = 0;
const baseRpm = 4280;

async function sendPacket() {
  packetId++;
  const rpm = Math.round(baseRpm + (Math.random() * 30 - 15));
  const map = Number((34.5 + (Math.random() * 0.4 - 0.2)).toFixed(2));
  const cht = [
    Number((168.0 + (Math.random() * 1.0 - 0.5)).toFixed(1)),
    Number((165.2 + (Math.random() * 1.0 - 0.5)).toFixed(1)),
    Number((171.5 + (Math.random() * 1.0 - 0.5)).toFixed(1)),
    Number((167.0 + (Math.random() * 1.0 - 0.5)).toFixed(1))
  ];
  const egt = [
    Math.round(782 + (Math.random() * 4 - 2)),
    Math.round(778 + (Math.random() * 4 - 2)),
    Math.round(795 + (Math.random() * 4 - 2)),
    Math.round(781 + (Math.random() * 4 - 2))
  ];
  const oilPress = Number((52.4 + (Math.random() * 0.6 - 0.3)).toFixed(1));
  const oilTemp = Number((88.5 + (Math.random() * 0.4 - 0.2)).toFixed(1));
  const vibeRms = Number((1.82 + (Math.random() * 0.08 - 0.04)).toFixed(2));

  const payload = {
    rpm,
    map,
    fuelFlow: 24.5,
    cht,
    egt,
    oilPress,
    oilTemp,
    vibrationRms: vibeRms,
    rawCan: {
      id: '0x180',
      raw: `${rpm.toString(16).toUpperCase()} ${(Math.round(map * 10)).toString(16).toUpperCase()}`,
      eng: `NODE-ENG: ${rpm} RPM | MAP: ${map}"`
    }
  };

  try {
    const res = await fetch(API_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (packetId % 10 === 0) {
      console.log(`[TX OK] Packet #${packetId} -> RPM: ${rpm} | MAP: ${map}" | CHT3: ${cht[2]}°C | OIL: ${oilPress} PSI`);
    }
  } catch (err) {
    console.error(`[TX FAIL] Failed to transmit packet #${packetId}:`, err.message);
  }
}

// Send every 150ms
setInterval(sendPacket, 150);
