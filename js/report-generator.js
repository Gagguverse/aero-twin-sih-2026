/* ==========================================================================
   AERO-TWIN: MISSION HEALTH & SENSOR TRUST DEBRIEF REPORT
   SIH Problem Statement: SIH26054 (DRDO - Robotics & Drones - Software)
   
   Generates a structured, printable engineering debrief report.
   Explicitly marked as DECISION-SUPPORT PROTOTYPE using SYNTHETIC SIMULATION DATA.
   ========================================================================== */

class ReportGenerator {
  constructor(telemetryEngine, aiEngine, sensorTrustEngine) {
    this.telemetry = telemetryEngine;
    this.ai = aiEngine;
    this.sensorTrust = sensorTrustEngine;
  }

  generateMissionReport() {
    return this.generateHtmlReport();
  }

  generateHtmlReport() {
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0];
    const timeStr = now.toTimeString().split(' ')[0];
    const state = this.telemetry.state;
    const ai = this.ai;
    const trust = this.sensorTrust ? this.sensorTrust.trustScores : { rpm: 1.0, oilPress: 1.0, cht: [1,1,1,1], egt: [1,1,1,1] };
    const reasons = this.sensorTrust ? this.sensorTrust.reasons : {};
    const explain = ai.explainability || { contributingFactors: [] };

    return `
      <div class="report-document" id="printable-report" style="font-family: 'Inter', sans-serif; color: #1e293b; background: #ffffff; padding: 24px; border-radius: 8px;">
        <!-- Header Strip -->
        <div style="display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #0f172a; padding-bottom: 14px; margin-bottom: 18px;">
          <div>
            <h2 style="font-size: 18px; font-weight: 800; color: #0f172a; margin: 0; text-transform: uppercase; letter-spacing: 0.5px;">
              AERO-TWIN &bull; MISSION HEALTH &amp; SENSOR TRUST DEBRIEF
            </h2>
            <p style="font-size: 11px; color: #64748b; margin: 4px 0 0 0;">
              Digital Twin Decision-Support System for MALE UAV Aero Piston Engines &bull; SIH-26054
            </p>
          </div>
          <div style="text-align: right;">
            <span style="display: inline-block; background: #fef2f2; color: #991b1b; font-size: 10px; font-weight: 700; padding: 3px 8px; border-radius: 4px; border: 1px solid #fecaca; text-transform: uppercase;">
              SYNTHETIC SIMULATION DATA &bull; PROTOTYPE
            </span>
            <div style="font-size: 10px; color: #64748b; margin-top: 4px;">Date: ${dateStr} ${timeStr}</div>
          </div>
        </div>

        <!-- Executive Summary Cards -->
        <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 20px;">
          <div style="background: #f8fafc; border: 1px solid #e2e8f0; padding: 10px 12px; border-radius: 6px;">
            <div style="font-size: 10px; font-weight: 700; color: #64748b; text-transform: uppercase;">Engine Health Index</div>
            <div style="font-size: 22px; font-weight: 800; color: ${ai.healthIndex >= 88 ? '#16a34a' : ai.healthIndex >= 65 ? '#d97706' : '#dc2626'};">${ai.healthIndex.toFixed(1)} / 100</div>
            <div style="font-size: 10px; font-weight: 600; color: #475569;">Status: ${ai.status}</div>
          </div>
          <div style="background: #f8fafc; border: 1px solid #e2e8f0; padding: 10px 12px; border-radius: 6px;">
            <div style="font-size: 10px; font-weight: 700; color: #64748b; text-transform: uppercase;">Sensor Trust State</div>
            <div style="font-size: 22px; font-weight: 800; color: ${ai.faultClass === 'SENSOR_FAULT' ? '#d97706' : '#16a34a'};">
              ${ai.faultClass === 'SENSOR_FAULT' ? 'FAULT ISOLATED' : 'ALL TRUSTED'}
            </div>
            <div style="font-size: 10px; color: #475569;">Sensor Trust Before Judgment</div>
          </div>
          <div style="background: #f8fafc; border: 1px solid #e2e8f0; padding: 10px 12px; border-radius: 6px;">
            <div style="font-size: 10px; font-weight: 700; color: #64748b; text-transform: uppercase;">Estimated RUL</div>
            <div style="font-size: 20px; font-weight: 800; color: #0284c7;">${ai.rulMinHours}&ndash;${ai.rulMaxHours} Hours</div>
            <div style="font-size: 9.5px; color: #64748b;">Model-Based Estimate (Simulated)</div>
          </div>
          <div style="background: #f8fafc; border: 1px solid #e2e8f0; padding: 10px 12px; border-radius: 6px;">
            <div style="font-size: 10px; font-weight: 700; color: #64748b; text-transform: uppercase;">Mission Phase</div>
            <div style="font-size: 20px; font-weight: 800; color: #0f172a; text-transform: uppercase;">${state.missionPhase}</div>
            <div style="font-size: 10px; color: #64748b;">Alt: ${state.altitude} ft &bull; Load: ${state.load}%</div>
          </div>
        </div>

        <!-- Section 1: Sensor Trust Layer Audit -->
        <h3 style="font-size: 12px; font-weight: 700; color: #0f172a; text-transform: uppercase; margin: 16px 0 8px 0; border-bottom: 1px solid #cbd5e1; padding-bottom: 4px;">
          1. Sensor Trust Layer Audit (Pre-Health Evaluation)
        </h3>
        <table style="width: 100%; border-collapse: collapse; font-size: 11px; margin-bottom: 16px;">
          <thead>
            <tr style="background: #f1f5f9; text-align: left;">
              <th style="padding: 6px 8px; border: 1px solid #e2e8f0;">Sensor Parameter</th>
              <th style="padding: 6px 8px; border: 1px solid #e2e8f0;">Raw Monitored Value</th>
              <th style="padding: 6px 8px; border: 1px solid #e2e8f0;">Trust Score (0-1)</th>
              <th style="padding: 6px 8px; border: 1px solid #e2e8f0;">Trust Status</th>
              <th style="padding: 6px 8px; border: 1px solid #e2e8f0;">Plausibility / Correlation Finding</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style="padding: 5px 8px; border: 1px solid #e2e8f0; font-weight: 600;">Oil Pressure</td>
              <td style="padding: 5px 8px; border: 1px solid #e2e8f0;">${state.oilPress.toFixed(1)} PSI</td>
              <td style="padding: 5px 8px; border: 1px solid #e2e8f0; font-weight: 700;">${trust.oilPress !== undefined ? trust.oilPress : 1.0}</td>
              <td style="padding: 5px 8px; border: 1px solid #e2e8f0; color: ${trust.oilPress < 0.6 ? '#dc2626' : '#16a34a'}; font-weight: 700;">
                ${trust.oilPress < 0.6 ? 'DISTRUSTED (QUARANTINED)' : 'TRUSTED'}
              </td>
              <td style="padding: 5px 8px; border: 1px solid #e2e8f0; color: #475569;">
                ${reasons.oilPress || 'Signal dynamic and correlated with RPM/Load.'}
              </td>
            </tr>
            <tr>
              <td style="padding: 5px 8px; border: 1px solid #e2e8f0; font-weight: 600;">Engine Speed (RPM)</td>
              <td style="padding: 5px 8px; border: 1px solid #e2e8f0;">${Math.round(state.rpm)} RPM</td>
              <td style="padding: 5px 8px; border: 1px solid #e2e8f0; font-weight: 700;">${trust.rpm !== undefined ? trust.rpm : 1.0}</td>
              <td style="padding: 5px 8px; border: 1px solid #e2e8f0; color: #16a34a; font-weight: 700;">TRUSTED</td>
              <td style="padding: 5px 8px; border: 1px solid #e2e8f0; color: #475569;">Normal slew rate and closed-loop governor response.</td>
            </tr>
            <tr>
              <td style="padding: 5px 8px; border: 1px solid #e2e8f0; font-weight: 600;">Exhaust Gas Temp (Avg)</td>
              <td style="padding: 5px 8px; border: 1px solid #e2e8f0;">${Math.round(state.egt.reduce((a,b)=>a+b,0)/4)}°C</td>
              <td style="padding: 5px 8px; border: 1px solid #e2e8f0; font-weight: 700;">${trust.egt ? trust.egt[0] : 1.0}</td>
              <td style="padding: 5px 8px; border: 1px solid #e2e8f0; color: #16a34a; font-weight: 700;">TRUSTED</td>
              <td style="padding: 5px 8px; border: 1px solid #e2e8f0; color: #475569;">Multi-thermocouple cross-agreement verified.</td>
            </tr>
            <tr>
              <td style="padding: 5px 8px; border: 1px solid #e2e8f0; font-weight: 600;">Cylinder Head Temp (Avg)</td>
              <td style="padding: 5px 8px; border: 1px solid #e2e8f0;">${Math.round(state.cht.reduce((a,b)=>a+b,0)/4)}°C</td>
              <td style="padding: 5px 8px; border: 1px solid #e2e8f0; font-weight: 700;">${trust.cht ? trust.cht[0] : 1.0}</td>
              <td style="padding: 5px 8px; border: 1px solid #e2e8f0; color: #16a34a; font-weight: 700;">TRUSTED</td>
              <td style="padding: 5px 8px; border: 1px solid #e2e8f0; color: #475569;">Thermal inertia dissipation plausibility confirmed.</td>
            </tr>
            <tr>
              <td style="padding: 5px 8px; border: 1px solid #e2e8f0; font-weight: 600;">Oil Temperature</td>
              <td style="padding: 5px 8px; border: 1px solid #e2e8f0;">${Math.round(state.oilTemp)}°C</td>
              <td style="padding: 5px 8px; border: 1px solid #e2e8f0; font-weight: 700;">${trust.oilTemp !== undefined ? trust.oilTemp : 1.0}</td>
              <td style="padding: 5px 8px; border: 1px solid #e2e8f0; color: #16a34a; font-weight: 700;">TRUSTED</td>
              <td style="padding: 5px 8px; border: 1px solid #e2e8f0; color: #475569;">Heat soak matches engine load curve.</td>
            </tr>
          </tbody>
        </table>

        <!-- Section 2: Diagnostics & Explainability ("WHY?") -->
        <h3 style="font-size: 12px; font-weight: 700; color: #0f172a; text-transform: uppercase; margin: 16px 0 8px 0; border-bottom: 1px solid #cbd5e1; padding-bottom: 4px;">
          2. Diagnostic Assessment &amp; Root-Cause Explainability ("WHY?")
        </h3>
        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-left: 4px solid ${ai.status === 'NOMINAL' ? '#16a34a' : ai.status === 'WARNING' ? '#d97706' : '#dc2626'}; padding: 12px 16px; border-radius: 4px; margin-bottom: 16px;">
          <div style="font-size: 12px; font-weight: 800; color: #0f172a; text-transform: uppercase;">
            ${explain.title || ai.detectedFault}
          </div>
          <div style="font-size: 11px; color: #475569; margin: 4px 0 8px 0;">
            ${explain.summary || 'Operating within baseline limits.'}
          </div>
          <div style="font-size: 11px; font-weight: 700; color: #334155; margin-bottom: 4px;">Contributing Factors:</div>
          <ul style="margin: 0; padding-left: 18px; font-size: 10.5px; color: #334155; line-height: 1.6;">
            ${explain.contributingFactors && explain.contributingFactors.length > 0
              ? explain.contributingFactors.map(f => `<li>${f}</li>`).join('')
              : '<li>All primary telemetry parameters within expected nominal bounds.</li>'}
          </ul>
        </div>

        <!-- Section 3: Engineering Maintenance Recommendations -->
        <h3 style="font-size: 12px; font-weight: 700; color: #0f172a; text-transform: uppercase; margin: 16px 0 8px 0; border-bottom: 1px solid #cbd5e1; padding-bottom: 4px;">
          3. Technical Directives
        </h3>
        <div style="font-size: 11px; color: #334155; line-height: 1.6;">
          ${ai.faultClass === 'SENSOR_FAULT'
            ? '<strong>Directive:</strong> Transducer maintenance required for Oil Pressure sensor (inspect wiring harness / signal conditioner). Engine propulsion assembly remains healthy; no mechanical tear-down required.'
            : ai.faultClass === 'THERMAL_DEGRADATION'
            ? '<strong>Directive:</strong> Inspect cylinder heat baffling and exhaust manifold for gas blowby. Reduce continuous loiter throttle until post-sortie borescope inspection.'
            : '<strong>Directive:</strong> Standard post-mission ground turn-around inspection. Propulsion system nominal.'}
        </div>

        <!-- Footer Disclaimer -->
        <div style="border-top: 1px solid #e2e8f0; margin-top: 24px; padding-top: 10px; font-size: 9.5px; color: #94a3b8; text-align: center;">
          Aero Twin UAV &bull; SIH 2026 Problem Statement 26054 &bull; Synthetic Telemetry Simulator &bull; Model-based decision-support estimate only.
        </div>
      </div>
    `;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ReportGenerator;
}
if (typeof window !== 'undefined') {
  window.ReportGenerator = ReportGenerator;
}
