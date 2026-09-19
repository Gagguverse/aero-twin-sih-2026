/* ==========================================================================
   AERO-TWIN: MALE UAV TACTICAL MISSION MAP & AUTONOMOUS CONTINGENCY SYSTEM
   DRDO Tapas-BH-201 Flight Envelope, Safe Recovery Corridor & Failsafe Derate
   SIH-2026 Problem Statement ID: 26054
   ========================================================================== */

class MissionPlanner {
  constructor(canvasId, telemetryEngine, aiEngine, soundFx) {
    this.canvas = document.getElementById(canvasId);
    if (!this.canvas) return;
    this.ctx = this.canvas.getContext('2d');
    this.telemetry = telemetryEngine;
    this.ai = aiEngine;
    this.soundFx = soundFx;

    this.dpr = window.devicePixelRatio || 1;
    this.width = 800;
    this.height = 600;

    // DRDO Tapas-BH-201 MALE UAV Mission State
    this.uav = {
      x: 460,
      y: 280,
      heading: 42, // Degrees
      speedKts: 118,
      altitude: 18000,
      tailNo: "DRDO-TAPAS-004",
      callsign: "GARUDA-04",
      missionType: "Border Loiter & Maritime ISR Sector Bravo"
    };

    // Flight Trail & Visual Effects
    this.trail = [];
    this.maxTrail = 28;
    this.radarSweepAngle = 0;
    this.isDiverting = false;
    this.divertTarget = null;
    this.hoveredBase = null;
    this.mousePos = { x: 0, y: 0 };
    this.isMouseOver = false;

    this.initCanvasSize();
    this.initInteractions();
    this.startRadarLoop();
  }

  initCanvasSize() {
    const parent = this.canvas.parentElement;
    if (!parent) return;
    const pw = parent.clientWidth || 800;
    const ph = parent.clientHeight || 550;

    this.width = pw;
    this.height = ph;
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.scale(this.dpr, this.dpr);
  }

  initInteractions() {
    this.canvas.addEventListener('mousemove', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      this.mousePos = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top
      };
      this.isMouseOver = true;

      const bases = this.getBases();
      this.hoveredBase = bases.find(b => {
        const dx = b.x - this.mousePos.x;
        const dy = b.y - this.mousePos.y;
        return Math.sqrt(dx * dx + dy * dy) < 28;
      }) || null;

      if (this.hoveredBase) {
        this.canvas.style.cursor = 'pointer';
      } else {
        this.canvas.style.cursor = 'crosshair';
      }
    });

    this.canvas.addEventListener('mouseleave', () => {
      this.isMouseOver = false;
      this.hoveredBase = null;
      this.canvas.style.cursor = 'default';
    });

    this.canvas.addEventListener('click', () => {
      if (this.hoveredBase) {
        this.divertTo(this.hoveredBase);
      }
    });

    // Touch Event Support for Mobile & Tablet Devices
    const handleTouch = (e) => {
      if (!e.touches || e.touches.length === 0) return;
      const rect = this.canvas.getBoundingClientRect();
      this.mousePos = {
        x: e.touches[0].clientX - rect.left,
        y: e.touches[0].clientY - rect.top
      };
      this.isMouseOver = true;
      const bases = this.getBases();
      this.hoveredBase = bases.find(b => {
        const dx = b.x - this.mousePos.x;
        const dy = b.y - this.mousePos.y;
        return Math.sqrt(dx * dx + dy * dy) < 32;
      }) || null;
    };

    this.canvas.addEventListener('touchstart', (e) => {
      handleTouch(e);
      if (this.hoveredBase) {
        e.preventDefault();
        this.divertTo(this.hoveredBase);
      }
    }, { passive: false });

    this.canvas.addEventListener('touchmove', (e) => {
      handleTouch(e);
    }, { passive: true });

    this.canvas.addEventListener('touchend', () => {
      this.isMouseOver = false;
      this.hoveredBase = null;
    });
  }

  startRadarLoop() {
    const loop = () => {
      // Dynamic auto-resize check
      const parent = this.canvas.parentElement;
      if (parent && parent.clientWidth > 0) {
        if (Math.abs(parent.clientWidth - this.width) > 2 || Math.abs(parent.clientHeight - this.height) > 2) {
          this.initCanvasSize();
        }
      }

      try {
        this.updateMissionPhysics();
        this.render();
      } catch (err) {
        console.warn('MissionPlanner render error:', err);
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  getBases() {
    const cx = this.width / 2;
    const cy = this.height / 2;
    return [
      {
        id: 'alpha',
        name: "BASE ALPHA (AFS Uttarlai)",
        shortName: "AFS UTTARLAI",
        x: cx - 180,
        y: cy + 130,
        runway: "09/27 - 9,000 FT",
        rwyHeading: 90,
        elevation: "510 FT MSL",
        freq: "128.45 MHz",
        isHome: true
      },
      {
        id: 'bravo',
        name: "STRIP BRAVO (Deesa FLS)",
        shortName: "DEESA FLS",
        x: cx + 70,
        y: cy + 150,
        runway: "14/32 - 6,500 FT",
        rwyHeading: 140,
        elevation: "480 FT MSL",
        freq: "122.80 MHz",
        isDivert: true
      },
      {
        id: 'charlie',
        name: "BASE CHARLIE (Bhuj AFS)",
        shortName: "BHUJ AFS",
        x: cx - 250,
        y: cy + 200,
        runway: "05/23 - 8,200 FT",
        rwyHeading: 50,
        elevation: "260 FT MSL",
        freq: "125.10 MHz",
        isDivert: true
      }
    ];
  }

  getWaypoints() {
    const cx = this.width / 2;
    const cy = this.height / 2;
    return [
      { name: "WP-ALPHA (BARMER)", x: cx - 120, y: cy + 40 },
      { name: "WP-BRAVO (SANCHORE)", x: cx - 30, y: cy - 30 },
      { name: "WP-PATROL-1 (SECTOR-B)", x: cx + 100, y: cy - 90 },
      { name: "WP-PATROL-2 (THAR DESERT)", x: cx + 180, y: cy - 10 },
      { name: "WP-LOITER (FORWARD ORBIT)", x: cx + 90, y: cy + 60 }
    ];
  }

  updateMissionPhysics() {
    this.radarSweepAngle = (this.radarSweepAngle + 0.02) % (Math.PI * 2);
    const cx = this.width / 2;
    const cy = this.height / 2;

    if (this.isDiverting) {
      const target = this.divertTarget || this.getBases()[1];
      const targetX = target.x;
      const targetY = target.y;
      const dx = targetX - this.uav.x;
      const dy = targetY - this.uav.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist > 12) {
        const angle = Math.atan2(dy, dx);
        this.uav.heading = (angle * (180 / Math.PI) + 90) % 360;
        this.uav.x += Math.cos(angle) * 0.7;
        this.uav.y += Math.sin(angle) * 0.7;
        this.uav.speedKts = 104; // Best glide L/D speed
        this.uav.altitude = Math.max(2500, this.uav.altitude - 3.5);
      } else {
        // Approaching threshold
        this.uav.speedKts = 88;
        this.uav.altitude = Math.max(1200, this.uav.altitude - 1.5);
      }
    } else {
      // Nominal loiter orbit around WP-LOITER sector
      const orbitAngle = Date.now() * 0.00035;
      this.uav.x = cx + 90 + Math.cos(orbitAngle) * 95;
      this.uav.y = cy - 15 + Math.sin(orbitAngle) * 65;
      this.uav.heading = (orbitAngle * (180 / Math.PI) + 90) % 360;
      this.uav.speedKts = 118;
      this.uav.altitude = (this.telemetry && this.telemetry.altitude) ? this.telemetry.altitude : 18000;
    }

    // Record breadcrumb flight trail
    if (this.trail.length === 0 || Date.now() - (this.trail[this.trail.length - 1].t || 0) > 400) {
      this.trail.push({ x: this.uav.x, y: this.uav.y, t: Date.now() });
      if (this.trail.length > this.maxTrail) {
        this.trail.shift();
      }
    }

    // Update Live Radar HUD Badge
    const spdAltEl = document.getElementById('map-hud-spd-alt');
    if (spdAltEl) {
      spdAltEl.textContent = `${Math.round(this.uav.speedKts)} KTS • ${Math.round(this.uav.altitude).toLocaleString()} FT`;
    }

    // Update dynamic recovery metrics in DOM
    this.updateRecoveryBasesMetrics();
  }

  updateRecoveryBasesMetrics() {
    const bases = this.getBases();
    const health = (this.ai && this.ai.healthIndex !== undefined) ? this.ai.healthIndex : 95;
    const isOverheat = this.telemetry && this.telemetry.cht && this.telemetry.cht[2] > 210;
    const isCutoff = this.telemetry && this.telemetry.fuelWallOpen === false;

    // Scale: 1 pixel ~ 0.85 KM
    const kmPerPx = 0.85;

    // Reach in KM
    let reachKm = 220;
    if (isCutoff) reachKm = 85;
    else if (isOverheat) reachKm = 135;
    else reachKm = Math.round(75 + (health / 100) * 145);

    const reachHud = document.getElementById('map-hud-reach');
    if (reachHud) {
      reachHud.textContent = `~${reachKm} KM (${isCutoff ? 'GLIDE ONLY' : isOverheat ? 'DERATED' : 'NOMINAL'})`;
      reachHud.className = isCutoff ? 'val highlight-crimson' : isOverheat ? 'val highlight-amber' : 'val highlight-emerald';
    }

    bases.forEach(b => {
      const dx = b.x - this.uav.x;
      const dy = b.y - this.uav.y;
      const pxDist = Math.sqrt(dx * dx + dy * dy);
      const distKm = Math.round(pxDist * kmPerPx);
      const speedKmH = this.uav.speedKts * 1.852;
      const etaMin = Math.round((distKm / Math.max(1, speedKmH)) * 60);

      const distEl = document.getElementById(`base-dist-${b.id}`);
      const etaEl = document.getElementById(`base-eta-${b.id}`);
      const statusEl = document.getElementById(`base-status-${b.id}`);

      if (distEl) distEl.textContent = `${distKm} KM`;
      if (etaEl) etaEl.textContent = `${etaMin} MIN`;

      if (statusEl) {
        if (distKm <= reachKm) {
          if (b.isHome) {
            statusEl.textContent = '🟢 IN GLIDE RANGE';
            statusEl.className = 'base-reach-status safe';
          } else if (b.id === 'bravo') {
            statusEl.textContent = '🟢 PRIMARY RECOVERY';
            statusEl.className = 'base-reach-status safe';
          } else {
            statusEl.textContent = '🟢 IN POWERED RANGE';
            statusEl.className = 'base-reach-status safe';
          }
        } else {
          statusEl.textContent = '❌ OUT OF GLIDE RANGE';
          statusEl.className = 'base-reach-status crit';
        }
      }
    });
  }

  divertTo(targetBase) {
    this.isDiverting = true;
    this.divertTarget = targetBase || this.getBases()[1];
    if (this.soundFx) this.soundFx.playCaution();

    const statusBadge = document.getElementById('map-mission-status-badge');
    if (statusBadge) {
      statusBadge.textContent = `DIVERTING: ${this.divertTarget.shortName || this.divertTarget.name.split('(')[0].trim()}`;
      statusBadge.className = 'badge badge-critical';
    }

    // Highlight target base in sidebar list
    const allCards = document.querySelectorAll('.base-row-card');
    allCards.forEach(c => c.classList.remove('active-target'));
    const targetCard = document.getElementById(`base-card-${this.divertTarget.id}`);
    if (targetCard) targetCard.classList.add('active-target');
  }

  executeFailsafeDerate() {
    const bases = this.getBases();
    // Derate engine power to safe thermal equilibrium and vector to Strip Bravo
    if (this.telemetry) {
      this.telemetry.setThrottle(0.62);
      this.telemetry.setFault('cylHeatBias', [0, 0, 8, 0]);
      if (this.telemetry.state && this.telemetry.state.cht) {
        this.telemetry.state.cht[2] = 168;
      }
    }
    this.divertTo(bases[1]); // Strip Bravo (Deesa FLS)

    const statusBadge = document.getElementById('map-mission-status-badge');
    if (statusBadge) {
      statusBadge.textContent = `AUTONOMOUS DERATE: DEESA FLS (HDG 194°)`;
      statusBadge.className = 'badge badge-warning';
    }
  }

  // 1-Click Test Scenarios & Reset
  reset() {
    this.testNominal();
  }

  testNominal() {
    this.isDiverting = false;
    this.divertTarget = null;
    this.uav.altitude = 18000;
    this.uav.speedKts = 118;

    if (this.telemetry) {
      this.telemetry.setFuelWall(true);
      this.telemetry.setThrottle(0.85);
      this.telemetry.clearAllFaults();
    }
    if (this.soundFx) this.soundFx.playChirp();

    const statusBadge = document.getElementById('map-mission-status-badge');
    if (statusBadge) {
      statusBadge.textContent = 'ISR SECTOR ACTIVE';
      statusBadge.className = 'badge badge-nominal';
    }

    const allCards = document.querySelectorAll('.base-row-card');
    allCards.forEach(c => c.classList.remove('active-target'));
  }

  testOverheat() {
    this.isDiverting = false; // Stay in orbit so user sees recovery circle contract!
    this.divertTarget = null;
    if (this.telemetry) {
      this.telemetry.setFuelWall(true);
      this.telemetry.setThrottle(0.90);
      this.telemetry.setFault('cylHeatBias', [0, 0, 60, 0]); // Trigger Cylinder #3 heat spike
      if (this.telemetry.state && this.telemetry.state.cht) {
        this.telemetry.state.cht[2] = 232;
      }
    }
    if (this.soundFx) this.soundFx.playCaution();

    const statusBadge = document.getElementById('map-mission-status-badge');
    if (statusBadge) {
      statusBadge.textContent = `THERMAL ALERT: CYL #3 OVERHEAT (232°C)`;
      statusBadge.className = 'badge badge-critical';
    }

    const allCards = document.querySelectorAll('.base-row-card');
    allCards.forEach(c => c.classList.remove('active-target'));
    const targetCard = document.getElementById('base-card-bravo');
    if (targetCard) targetCard.classList.add('active-target');
  }

  testFlameout() {
    this.isDiverting = true;
    this.divertTarget = this.getBases()[1]; // Deadstick glide to Deesa
    if (this.telemetry) {
      this.telemetry.setFuelWall(false); // Cut fuel firewall valve
      this.telemetry.state.rpm = 1200;
    }
    if (this.soundFx) this.soundFx.playAlarm();

    const statusBadge = document.getElementById('map-mission-status-badge');
    if (statusBadge) {
      statusBadge.textContent = `DEAD-STICK GLIDE: DEESA FLS`;
      statusBadge.className = 'badge badge-critical';
    }

    const allCards = document.querySelectorAll('.base-row-card');
    allCards.forEach(c => c.classList.remove('active-target'));
    const targetCard = document.getElementById('base-card-bravo');
    if (targetCard) targetCard.classList.add('active-target');
  }

  centerOnUAV() {
    this.uavLockPulse = Date.now() + 2500;
    if (this.soundFx) this.soundFx.playClick();
  }

  render() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.width, this.height);

    // 1. Geographic Background (Terrain, Border Demarcation, Coastline)
    this.renderGeographicTerrain();

    // 2. Radar Polar Grid & Range Rings
    this.renderRadarGrid();

    // 3. Flight Paths & Waypoints
    this.renderFlightPlan();

    // 4. Dynamic Recovery Corridor / Gliding & Powered Reach Circle
    this.renderRecoveryCorridor();

    // 5. Airbases & Detailed Runways
    this.renderBases();

    // 6. Emergency Diversion Line (If diverting)
    if (this.isDiverting) {
      this.renderEmergencyVector();
    }

    // 7. UAV Flight Trail Breadcrumbs
    this.renderFlightTrail();

    // 8. Detailed DRDO Tapas-BH-201 MALE UAV Airframe
    this.renderUAV();

    // 9. Radar Sweep Line & Tactical Compass Rose
    this.renderRadarSweep();
    this.renderTacticalCompass();
    this.renderScaleLegend();
  }

  renderGeographicTerrain() {
    const ctx = this.ctx;
    ctx.save();
    const cx = this.width / 2;
    const cy = this.height / 2;

    // A. Coastal Outline (Rann of Kutch & Arabian Coast - Southwest)
    ctx.beginPath();
    ctx.moveTo(0, cy + 110);
    ctx.bezierCurveTo(cx - 300, cy + 130, cx - 220, cy + 180, cx - 190, cy + 240);
    ctx.bezierCurveTo(cx - 160, cy + 280, cx - 110, cy + 320, cx - 80, this.height);
    ctx.lineTo(0, this.height);
    ctx.closePath();
    ctx.fillStyle = 'rgba(10, 30, 60, 0.45)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(0, 240, 255, 0.2)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Coastline Label
    ctx.fillStyle = 'rgba(0, 240, 255, 0.35)';
    ctx.font = '8px "JetBrains Mono", monospace';
    ctx.fillText('RANN OF KUTCH / ARABIAN GULF COAST', 14, cy + 185);

    // B. Indo-Pak Western Border Demarcation Line
    ctx.beginPath();
    ctx.strokeStyle = '#eab308';
    ctx.lineWidth = 1.6;
    ctx.setLineDash([8, 6, 2, 6]);
    ctx.moveTo(cx - 160, 0);
    ctx.lineTo(cx - 80, cy - 140);
    ctx.lineTo(cx + 40, cy - 80);
    ctx.lineTo(cx + 140, cy - 160);
    ctx.lineTo(cx + 280, cy - 110);
    ctx.stroke();
    ctx.setLineDash([]);

    // Border Label
    ctx.fillStyle = '#eab308';
    ctx.font = 'bold 8.5px "Orbitron", monospace';
    ctx.fillText('--- WESTERN INTERNATIONAL BORDER (IB) ---', cx - 20, cy - 120);

    // Border Checkposts
    const borderPosts = [
      { name: "BP-612", x: cx - 80, y: cy - 140 },
      { name: "BP-740", x: cx + 40, y: cy - 80 },
      { name: "BP-890", x: cx + 140, y: cy - 160 }
    ];
    borderPosts.forEach(bp => {
      ctx.fillStyle = '#eab308';
      ctx.fillRect(bp.x - 3, bp.y - 3, 6, 6);
      ctx.fillStyle = 'rgba(234, 179, 8, 0.8)';
      ctx.font = '7.5px "JetBrains Mono", monospace';
      ctx.fillText(bp.name, bp.x + 6, bp.y + 2);
    });

    // C. Restricted Airspace Zone VA(R)-104
    ctx.beginPath();
    ctx.moveTo(cx + 20, cy - 60);
    ctx.lineTo(cx + 170, cy - 70);
    ctx.lineTo(cx + 210, cy + 20);
    ctx.lineTo(cx + 60, cy + 40);
    ctx.closePath();
    ctx.fillStyle = 'rgba(239, 68, 68, 0.04)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(239, 68, 68, 0.35)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = 'rgba(239, 68, 68, 0.55)';
    ctx.font = '8px "Orbitron", monospace';
    ctx.fillText('RESTRICTED AIRSPACE VA(R)-104', cx + 70, cy - 10);

    // D. Lat/Long Graticule Grid Coordinates
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
    ctx.lineWidth = 1;
    [0.25, 0.5, 0.75].forEach(frac => {
      const gx = this.width * frac;
      const gy = this.height * frac;
      ctx.beginPath();
      ctx.moveTo(gx, 0); ctx.lineTo(gx, this.height);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, gy); ctx.lineTo(this.width, gy);
      ctx.stroke();

      ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
      ctx.font = '8px "JetBrains Mono", monospace';
      ctx.fillText(`${Math.round(70 + frac * 2)}°00'E`, gx + 3, this.height - 8);
      ctx.fillText(`${Math.round(26 - frac * 2)}°00'N`, 4, gy - 3);
    });

    ctx.restore();
  }

  renderRadarGrid() {
    const ctx = this.ctx;
    ctx.save();
    const cx = this.width / 2;
    const cy = this.height / 2;

    ctx.strokeStyle = 'rgba(0, 240, 255, 0.08)';
    ctx.lineWidth = 1;

    // Range rings (50km, 100km, 150km, 200km, 250km)
    const rings = [65, 130, 195, 260, 325];
    rings.forEach((r, idx) => {
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();

      ctx.fillStyle = 'rgba(0, 240, 255, 0.35)';
      ctx.font = '8.5px "JetBrains Mono", monospace';
      ctx.fillText(`${(idx + 1) * 50} KM`, cx + r + 4, cy - 4);
    });

    // Crosshairs
    ctx.beginPath();
    ctx.moveTo(cx, 0); ctx.lineTo(cx, this.height);
    ctx.moveTo(0, cy); ctx.lineTo(this.width, cy);
    ctx.stroke();

    ctx.restore();
  }

  renderFlightPlan() {
    const ctx = this.ctx;
    ctx.save();
    const wps = this.getWaypoints();

    // Waypoint connection lines
    ctx.strokeStyle = 'rgba(0, 240, 255, 0.35)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 5]);

    ctx.beginPath();
    wps.forEach((wp, idx) => {
      if (idx === 0) ctx.moveTo(wp.x, wp.y);
      else ctx.lineTo(wp.x, wp.y);
    });
    ctx.closePath();
    ctx.stroke();
    ctx.setLineDash([]);

    // Waypoint dots & text
    wps.forEach(wp => {
      ctx.fillStyle = '#00f0ff';
      ctx.beginPath();
      ctx.arc(wp.x, wp.y, 4, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
      ctx.font = '8.5px "JetBrains Mono", monospace';
      ctx.fillText(wp.name, wp.x + 7, wp.y + 3);
    });

    ctx.restore();
  }

  renderRecoveryCorridor() {
    const ctx = this.ctx;
    ctx.save();

    // Safe recovery reach circle based on live Health Index & fuel
    const health = (this.ai && this.ai.healthIndex !== undefined) ? this.ai.healthIndex : 95;
    const isOverheat = this.telemetry && this.telemetry.cht && this.telemetry.cht[2] > 210;
    const isCutoff = this.telemetry && this.telemetry.fuelWallOpen === false;

    let recoveryRadius = 60 + (health / 100) * 140;
    if (isCutoff) recoveryRadius = 70; // 85 km deadstick glide
    else if (isOverheat) recoveryRadius = 110; // 130 km derated

    const isCritical = isCutoff || isOverheat || health < 60;
    ctx.fillStyle = isCritical ? 'rgba(239, 68, 68, 0.08)' : 'rgba(16, 185, 129, 0.06)';
    ctx.strokeStyle = isCritical ? 'rgba(239, 68, 68, 0.7)' : 'rgba(16, 185, 129, 0.5)';
    ctx.lineWidth = 2;
    ctx.setLineDash(isCritical ? [6, 4] : []);

    ctx.beginPath();
    ctx.arc(this.uav.x, this.uav.y, recoveryRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.setLineDash([]);

    // Dynamic Safe Reach Radius Tag
    ctx.fillStyle = isCritical ? '#ef4444' : '#10b981';
    ctx.font = 'bold 9.5px "Orbitron", monospace';
    const tagText = isCutoff 
      ? `🚨 EMERGENCY DEAD-STICK GLIDE: ~${Math.round(recoveryRadius * 1.2)} KM` 
      : isOverheat
        ? `⚠️ THERMAL DERATE REACH: ~${Math.round(recoveryRadius * 1.2)} KM`
        : `🟢 NOMINAL SAFE RECOVERY: ~${Math.round(recoveryRadius * 1.2)} KM`;
    ctx.fillText(tagText, this.uav.x - recoveryRadius + 10, this.uav.y - 10);

    ctx.restore();
  }

  renderBases() {
    const ctx = this.ctx;
    ctx.save();
    const bases = this.getBases();

    bases.forEach(b => {
      const isTarget = this.isDiverting && this.divertTarget && this.divertTarget.id === b.id;
      const isHovered = this.hoveredBase && this.hoveredBase.id === b.id;

      // Draw Runway orientation strip
      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.rotate((b.rwyHeading * Math.PI) / 180);

      // Runway tarmac rectangle
      ctx.fillStyle = isTarget ? '#ef4444' : '#334155';
      ctx.fillRect(-18, -3, 36, 6);
      ctx.strokeStyle = isHovered ? '#00f0ff' : '#94a3b8';
      ctx.lineWidth = 1;
      ctx.strokeRect(-18, -3, 36, 6);

      // Runway centerline dashed line
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 0.8;
      ctx.setLineDash([3, 2]);
      ctx.beginPath();
      ctx.moveTo(-16, 0); ctx.lineTo(16, 0);
      ctx.stroke();
      ctx.setLineDash([]);

      // Extended glide path cone
      ctx.fillStyle = isTarget ? 'rgba(239, 68, 68, 0.15)' : 'rgba(0, 240, 255, 0.08)';
      ctx.beginPath();
      ctx.moveTo(-18, 0);
      ctx.lineTo(-45, -10);
      ctx.lineTo(-45, 10);
      ctx.closePath();
      ctx.fill();

      ctx.restore();

      // Base marker icon
      ctx.fillStyle = b.isHome ? '#10b981' : '#f59e0b';
      ctx.strokeStyle = isHovered ? '#00f0ff' : '#fff';
      ctx.lineWidth = isHovered ? 2 : 1;
      ctx.fillRect(b.x - 5, b.y - 5, 10, 10);
      ctx.strokeRect(b.x - 5, b.y - 5, 10, 10);

      // Active diversion pulsing reticle
      if (isTarget) {
        ctx.strokeStyle = '#ef4444';
        ctx.lineWidth = 2;
        const pulseR = 16 + Math.sin(Date.now() * 0.008) * 5;
        ctx.beginPath();
        ctx.arc(b.x, b.y, pulseR, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Hover highlight reticle
      if (isHovered) {
        ctx.strokeStyle = '#00f0ff';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(b.x, b.y, 18, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Base Labels
      ctx.fillStyle = isHovered ? '#00f0ff' : '#fff';
      ctx.font = 'bold 9.5px "Orbitron", monospace';
      ctx.fillText(b.name, b.x + 14, b.y - 2);

      ctx.fillStyle = 'rgba(148, 163, 184, 0.9)';
      ctx.font = '8px "JetBrains Mono", monospace';
      ctx.fillText(`RWY ${b.runway} | ELEV: ${b.elevation}`, b.x + 14, b.y + 10);

      // Hover Interactive Popover Box
      if (isHovered) {
        ctx.fillStyle = 'rgba(8, 16, 32, 0.95)';
        ctx.strokeStyle = '#00f0ff';
        ctx.lineWidth = 1;
        ctx.fillRect(b.x + 14, b.y + 16, 170, 42);
        ctx.strokeRect(b.x + 14, b.y + 16, 170, 42);

        ctx.fillStyle = '#00f0ff';
        ctx.font = 'bold 8.5px "Orbitron", monospace';
        ctx.fillText(`TOWER FREQ: ${b.freq}`, b.x + 20, b.y + 30);

        ctx.fillStyle = '#f59e0b';
        ctx.font = 'bold 8px "JetBrains Mono", monospace';
        ctx.fillText('👉 CLICK AIRFIELD TO DIVERT', b.x + 20, b.y + 46);
      }
    });

    ctx.restore();
  }

  renderEmergencyVector() {
    const ctx = this.ctx;
    ctx.save();
    const target = this.divertTarget || this.getBases()[1];
    const targetX = target.x;
    const targetY = target.y;

    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 2.5;
    ctx.setLineDash([8, 4]);
    ctx.lineDashOffset = -Date.now() * 0.025;

    ctx.beginPath();
    ctx.moveTo(this.uav.x, this.uav.y);
    ctx.lineTo(targetX, targetY);
    ctx.stroke();

    // Bearing label along vector
    const midX = (this.uav.x + targetX) / 2;
    const midY = (this.uav.y + targetY) / 2;
    ctx.fillStyle = '#f59e0b';
    ctx.font = 'bold 9px "Orbitron", monospace';
    ctx.fillText(`EMERGENCY VECTOR -> ${target.shortName || target.name.split('(')[0].trim()}`, midX + 12, midY);

    ctx.restore();
  }

  renderFlightTrail() {
    const ctx = this.ctx;
    if (this.trail.length < 2) return;
    ctx.save();

    for (let i = 0; i < this.trail.length; i++) {
      const p = this.trail[i];
      const alpha = (i / this.trail.length) * 0.45;
      const size = 1.5 + (i / this.trail.length) * 2;

      ctx.fillStyle = `rgba(0, 240, 255, ${alpha})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, size, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  renderUAV() {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(this.uav.x, this.uav.y);

    // 1. Tactical Halo / Pulse Glow behind aircraft
    const haloRadius = 26 + Math.sin(Date.now() * 0.005) * 4;
    ctx.fillStyle = 'rgba(0, 240, 255, 0.08)';
    ctx.beginPath();
    ctx.arc(0, 0, haloRadius, 0, Math.PI * 2);
    ctx.fill();

    // Tactical Target Lock Reticle (when Center UAV is engaged)
    if (this.uavLockPulse && Date.now() < this.uavLockPulse) {
      const remainingMs = this.uavLockPulse - Date.now();
      const alpha = Math.min(1.0, remainingMs / 600);
      const angle = (Date.now() * 0.003) % (Math.PI * 2);
      const reticleRadius = 42 + Math.sin(Date.now() * 0.01) * 3;

      ctx.save();
      ctx.strokeStyle = `rgba(0, 240, 255, ${0.85 * alpha})`;
      ctx.lineWidth = 1.8;

      // Rotating dashed targeting ring
      ctx.beginPath();
      ctx.arc(0, 0, reticleRadius, 0, Math.PI * 2);
      ctx.stroke();

      // 4 Corner Brackets
      const bSize = 14;
      const bDist = reticleRadius + 8;
      // Top-Left
      ctx.beginPath();
      ctx.moveTo(-bDist, -bDist + bSize); ctx.lineTo(-bDist, -bDist); ctx.lineTo(-bDist + bSize, -bDist);
      ctx.stroke();
      // Top-Right
      ctx.beginPath();
      ctx.moveTo(bDist - bSize, -bDist); ctx.lineTo(bDist, -bDist); ctx.lineTo(bDist, -bDist + bSize);
      ctx.stroke();
      // Bottom-Left
      ctx.beginPath();
      ctx.moveTo(-bDist, bDist - bSize); ctx.lineTo(-bDist, bDist); ctx.lineTo(-bDist + bSize, bDist);
      ctx.stroke();
      // Bottom-Right
      ctx.beginPath();
      ctx.moveTo(bDist - bSize, bDist); ctx.lineTo(bDist, bDist); ctx.lineTo(bDist, bDist - bSize);
      ctx.stroke();

      // Tactical HUD Text
      ctx.font = 'bold 9px "Orbitron", monospace';
      ctx.fillStyle = `rgba(0, 240, 255, ${0.95 * alpha})`;
      ctx.textAlign = 'center';
      ctx.fillText('⚡ TARGET LOCKED • GARUDA-04', 0, -bDist - 6);

      ctx.font = '8px "JetBrains Mono", monospace';
      ctx.fillStyle = `rgba(203, 213, 225, ${0.9 * alpha})`;
      ctx.fillText('HDG: ' + Math.round(this.uav.heading) + '° • 18,000 FT', 0, bDist + 14);

      ctx.restore();
    }

    // 2. Forward Sensor Vision Cone (EO/IR Gimbal & Weather Radar)
    ctx.save();
    ctx.rotate((this.uav.heading * Math.PI) / 180);

    const grad = ctx.createRadialGradient(0, -18, 5, 0, -90, 85);
    grad.addColorStop(0, 'rgba(0, 240, 255, 0.22)');
    grad.addColorStop(1, 'rgba(0, 240, 255, 0.0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(0, -14);
    ctx.lineTo(-35, -95);
    ctx.lineTo(35, -95);
    ctx.closePath();
    ctx.fill();

    // 3. DRDO TAPAS-BH-201 HIGH-DETAIL AIRFRAME MODEL
    // Fuselage Body
    ctx.fillStyle = '#0f1f38';
    ctx.strokeStyle = '#00f0ff';
    ctx.lineWidth = 1.6;

    ctx.beginPath();
    ctx.moveTo(0, -22); // Nose radome tip
    ctx.bezierCurveTo(5, -16, 7, 0, 6, 12);
    ctx.lineTo(-6, 12);
    ctx.bezierCurveTo(-7, 0, -5, -16, 0, -22);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Nose EO/IR Gimbal Turret Ball
    ctx.fillStyle = '#00f0ff';
    ctx.beginPath();
    ctx.arc(0, -21, 3.5, 0, Math.PI * 2);
    ctx.fill();

    // Long MALE High-Aspect-Ratio Wings (Span: ~60px)
    ctx.fillStyle = '#16294a';
    ctx.strokeStyle = '#00f0ff';
    ctx.lineWidth = 1.4;

    ctx.beginPath();
    ctx.moveTo(0, -5);
    ctx.lineTo(32, -1);
    ctx.lineTo(31, 4);
    ctx.lineTo(6, 3);
    ctx.lineTo(6, 10);
    ctx.lineTo(-6, 10);
    ctx.lineTo(-6, 3);
    ctx.lineTo(-31, 4);
    ctx.lineTo(-32, -1);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Wingtips / Winglets
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(32, -1); ctx.lineTo(33, -7);
    ctx.moveTo(-32, -1); ctx.lineTo(-33, -7);
    ctx.stroke();

    // Twin Booms extending rearward
    ctx.strokeStyle = '#00f0ff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(-12, 4); ctx.lineTo(-12, 22);
    ctx.moveTo(12, 4); ctx.lineTo(12, 22);
    ctx.stroke();

    // Inverted V-Tail (Ruddervators)
    ctx.beginPath();
    ctx.moveTo(-16, 26);
    ctx.lineTo(0, 18);
    ctx.lineTo(16, 26);
    ctx.strokeStyle = '#00f0ff';
    ctx.lineWidth = 1.8;
    ctx.stroke();

    // Center Rear Engine Bay (115 HP Aero Piston Engine Nacelle)
    ctx.fillStyle = '#f59e0b';
    ctx.fillRect(-4, 6, 8, 8);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1;
    ctx.strokeRect(-4, 6, 8, 8);

    // Spinning 3-Blade Pusher Propeller
    const propTime = Date.now() * 0.04;
    ctx.save();
    ctx.translate(0, 15);
    // Propeller motion blur disc
    ctx.fillStyle = 'rgba(245, 158, 11, 0.25)';
    ctx.beginPath();
    ctx.arc(0, 0, 11, 0, Math.PI * 2);
    ctx.fill();

    // Rotating propeller blades
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 1.8;
    for (let i = 0; i < 3; i++) {
      const bAngle = propTime + (i * Math.PI * 2) / 3;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(bAngle) * 11, Math.sin(bAngle) * 11);
      ctx.stroke();
    }
    ctx.restore();

    // Navigation Strobe Lights (Blinking)
    const isStrobeOn = Math.sin(Date.now() * 0.007) > 0;
    // Left Wing: Red
    ctx.fillStyle = isStrobeOn ? '#ef4444' : '#551111';
    ctx.beginPath(); ctx.arc(-32, 2, 2.5, 0, Math.PI * 2); ctx.fill();
    // Right Wing: Green
    ctx.fillStyle = isStrobeOn ? '#10b981' : '#114422';
    ctx.beginPath(); ctx.arc(32, 2, 2.5, 0, Math.PI * 2); ctx.fill();
    // Tail: White Strobe
    if (Math.floor(Date.now() / 450) % 2 === 0) {
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(0, 22, 2, 0, Math.PI * 2); ctx.fill();
    }

    ctx.restore(); // Restore heading rotation

    // 4. Tactical Callout Tag Badge floating next to UAV
    ctx.fillStyle = 'rgba(8, 16, 32, 0.9)';
    ctx.strokeStyle = 'rgba(0, 240, 255, 0.4)';
    ctx.lineWidth = 1;
    ctx.fillRect(36, -26, 175, 48);
    ctx.strokeRect(36, -26, 175, 48);

    // Callout text
    ctx.fillStyle = '#00f0ff';
    ctx.font = 'bold 10px "Orbitron", monospace';
    ctx.fillText(`${this.uav.callsign} • DRDO TAPAS-BH-201`, 42, -12);

    ctx.fillStyle = '#ffffff';
    ctx.font = '8.5px "JetBrains Mono", monospace';
    ctx.fillText(`ALT: ${Math.round(this.uav.altitude)} FT | SPD: ${this.uav.speedKts} KTS`, 42, 2);

    ctx.fillStyle = '#f59e0b';
    ctx.font = '8px "JetBrains Mono", monospace';
    ctx.fillText(`HDG: ${Math.round(this.uav.heading).toString().padStart(3, '0')}° | PROPULSION: 115HP PUSHER`, 42, 14);

    // Leader line to aircraft center
    ctx.strokeStyle = 'rgba(0, 240, 255, 0.5)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(24, -14);
    ctx.lineTo(36, -14);
    ctx.stroke();

    ctx.restore();
  }

  renderRadarSweep() {
    const ctx = this.ctx;
    ctx.save();
    const cx = this.width / 2;
    const cy = this.height / 2;
    const r = Math.max(this.width, this.height) * 0.65;

    const sx = cx + Math.cos(this.radarSweepAngle) * r;
    const sy = cy + Math.sin(this.radarSweepAngle) * r;

    ctx.strokeStyle = 'rgba(0, 240, 255, 0.25)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(sx, sy);
    ctx.stroke();

    // Radar sweep wedge trail
    const trailAngle = 0.35;
    const grad = ctx.createRadialGradient(cx, cy, 10, cx, cy, r);
    grad.addColorStop(0, 'rgba(0, 240, 255, 0.15)');
    grad.addColorStop(1, 'rgba(0, 240, 255, 0.0)');

    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, this.radarSweepAngle - trailAngle, this.radarSweepAngle);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
  }

  renderTacticalCompass() {
    const ctx = this.ctx;
    ctx.save();
    const compX = this.width - 48;
    const compY = 48;
    const compR = 30;

    // Outer ring
    ctx.strokeStyle = 'rgba(0, 240, 255, 0.3)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(compX, compY, compR, 0, Math.PI * 2);
    ctx.stroke();

    // Degree tick marks
    for (let deg = 0; deg < 360; deg += 30) {
      const rad = (deg * Math.PI) / 180;
      const innerR = (deg % 90 === 0) ? compR - 6 : compR - 3;
      ctx.beginPath();
      ctx.moveTo(compX + Math.cos(rad) * innerR, compY + Math.sin(rad) * innerR);
      ctx.lineTo(compX + Math.cos(rad) * compR, compY + Math.sin(rad) * compR);
      ctx.stroke();
    }

    // Cardinal Points
    ctx.fillStyle = '#00f0ff';
    ctx.font = 'bold 9px "Orbitron", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('N', compX, compY - compR + 8);
    ctx.fillText('S', compX, compY + compR - 8);
    ctx.fillText('E', compX + compR - 8, compY);
    ctx.fillText('W', compX - compR + 8, compY);

    // Aircraft Heading Needle
    ctx.save();
    ctx.translate(compX, compY);
    ctx.rotate((this.uav.heading * Math.PI) / 180);

    // Needle arrow
    ctx.fillStyle = '#ef4444';
    ctx.beginPath();
    ctx.moveTo(0, -18);
    ctx.lineTo(4, 0);
    ctx.lineTo(-4, 0);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#94a3b8';
    ctx.beginPath();
    ctx.moveTo(0, 14);
    ctx.lineTo(3, 0);
    ctx.lineTo(-3, 0);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
    ctx.restore();
  }

  renderScaleLegend() {
    const ctx = this.ctx;
    ctx.save();
    const lx = this.width - 150;
    const ly = this.height - 18;

    // Scale bar: 60px = 50 KM
    ctx.strokeStyle = 'rgba(0, 240, 255, 0.6)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(lx, ly); ctx.lineTo(lx + 60, ly);
    ctx.moveTo(lx, ly - 4); ctx.lineTo(lx, ly + 4);
    ctx.moveTo(lx + 60, ly - 4); ctx.lineTo(lx + 60, ly + 4);
    ctx.stroke();

    ctx.fillStyle = '#00f0ff';
    ctx.font = '8px "JetBrains Mono", monospace';
    ctx.fillText('50 KM (SCALE)', lx + 8, ly - 6);

    ctx.restore();
  }
}

window.MissionPlanner = MissionPlanner;
