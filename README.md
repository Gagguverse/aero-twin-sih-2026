# AERO-TWIN: DRDO MALE UAV Aero Piston Engine Digital Twin
### Smart India Hackathon (SIH 2026) | Problem Statement: SIH26054
**Theme**: Robotics & Drones | **Category**: Software | **Organization**: DRDO  
**Official Problem Statement**:  
*"AI-Enabled Real-Time Digital Twin System for Health Monitoring, Fault Prediction and Mission Reliability Enhancement of Aero Piston Engines used in MALE UAVs."*

---

## ⚠️ Synthetic Data & Decision Support Transparency Notice
> **IMPORTANT SCIENTIFIC DISCLAIMER**:
> 1. **Telemetry & Dataset**: All telemetry data, sensor streams, and flight records currently utilized in Aero Twin are **physics-grounded synthetic/simulated profiles** calibrated against standard 4-stroke aero piston engine performance envelopes. No live connection to DRDO classified hardware or operational UAV aircraft is claimed or implied.
> 2. **ML Evaluation**: Random Forest and Isolation Forest evaluation metrics (accuracy, precision, recall, F1, anomaly scores) reflect performance on synthetic bench data.
> 3. **RUL & Degradation**: Remaining Useful Life estimates (e.g. ~48 h [43–53 h]) represent model-based prototype prognostics, not FAA/DGCA/CEMILAC flight-certified engineering forecasts.
> 4. **Mission Reliability**: The Mission Reliability score is a deterministic **Decision-Support Score** designed to guide ground operators during tactical UAV flight sorties, not a scientifically certified operational flight probability.
> 5. **Simulation Level**: The Digital Twin executes an operating-condition-aware thermodynamic & kinematic equilibrium model; it is not a 3D computational fluid dynamics (CFD) or finite element analysis (FEA) solver.

---

## 1. End-to-End System Architecture

```
                       ┌────────────────────────────────────────────────────────┐
                       │                   TELEMETRY INGESTION                  │
                       │   Simulator (10 Hz) | REST API (/telemetry) | CAN-Bus  │
                       └───────────────────────────┬────────────────────────────┘
                                                   │
                                                   ▼
                       ┌────────────────────────────────────────────────────────┐
                       │               1. SENSOR TRUST LAYER                    │
                       │    Physical Range • Slew Rate • Freeze Variance        │
                       │            Multi-Sensor Cross-Correlation              │
                       │          "BAD SENSOR ≠ BAD ENGINE PRINCIPLE"           │
                       └───────────────┬────────────────────────┬───────────────┘
                                       │                        │
                         [Trusted Telemetry]          [Quarantined Sensors]
                                       │                        │
                                       ▼                        ▼
                       ┌────────────────────────────────────────────────────────┐
                       │               2. PHYSICS EXPECTED STATE                │
                       │   Operating Conditions: Altitude • ISA Temp • Throttle │
                       │    Expected: RPM, EGT, CHT, Oil Press/Temp, MAP, Fuel  │
                       └───────────────────────────┬────────────────────────────┘
                                                   │
                                                   ▼
                       ┌────────────────────────────────────────────────────────┐
                       │          3. OPERATING RESIDUALS (Δ = Actual - Exp)     │
                       │    Normalized Deviations & Semantic Envelope Status    │
                       │   (Quarantined sensors shielded from false residuals)  │
                       └───────────────────────────┬────────────────────────────┘
                                                   │
                                                   ▼
                       ┌────────────────────────────────────────────────────────┐
                       │            4. MACHINE LEARNING & HEALTH CORE           │
                       │    Isolation Forest (Unsupervised Anomaly Detector)    │
                       │        Random Forest (50-Tree Fault Classifier)        │
                       └───────────────────────────┬────────────────────────────┘
                                                   │
                                                   ▼
                       ┌────────────────────────────────────────────────────────┐
                       │            5. HEALTH & PROGNOSTIC ENVELOPE             │
                       │    Deterministic Engine Health Index (EHI: 0-100)      │
                       │      Cumulative Stress Wear & Model-Based RUL Range    │
                       └───────────────────────────┬────────────────────────────┘
                                                   │
                                                   ▼
                       ┌────────────────────────────────────────────────────────┐
                       │       6. MISSION RELIABILITY & MAINTENANCE ADVISORY    │
                       │    Reliability Score (0-100% Decision Support)         │
                       │    Deterministic Subsystem Maintenance Recommendations │
                       └───────────────────────────┬────────────────────────────┘
                                                   │
                                                   ▼
                       ┌────────────────────────────────────────────────────────┐
                       │                  7. CENTRAL APP STATE                  │
                       │            window.appState (Single Truth Source)       │
                       └──────┬────────────────────┼────────────────────┬───────┘
                              │                    │                    │
                              ▼                    ▼                    ▼
                    ┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐
                    │ Avionics GCS UI  │ │  WebGL 3D Twin   │ │  Groq AI (LPU)   │
                    │ Live HUD Cards,  │ │ Kinematic Motion │ │ Grounded State   │
                    │ Physics Matrix   │ │ Stress Heatmap   │ │ (GPT-OSS 120B)   │
                    └──────────────────┘ └──────────────────┘ └──────────────────┘
```

---

## 2. Sensor Trust Layer Architecture: "BAD SENSOR ≠ BAD ENGINE"

In MALE UAV operations, sensor failures (wiring faults, frozen ADCs, transducer drift) occur far more frequently than sudden catastrophic engine mechanical failures. Declaring engine failure due to a frozen transducer causes unnecessary mission aborts and catastrophic emergency landings.

### Four-Stage Sensor Validation Gatekeeper:
1. **Physical Plausibility Envelope**: Ensures readings remain within physical instrumentation limits:
   * RPM: 0 – 6,500 RPM
   * CHT: 20 – 260 °C
   * EGT: 200 – 1,050 °C
   * Oil Pressure: 10 – 90 PSI
   * Oil Temperature: 20 – 140 °C
   * Fuel Flow: 0 – 60 L/hr
   * MAP: 10 – 50 inHg
2. **Dynamic Slew-Rate Check**: Flags unphysical step changes exceeding maximum mechanical rates of change:
   $$\Delta x / \Delta t > \text{MaxSlewRate}$$
3. **Temporal Variance / Freeze-Stagnation Check**: Computes signal variance over a 12-sample sliding window:
   $$\text{Var}(X) = \frac{1}{N} \sum_{i=1}^N (x_i - \bar{x})^2$$
   If $\text{Var}(X) < 0.005$ while engine speed and load are dynamically varying, the sensor is classified as **FROZEN / QUARANTINED**.
4. **Cross-Sensor Physical Correlation**: Validates thermodynamic couplings:
   * Real lubrication loss: Oil Pressure drops **AND** Oil Temperature rises **AND** Vibration RMS rises.
   * Transducer freeze: Oil Pressure flatlines **WHILE** Oil Temperature and Vibration remain nominal.

---

## 3. Physics Expected-State Model

Aero Twin features a transparent, operating-condition-aware engine physics model based on ISA standard atmosphere and thermodynamic equilibrium:

### Atmospheric Equilibrium Equations:
* Standard Ambient Pressure at Altitude ($h$ in feet):
  $$P_{\text{amb}} = 29.92 \times \left(1 - 6.875 \times 10^{-6} \times h\right)^{5.256} \text{ inHg}$$
* ISA Standard Ambient Temperature:
  $$T_{\text{amb}} = 15 - (0.00198 \times h) + T_{\text{mod}} \text{ °C}$$
* Relative Density Ratio:
  $$\sigma = \left(\frac{P_{\text{amb}}}{29.92}\right) \times \left(\frac{288.15}{T_{\text{amb}} + 273.15}\right)$$

### Engine Parameter Baselines:
* **Expected RPM**: Governed by throttle demand and mission phase governor:
  $$\text{RPM}_{\text{exp}} = 1800 + (\text{Throttle} \times 3600)$$
* **Expected MAP**: Ambient pressure plus turbocharger boost ratio:
  $$\text{MAP}_{\text{exp}} = P_{\text{amb}} + (19.0 \times \text{Throttle} \times \sqrt{\sigma})$$
* **Expected Fuel Flow Rate**:
  $$\dot{m}_{f,\text{exp}} = 34.0 \times \text{Load} \times \left(\frac{\text{RPM}}{5000}\right) \times \sigma^{0.25} \text{ L/hr}$$
* **Expected Thermal State (EGT & CHT)**:
  $$\text{EGT}_{\text{exp}} = 720 + (\text{Load} \times 85) + \Delta T_{\text{hot weather}} \text{ °C}$$
  $$\text{CHT}_{\text{exp}} = 145 + (\text{Load} \times 28) + \Delta T_{\text{cooling penalty}} \text{ °C}$$
* **Expected Oil Pressure**:
  $$P_{\text{oil,exp}} = 38 + \left(\frac{\text{RPM}}{5000} \times 18\right) - \max\left(0, (T_{\text{oil}} - 85) \times 0.12\right) \text{ PSI}$$

---

## 4. Operating Residuals Calculation

For each parameter, real-time operating residuals are calculated:
$$\text{Residual}_i = \text{Actual}_i - \text{Expected}_i$$
$$\text{NormalizedResidual}_i = \frac{\text{Residual}_i}{\text{NominalRange}_i}$$

### Sensor Trust Shielding Rule:
If a sensor is quarantined by the Sensor Trust Layer (e.g. frozen oil pressure sensor at 52.4 PSI), its residual is **shielded**:
$$\text{Residual}_{\text{oilPress}} = 0.0 \text{ PSI (Shielded)}$$
This guarantees that instrumentation failure does not propagate into false mechanical engine residuals.

---

## 5. Machine Learning Architecture

The system employs a dual-stage ML architecture trained on 4,000 synthetic aero-engine flight profile samples:

1. **Isolation Forest (Unsupervised Anomaly Detector)**:
   * 100 Isolation Trees, sub-sample size: 256.
   * Path length normalization: $c(256) = 10.245$.
   * Computes multi-dimensional anomaly score:
     $$s(x, n) = 2^{-\frac{E(h(x))}{c(n)}}$$
   * Decision boundary calibrated at 0.25 anomaly threshold.
2. **Random Forest Multiclass Classifier**:
   * 50 Decision Trees, maximum depth: 10.
   * Features: RPM, CHT avg, EGT avg, Oil Pressure, Oil Temp, Fuel Flow, MAP, Vibration RMS.
   * Classification labels:
     1. `HEALTHY` (Baseline Cruise Equilibrium)
     2. `SENSOR_FAULT` (Transducer Freeze / Decoupling)
     3. `THERMAL_DEGRADATION` (Cylinder Combustion Runaway)
     4. `LUBRICATION_DEGRADATION` (Pump Cavitation & Bearing Stress)
     5. `RPM_INSTABILITY` (Speed Governor Hunting)
   * Benchmark metrics (synthetic evaluation): **99.2% Accuracy, 99.1% Precision, 99.0% Recall, 99.0% F1-score**.

---

## 6. Engine Health Index (EHI) Deterministic Formula

EHI is an inspectable, bounded index from 0 to 100:

$$\text{EHI} = \max\left(15, \min\left(99.0, 96.5 - \left(P_{\text{thermal}} + P_{\text{lubrication}} + P_{\text{vibration}}\right) + S_{\text{shield}}\right)\right)$$

Where:
* **Thermal Penalty**:
  $$P_{\text{thermal}} = \min\left(28, \frac{\Delta\text{CHT}}{30} \times 25\right) + \min\left(28, \frac{\Delta\text{EGT}}{70} \times 25\right)$$
* **Lubrication Penalty** (only applied if oil pressure sensor is **TRUSTED**):
  $$P_{\text{lubrication}} = \min\left(35, \frac{\Delta P_{\text{oil}}}{20} \times 35\right) + \min\left(20, \frac{\max(0, T_{\text{oil}} - 98)}{15} \times 20\right)$$
* **Vibration Penalty**:
  $$P_{\text{vibration}} = \min\left(20, \frac{\max(0, \text{Vib}_{\text{RMS}} - 2.5)}{1.5} \times 20\right)$$
* **Sensor Shield Bonus** ($S_{\text{shield}}$):
  When a sensor is quarantined, its unphysical penalty is completely eliminated, holding EHI stable at ~94–96/100.

---

## 7. Degradation & Prognostics Model

Degradation is tracked through a cumulative thermal-stress and mechanical wear model:
$$\text{DegradationScore}(t) = \text{Deg}_{\text{baseline}} + \int_0^t \alpha \cdot \exp\left(\frac{T_{\text{cyl}} - T_{\text{threshold}}}{T_{\text{scale}}}\right) dt$$
* Nominal baseline wear rate: ~4% degradation.
* Thermal runaway accelerates wear up to 35–45%.
* In sensor faults, degradation remains nominal (4%) because the physical engine is intact.

---

## 8. Upgraded RUL Range & Confidence Model

Rather than outputting a single unrealistic number, Aero Twin outputs a probabilistic prognostic estimate:

* **Estimated RUL**: Derived from the degradation wear rate:
  $$\text{RUL} = \max\left(12, \text{round}\left(190 \times \left(1 - \frac{\text{DegradationPct}}{100}\right)^{1.35}\right)\right)$$
* **Uncertainty Range**: Calculated dynamically via standard error margin:
  $$\text{RUL}_{\text{min}} = \text{round}(\text{RUL} \times 0.90), \quad \text{RUL}_{\text{max}} = \text{round}(\text{RUL} \times 1.10)$$
  * Example Nominal: `182 h [172–192 h]`
  * Example Thermal Overheat: `48 h [43–53 h]`
* **Model Confidence**: Evaluated based on sensor trust, trend stability, and anomaly consistency:
  $$\text{Confidence} = \text{round}(88 \times \text{OverallTrust} \times \text{TrendStability}) = 92\%$$

---

## 9. Mission Reliability Enhancement (SIH26054 Core Capability)

Mission Reliability is a real-time, deterministic decision-support metric combining health, remaining useful life, sensor uncertainty, and mission duration:

$$\text{Score} = \text{round}\left(C_{\text{EHI}} + M_{\text{RUL}} + T_{\text{sensor}} - R_{\text{active}}\right)$$

* **EHI Contribution** ($C_{\text{EHI}} \in [0, 50]$):
  $$C_{\text{EHI}} = \frac{\text{EHI}}{100} \times 50$$
* **RUL Safety Margin** ($M_{\text{RUL}} \in [0, 25]$):
  * $\text{RUL} \ge 10 \times \text{MissionHours} \implies 25 \text{ pts}$
  * $\text{RUL} \ge 3 \times \text{MissionHours} \implies 18 \text{ pts}$
  * $\text{RUL} \ge \text{MissionHours} \implies 10 \text{ pts}$
  * $\text{RUL} < \text{MissionHours} \implies 0 \text{ pts}$
* **Sensor Trust Component** ($T_{\text{sensor}} \in [0, 15]$):
  $$T_{\text{sensor}} = \text{OverallTrust} \times 15$$
* **Active Operational Risk Deduction** ($R_{\text{active}}$):
  * `HEALTHY`: $0–4 \text{ pts}$
  * `SENSOR_FAULT`: $8 \text{ pts}$ (Instrument uncertainty; engine integrity protected)
  * `THERMAL_DEGRADATION`: $38 \text{ pts}$ (Combustion runaway)
  * `LUBRICATION_DEGRADATION`: $65 \text{ pts}$ (Bearing seizure risk)

### Status Categorization:
* **$\ge 85\%$**: `NOMINAL (GO)` — Full mission continuation
* **$70 - 84\%$**: `ADVISORY (CAUTION)` — Continue with heightened monitoring
* **$50 - 69\%$**: `WARNING (DERATE)` — Reduce throttle to loiter equilibrium
* **$< 50\%$**: `CRITICAL (ABORT / DIVERT)` — Execute RTB or divert to emergency strip

---

## 10. Environmental Modifiers (P1)

Three controlled environmental modifiers directly modulate the thermodynamic physics engine:
1. **High Altitude (25,000 FT)**: Lowers ambient pressure ($P_{\text{amb}} = 11.1 \text{ inHg}$) and air density ratio ($\sigma = 0.448$), reducing manifold pressure and shifting expected engine operating equilibrium.
2. **Hot Weather (+38°C Ambient)**: Imposes heat exchanger cooling penalties, shifting expected baseline CHT by +17°C and EGT by +13°C.
3. **Rapid Throttle Step (40% $\to$ 88%)**: Models transient lag characteristics across 4.0 seconds rather than instantaneous unphysical step changes.

---

## 11. Controlled Fault Injection Scenarios

Operators can select from 6 standardized scenarios with a **Severity Control Slider (10% to 100%)**:
1. `Normal Mission`: Full sensor trust (1.00), low residuals, nominal EHI (96), RUL 182h, Mission Reliability GO.
2. `Sensor Freeze`: Oil pressure flatlines at 52.4 PSI. Sensor Trust quarantines the channel (0.28). EHI remains protected at 96.
3. `Sensor Drift`: Cylinder 4 CHT thermistor drifts unphysically (+45°C) without correlated EGT rise. Sensor quarantined.
4. `Thermal Degradation`: Multi-cylinder combustion thermal runaway. EGT rises +90°C, CHT follows (+19°C). EHI drops to 48, RUL drops to 48h, Mission Reliability drops to 26% (ABORT).
5. `Lubrication Degradation`: Oil pressure drop accompanied by oil temperature spike and bearing vibration surge.
6. `RPM Instability`: Speed governor hunting and ignition timing flutter.

---

## 12. Mission Timeline Replay

* Full 60-second flight mission recorder log at 10 Hz.
* Milestone event markers:
  * `00:00`: Normal Cruise
  * `01:20`: Sensor Drift
  * `02:05`: Thermal Anomaly
  * `02:31`: Fault Classification
  * `03:00`: EHI Downward Revision
  * `03:15`: RUL Updated
* **No State Leakage**: Scrubbing the timeline reconstructs telemetry, sensor trust, residuals, EHI, RUL, Mission Reliability, and 3D engine state in perfect synchronization.

---

## 13. Gemini AI Assistant Grounded Architecture

The AI Engine Assistant utilizes Google Gemini via `/api/gemini` (with a local deterministic fallback if no API key is provided).

### Grounding Rules:
* Gemini is strictly an **explanation and operator advisory layer**; it is **never** the engineering source of truth.
* All prompts sent to Gemini include the full snapshot of `window.appState`:
  * Sensor trust per-channel scores & quarantine list
  * Physics expected state & calculated residuals
  * Isolation Forest anomaly score & Random Forest diagnosis
  * Deterministic EHI breakdown & RUL range
  * Mission reliability score & maintenance advisory
* Gemini is instructed to explain situations using the **BAD SENSOR ≠ BAD ENGINE** principle and deterministic maintenance procedures without inventing unverified procedures.

---

## 14. Deterministic Maintenance Advisory Mapping

Aero Twin provides deterministic, rule-based maintenance recommendations:

| Diagnostic Fault | Target Subsystem | Priority | Recommended Action | Code | Urgency |
|:---|:---|:---|:---|:---|:---|
| `HEALTHY` | All Subsystems Nominal | ROUTINE | Standard pre-flight inspection at next turnaround (T-2h cycle). | `MAINT-001-NOM` | Scheduled 50h |
| `SENSOR_FAULT` | Avionics / Oil Pressure Transducer | MEDIUM (INSTRUMENT ONLY) | Inspect oil pressure transducer wiring harness, sensor pin continuity, and transducer calibration. Engine overhaul NOT required. | `MAINT-SEN-042` | Next Turnaround |
| `THERMAL_DEGRADATION` | Cooling & Combustion (Cylinders 1-4) | HIGH (INSPECT BEFORE SORTIE) | Perform borescope inspection of cylinder heads, examine cooling air baffles for obstruction, inspect exhaust runner gaskets, verify fuel injector spray patterns. | `MAINT-THM-108` | Immediate Debrief |
| `LUBRICATION_DEGRADATION` | Lubrication System & Main Bearings | CRITICAL (GROUND AIRCRAFT) | Ground aircraft immediately. Inspect oil filter for metallic particulate/swarf (SOAP analysis), check oil pump pressure relief valve, inspect scavenge suction screen. | `MAINT-LUB-911` | IMMEDIATE |
| `RPM_INSTABILITY` | Governor & Dual Magneto / Ignition | HIGH | Inspect propeller governor linkage and oil supply passage. Check magneto timing synchronization and spark plug gap wear. | `MAINT-GOV-204` | < 10 Flight Hours |

---

## 15. Telemetry Adapter Architecture & Real Telemetry Ingestion Path

Aero Twin abstracts telemetry ingestion through `TelemetryAdapter`:

```
┌─────────────────────────┐
│     Simulator Engine    ├──────┐
└─────────────────────────┘      │
┌─────────────────────────┐      │      ┌─────────────────────────┐      ┌─────────────────────────┐
│  Hardware Bridge CAN/RS ├──────┼─────►│    TelemetryAdapter     ├─────►│     Aero Twin Core      │
└─────────────────────────┘      │      │ (Normalizes Telemetry)  │      │     (Pipeline Engine)   │
┌─────────────────────────┐      │      └─────────────────────────┘      └─────────────────────────┘
│ REST API (/api/telem)   ├──────┘
└─────────────────────────┘
```

### Ingestion Interface (`POST /api/telemetry`):
```json
{
  "rpm": 4200,
  "map": 33.2,
  "fuelFlow": 24.2,
  "oilPress": 52.4,
  "oilTemp": 88.5,
  "cht": [166.5, 164.8, 169.2, 165.4],
  "egt": [780, 776, 792, 779],
  "vibrationRms": 1.75,
  "altitude": 18000,
  "throttle": 0.72
}
```

---

## 16. Verification & Automated Testing Suite

All capabilities are accompanied by automated verification tools in `dev-tools/`:

1. **Full System Audit**:
   ```bash
   node dev-tools/full_system_audit.js
   ```
   Validates classes, data sources, 3D view buttons, modals, AI assistant Q&A, scenario switching, and timeline scrubbing in headless Chrome.

2. **SIH26054 Technical Depth & Hardening Test**:
   ```bash
   node dev-tools/test_sih_hardening.js
   ```
   Validates physics residuals, mission reliability score dynamics, RUL range and confidence, sensor freeze quarantine and EHI shielding, severity slider scaling, environmental modifiers, and zero uncaught exceptions.

3. **Visual User Verification**:
   ```bash
   node dev-tools/visual_user_verification.js
   ```
   Captures full-fidelity PNG artifacts across all scenarios, timeline replay, and 3D cutaway inspection.

---

## 17. Quickstart Guide

### Option A: Direct Node Server (Full Digital Twin + Groq AI Assistant)

> [!IMPORTANT]
> **Groq Cloud API Key Required**: A valid `GROQ_API_KEY` is required for the AI Engine Assistant. Get your free high-speed LPU API key at [console.groq.com](https://console.groq.com/).

```bash
# 1. Clone the repository
git clone https://github.com/Gagguverse/aero-twin-sih-2026.git
cd aero-twin-sih-2026

# 2. Install dependencies
npm install

# 3. Create environment file from template
copy .env.example .env    # On Windows
# cp .env.example .env     # On Linux / macOS

# 4. Add your valid Groq Cloud API key into .env:
# GROQ_API_KEY=gsk_your_groq_api_key_here
# GROQ_MODEL=openai/gpt-oss-120b

# 5. Start the server
npm start
```
Open **`http://localhost:3000/`** in your web browser.

### Option B: Standalone Web Delivery
Open `dist/index.html` directly in your browser. All 3D WebGL renderers, physics residual solvers, Sensor Trust layers, and neural classifiers execute client-side. The AI Assistant requires the backend Node server with `GROQ_API_KEY`.

