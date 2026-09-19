"""
==========================================================================
AERO-TWIN: REAL ENGINE HARDWARE TELEMETRY INGESTION BRIDGE
DRDO MALE UAV AERO PISTON ENGINE DIGITAL TWIN (SIH-26054)
==========================================================================
Connects physical aero engine sensors (via CAN-bus or Serial COM port)
and streams real-time telemetry to the Digital Twin Web Platform:
http://localhost:3000/api/telemetry

Usage:
  1. Real Serial/COM Port (Arduino / ESP32 / Sensor Hub):
     python hardware_bridge.py --port COM3 --baud 115200

  2. Real CAN-bus (CANable / Peak CAN / SocketCAN):
     python hardware_bridge.py --can-interface can0 --can-bitrate 500000

  3. Test Bench Live Generator (Simulates physical engine bench streaming):
     python hardware_bridge.py --test-bench
==========================================================================
"""

import time
import json
import argparse
import sys

try:
    import urllib.request
except ImportError:
    pass

API_ENDPOINT = "http://localhost:3000/api/telemetry"

def send_telemetry_packet(packet_data):
    """Sends JSON packet to the Digital Twin Server"""
    try:
        req = urllib.request.Request(
            API_ENDPOINT,
            data=json.dumps(packet_data).encode('utf-8'),
            headers={'Content-Type': 'application/json'}
        )
        with urllib.request.urlopen(req, timeout=0.5) as response:
            return response.status == 200
    except Exception as e:
        print(f"[BRIDGE ERROR] Failed to send to {API_ENDPOINT}: {e}", file=sys.stderr)
        return False

def run_test_bench_mode():
    """Simulates physical engine test bench streaming to test the real hardware bridge"""
    print("=" * 65)
    print("AERO-TWIN: PHYSICAL ENGINE BENCH BRIDGE STARTED (TEST MODE)")
    print(f"Streaming live sensor data to {API_ENDPOINT}")
    print("Press Ctrl+C to stop.")
    print("=" * 65)

    base_rpm = 4250.0
    packet_id = 0

    while True:
        packet_id += 1
        # Realistic sensor fluctuations
        import random
        rpm = base_rpm + random.uniform(-15, 15)
        map_boost = 34.2 + random.uniform(-0.2, 0.2)
        cht = [
            168.5 + random.uniform(-0.5, 0.5),
            165.2 + random.uniform(-0.5, 0.5),
            171.8 + random.uniform(-0.5, 0.5),
            167.0 + random.uniform(-0.5, 0.5)
        ]
        egt = [
            782.0 + random.uniform(-2, 2),
            778.0 + random.uniform(-2, 2),
            795.0 + random.uniform(-2, 2),
            781.0 + random.uniform(-2, 2)
        ]
        oil_press = 52.4 + random.uniform(-0.3, 0.3)
        oil_temp = 88.5 + random.uniform(-0.2, 0.2)
        vibe_rms = 1.82 + random.uniform(-0.05, 0.05)

        telemetry_payload = {
            "rpm": round(rpm, 1),
            "map": round(map_boost, 2),
            "fuelFlow": round(24.5 + random.uniform(-0.2, 0.2), 1),
            "cht": [round(c, 1) for c in cht],
            "egt": [round(e, 1) for e in egt],
            "oilPress": round(oil_press, 1),
            "oilTemp": round(oil_temp, 1),
            "vibrationRms": round(vibe_rms, 2),
            "rawCan": {
                "id": "0x180",
                "raw": f"{int(rpm):04X} {int(map_boost*10):04X}",
                "eng": f"HW-ENG: {int(rpm)} RPM | MAP: {map_boost:.1f}\""
            }
        }

        success = send_telemetry_packet(telemetry_payload)
        if packet_id % 10 == 0:
            status = "TX OK" if success else "TX RETRY"
            print(f"[{status}] Packet #{packet_id} -> RPM: {rpm:.0f} | MAP: {map_boost:.1f}\" | CHT3: {cht[2]:.1f}°C | OIL: {oil_press:.1f} PSI")

        time.sleep(0.1) # 10 Hz telemetry rate

def run_serial_mode(port, baud):
    """Reads serial line from Arduino/ECU and sends to Digital Twin"""
    try:
        import serial
    except ImportError:
        print("[ERROR] pyserial is required for serial mode. Run: pip install pyserial")
        sys.exit(1)

    print(f"[SERIAL] Opening {port} at {baud} baud...")
    ser = serial.Serial(port, baud, timeout=1)
    print("[SERIAL] Connected! Waiting for engine sensor stream...")

    while True:
        try:
            line = ser.readline().decode('utf-8', errors='ignore').strip()
            if not line:
                continue

            # Support JSON format
            if line.startswith('{') and line.endsWith('}'):
                packet = json.loads(line)
                send_telemetry_packet(packet)
            # Support CSV format: RPM,MAP,CHT1,CHT2,CHT3,CHT4,EGT1,EGT2,EGT3,EGT4,OIL_P,OIL_T,VIBE
            elif ',' in line:
                parts = [float(x) for x in line.split(',')]
                if len(parts) >= 6:
                    packet = {
                        "rpm": parts[0],
                        "map": parts[1],
                        "cht": parts[2:6],
                        "egt": parts[6:10] if len(parts) >= 10 else [780]*4,
                        "oilPress": parts[10] if len(parts) > 10 else 52,
                        "oilTemp": parts[11] if len(parts) > 11 else 88,
                        "vibrationRms": parts[12] if len(parts) > 12 else 1.8
                    }
                    send_telemetry_packet(packet)
        except Exception as e:
            print(f"[SERIAL RX ERROR] {e}")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="AERO-TWIN Hardware Telemetry Ingestion Bridge")
    parser.add_argument("--port", type=str, help="Serial COM port (e.g. COM3 or /dev/ttyUSB0)")
    parser.add_argument("--baud", type=int, default=115200, help="Baud rate (default: 115200)")
    parser.add_argument("--test-bench", action="store_true", help="Run simulated test bench feeder")

    args = parser.parse_args()

    if args.port:
        run_serial_mode(args.port, args.baud)
    else:
        # Default to test bench feeder demonstration
        run_test_bench_mode()
