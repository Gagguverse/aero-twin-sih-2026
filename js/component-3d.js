/**
 * Subsystem3DViewer - Dedicated High-Fidelity 3D CAD Component Inspector
 * DRDO MALE UAV Propulsion Digital Twin (SIH 2026 - PS 26054)
 * Provides isolated, ultra-detailed 3D interactive models for every subsystem:
 * Cylinder & Piston, Turbocharger, Crankshaft, Oil System, Fuel Rail, PRSU Gearbox.
 */

class Subsystem3DViewer {
  constructor(canvasId = 'subsystem-cad-canvas') {
    this.canvas = typeof canvasId === 'string' ? document.getElementById(canvasId) : canvasId;
    if (!this.canvas) {
      console.warn('Subsystem3DViewer: Canvas not found:', canvasId);
      return;
    }
    this.ctx = this.canvas.getContext('2d');

    // Camera & Viewport State
    this.cam = {
      rotX: 0.35,
      rotY: -0.65,
      zoom: 1.35,
      panX: 0,
      panY: 0,
      targetRotX: 0.35,
      targetRotY: -0.65,
      targetZoom: 1.35,
      targetPanX: 0,
      targetPanY: 0,
      isDragging: false,
      lastMouseX: 0,
      lastMouseY: 0
    };

    // Subsystem selection ('cyl1'..'cyl4', 'turbo', 'crankshaft', 'oil_system', 'fuel_system', 'gearbox')
    this.activeKey = 'cyl3';
    this.viewMode = 'solid'; // 'solid', 'cutaway', 'exploded', 'wireframe'
    this.autoRotate = true;
    this.explodedFactor = 0; // 0 (assembled) to 1.0 (fully exploded)
    this.targetExplodedFactor = 0;
    this.showAnatomyLabels = true; // Interactive 3D component annotations
    this.speedMultiplier = 0.05; // Default slow-mo for crystal clear component motion
    this.isPaused = false;

    // Kinematics & Telemetry
    this.crankAngle = 0;
    this.rpm = 4200;
    this.throttle = 0.75;
    this.turboSpoolAngle = 0;
    this.telemetry = {
      cht: [168, 165, 172, 166],
      egt: [780, 775, 792, 778],
      map: 34.5,
      oilPress: 52.4,
      oilTemp: 88.5,
      fuelFlow: 24.8,
      fuelRemainingKg: 184.2,
      fuelPressure: 43.5,
      fuelWallOpen: true,
      vibrationRms: 1.8
    };

    this.initCanvasSize();
    this.bindEvents();
    this.startLoop();
  }

  initCanvasSize() {
    const parent = this.canvas.parentElement;
    if (!parent) return;
    const rect = parent.getBoundingClientRect();
    this.dpr = window.devicePixelRatio || 1;

    let targetW = 600;
    let targetH = 360;

    if (rect.width === 0 && parent.clientWidth === 0) {
      if (!this.width) {
        targetW = 600;
        targetH = 360;
      } else {
        return;
      }
    } else {
      targetW = Math.round(rect.width > 0 ? rect.width : (parent.clientWidth || 600));
      targetH = Math.round(rect.height > 0 ? rect.height : (parent.clientHeight || 360));
    }

    if (this.width === targetW && this.height === targetH && this.canvas.width > 0) {
      return; // Already correct dimensions! Prevent resetting canvas state & flickering!
    }

    this.width = targetW;
    this.height = targetH;
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.scale(this.dpr, this.dpr);
  }

  bindEvents() {
    window.addEventListener('resize', () => this.initCanvasSize());

    this.canvas.addEventListener('mousedown', (e) => {
      this.cam.isDragging = true;
      this.cam.lastMouseX = e.clientX;
      this.cam.lastMouseY = e.clientY;
      this.autoRotate = false; // User manual control stops auto-rotation
      this.updateAutoRotateBtnUI();
    });

    window.addEventListener('mousemove', (e) => {
      if (!this.cam.isDragging) return;
      const dx = e.clientX - this.cam.lastMouseX;
      const dy = e.clientY - this.cam.lastMouseY;
      this.cam.targetRotY -= dx * 0.009;
      this.cam.targetRotX -= dy * 0.009;
      this.cam.targetRotX = Math.max(-1.4, Math.min(1.4, this.cam.targetRotX));
      this.cam.lastMouseX = e.clientX;
      this.cam.lastMouseY = e.clientY;
    });

    window.addEventListener('mouseup', () => {
      this.cam.isDragging = false;
    });

    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const zoomDelta = -e.deltaY * 0.0012;
      this.cam.targetZoom = Math.max(0.6, Math.min(2.8, this.cam.targetZoom + zoomDelta));
    }, { passive: false });

    // Touch support
    let touchStartX = 0, touchStartY = 0;
    this.canvas.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) {
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
        this.autoRotate = false;
        this.updateAutoRotateBtnUI();
      }
    });

    this.canvas.addEventListener('touchmove', (e) => {
      if (e.touches.length === 1) {
        const dx = e.touches[0].clientX - touchStartX;
        const dy = e.touches[0].clientY - touchStartY;
        this.cam.targetRotY -= dx * 0.012;
        this.cam.targetRotX -= dy * 0.012;
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
      }
    });
  }

  loadSubsystem(compKey) {
    this.activeKey = compKey;
    this.cam.targetPanX = 0;
    this.cam.targetPanY = 0;

    // Component-specific optimal framing
    if (compKey.startsWith('cyl')) {
      this.cam.targetRotX = 0.28;
      this.cam.targetRotY = -0.55;
      this.cam.targetZoom = 1.45;
    } else if (compKey === 'turbo') {
      this.cam.targetRotX = 0.40;
      this.cam.targetRotY = 0.85;
      this.cam.targetZoom = 1.50;
    } else if (compKey === 'crankshaft') {
      this.cam.targetRotX = 0.75;
      this.cam.targetRotY = -0.45;
      this.cam.targetZoom = 1.30;
    } else if (compKey === 'oil_system') {
      this.cam.targetRotX = 0.32;
      this.cam.targetRotY = -0.65;
      this.cam.targetZoom = 1.45;
      this.cam.targetPanY = -12;
    } else if (compKey === 'fuel_system') {
      this.cam.targetRotX = 0.45;
      this.cam.targetRotY = -0.60;
      this.cam.targetZoom = 1.40;
    } else if (compKey === 'gearbox') {
      this.cam.targetRotX = 0.30;
      this.cam.targetRotY = -0.85;
      this.cam.targetZoom = 1.45;
    } else if (compKey === 'uav_airframe') {
      this.cam.targetRotX = 0.35;
      this.cam.targetRotY = -0.75;
      this.cam.targetZoom = 0.95;
    }

    this.updateBadgeUI();
  }

  setViewMode(mode) {
    this.viewMode = mode;
    if (mode === 'exploded') {
      this.targetExplodedFactor = 1.0;
    } else {
      this.targetExplodedFactor = 0;
    }
  }

  toggleAutoRotate() {
    this.autoRotate = !this.autoRotate;
    this.updateAutoRotateBtnUI();
  }

  resetCamera() {
    this.loadSubsystem(this.activeKey);
  }

  updateAutoRotateBtnUI() {
    const btn = document.getElementById('btn-cad-autorotate');
    if (btn) btn.classList.toggle('active', this.autoRotate);
  }

  toggleAnatomyLabels() {
    this.showAnatomyLabels = !this.showAnatomyLabels;
    this.updateAnatomyBtnUI();
  }

  updateAnatomyBtnUI() {
    const btn = document.getElementById('btn-cad-anatomy');
    if (btn) btn.classList.toggle('active', this.showAnatomyLabels);
  }

  setKinematicSpeed(multiplier) {
    this.speedMultiplier = parseFloat(multiplier) || 0.05;
    this.isPaused = false;
    this.updateSpeedUI();
  }

  togglePause() {
    this.isPaused = !this.isPaused;
    this.updateSpeedUI();
  }

  stepCrankAngle(deltaDeg = 15) {
    this.isPaused = true;
    const deltaRad = (deltaDeg * Math.PI) / 180;
    this.crankAngle = (this.crankAngle + deltaRad + (Math.PI * 4)) % (Math.PI * 4);
    this.turboSpoolAngle = (this.turboSpoolAngle + deltaRad * 3.5 + (Math.PI * 2)) % (Math.PI * 2);
    this.updateSpeedUI();
  }

  updateSpeedUI() {
    const pills = document.querySelectorAll('#cad-speed-pills .speed-btn');
    pills.forEach(p => {
      const spd = parseFloat(p.getAttribute('data-speed'));
      p.classList.toggle('active', !this.isPaused && Math.abs(spd - this.speedMultiplier) < 0.005);
    });

    const pauseBtn = document.getElementById('btn-cad-pause-toggle');
    if (pauseBtn) {
      pauseBtn.innerHTML = this.isPaused ? '▶️ RESUME' : '⏸️ FREEZE';
      pauseBtn.classList.toggle('active', this.isPaused);
    }

    const slowMoBtn = document.getElementById('btn-cad-slowmo');
    if (slowMoBtn) {
      slowMoBtn.classList.toggle('active', !this.isPaused && this.speedMultiplier <= 0.05);
    }
  }

  toggleSlowMo() {
    if (this.speedMultiplier <= 0.05 && !this.isPaused) {
      this.setKinematicSpeed(1.0);
    } else {
      this.setKinematicSpeed(0.05);
    }
  }

  updateBadgeUI() {
    const badge = document.getElementById('cad-active-subsystem-title');
    const partTag = document.getElementById('cad-part-tag');
    const names = {
      cyl1: { title: 'CYLINDER & PISTON ASSEMBLY #1 (FRONT LEFT)', part: 'CEMILAC AERO-CYL-101 • 4-STROKE BOXER' },
      cyl2: { title: 'CYLINDER & PISTON ASSEMBLY #2 (FRONT RIGHT)', part: 'CEMILAC AERO-CYL-202 • 4-STROKE BOXER' },
      cyl3: { title: 'CYLINDER & PISTON ASSEMBLY #3 (REAR LEFT)', part: 'CEMILAC AERO-CYL-304 • KNOCK & CHT DETECTOR' },
      cyl4: { title: 'CYLINDER & PISTON ASSEMBLY #4 (REAR RIGHT)', part: 'CEMILAC AERO-CYL-404 • 4-STROKE BOXER' },
      turbo: { title: 'TURBOCHARGER & WASTEGATE ASSEMBLY', part: 'CEMILAC AERO-TC-914 • HIGH-ALTITUDE CENTRIFUGAL BOOST' },
      crankshaft: { title: '4-THROW COUNTERWEIGHTED CRANKSHAFT', part: 'CEMILAC AERO-CRK-400 • FORGED ALLOY & JOURNAL BEARINGS' },
      oil_system: { title: 'LUBRICATION PUMP, SUMP & FILTER', part: 'CEMILAC AERO-LUB-102 • GEROTOR POSITIVE DISPLACEMENT' },
      fuel_system: { title: 'FUEL INJECTION RAIL & FIREWALL VALVE', part: 'CEMILAC AERO-FW-100 • SOLENOID PULSED INJECTION' },
      gearbox: { title: 'PRSU PROPELLER REDUCTION GEARBOX', part: 'CEMILAC AERO-GB-243 • 2.43:1 HELICAL REDUCTION' },
      uav_airframe: { title: 'DRDO TAPAS-BH-201 MALE UAV (FULL AIRFRAME & PROPULSION)', part: 'DRDO / ADE • MEDIUM ALTITUDE LONG ENDURANCE (MALE) UAV' }
    };
    const info = names[this.activeKey] || names.cyl3;
    if (badge) badge.textContent = info.title;
    if (partTag) partTag.textContent = info.part;
  }

  updateTelemetry(telem) {
    this.telemetry = { ...this.telemetry, ...telem };
    this.rpm = telem.rpm !== undefined ? telem.rpm : this.rpm;
    this.throttle = telem.throttle !== undefined ? telem.throttle : this.throttle;
  }

  project(x, y, z) {
    const cosY = Math.cos(this.cam.rotY), sinY = Math.sin(this.cam.rotY);
    const x1 = x * cosY + z * sinY;
    const z1 = -x * sinY + z * cosY;

    const cosX = Math.cos(this.cam.rotX), sinX = Math.sin(this.cam.rotX);
    const y2 = y * cosX - z1 * sinX;
    const z2 = y * sinX + z1 * cosX;

    const fov = 420;
    const depth = z2 + 450;
    const scale = (fov / Math.max(depth, 80)) * this.cam.zoom;

    const screenX = this.width / 2 + x1 * scale + this.cam.panX;
    const screenY = this.height / 2 + y2 * scale + this.cam.panY;

    return { x: screenX, y: screenY, scale, z: z2 };
  }

  startLoop() {
    const loop = () => {
      const parent = this.canvas.parentElement;
      if (parent && parent.clientWidth > 0) {
        if (Math.abs(parent.clientWidth - this.width) > 6 || Math.abs(parent.clientHeight - this.height) > 6) {
          this.initCanvasSize();
        }
      }

      try {
        this.updatePhysics();
        this.render();
      } catch (err) {
        console.warn('Subsystem3DViewer render error:', err);
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  updatePhysics() {
    // Camera interpolation
    this.cam.rotX += (this.cam.targetRotX - this.cam.rotX) * 0.1;
    this.cam.rotY += (this.cam.targetRotY - this.cam.rotY) * 0.1;
    this.cam.zoom += (this.cam.targetZoom - this.cam.zoom) * 0.1;
    this.cam.panX += (this.cam.targetPanX - this.cam.panX) * 0.1;
    this.cam.panY += (this.cam.targetPanY - this.cam.panY) * 0.1;

    // Exploded factor interpolation
    this.explodedFactor += (this.targetExplodedFactor - this.explodedFactor) * 0.1;

    // Auto-rotation when idle
    if (this.autoRotate && !this.cam.isDragging) {
      this.cam.targetRotY -= 0.005;
    }

    // Kinematic speed with Slow-Motion & Freeze support (calibrated for easy reading)
    if (!this.isPaused) {
      // Calibrated rate: 1 full 720° cycle takes ~13.5s at default speedMultiplier (0.05)
      // That means each of the 4 strokes (180°) takes ~3.37 seconds!
      const baseEducationalRate = 0.045;
      const crankSpeed = (this.rpm / 60) * 2 * Math.PI * 0.016 * baseEducationalRate * this.speedMultiplier;
      this.crankAngle = (this.crankAngle + crankSpeed) % (Math.PI * 4);
      this.turboSpoolAngle = (this.turboSpoolAngle + crankSpeed * 3.5) % (Math.PI * 2);
    }
  }

  getComponentDetailedState() {
    const deg = Math.round((this.crankAngle * 180 / Math.PI) % 720);
    const key = this.activeKey;

    if (key.startsWith('cyl')) {
      const cylIdx = parseInt(key.replace('cyl', ''), 10) - 1;
      const cylOffsets = [0, 180, 360, 540];
      const cylDeg = (deg + cylOffsets[cylIdx]) % 720;
      const strokeIdx = Math.floor(cylDeg / 180); // 0: Intake, 1: Compression, 2: Power, 3: Exhaust
      const strokeDeg = cylDeg % 180;
      const cht = (this.telemetry.cht && this.telemetry.cht[cylIdx]) ? Math.round(this.telemetry.cht[cylIdx]) : 172;

      if (strokeIdx === 0) {
        return {
          badge: '⚡ INTAKE STROKE 💨',
          badgeClass: 'stroke-intake',
          degText: `${cylDeg}° / 720° (STROKE 1/4)`,
          headline: `CYLINDER #${cylIdx + 1} • FRESH CHARGE INDUCTION`,
          narration: `Piston descends from Top Dead Center (TDC) to Bottom Dead Center (BDC), creating negative chamber pressure. The intake poppet valve lifts 8.2mm, allowing atomized fuel-air mixture to fill the cylinder bore.`,
          chips: [
            { label: 'VALVES', val: 'INTAKE OPEN (8.2mm) • EXHAUST CLOSED' },
            { label: 'PISTON MOTION', val: 'DESCENDING (TDC ➔ BDC)' },
            { label: 'CYLINDER HEAD TEMP', val: `${cht}°C (NOMINAL <185°C)` },
            { label: 'INDUCTION PRESSURE', val: '-2.4 PSI VACUUM' },
            { label: 'CRANKPIN THROW', val: `THROW #${cylIdx + 1} AT ${strokeDeg}°` }
          ],
          compactSummary: `⚡ CYL #${cylIdx + 1}: INTAKE 💨 (${cylDeg}°) • VALVE OPEN • CHT: ${cht}°C`
        };
      } else if (strokeIdx === 1) {
        return {
          badge: '⚡ COMPRESSION STROKE ⚡',
          badgeClass: 'stroke-comp',
          degText: `${cylDeg}° / 720° (STROKE 2/4)`,
          headline: `CYLINDER #${cylIdx + 1} • CHARGE COMPRESSION (9.5:1 RATIO)`,
          narration: `Both intake and exhaust poppet valves are tightly sealed on stellite seats. Piston rises rapidly from BDC to TDC, compressing the trapped fuel-air charge to 9.5:1 ratio and superheating it for ignition.`,
          chips: [
            { label: 'VALVES', val: 'SEALED (INTAKE & EXHAUST TIGHT)' },
            { label: 'PISTON MOTION', val: 'RISING (BDC ➔ TDC COMPRESSION)' },
            { label: 'CYLINDER HEAD TEMP', val: `${cht}°C (COMPRESSION HEATING)` },
            { label: 'CHAMBER PRESSURE', val: `${(14.7 + strokeDeg * 0.12).toFixed(1)} BAR RISING` },
            { label: 'RING PACK SEAL', val: '3 COMPRESSION RINGS ENGAGED' }
          ],
          compactSummary: `⚡ CYL #${cylIdx + 1}: COMPRESSION ⚡ (${cylDeg}°) • VALVES SEALED • CHT: ${cht}°C`
        };
      } else if (strokeIdx === 2) {
        return {
          badge: '⚡ POWER STROKE 🔥',
          badgeClass: 'stroke-power',
          degText: `${cylDeg}° / 720° (STROKE 3/4)`,
          headline: `CYLINDER #${cylIdx + 1} • COMBUSTION EXPANSION WORK`,
          narration: `Dual aviation spark plugs fire at TDC. High-temperature flame front expands rapidly (~1480°C, 68 Bar), forcing piston downward and transmitting peak mechanical torque through connecting rod to crankshaft.`,
          chips: [
            { label: 'VALVES', val: 'BOTH SEALED (100% PRESSURE RETENTION)' },
            { label: 'PISTON MOTION', val: 'EXPANDING DOWNWARD (TDC ➔ BDC)' },
            { label: 'COMBUSTION FLAME', val: '~1480°C FLAME PEAK' },
            { label: 'CYLINDER HEAD TEMP', val: `${cht}°C (ACTIVE HEAT WORK)` },
            { label: 'PEAK WORK PRESSURE', val: '68.2 BAR EXPANDING FORCE' }
          ],
          compactSummary: `⚡ CYL #${cylIdx + 1}: POWER 🔥 (${cylDeg}°) • SPARK IGNITED • CHT: ${cht}°C`
        };
      } else {
        return {
          badge: '⚡ EXHAUST STROKE 💨',
          badgeClass: 'stroke-exhaust',
          degText: `${cylDeg}° / 720° (STROKE 4/4)`,
          headline: `CYLINDER #${cylIdx + 1} • BURNT GAS EVACUATION`,
          narration: `Exhaust poppet valve lifts 8.0mm open. Piston sweeps upward from BDC to TDC, scavenging hot burnt combustion gases through stainless exhaust runners into the turbocharger turbine scroll.`,
          chips: [
            { label: 'VALVES', val: 'EXHAUST OPEN (8.0mm) • INTAKE CLOSED' },
            { label: 'PISTON MOTION', val: 'SCAVENGING UPWARD (BDC ➔ TDC)' },
            { label: 'EXHAUST GAS TEMP', val: '780°C TO TURBO TURBINE' },
            { label: 'CYLINDER HEAD TEMP', val: `${cht}°C (COOLING FIN DISSIPATION)` },
            { label: 'BACKPRESSURE', val: '2.1 PSI NOMINAL FLOW' }
          ],
          compactSummary: `⚡ CYL #${cylIdx + 1}: EXHAUST 💨 (${cylDeg}°) • VALVE OPEN • CHT: ${cht}°C`
        };
      }
    }

    if (key === 'crankshaft') {
      const th1 = deg % 360;
      const th2 = (deg + 180) % 360;
      const th3 = (deg + 90) % 360;
      const th4 = (deg + 270) % 360;
      const strokeIdx = Math.floor(deg / 180) + 1;
      const vib = (this.telemetry.vibrationRms || 0.85).toFixed(2);
      const oilP = (this.telemetry.oilPress || 52.4).toFixed(1);

      let activeWork = '';
      let nar = '';
      if (deg < 180) {
        activeWork = 'CYL 3 POWER STROKE 🔥 • CYL 1 INTAKE';
        nar = 'Crankshaft rotates through Stroke 1. Cylinder 3 combustion forces Crankpin #3 downward, transmitting high torque to the shaft while Cylinder 1 draws fresh charge.';
      } else if (deg < 360) {
        activeWork = 'CYL 4 POWER STROKE 🔥 • CYL 1 COMPRESSION';
        nar = 'Crankshaft rotates through Stroke 2. Cylinder 4 power stroke drives Crankpin #4 while forged counterweights balance rotating reciprocating inertia.';
      } else if (deg < 540) {
        activeWork = 'CYL 1 POWER STROKE 🔥 • CYL 2 COMPRESSION';
        nar = 'Crankshaft enters 2nd revolution (Stroke 3). Cylinder 1 spark plug fires at TDC, exerting maximum downward thrust on Crankpin #1 to maintain shaft inertia.';
      } else {
        activeWork = 'CYL 2 POWER STROKE 🔥 • CYL 4 EXHAUST';
        nar = 'Crankshaft completes 720° 4-stroke cycle (Stroke 4). Cylinder 2 power stroke delivers rotational energy while Cylinder 4 expels burnt exhaust gases.';
      }

      return {
        badge: '⚡ 4-THROW CRANKSHAFT',
        badgeClass: 'stroke-crank',
        degText: `${deg}° / 720° (STROKE ${strokeIdx}/4)`,
        headline: 'FORGED ALLOY CRANKSHAFT • DYNAMIC BOXER BALANCE',
        narration: `${nar} Pressurized hydrodynamic oil film (${oilP} PSI) cushions bronze journal sleeves to eliminate metal-on-metal wear.`,
        chips: [
          { label: 'ACTIVE TORQUE PULSE', val: activeWork },
          { label: 'JOURNAL OIL FILM', val: `${oilP} PSI POSITIVE CUSHION` },
          { label: 'THROW 1 / 2 ANGLES', val: `TH1: ${th1}° • TH2: ${th2}°` },
          { label: 'THROW 3 / 4 ANGLES', val: `TH3: ${th3}° • TH4: ${th4}°` },
          { label: 'VIBRATION HARMONICS', val: `${vib} mm/s RMS (SAFE <2.5)` }
        ],
        compactSummary: `⚡ CRANKSHAFT: ${deg}°/720° | ${activeWork} | OIL: ${oilP} PSI`
      };
    }

    if (key === 'turbo') {
      const mapVal = (this.telemetry.map || 34.5).toFixed(1);
      const isLeaking = this.telemetry.map < 28;
      const wgStatus = isLeaking ? 'LEAKING DEFICIT ⚠️' : 'REGULATING 34.5 inHg';
      const spoolRpm = Math.round(118500 * (this.rpm / 4200));
      return {
        badge: '⚡ TURBOCHARGER BOOST',
        badgeClass: 'stroke-subsystem',
        degText: `${spoolRpm.toLocaleString()} SPOOL RPM`,
        headline: 'CENTRIFUGAL COMPRESSOR & INCONEL TURBINE',
        narration: 'Exhaust gas at 780°C spins the inconel turbine wheel, driving the cold-side billet compressor impeller up to 118,500 RPM to compress intake air and prevent power loss at high altitudes.',
        chips: [
          { label: 'IMPELLER SPEED', val: `~${spoolRpm.toLocaleString()} RPM` },
          { label: 'MANIFOLD PRESSURE', val: `${mapVal} inHg (${mapVal > 29.9 ? '+' + (mapVal - 29.9).toFixed(1) + ' inHg BOOST' : 'VACUUM'})` },
          { label: 'WASTEGATE CANISTER', val: wgStatus },
          { label: 'CHRA OIL FEED', val: `${(this.telemetry.oilPress || 52.4).toFixed(1)} PSI CONTINUOUS` },
          { label: 'TURBINE TEMP', val: '780°C HOT-GAS INFLOW' }
        ],
        compactSummary: `⚡ TURBO: ~${spoolRpm.toLocaleString()} RPM | MAP: ${mapVal} inHg | WG: ${wgStatus}`
      };
    }

    if (key === 'oil_system') {
      const oilP = (this.telemetry.oilPress || 52.4).toFixed(1);
      const oilT = Math.round(this.telemetry.oilTemp || 88);
      const isCavitating = this.telemetry.oilPress < 30;
      const pumpRpm = Math.round(this.rpm * 1.5);
      return {
        badge: '⚡ GEROTOR OIL LUBRICATION',
        badgeClass: isCavitating ? 'stroke-exhaust' : 'stroke-subsystem',
        degText: `${oilP} PSI / ${oilT}°C`,
        headline: 'POSITIVE DISPLACEMENT GEROTOR PUMP & SUMP',
        narration: '4-lobe inner rotor driven off camshaft spins inside 5-pocket outer ring at 6,300 RPM. Expanding chambers draw oil from finned billet sump; contracting chambers force pressurized oil through 10µm filter to crankshaft and turbo.',
        chips: [
          { label: 'DELIVERY PRESSURE', val: `${oilP} PSI (${isCavitating ? 'CAVITATION ALERT ⚠️' : 'NOMINAL >42.0 PSI'})` },
          { label: 'SUMP OIL TEMP', val: `${oilT}°C (SAE 15W-50 OPTIMAL)` },
          { label: 'PUMP ROTOR SPEED', val: `${pumpRpm.toLocaleString()} RPM` },
          { label: 'OIL FILTER', val: '10µm SPIN-ON WITH BYPASS' },
          { label: 'SCAVENGE STAGE', val: 'DUAL GEROTOR SUCTION ACTIVE' }
        ],
        compactSummary: `⚡ OIL SYSTEM: ${oilP} PSI | SUMP: ${oilT}°C | PUMP: ${pumpRpm} RPM`
      };
    }

    if (key === 'fuel_system') {
      const isArmed = this.telemetry.fuelWallOpen !== false;
      const afr = (this.telemetry.afr || 14.7).toFixed(1);
      const flow = (this.telemetry.fuelFlow || 28.5).toFixed(1);
      return {
        badge: '⚡ COMMON RAIL FUEL SYSTEM',
        badgeClass: isArmed ? 'stroke-subsystem' : 'stroke-exhaust',
        degText: isArmed ? '43.5 PSI (3.0 BAR)' : '0 PSI (SHUTOFF)',
        headline: 'SEQUENTIAL MULTI-PORT INJECTION & FIREWALL VALVE',
        narration: isArmed 
          ? 'Electric high-pressure rail maintains constant 43.5 PSI. 4 Bosch solenoid injectors spray atomized micro-droplets into intake runner ports, precisely timed with each cylinder intake valve stroke.'
          : 'EMERGENCY FIREWALL VALVE MECHANICALLY CLOSED: Fuel rail isolated. All injector delivery halted for containment.',
        chips: [
          { label: 'RAIL PRESSURE', val: isArmed ? '43.5 PSI (3.0 BAR CONSTANT)' : '0 PSI ISOLATED' },
          { label: 'AIR-FUEL RATIO (AFR)', val: `${afr}:1 (STOICHIOMETRIC)` },
          { label: 'FUEL CONSUMPTION', val: `${flow} L/HR FLOW RATE` },
          { label: 'INJECTOR PULSE', val: '3.4ms SEQUENTIAL PWM' },
          { label: 'FIREWALL SHUTOFF', val: isArmed ? 'ARMED & OPEN' : 'EMERGENCY CLOSED 🚨' }
        ],
        compactSummary: `⚡ FUEL RAIL: ${isArmed ? '43.5 PSI' : '0 PSI CUTOFF'} | AFR: ${afr}:1 | FLOW: ${flow} L/H`
      };
    }

    if (key === 'gearbox') {
      const engRpm = Math.round(this.rpm);
      const propRpm = Math.round(this.rpm / 2.43);
      return {
        badge: '⚡ PRSU REDUCTION GEARBOX',
        badgeClass: 'stroke-subsystem',
        degText: '2.43:1 RATIO',
        headline: 'PROPELLER SPEED REDUCTION UNIT (PRSU)',
        narration: 'Converts high engine speed (4200 RPM) into aerodynamically efficient propeller speed (1728 RPM) using 17.5° case-hardened helical gears. Elastomeric torsional coupling dampens engine combustion shockwaves.',
        chips: [
          { label: 'ENGINE CRANK INPUT', val: `${engRpm} RPM` },
          { label: 'PROPELLER OUTPUT', val: `${propRpm} RPM` },
          { label: 'GEAR REDUCTION RATIO', val: '2.43:1 GROUND HELICAL' },
          { label: 'TORSIONAL DAMPER', val: 'RUBBER-IN-SHEAR ABSORPTION OK' },
          { label: 'THRUST BEARING', val: '450 kgf FORWARD CAPABILITY' }
        ],
        compactSummary: `⚡ PRSU GEARBOX: 4200 ➔ 1728 RPM | 2.43:1 RATIO | DAMPER OK`
      };
    }

    if (key === 'uav_airframe') {
      return {
        badge: '✈️ DRDO TAPAS MALE UAV',
        badgeClass: 'stroke-uav',
        degText: 'FULL AIRFRAME & PROPULSION',
        headline: 'DRDO TAPAS-BH-201 MALE UAV AIRFRAME & ENGINE BAY',
        narration: 'Composite twin-boom airframe with rear-mounted 115 HP turbocharged aero piston engine. Pusher propeller delivers efficient high-altitude endurance of 18+ hours.',
        chips: [
          { label: 'WINGSPAN', val: '20.6 M (HIGH-ASPECT RATIO)' },
          { label: 'PROPULSION', val: '115 HP TURBO PISTON (PUSHER)' },
          { label: 'MAX CEILING', val: '30,000 FT (MALE ENVELOPE)' },
          { label: 'CRUISE SPEED', val: '118 KTS • 218 KM/H' },
          { label: 'MTOW / PAYLOAD', val: '1,800 KG / 350 KG' }
        ],
        compactSummary: '✈️ DRDO TAPAS-BH-201 MALE UAV • 115 HP PUSHER PROPULSION • 20.6M WINGSPAN'
      };
    }

    return {
      badge: '⚡ KINEMATIC CYCLE',
      badgeClass: 'stroke-subsystem',
      degText: `${deg}° / 720°`,
      headline: 'AERO PROPULSION DIGITAL TWIN SUBSYSTEM',
      narration: 'Mechanical kinematics synchronized with live sensor telemetry and Otto cycle.',
      chips: [
        { label: 'CYCLE ANGLE', val: `${deg}° / 720°` }
      ],
      compactSummary: `⚡ CYCLE: ${deg}° / 720°`
    };
  }

  getComponentLiveReadout() {
    const state = this.getComponentDetailedState();
    return state.compactSummary;
  }

  updateReadingShowcaseDOM() {
    const state = this.getComponentDetailedState();
    const summaryKey = `${state.badge}|${state.degText}|${state.headline}|${state.compactSummary}`;
    if (this._lastRenderedKey === summaryKey) {
      return; // Value unchanged: prevent DOM layout thrashing & reflow jitter!
    }
    this._lastRenderedKey = summaryKey;

    // 1. Badge Phase
    const badgeEl = document.getElementById('cad-badge-phase');
    if (badgeEl) {
      badgeEl.textContent = state.badge;
      badgeEl.className = `cad-badge-phase ${state.badgeClass}`;
    }

    // 2. Degree badge
    const degEl = document.getElementById('cad-badge-deg');
    if (degEl) {
      degEl.textContent = state.degText;
    }

    // 3. Headline
    const headlineEl = document.getElementById('cad-reading-headline');
    if (headlineEl) {
      headlineEl.textContent = state.headline;
    }

    // 4. Narration (Kya ho raha hai)
    const narrationEl = document.getElementById('cad-narration-text');
    if (narrationEl) {
      narrationEl.textContent = state.narration;
    }

    // 5. Chips Grid
    const chipsEl = document.getElementById('cad-reading-chips');
    if (chipsEl && state.chips) {
      chipsEl.innerHTML = state.chips.map(c => 
        `<span class="reading-metric-chip">${c.label}: <strong>${c.val}</strong></span>`
      ).join('');
    }

    // 6. Top strip compact indicator
    const strokeEl = document.getElementById('cad-live-stroke-indicator');
    if (strokeEl) {
      strokeEl.textContent = state.compactSummary;
    }

    // 7. Synchronize Live Operating Reading in Column 1 below if inspected
    const statReadingEl = document.getElementById('inspect-stat-reading');
    if (statReadingEl && state.chips && state.chips.length > 0) {
      statReadingEl.textContent = state.chips[0].val;
    }
  }

  render() {
    this.ctx.clearRect(0, 0, this.width, this.height);

    // Synchronize High-Visibility Mechanical Reading Showcase DOM
    this.updateReadingShowcaseDOM();

    // 1. Engineering Blueprint Tech Grid
    this.renderBlueprintGrid();

    // 2. Render Dedicated Component 3D CAD Model
    const key = this.activeKey;
    if (key.startsWith('cyl')) {
      const cylIdx = parseInt(key.replace('cyl', ''), 10) - 1;
      const cht = (this.telemetry.cht && this.telemetry.cht[cylIdx]) || 170;
      this.renderCylinderCAD(cylIdx + 1, cht);
    } else if (key === 'turbo') {
      this.renderTurboCAD();
    } else if (key === 'crankshaft') {
      this.renderCrankshaftCAD();
    } else if (key === 'oil_system') {
      this.renderOilSystemCAD();
    } else if (key === 'fuel_system') {
      this.renderFuelSystemCAD();
    } else if (key === 'gearbox') {
      this.renderGearboxCAD();
    } else if (key === 'uav_airframe') {
      this.renderUavAirframeCAD();
    }

    // 3. Technical HUD Overlay & Coordinate Axes
    this.renderHUDOverlay();
  }

  renderBlueprintGrid() {
    const ctx = this.ctx;
    ctx.save();
    const gSize = 120;
    const step = 30;
    const yGround = 65;

    ctx.lineWidth = 1;
    for (let x = -gSize; x <= gSize; x += step) {
      const p1 = this.project(x, yGround, -gSize);
      const p2 = this.project(x, yGround, gSize);
      ctx.strokeStyle = x === 0 ? 'rgba(0, 240, 255, 0.25)' : 'rgba(0, 240, 255, 0.05)';
      ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
    }
    for (let z = -gSize; z <= gSize; z += step) {
      const p1 = this.project(-gSize, yGround, z);
      const p2 = this.project(gSize, yGround, z);
      ctx.strokeStyle = z === 0 ? 'rgba(0, 240, 255, 0.25)' : 'rgba(0, 240, 255, 0.05)';
      ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
    }

    // Concentric blueprint circular range rings
    const center = this.project(0, yGround, 0);
    [40, 80, 120].forEach(r => {
      ctx.strokeStyle = 'rgba(0, 240, 255, 0.04)';
      ctx.beginPath();
      ctx.arc(center.x, center.y, r * center.scale, 0, Math.PI * 2);
      ctx.stroke();
    });

    ctx.restore();
  }

  /* ==========================================================================
     3D VOLUMETRIC GEOMETRY PRIMITIVES (TRUE 3D PROJECTION FROM ANY ANGLE)
     ========================================================================== */
  drawCircle3D(cx, cy, cz, radius, normalAxis = 'y', strokeStyle = null, fillStyle = null, segments = 24) {
    const ctx = this.ctx;
    ctx.beginPath();
    let firstPt = null;
    for (let i = 0; i <= segments; i++) {
      const theta = (i / segments) * Math.PI * 2;
      let x = cx, y = cy, z = cz;
      if (normalAxis === 'y') {
        x += Math.cos(theta) * radius;
        z += Math.sin(theta) * radius;
      } else if (normalAxis === 'x') {
        y += Math.cos(theta) * radius;
        z += Math.sin(theta) * radius;
      } else if (normalAxis === 'z') {
        x += Math.cos(theta) * radius;
        y += Math.sin(theta) * radius;
      }
      const pt = this.project(x, y, z);
      if (i === 0) {
        firstPt = pt;
        ctx.moveTo(pt.x, pt.y);
      } else {
        ctx.lineTo(pt.x, pt.y);
      }
    }
    ctx.closePath();
    if (fillStyle) {
      ctx.fillStyle = fillStyle;
      ctx.fill();
    }
    if (strokeStyle) {
      ctx.strokeStyle = strokeStyle;
      ctx.stroke();
    }
  }

  drawCylinder3D(cx, y1, y2, cz, radius, strokeStyle = null, fillStyle = null, segments = 20, numRibs = 6) {
    const ctx = this.ctx;
    // Top circle
    this.drawCircle3D(cx, y1, cz, radius, 'y', strokeStyle, fillStyle, segments);
    // Bottom circle
    this.drawCircle3D(cx, y2, cz, radius, 'y', strokeStyle, fillStyle, segments);
    // Longitudinal contour silhouette ribs
    if (numRibs > 0) {
      ctx.strokeStyle = strokeStyle || 'rgba(0, 240, 255, 0.4)';
      for (let i = 0; i < numRibs; i++) {
        const theta = (i / numRibs) * Math.PI * 2;
        const x = cx + Math.cos(theta) * radius;
        const z = cz + Math.sin(theta) * radius;
        const p1 = this.project(x, y1, z);
        const p2 = this.project(x, y2, z);
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.stroke();
      }
    }
  }

  drawAxialCylinder3D(x1, x2, cy, cz, radius, strokeStyle = null, fillStyle = null, segments = 16, numRibs = 4) {
    const ctx = this.ctx;
    this.drawCircle3D(x1, cy, cz, radius, 'x', strokeStyle, fillStyle, segments);
    this.drawCircle3D(x2, cy, cz, radius, 'x', strokeStyle, fillStyle, segments);
    if (numRibs > 0) {
      ctx.strokeStyle = strokeStyle || 'rgba(0, 240, 255, 0.4)';
      for (let i = 0; i < numRibs; i++) {
        const theta = (i / numRibs) * Math.PI * 2;
        const y = cy + Math.cos(theta) * radius;
        const z = cz + Math.sin(theta) * radius;
        const p1 = this.project(x1, y, z);
        const p2 = this.project(x2, y, z);
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.stroke();
      }
    }
  }

  drawZAxisCylinder3D(cx, cy, z1, z2, radius, strokeStyle = null, fillStyle = null, segments = 16, numRibs = 4) {
    const ctx = this.ctx;
    this.drawCircle3D(cx, cy, z1, radius, 'z', strokeStyle, fillStyle, segments);
    this.drawCircle3D(cx, cy, z2, radius, 'z', strokeStyle, fillStyle, segments);
    if (numRibs > 0) {
      ctx.strokeStyle = strokeStyle || 'rgba(0, 240, 255, 0.4)';
      for (let i = 0; i < numRibs; i++) {
        const theta = (i / numRibs) * Math.PI * 2;
        const x = cx + Math.cos(theta) * radius;
        const y = cy + Math.sin(theta) * radius;
        const p1 = this.project(x, y, z1);
        const p2 = this.project(x, y, z2);
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.stroke();
      }
    }
  }

  /* ==========================================================================
     1. DEDICATED CYLINDER & PISTON 3D CAD MODEL
     ========================================================================== */
  renderCylinderCAD(cylNum, chtTemp) {
    const ctx = this.ctx;
    ctx.save();

    const isOverheating = chtTemp > 200;
    const exp = this.explodedFactor;
    const isWire = this.viewMode === 'wireframe';
    const isCutaway = this.viewMode === 'cutaway' || this.viewMode === 'exploded';

    // Rigid Slider-Crank Mechanical Kinematics (No stretching, no warping)
    const crankCenterY = 62;
    const crankR = 20;
    const rodL = 76;
    const crankAngle = this.crankAngle;
    const crankPinX = Math.sin(crankAngle) * crankR;
    const crankPinY = crankCenterY - Math.cos(crankAngle) * crankR;
    const crankPinZ = 0;

    // Exact mathematical wrist pin Y via slider-crank Pythagorean formula:
    const pistonPinY = crankPinY - Math.sqrt(Math.max(1, rodL * rodL - crankPinX * crankPinX)) - (exp * 65);
    const pistonCrownY = pistonPinY - 18;
    const pistonSkirtY = pistonPinY + 16;
    const barrelRadius = 38;
    const pistonRadius = 34;

    // A. 7 Deep Radial 3D Circular Cooling Fins (True 3D Ellipses in XZ plane)
    const finCount = 7;
    for (let i = 0; i < finCount; i++) {
      const fy = -46 + (i * 11);
      const fRad = barrelRadius + (i % 2 === 0 ? 9 : 6);
      const finColor = isOverheating ? '#ef4444' : (isWire ? 'rgba(0, 240, 255, 0.35)' : '#334155');
      const finFill = isWire ? null : (isOverheating ? 'rgba(239, 68, 68, 0.15)' : 'rgba(15, 23, 42, 0.5)');
      this.drawCircle3D(0, fy, 0, fRad, 'y', finColor, finFill, 24);

      // Chamfered Specular Highlight Rim
      if (!isWire) {
        this.drawCircle3D(0, fy - 0.8, 0, fRad - 1.5, 'y', 'rgba(255, 255, 255, 0.18)', null, 24);
      }
    }

    // Cylinder Head Cap Dome in 3D
    const headColor = isOverheating ? '#ef4444' : (isWire ? 'rgba(0, 240, 255, 0.4)' : '#1e293b');
    this.drawCircle3D(0, -56, 0, barrelRadius + 3, 'y', headColor, isWire ? null : 'rgba(30, 41, 59, 0.95)', 24);

    // Cylinder Liner Wall Bore in 3D
    const linerStroke = isWire ? 'rgba(0, 240, 255, 0.25)' : '#64748b';
    this.drawCylinder3D(0, -52, 38, 0, barrelRadius, linerStroke, null, 20, 6);

    // Precision Cross-Hatch Honing Pattern inside Cylinder Bore
    if (isCutaway) {
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.2)';
      ctx.lineWidth = 1;
      for (let h = -35; h <= 25; h += 14) {
        const hl1 = this.project(-barrelRadius + 2, h - 8, 0);
        const hr1 = this.project(barrelRadius - 2, h + 8, 0);
        const hl2 = this.project(-barrelRadius + 2, h + 8, 0);
        const hr2 = this.project(barrelRadius - 2, h - 8, 0);
        ctx.beginPath(); ctx.moveTo(hl1.x, hl1.y); ctx.lineTo(hr1.x, hr1.y); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(hl2.x, hl2.y); ctx.lineTo(hr2.x, hr2.y); ctx.stroke();
      }
    }

    // Exploded View Central Alignment Dotted Axis
    if (exp > 0.05) {
      const aTop = this.project(0, -90, 0);
      const aBot = this.project(0, 80, 0);
      ctx.strokeStyle = 'rgba(0, 240, 255, 0.35)';
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(aTop.x, aTop.y); ctx.lineTo(aBot.x, aBot.y); ctx.stroke();
      ctx.setLineDash([]);
    }

    // B. Reciprocating Aluminum Piston in 3D (Crown, Skirt, Ring Grooves)
    const pistonStroke = isOverheating ? '#fca5a5' : (isWire ? '#00f0ff' : '#cbd5e1');
    const pistonFill = isWire ? 'rgba(0, 240, 255, 0.08)' : (isOverheating ? 'rgba(239, 68, 68, 0.85)' : 'rgba(148, 163, 184, 0.92)');

    // 3D Piston Crown Disk
    this.drawCircle3D(0, pistonCrownY, 0, pistonRadius, 'y', pistonStroke, pistonFill, 20);

    // 3D Piston Skirt Ring & Vertical Contour Ribs
    this.drawCircle3D(0, pistonSkirtY, 0, pistonRadius, 'y', pistonStroke, null, 20);
    for (let r = 0; r < 4; r++) {
      const ang = (r * Math.PI / 2);
      const rx = Math.cos(ang) * pistonRadius;
      const rz = Math.sin(ang) * pistonRadius;
      const pt1 = this.project(rx, pistonCrownY, rz);
      const pt2 = this.project(rx, pistonSkirtY, rz);
      ctx.strokeStyle = pistonStroke;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(pt1.x, pt1.y); ctx.lineTo(pt2.x, pt2.y); ctx.stroke();
    }

    // 3 Precision Piston Rings around the Circumference in 3D
    this.drawCircle3D(0, pistonCrownY + 5, 0, pistonRadius + 0.5, 'y', '#f8fafc', null, 16);
    this.drawCircle3D(0, pistonCrownY + 9, 0, pistonRadius + 0.5, 'y', '#cbd5e1', null, 16);
    this.drawCircle3D(0, pistonCrownY + 13, 0, pistonRadius + 0.5, 'y', '#fbbf24', null, 16);

    // Full-Floating Hollow Gudgeon / Wrist Pin in 3D along X axis
    const pinOffset = exp * 35;
    this.drawAxialCylinder3D(-19 - pinOffset, 19 + pinOffset, pistonPinY, 0, 4.5, '#f8fafc', '#334155', 14, 4);

    // C. Forged H-Beam Connecting Rod in 3D
    const pSmall = this.project(0, pistonPinY, 0);
    const pBig = this.project(crankPinX, crankPinY + (exp * 35), crankPinZ);

    // Small-End Eye around Wrist Pin
    this.drawCircle3D(0, pistonPinY, 0, 7.5, 'z', '#94a3b8', '#1e293b', 14);

    // Big-End Rod Cap around Crankpin
    this.drawCircle3D(crankPinX, crankPinY + (exp * 35), 0, 10.5, 'z', '#cbd5e1', '#334155', 16);

    // Connecting H-Beam Rod Shank (Constant Rigid Length)
    ctx.strokeStyle = '#64748b';
    ctx.lineWidth = Math.max(3.5, 7 * pSmall.scale);
    ctx.beginPath(); ctx.moveTo(pSmall.x, pSmall.y); ctx.lineTo(pBig.x, pBig.y); ctx.stroke();

    // Recessed Inner I-Beam Web Channel
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = Math.max(1.5, 2.8 * pSmall.scale);
    ctx.beginPath(); ctx.moveTo(pSmall.x, pSmall.y + 4); ctx.lineTo(pBig.x, pBig.y - 4); ctx.stroke();

    // Dual ARP 12-Pt Rod Bolts on Cap
    [-4, 4].forEach(bx => {
      ctx.fillStyle = '#f8fafc';
      ctx.beginPath();
      ctx.arc(pBig.x + bx * pBig.scale, pBig.y + 7 * pBig.scale, Math.max(1, 1.8 * pBig.scale), 0, Math.PI * 2);
      ctx.fill();
    });

    // Crankshaft Center Throw in 3D
    this.drawCircle3D(0, crankCenterY, 0, 13, 'z', '#00f0ff', '#1e293b', 16);
    const pCrankCenter = this.project(0, crankCenterY, 0);
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = Math.max(2.5, 5 * pBig.scale);
    ctx.beginPath(); ctx.moveTo(pCrankCenter.x, pCrankCenter.y); ctx.lineTo(pBig.x, pBig.y); ctx.stroke();

    // D. Dual Overhead Poppet Valves with Realistic Camshaft Lift in 3D
    const deg = Math.round((this.crankAngle * 180 / Math.PI) % 720);
    const cylOffsets = [0, 180, 360, 540];
    const cylDeg = (deg + cylOffsets[(cylNum - 1) % 4]) % 720;
    const valveLiftIn = (cylDeg < 180) ? Math.sin((cylDeg / 180) * Math.PI) * 7 : 0;
    const valveLiftEx = (cylDeg >= 540) ? Math.sin(((cylDeg - 540) / 180) * Math.PI) * 7 : 0;

    const inY = -56 + valveLiftIn - (exp * 35);
    const exY = -56 + valveLiftEx - (exp * 35);

    // Intake Valve (Left, Cyan/Blue)
    this.drawCircle3D(-16, inY, 0, 8.5, 'y', '#38bdf8', '#0284c7', 14);
    const inTop = this.project(-16, inY - 22, 0);
    const inBot = this.project(-16, inY, 0);
    ctx.strokeStyle = '#38bdf8'; ctx.lineWidth = Math.max(1.5, 3 * inBot.scale);
    ctx.beginPath(); ctx.moveTo(inTop.x, inTop.y); ctx.lineTo(inBot.x, inBot.y); ctx.stroke();
    // Intake Valve Springs
    for (let c = -16; c <= -4; c += 4) {
      ctx.strokeStyle = '#0284c7'; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(inBot.x - 5, inBot.y + c); ctx.lineTo(inBot.x + 5, inBot.y + c + 2); ctx.stroke();
    }

    // Exhaust Valve (Right, Amber/Orange)
    this.drawCircle3D(16, exY, 0, 8.5, 'y', '#f59e0b', '#d97706', 14);
    const exTop = this.project(16, exY - 22, 0);
    const exBot = this.project(16, exY, 0);
    ctx.strokeStyle = '#f59e0b'; ctx.lineWidth = Math.max(1.5, 3 * exBot.scale);
    ctx.beginPath(); ctx.moveTo(exTop.x, exTop.y); ctx.lineTo(exBot.x, exBot.y); ctx.stroke();
    // Exhaust Valve Springs
    for (let c = -16; c <= -4; c += 4) {
      ctx.strokeStyle = '#d97706'; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(exBot.x - 5, exBot.y + c); ctx.lineTo(exBot.x + 5, exBot.y + c + 2); ctx.stroke();
    }

    // E. Aviation Dual Spark Plugs (45° Angle Ports)
    const plugExp = exp * 30;
    const pl1 = this.project(-34 - plugExp, -44 - plugExp * 0.5, 0);
    const pl2 = this.project(34 + plugExp, -44 - plugExp * 0.5, 0);
    [pl1, pl2].forEach(pl => {
      ctx.fillStyle = '#b45309'; ctx.fillRect(pl.x - 3, pl.y - 3, 6, 6);
      ctx.fillStyle = '#f8fafc'; ctx.beginPath(); ctx.arc(pl.x, pl.y - 4, Math.max(2, 3.5 * pl.scale), 0, Math.PI * 2); ctx.fill();
    });

    // F. Smooth Sine-Envelope Combustion Flame at TDC (Power Stroke 360°-440°)
    if (cylDeg >= 360 && cylDeg <= 440 && exp < 0.25) {
      const flameAlpha = Math.sin(((cylDeg - 360) / 80) * Math.PI);
      const chamberP = this.project(0, -42, 0);
      const flameRadius = Math.max(4, 36 * chamberP.scale);
      const grad = ctx.createRadialGradient(chamberP.x, chamberP.y, 2, chamberP.x, chamberP.y, flameRadius);
      grad.addColorStop(0, `rgba(255, 255, 255, ${flameAlpha * 0.95})`);
      grad.addColorStop(0.3, `rgba(255, 200, 40, ${flameAlpha * 0.85})`);
      grad.addColorStop(0.7, `rgba(255, 80, 20, ${flameAlpha * 0.5})`);
      grad.addColorStop(1, 'rgba(255, 0, 0, 0)');
      ctx.fillStyle = grad;
      ctx.beginPath(); ctx.arc(chamberP.x, chamberP.y, flameRadius, 0, Math.PI * 2); ctx.fill();
    }

    // 3D Anatomy Pointer Callouts (Stationary Margin Badges + Steady Nominal Anchors)
    const nominalPistonY = -22;
    this.renderAnatomyCallouts([
      { title: 'INTAKE POPPET VALVE', spec: '38mm STELLITE-FACED', x: -16, y: -56 - (exp * 35), z: 0, side: 'left', color: '#38bdf8' },
      { title: 'EXHAUST VALVE', spec: 'SODIUM-COOLED STEM', x: 16, y: -56 - (exp * 35), z: 0, side: 'right', color: '#f59e0b' },
      { title: 'PISTON CROWN', spec: 'FORGED 4032 ALLOY', x: 0, y: nominalPistonY - 18 - (exp * 65), z: 0, side: 'left', color: '#38bdf8' },
      { title: 'PISTON RINGS (3-TIER)', spec: 'CHROME / SCRAPER / OIL', x: 28, y: nominalPistonY - 9 - (exp * 65), z: 0, side: 'right', color: '#cbd5e1' },
      { title: 'GUDGEON WRIST PIN', spec: 'FULL-FLOATING HOLLOW STEEL', x: -18, y: nominalPistonY - (exp * 65), z: 0, side: 'left', color: '#f8fafc' },
      { title: 'FORGED H-BEAM ROD', spec: '4340 CHROME-MOLY STEEL', x: 0, y: (nominalPistonY + crankCenterY) * 0.5, z: 0, side: 'right', color: '#94a3b8' },
      { title: 'COOLING FINS', spec: 'RADIAL AIR HEAT-SINK', x: -44, y: -2, z: 0, side: 'left', color: '#38bdf8' },
      { title: 'CRANKPIN JOURNAL', spec: 'BOXER COUNTERWEIGHTED', x: 0, y: crankCenterY + (exp * 35), z: 0, side: 'right', color: '#fbbf24' }
    ]);

    ctx.restore();
  }

  /* ==========================================================================
     2. DEDICATED TURBOCHARGER & WASTEGATE 3D CAD MODEL
     ========================================================================== */
  renderTurboCAD() {
    const ctx = this.ctx;
    ctx.save();

    const exp = this.explodedFactor;
    const isWgLeaking = this.telemetry.map < 28;
    const isWire = this.viewMode === 'wireframe';

    // Center Assembly Reference Axis Line
    if (exp > 0.05) {
      const aLeft = this.project(-90, 0, 0);
      const aRight = this.project(90, 0, 0);
      ctx.strokeStyle = 'rgba(0, 240, 255, 0.35)';
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(aLeft.x, aLeft.y); ctx.lineTo(aRight.x, aRight.y); ctx.stroke();
      ctx.setLineDash([]);
    }

    // A. Cold Compressor Scroll Housing in 3D (Left, Blue/Cyan, Normal = 'x')
    const compX = -36 - (exp * 48);
    const compFill = isWire ? 'rgba(0, 240, 255, 0.08)' : 'rgba(18, 30, 52, 0.95)';
    this.drawCircle3D(compX, 0, 0, 36, 'x', '#00f0ff', compFill, 24);
    this.drawCircle3D(compX - 8, 0, 0, 20, 'x', '#38bdf8', isWire ? null : 'rgba(15, 23, 42, 0.95)', 20);

    // 10-Blade Billet Impeller Spinning in 3D around X Axis
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 1.8;
    for (let b = 0; b < 10; b++) {
      const ang = this.turboSpoolAngle + (b * (Math.PI * 2 / 10));
      const pCenter = this.project(compX, 0, 0);
      const pTip = this.project(compX - 3, Math.cos(ang) * 26, Math.sin(ang) * 26);
      ctx.beginPath(); ctx.moveTo(pCenter.x, pCenter.y); ctx.lineTo(pTip.x, pTip.y); ctx.stroke();
    }

    // B. Center CHRA Bearing Cartridge Housing in 3D along X Axis
    this.drawAxialCylinder3D(-14, 14, 0, 0, 16, '#64748b', isWire ? null : '#334155', 16, 4);

    // Oil Feed & Return Boss Fittings in 3D
    const feedP1 = this.project(0, -16, 0);
    const feedP2 = this.project(0, -28, 0);
    const drainP1 = this.project(0, 16, 0);
    const drainP2 = this.project(0, 28, 0);
    ctx.strokeStyle = '#e2e8f0'; ctx.lineWidth = 2.2;
    ctx.beginPath(); ctx.moveTo(feedP1.x, feedP1.y); ctx.lineTo(feedP2.x, feedP2.y); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(drainP1.x, drainP1.y); ctx.lineTo(drainP2.x, drainP2.y); ctx.stroke();

    // C. Hot Turbine Housing in 3D (Right, Amber/Red, Normal = 'x')
    const turbX = 36 + (exp * 48);
    const turbHeatColor = this.telemetry.egt[0] > 800 ? '#ef4444' : '#f59e0b';
    const turbFill = isWire ? 'rgba(239, 68, 68, 0.08)' : 'rgba(45, 24, 16, 0.95)';
    this.drawCircle3D(turbX, 0, 0, 34, 'x', turbHeatColor, turbFill, 24);
    this.drawCircle3D(turbX + 8, 0, 0, 18, 'x', '#fbbf24', isWire ? null : 'rgba(28, 14, 10, 0.95)', 20);

    // 8 Inconel Turbine Blades Spinning in 3D around X Axis
    ctx.strokeStyle = '#fbbf24';
    ctx.lineWidth = 1.8;
    for (let b = 0; b < 8; b++) {
      const ang = this.turboSpoolAngle + (b * (Math.PI * 2 / 8));
      const pCenter = this.project(turbX, 0, 0);
      const pTip = this.project(turbX + 3, Math.cos(ang) * 24, Math.sin(ang) * 24);
      ctx.beginPath(); ctx.moveTo(pCenter.x, pCenter.y); ctx.lineTo(pTip.x, pTip.y); ctx.stroke();
    }

    // D. Wastegate Actuator Canister in 3D
    const wgY = -52 - (exp * 40);
    this.drawCylinder3D(26, wgY - 14, wgY + 14, 0, 12, isWgLeaking ? '#ef4444' : '#fbbf24', isWire ? null : '#78350f', 16, 4);

    // Actuator Pushrod Linkage down to Wastegate Flapper Valve in 3D
    const wgRodTop = this.project(26, wgY + 14, 0);
    const wgFlapper = this.project(turbX + 8, -10, 0);
    ctx.strokeStyle = isWgLeaking ? '#ef4444' : '#cbd5e1';
    ctx.lineWidth = 2.2;
    ctx.beginPath(); ctx.moveTo(wgRodTop.x, wgRodTop.y); ctx.lineTo(wgFlapper.x, wgFlapper.y); ctx.stroke();

    // 3D Anatomy Pointer Callouts for Turbocharger Subsystem
    this.renderAnatomyCallouts([
      { title: 'BILLET COMPRESSOR WHEEL', spec: 'CNC 6+6 FORGED ALLOY', x: compX - 4, y: 0, z: 0, side: 'left', color: '#00f0ff' },
      { title: 'COMPRESSOR VOLUTE', spec: 'EXPANDING SPIRAL SCROLL', x: compX, y: -24, z: 0, side: 'left', color: '#38bdf8' },
      { title: 'CHRA BEARING CORE', spec: 'HYDRODYNAMIC OIL JOURNAL', x: 0, y: -16, z: 0, side: 'left', color: '#94a3b8' },
      { title: 'INCONEL TURBINE WHEEL', spec: 'EXHAUST GAS EXTRACTION', x: turbX + 4, y: 0, z: 0, side: 'right', color: '#fbbf24' },
      { title: 'TURBINE HOUSING', spec: 'HIGH-NICKEL DUCTILE IRON', x: turbX, y: 24, z: 0, side: 'right', color: '#f59e0b' },
      { title: 'WASTEGATE ACTUATOR', spec: 'CALIBRATED DIAPHRAGM', x: 26, y: wgY, z: 0, side: 'right', color: '#fbbf24' },
      { title: 'WASTEGATE FLAPPER', spec: 'BOOST LIMITER RELIEF', x: turbX + 8, y: -10, z: 0, side: 'right', color: '#10b981' }
    ]);

    ctx.restore();
  }

  /* ==========================================================================
     3. DEDICATED CRANKSHAFT & BEARINGS 3D CAD MODEL
     ========================================================================== */
  renderCrankshaftCAD() {
    const ctx = this.ctx;
    ctx.save();

    const exp = this.explodedFactor;
    const isBearingDamaged = this.telemetry.vibrationRms > 2.8 || this.telemetry.oilPress < 35;
    const isWire = this.viewMode === 'wireframe';

    // Main Center Crankshaft Shaft along Z in 3D
    const shaftLen = 150;
    this.drawZAxisCylinder3D(0, 0, -shaftLen / 2, shaftLen / 2, 7, isBearingDamaged ? '#ef4444' : '#00f0ff', isWire ? null : '#334155', 16, 4);

    // 4 Crankpins with 180° Boxer Offsets in 3D
    const crankThrows = [
      { z: -50, angle: this.crankAngle, cyl: 1 },
      { z: -20, angle: this.crankAngle + Math.PI, cyl: 2 },
      { z: 20,  angle: this.crankAngle + Math.PI / 2, cyl: 3 },
      { z: 50,  angle: this.crankAngle + 3 * Math.PI / 2, cyl: 4 }
    ];

    crankThrows.forEach(throwItem => {
      const throwR = 24;
      const tx = Math.cos(throwItem.angle) * throwR;
      const ty = Math.sin(throwItem.angle) * throwR;

      // 3D Cylindrical Crankpin Journal
      this.drawZAxisCylinder3D(tx, ty, throwItem.z - 7, throwItem.z + 7, 5.5, '#cbd5e1', '#f8fafc', 12, 4);

      // 3D Forged Counterweight Web with Front & Rear Thickness along Z
      const cWebX = -Math.cos(throwItem.angle) * (throwR * 1.2);
      const cWebY = -Math.sin(throwItem.angle) * (throwR * 1.2);
      const nx = -Math.sin(throwItem.angle) * 9;
      const ny = Math.cos(throwItem.angle) * 9;

      [-4, 4].forEach(dz => {
        const pC = this.project(0, 0, throwItem.z + dz);
        const pPin = this.project(tx, ty, throwItem.z + dz);
        const pW1 = this.project(cWebX + nx, cWebY + ny, throwItem.z + dz);
        const pW2 = this.project(cWebX - nx, cWebY - ny, throwItem.z + dz);

        ctx.fillStyle = isWire ? 'rgba(0, 240, 255, 0.08)' : '#334155';
        ctx.strokeStyle = '#64748b';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(pPin.x, pPin.y);
        ctx.lineTo(pC.x, pC.y);
        ctx.lineTo(pW1.x, pW1.y);
        ctx.lineTo(pW2.x, pW2.y);
        ctx.closePath();
        ctx.fill(); ctx.stroke();
      });
    });

    // 3 Hydrodynamic Split Shell Bearings in 3D (Seated on shaft at Y = 0; separated only on exploded view)
    const bearingZs = [-35, 0, 35];
    bearingZs.forEach((bz, bIdx) => {
      const bOffset = exp * ((bIdx - 1) * 35);
      const bUpperY = -(exp * 24);
      const bLowerY = (exp * 24);

      const bColor = isBearingDamaged ? '#ef4444' : '#d97706';
      this.drawCircle3D(0, bUpperY, bz + bOffset, 10, 'z', bColor, null, 16);
      this.drawCircle3D(0, bLowerY, bz + bOffset, 10, 'z', bColor, null, 16);
    });

    // Rear Flywheel & Starter Ring Gear at z = shaftLen/2 + (exp * 35) in 3D
    const fwZ = shaftLen / 2 + (exp * 35);
    this.drawCircle3D(0, 0, fwZ, 28, 'z', '#64748b', isWire ? null : '#1e293b', 24);
    this.drawCircle3D(0, 0, fwZ + 3, 26, 'z', '#cbd5e1', null, 24);

    // Front Splined Snout & Reduction Pinion at z = -shaftLen/2 - (exp * 35) in 3D
    const gearZ = -shaftLen / 2 - 8 - (exp * 35);
    this.drawZAxisCylinder3D(0, 0, gearZ - 10, gearZ, 14, '#00f0ff', '#475569', 16, 6);

    // 3D Anatomy Pointer Callouts for Crankshaft Subsystem
    this.renderAnatomyCallouts([
      { title: '4-THROW CRANKSHAFT', spec: 'FORGED 4340 CHROME-MOLY', x: 0, y: 0, z: 0, side: 'left', color: '#00f0ff' },
      { title: 'SPLIT JOURNAL BEARINGS', spec: 'TRI-METAL HYDRODYNAMIC', x: 0, y: -24, z: 0, side: 'left', color: '#d97706' },
      { title: 'PRSU DRIVE SNOUT', spec: 'SPLINED REDUCTION HUB', x: 0, y: 0, z: gearZ, side: 'left', color: '#38bdf8' },
      { title: 'CRANKPIN JOURNALS', spec: '180° BOXER OFFSETS', x: 24, y: 0, z: -50, side: 'right', color: '#cbd5e1' },
      { title: 'COUNTERWEIGHT WEBS', spec: 'BALANCED PRIMARY COUPLE', x: -24, y: 0, z: -20, side: 'right', color: '#94a3b8' },
      { title: 'FLYWHEEL RING GEAR', spec: 'STARTER TEETH & SENSOR TONE', x: 0, y: 0, z: fwZ, side: 'right', color: '#64748b' }
    ]);

    ctx.restore();
  }

  /* ==========================================================================
     4. DEDICATED OIL SYSTEM 3D CAD MODEL
     ========================================================================== */
  renderOilSystemCAD() {
    const ctx = this.ctx;
    ctx.save();

    const exp = this.explodedFactor;
    const isOilLow = this.telemetry.oilPress < 35;
    const isOilCrit = this.telemetry.oilPress < 22;
    const isWire = this.viewMode === 'wireframe';
    const isCutaway = this.viewMode === 'cutaway' || this.viewMode === 'exploded';

    // A. Billet Finned Oil Sump Pan (Bottom) in 3D
    const sumpY = 32 + (exp * 50);
    const panW = 46, panH = 24, panD = 46;
    const sCorners = [
      [-panW, sumpY - 6, -panD], [panW, sumpY - 6, -panD], [panW, sumpY + panH, -panD], [-panW, sumpY + panH, -panD],
      [-panW, sumpY - 6, panD],  [panW, sumpY - 6, panD],  [panW, sumpY + panH, panD],  [-panW, sumpY + panH, panD]
    ];
    const sProj = sCorners.map(c => this.project(c[0], c[1], c[2]));

    if (isWire) {
      ctx.strokeStyle = isOilCrit ? '#ef4444' : (isOilLow ? '#f59e0b' : '#00f0ff');
      ctx.lineWidth = 1.4;
      this.drawBoxEdges(sProj);
    } else {
      const alpha = isCutaway ? 0.35 : 0.90;
      const panColor = isOilCrit ? 'rgba(239, 68, 68, 0.7)' : (isOilLow ? 'rgba(245, 158, 11, 0.65)' : `rgba(18, 28, 48, ${alpha})`);

      const panFaces = [
        { indices: [0, 1, 2, 3], z: (sProj[0].z + sProj[1].z + sProj[2].z + sProj[3].z) / 4, c: panColor },
        { indices: [5, 4, 7, 6], z: (sProj[5].z + sProj[4].z + sProj[7].z + sProj[6].z) / 4, c: panColor },
        { indices: [3, 2, 6, 7], z: (sProj[3].z + sProj[2].z + sProj[6].z + sProj[7].z) / 4, c: 'rgba(12, 18, 32, 0.95)' },
        { indices: [4, 0, 3, 7], z: (sProj[4].z + sProj[0].z + sProj[3].z + sProj[7].z) / 4, c: panColor },
        { indices: [1, 5, 6, 2], z: (sProj[1].z + sProj[5].z + sProj[6].z + sProj[2].z) / 4, c: panColor }
      ];
      panFaces.sort((a, b) => b.z - a.z);

      ctx.strokeStyle = isOilCrit ? '#ef4444' : (isOilLow ? '#f59e0b' : 'rgba(0, 240, 255, 0.5)');
      ctx.lineWidth = 1;
      panFaces.forEach(f => {
        this.drawQuad(sProj[f.indices[0]], sProj[f.indices[1]], sProj[f.indices[2]], sProj[f.indices[3]], f.c);
      });
    }

    // 7 Billet Sump Cooling Fins along bottom in 3D
    [-30, -20, -10, 0, 10, 20, 30].forEach(fx => {
      const f1 = this.project(fx, sumpY + panH, -panD + 4);
      const f2 = this.project(fx, sumpY + panH, panD - 4);
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.6)';
      ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(f1.x, f1.y); ctx.lineTo(f2.x, f2.y); ctx.stroke();
    });

    // Magnetic Brass Drain Plug at bottom in 3D
    this.drawCircle3D(0, sumpY + panH + 2, 0, 4.5, 'y', '#f59e0b', '#b45309', 12);

    // Oil Level Sight Glass on Sump Wall in 3D
    this.drawCircle3D(panW, sumpY + 8, 0, 6, 'x', '#38bdf8', isOilLow ? 'rgba(239, 68, 68, 0.8)' : 'rgba(245, 158, 11, 0.85)', 16);

    // B. Gerotor Oil Pump in 3D (Left Side)
    const pumpX = -38 - (exp * 42);
    const pumpY = -14;
    this.drawAxialCylinder3D(pumpX - 10, pumpX + 10, pumpY, 0, 22, '#00f0ff', 'rgba(28, 44, 76, 0.95)', 20, 4);

    // Rotating 4-Lobe Trochoid Inner Driver in 3D
    const driveAngle = this.crankAngle * 1.5;
    this.drawCircle3D(pumpX - 10.5, pumpY, 0, 11, 'x', '#fbbf24', '#b45309', 16);

    // C. Spin-On 15W-50 Filter Canister in 3D (Right Side)
    const filterX = 38 + (exp * 42);
    const filterY = -12;
    this.drawCylinder3D(filterX, filterY - 24, filterY + 24, 0, 15, '#cbd5e1', 'rgba(15, 23, 42, 0.95)', 18, 4);
    this.drawCircle3D(filterX, filterY - 24, 0, 15, 'y', '#f8fafc', '#334155', 18);

    // D. Braided Stainless AN-8 Lines Connecting Pump to Filter & Sump in 3D
    const lineP1 = this.project(pumpX + 10, pumpY - 8, 0);
    const lineP2 = this.project((pumpX + filterX) / 2, pumpY - 22, 0);
    const lineP3 = this.project(filterX - 15, filterY - 8, 0);
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(lineP1.x, lineP1.y);
    ctx.quadraticCurveTo(lineP2.x, lineP2.y, lineP3.x, lineP3.y);
    ctx.stroke();

    // 3D Anatomy Pointer Callouts for Oil System Subsystem
    this.renderAnatomyCallouts([
      { title: 'BILLET OIL SUMP', spec: '7 COOLING RIBS • WET SUMP', x: 0, y: sumpY, z: 0, side: 'left', color: '#00f0ff' },
      { title: 'SIGHT GLASS', spec: '15W-50 SYNTHETIC LEVEL', x: panW, y: sumpY + 8, z: 0, side: 'left', color: '#f59e0b' },
      { title: 'GEROTOR TROCHOID PUMP', spec: 'POSITIVE DISPLACEMENT 50 PSI', x: pumpX, y: pumpY, z: 0, side: 'left', color: '#00f0ff' },
      { title: 'SPIN-ON OIL FILTER', spec: '10-MICRON FULL-FLOW ELEMENT', x: filterX, y: filterY, z: 0, side: 'right', color: '#cbd5e1' },
      { title: 'MAGNETIC DRAIN PLUG', spec: 'FE WEAR PARTICLE TRAP', x: 0, y: sumpY + panH + 2, z: 0, side: 'right', color: '#b45309' },
      { title: 'AN-8 BRAIDED HOSE', spec: 'STAINLESS COOLER FEED LINE', x: 0, y: pumpY - 22, z: 0, side: 'right', color: '#cbd5e1' }
    ]);

    ctx.restore();
  }

  /* ==========================================================================
     5. DEDICATED FUEL SYSTEM 3D CAD MODEL
     ========================================================================== */
  renderFuelSystemCAD() {
    const ctx = this.ctx;
    ctx.save();

    const exp = this.explodedFactor;
    const isCutoff = !this.telemetry.fuelWallOpen;
    const isWire = this.viewMode === 'wireframe';

    // A. Extruded Aluminum Fuel Rail in 3D along X axis
    const railY = -36 - (exp * 42);
    const railColor = isCutoff ? '#64748b' : '#00f0ff';
    this.drawAxialCylinder3D(-65, 65, railY, 0, 7.5, railColor, isWire ? null : 'rgba(15, 23, 42, 0.95)', 16, 4);

    // Schrader Pressure Sampling Port in 3D
    this.drawCylinder3D(40, railY - 14, railY, 0, 3.5, '#f59e0b', '#b45309', 10, 2);

    // B. High-Pressure Solenoid Injector in 3D
    const injY = 10 + (exp * 45);
    this.drawCylinder3D(0, injY - 24, injY + 24, 0, 11, isCutoff ? '#64748b' : '#38bdf8', isWire ? null : '#1e293b', 16, 4);

    // Internal Solenoid Copper Coil in 3D
    for (let c = -16; c <= 8; c += 4) {
      this.drawCircle3D(0, injY + c, 0, 8.5, 'y', '#d97706', null, 12);
    }

    // Atomizing Fuel Nozzle Spray Cone in 3D (Pulses with injection pulse)
    if (!isCutoff) {
      const nozzleP = this.project(0, injY + 24, 0);
      const sprayConeP1 = this.project(-18, injY + 52, 0);
      const sprayConeP2 = this.project(18, injY + 52, 0);
      ctx.fillStyle = 'rgba(56, 189, 248, 0.25)';
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.6)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(nozzleP.x, nozzleP.y);
      ctx.lineTo(sprayConeP1.x, sprayConeP1.y);
      ctx.lineTo(sprayConeP2.x, sprayConeP2.y);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
    }

    // C. Emergency Firewall Shutoff Ball Valve in 3D (Left side)
    const fwP = this.project(-45, -5, 0);
    this.drawCircle3D(-45, -5, 0, 11, 'z', isCutoff ? '#ef4444' : '#10b981', isCutoff ? 'rgba(239, 68, 68, 0.4)' : 'rgba(16, 185, 129, 0.4)', 16);

    // 3D Anatomy Pointer Callouts for Fuel System Subsystem
    this.renderAnatomyCallouts([
      { title: 'FIREWALL BALL VALVE', spec: isCutoff ? 'CLOSED (CUTOFF)' : 'OPEN (ARMED)', x: -45, y: -5, z: 0, side: 'left', color: isCutoff ? '#ef4444' : '#10b981' },
      { title: 'SOLENOID INJECTOR', spec: 'BOSCH HIGH-PRESSURE PULSED', x: 0, y: injY - 10, z: 0, side: 'left', color: '#38bdf8' },
      { title: 'BILLET FUEL RAIL', spec: 'ANODIZED AERO ALLOY', x: 0, y: railY, z: 0, side: 'right', color: '#00f0ff' },
      { title: 'PRESSURE TEST PORT', spec: 'SCHRADER SAMPLING VALVE', x: 40, y: railY - 14, z: 0, side: 'right', color: '#b45309' },
      { title: 'ATOMIZING NOZZLE', spec: '4-HOLE SPRAY TIP', x: 0, y: injY + 28, z: 0, side: 'right', color: '#38bdf8' }
    ]);

    ctx.restore();
  }

  /* ==========================================================================
     6. DEDICATED PRSU REDUCTION GEARBOX 3D CAD MODEL
     ========================================================================== */
  renderGearboxCAD() {
    const ctx = this.ctx;
    ctx.save();

    const exp = this.explodedFactor;
    const isWire = this.viewMode === 'wireframe';

    // A. Cast Magnesium Gearbox Split Casing in 3D
    const caseLeftX = -25 - (exp * 42);
    const caseRightX = 25 + (exp * 42);
    [caseLeftX, caseRightX].forEach(cx => {
      const p = this.project(cx, 0, 0);
      ctx.fillStyle = isWire ? 'rgba(0, 240, 255, 0.08)' : 'rgba(28, 45, 75, 0.88)';
      ctx.strokeStyle = '#00f0ff';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.rect(p.x - 18 * p.scale, p.y - 32 * p.scale, 36 * p.scale, 64 * p.scale);
      ctx.fill(); ctx.stroke();
    });

    // B. Input Drive Pinion Gear in 3D along Z axis (4200 RPM Crank Drive)
    this.drawZAxisCylinder3D(0, 22, -10, 10, 14, '#94a3b8', isWire ? null : '#475569', 16, 6);
    // Pinion teeth in 3D
    for (let t = 0; t < 12; t++) {
      const a = this.crankAngle + (t * Math.PI / 6);
      const px1 = Math.cos(a) * 16;
      const py1 = 22 + Math.sin(a) * 16;
      const p1 = this.project(px1, py1, -10);
      const p2 = this.project(px1, py1, 10);
      ctx.strokeStyle = '#cbd5e1'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
    }

    // C. Output Helical Bull Gear in 3D along Z axis (2.43:1 Ratio, 1728 RPM)
    const bullAngle = -this.crankAngle / 2.43;
    this.drawZAxisCylinder3D(0, -14, -10, 10, 30, '#38bdf8', isWire ? null : '#334155', 24, 8);
    // Bull gear teeth in 3D
    for (let t = 0; t < 24; t++) {
      const a = bullAngle + (t * Math.PI / 12);
      const bx1 = Math.cos(a) * 33;
      const by1 = -14 + Math.sin(a) * 33;
      const p1 = this.project(bx1, by1, -10);
      const p2 = this.project(bx1, by1, 10);
      ctx.strokeStyle = '#94a3b8'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
    }

    // 6 Weight-Relief Windows in Bull Gear Web in 3D
    for (let w = 0; w < 6; w++) {
      const a = bullAngle + (w * Math.PI / 3);
      const wx = Math.cos(a) * 18;
      const wy = -14 + Math.sin(a) * 18;
      this.drawCircle3D(wx, wy, 0, 4.5, 'z', '#0f172a', '#1e293b', 10);
    }

    // D. Propeller Drive Hub Flange in 3D (Z = -45)
    const flangeZ = -45 - (exp * 42);
    this.drawCircle3D(0, -14, flangeZ, 20, 'z', '#00f0ff', 'rgba(0, 240, 255, 0.3)', 20);

    // 6 Aviation Stud Bolt Holes on Propeller Hub
    for (let s = 0; s < 6; s++) {
      const a = s * Math.PI / 3;
      const sx = Math.cos(a) * 14;
      const sy = -14 + Math.sin(a) * 14;
      this.drawCircle3D(sx, sy, flangeZ, 2.5, 'z', '#fff', '#f8fafc', 8);
    }

    // 3D Anatomy Pointer Callouts for PRSU Gearbox Subsystem
    this.renderAnatomyCallouts([
      { title: 'SPLIT PRSU HOUSING', spec: 'CAST MAGNESIUM ALLOY', x: caseLeftX, y: -20, z: 0, side: 'left', color: '#00f0ff' },
      { title: 'INPUT PINION GEAR', spec: 'HELICAL 4200 RPM DRIVE', x: 0, y: 22, z: 0, side: 'left', color: '#94a3b8' },
      { title: 'PROP THRUST BEARING', spec: 'ANGULAR CONTACT RACE', x: 0, y: -14, z: flangeZ + 12, side: 'left', color: '#fbbf24' },
      { title: 'OUTPUT BULL GEAR', spec: '2.43:1 RATIO HELICAL', x: 0, y: -14, z: 0, side: 'right', color: '#38bdf8' },
      { title: 'TORSIONAL DAMPER DOGS', spec: 'NITRILE ELASTOMERIC ISOLATOR', x: 16, y: -14, z: 0, side: 'right', color: '#64748b' },
      { title: 'PROP DRIVE FLANGE', spec: '6 AN-STUD MOUNTING HUB', x: 0, y: -14, z: flangeZ, side: 'right', color: '#00f0ff' }
    ]);

    ctx.restore();
  }

  /* ==========================================================================
     DYNAMIC 3D ANATOMY POINTER CALLOUTS (STATIONARY HUD BADGES & 3D LEADER LINES)
     The names of components remain fixed and stationary on the HUD margins,
     while precision leader lines point to the 3D component anchor locations.
     This ensures the component names NEVER move or jitter with moving parts.
     ========================================================================== */
  renderAnatomyCallouts(labels) {
    if (!this.showAnatomyLabels || !labels || labels.length === 0) return;
    const ctx = this.ctx;
    ctx.save();

    // Separate into Left and Right stationary columns
    const leftList = [];
    const rightList = [];

    labels.forEach((item, idx) => {
      const side = item.side || (idx % 2 === 0 ? 'left' : 'right');
      if (side === 'left') {
        leftList.push(item);
      } else {
        rightList.push(item);
      }
    });

    const renderColumn = (colItems, isLeft) => {
      const count = colItems.length;
      if (count === 0) return;

      // Start below the top HUD bar (which resides at y: 8..36) to guarantee 0% vertical collision
      const topMargin = 46;
      const bottomMargin = 38;
      const availH = Math.max(120, this.height - topMargin - bottomMargin);
      const rowH = Math.min(42, availH / count);
      const cardW = 138;
      const cardH = 22;

      colItems.forEach((item, i) => {
        // Stationary, non-moving card coordinates at extreme side boundaries
        const cardX = isLeft ? 10 : this.width - cardW - 10;
        const cardY = topMargin + (i * rowH) + ((rowH - cardH) / 2);

        // Project 3D anchor position
        const pt = this.project(item.x, item.y, item.z);
        if (pt && pt.scale > 0 && pt.z > -420) {
          // Inner hook point on the stationary card edge
          const hookX = isLeft ? cardX + cardW : cardX;
          const hookY = cardY + (cardH / 2);

          // Subtle horizontal stub then leader line to 3D anchor point
          const stubX = isLeft ? hookX + 12 : hookX - 12;

          ctx.strokeStyle = item.color || '#00f0ff';
          ctx.lineWidth = 1;
          ctx.setLineDash([3, 2]);
          ctx.beginPath();
          ctx.moveTo(hookX, hookY);
          ctx.lineTo(stubX, hookY);
          ctx.lineTo(pt.x, pt.y);
          ctx.stroke();
          ctx.setLineDash([]);

          // Glowing Anchor Dot on 3D geometry
          ctx.fillStyle = item.color || '#00f0ff';
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, Math.max(2, 3.2 * pt.scale), 0, Math.PI * 2);
          ctx.fill();

          // Outer halo ring on 3D anchor dot
          ctx.strokeStyle = item.color || 'rgba(0, 240, 255, 0.4)';
          ctx.lineWidth = 0.8;
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, Math.max(3.5, 5.5 * pt.scale), 0, Math.PI * 2);
          ctx.stroke();
        }

        // Stationary Glassmorphism Name Card
        ctx.fillStyle = 'rgba(8, 14, 28, 0.92)';
        ctx.strokeStyle = item.color || 'rgba(0, 240, 255, 0.45)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        if (ctx.roundRect) {
          ctx.roundRect(cardX, cardY, cardW, cardH, 4);
        } else {
          ctx.rect(cardX, cardY, cardW, cardH);
        }
        ctx.fill();
        ctx.stroke();

        // Left accent bar on card
        ctx.fillStyle = item.color || '#00f0ff';
        ctx.fillRect(isLeft ? cardX : cardX + cardW - 3, cardY, 3, cardH);

        // Part Name Title (Stationary)
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 8px "Orbitron", monospace';
        ctx.textAlign = 'left';
        ctx.fillText(item.title, cardX + (isLeft ? 8 : 6), cardY + 9.5);

        // Subtitle / Engineering Spec Tag (Stationary)
        if (item.spec) {
          ctx.fillStyle = item.color || '#38bdf8';
          ctx.font = '7px "JetBrains Mono", monospace';
          ctx.fillText(item.spec, cardX + (isLeft ? 8 : 6), cardY + 18);
        }
      });
    };

    renderColumn(leftList, true);
    renderColumn(rightList, false);

    ctx.restore();
  }

  drawBoxEdges(p) {
    if (!p || p.length < 8) return;
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(p[0].x, p[0].y); ctx.lineTo(p[1].x, p[1].y);
    ctx.lineTo(p[2].x, p[2].y); ctx.lineTo(p[3].x, p[3].y); ctx.closePath();
    ctx.moveTo(p[4].x, p[4].y); ctx.lineTo(p[5].x, p[5].y);
    ctx.lineTo(p[6].x, p[6].y); ctx.lineTo(p[7].x, p[7].y); ctx.closePath();
    ctx.moveTo(p[0].x, p[0].y); ctx.lineTo(p[4].x, p[4].y);
    ctx.moveTo(p[1].x, p[1].y); ctx.lineTo(p[5].x, p[5].y);
    ctx.moveTo(p[2].x, p[2].y); ctx.lineTo(p[6].x, p[6].y);
    ctx.moveTo(p[3].x, p[3].y); ctx.lineTo(p[7].x, p[7].y);
    ctx.stroke();
  }

  drawQuad(p1, p2, p3, p4, fillStyle) {
    const ctx = this.ctx;
    ctx.fillStyle = fillStyle;
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.lineTo(p3.x, p3.y);
    ctx.lineTo(p4.x, p4.y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  /* ==========================================================================
     DRDO TAPAS-BH-201 MALE UAV 3D AIRFRAME & PROPULSION INTEGRATION
     ========================================================================== */
  renderUavAirframeCAD() {
    const ctx = this.ctx;
    const exp = this.explodedFactor;
    const isWire = this.viewMode === 'wireframe';
    const isCutaway = this.viewMode === 'cutaway';

    ctx.save();
    ctx.lineWidth = 1.2;

    const colBody = isWire ? 'rgba(0, 240, 255, 0.15)' : 'rgba(22, 38, 68, 0.9)';
    const colWing = isWire ? 'rgba(0, 240, 255, 0.12)' : 'rgba(28, 48, 84, 0.92)';
    const colEngine = isWire ? 'rgba(245, 158, 11, 0.25)' : 'rgba(245, 158, 11, 0.85)';

    // 1. Central Fuselage
    const noseZ = -95 - exp * 45;
    const pNoseTip = this.project(0, 4, noseZ);
    const pNoseL = this.project(-12, 8, noseZ + 25);
    const pNoseR = this.project(12, 8, noseZ + 25);
    const pNoseB = this.project(0, -6, noseZ + 25);
    this.drawQuad(pNoseTip, pNoseL, pNoseB, pNoseTip, isWire ? 'transparent' : 'rgba(30, 50, 85, 0.95)');
    this.drawQuad(pNoseTip, pNoseR, pNoseB, pNoseTip, isWire ? 'transparent' : 'rgba(24, 40, 72, 0.95)');

    // EO/IR Gimbal Spherical Turret under nose
    const pTurretCenter = this.project(0, -12, noseZ + 18);
    ctx.fillStyle = '#00f0ff';
    ctx.beginPath();
    ctx.arc(pTurretCenter.x, pTurretCenter.y, 7 * pTurretCenter.scale, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.stroke();

    // Sensor lens on turret
    ctx.fillStyle = '#ef4444';
    ctx.beginPath();
    ctx.arc(pTurretCenter.x + 2 * pTurretCenter.scale, pTurretCenter.y + 1 * pTurretCenter.scale, 2.5 * pTurretCenter.scale, 0, Math.PI * 2);
    ctx.fill();

    // Fuselage Midsection (Main Body)
    const pMidFL_T = this.project(-15, 12, -70);
    const pMidFR_T = this.project(15, 12, -70);
    const pMidBL_T = this.project(-14, 10, 45);
    const pMidBR_T = this.project(14, 10, 45);

    const pMidFL_B = this.project(-15, -10, -70);
    const pMidFR_B = this.project(15, -10, -70);
    const pMidBL_B = this.project(-14, -8, 45);
    const pMidBR_B = this.project(14, -8, 45);

    this.drawQuad(pMidFL_T, pMidFR_T, pMidBR_T, pMidBL_T, colBody);
    this.drawQuad(pMidFL_T, pMidBL_T, pMidBL_B, pMidFL_B, isWire ? 'transparent' : 'rgba(16, 28, 52, 0.85)');
    this.drawQuad(pMidFR_T, pMidBR_T, pMidBR_B, pMidFR_B, isWire ? 'transparent' : 'rgba(20, 36, 64, 0.85)');

    // SATCOM / Avionics Dorsal Hump
    const pSatF = this.project(0, 18, -40);
    const pSatB = this.project(0, 16, -5);
    ctx.strokeStyle = '#00f0ff';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(pSatF.x, pSatF.y);
    ctx.lineTo(pSatB.x, pSatB.y);
    ctx.stroke();

    // 2. High-Aspect-Ratio MALE Composite Wings (Span: ~270)
    const wingExpL = -exp * 50;
    const pWL_RootLE = this.project(-15 + wingExpL, 8, -25);
    const pWL_RootTE = this.project(-15 + wingExpL, 6, 15);
    const pWL_TipLE = this.project(-145 + wingExpL, 12, -10);
    const pWL_TipTE = this.project(-145 + wingExpL, 10, 5);

    this.drawQuad(pWL_RootLE, pWL_TipLE, pWL_TipTE, pWL_RootTE, colWing);

    // Left Winglet
    const pWL_LetTop = this.project(-147 + wingExpL, 26, -2);
    ctx.beginPath();
    ctx.moveTo(pWL_TipLE.x, pWL_TipLE.y);
    ctx.lineTo(pWL_LetTop.x, pWL_LetTop.y);
    ctx.lineTo(pWL_TipTE.x, pWL_TipTE.y);
    ctx.strokeStyle = '#fff';
    ctx.stroke();

    // Right Wing
    const wingExpR = exp * 50;
    const pWR_RootLE = this.project(15 + wingExpR, 8, -25);
    const pWR_RootTE = this.project(15 + wingExpR, 6, 15);
    const pWR_TipLE = this.project(145 + wingExpR, 12, -10);
    const pWR_TipTE = this.project(145 + wingExpR, 10, 5);

    this.drawQuad(pWR_RootLE, pWR_TipLE, pWR_TipTE, pWR_RootTE, colWing);

    // Right Winglet
    const pWR_LetTop = this.project(147 + wingExpR, 26, -2);
    ctx.beginPath();
    ctx.moveTo(pWR_TipLE.x, pWR_TipLE.y);
    ctx.lineTo(pWR_LetTop.x, pWR_LetTop.y);
    ctx.lineTo(pWR_TipTE.x, pWR_TipTE.y);
    ctx.strokeStyle = '#fff';
    ctx.stroke();

    // Navigation Strobes on wingtips
    const isStrobe = Math.sin(Date.now() * 0.007) > 0;
    ctx.fillStyle = isStrobe ? '#ef4444' : '#551111';
    ctx.beginPath(); ctx.arc(pWL_TipLE.x, pWL_TipLE.y, 3.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = isStrobe ? '#10b981' : '#114422';
    ctx.beginPath(); ctx.arc(pWR_TipLE.x, pWR_TipLE.y, 3.5, 0, Math.PI * 2); ctx.fill();

    // 3. Twin Booms extending rearward
    const pBoomL_F = this.project(-45 + wingExpL * 0.4, 7, -5);
    const pBoomL_R = this.project(-45 + wingExpL * 0.4, 8, 115);
    ctx.strokeStyle = '#00f0ff';
    ctx.lineWidth = 2.4;
    ctx.beginPath(); ctx.moveTo(pBoomL_F.x, pBoomL_F.y); ctx.lineTo(pBoomL_R.x, pBoomL_R.y); ctx.stroke();

    const pBoomR_F = this.project(45 + wingExpR * 0.4, 7, -5);
    const pBoomR_R = this.project(45 + wingExpR * 0.4, 8, 115);
    ctx.beginPath(); ctx.moveTo(pBoomR_F.x, pBoomR_F.y); ctx.lineTo(pBoomR_R.x, pBoomR_R.y); ctx.stroke();

    // 4. Inverted V-Tail (Ruddervators)
    const pTailApex = this.project(0, -6, 128);
    const pTailFinL = this.project(-52 + wingExpL * 0.4, 28, 122);
    const pTailFinR = this.project(52 + wingExpR * 0.4, 28, 122);

    ctx.strokeStyle = '#00f0ff';
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(pBoomL_R.x, pBoomL_R.y);
    ctx.lineTo(pTailFinL.x, pTailFinL.y);
    ctx.lineTo(pTailApex.x, pTailApex.y);
    ctx.lineTo(pTailFinR.x, pTailFinR.y);
    ctx.lineTo(pBoomR_R.x, pBoomR_R.y);
    ctx.stroke();

    // Horizontal stabilizer joiner
    ctx.beginPath();
    ctx.moveTo(pBoomL_R.x, pBoomL_R.y);
    ctx.lineTo(pTailApex.x, pTailApex.y);
    ctx.lineTo(pBoomR_R.x, pBoomR_R.y);
    ctx.stroke();

    // 5. Rear Engine Nacelle & Installed Aero Piston Engine
    const engY = 2 + exp * 35;
    const pEngF_T = this.project(-10, engY + 8, 15);
    const pEngR_T = this.project(10, engY + 8, 15);
    const pEngB_R = this.project(9, engY - 6, 62);
    const pEngB_L = this.project(-9, engY - 6, 62);

    this.drawQuad(pEngF_T, pEngR_T, pEngB_R, pEngB_L, colEngine);

    // Engine cylinder banks protruding slightly from rear fuselage
    const pCylL = this.project(-18, engY + 2, 38);
    const pCylR = this.project(18, engY + 2, 38);
    ctx.fillStyle = '#f59e0b';
    ctx.beginPath(); ctx.arc(pCylL.x, pCylL.y, 4.5 * pCylL.scale, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(pCylR.x, pCylR.y, 4.5 * pCylR.scale, 0, Math.PI * 2); ctx.fill();

    // 6. Spinning Pusher Propeller
    const pPropHub = this.project(0, 1, 68);
    const propR = 24 * pPropHub.scale;
    const propAngle = (Date.now() * 0.04) % (Math.PI * 2);

    // Prop blur disc
    ctx.fillStyle = 'rgba(245, 158, 11, 0.2)';
    ctx.beginPath();
    ctx.arc(pPropHub.x, pPropHub.y, propR, 0, Math.PI * 2);
    ctx.fill();

    // 3 Propeller blades
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 2.2;
    for (let b = 0; b < 3; b++) {
      const a = propAngle + (b * Math.PI * 2) / 3;
      ctx.beginPath();
      ctx.moveTo(pPropHub.x, pPropHub.y);
      ctx.lineTo(pPropHub.x + Math.cos(a) * propR, pPropHub.y + Math.sin(a) * propR);
      ctx.stroke();
    }

    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(pPropHub.x, pPropHub.y, 3 * pPropHub.scale, 0, Math.PI * 2);
    ctx.fill();

    // 7. Interactive 3D Anatomy Labels
    if (this.showAnatomyLabels) {
      const labels = [
        { title: "1. EO/IR SENSOR GIMBAL", pt: pTurretCenter, offX: -45, offY: -28 },
        { title: "2. 20.6M COMPOSITE WINGS", pt: pWL_TipLE, offX: -60, offY: -25 },
        { title: "3. 115 HP TURBO PISTON (PUSHER)", pt: this.project(0, engY + 12, 38), offX: 55, offY: -30 },
        { title: "4. TWIN CARBON TAIL BOOMS", pt: pBoomR_R, offX: 50, offY: -15 },
        { title: "5. INVERTED V-TAIL", pt: pTailApex, offX: 45, offY: 25 },
        { title: "6. 3-BLADE PUSHER PROPELLER", pt: pPropHub, offX: -55, offY: 30 }
      ];

      ctx.font = 'bold 8px "Orbitron", monospace';
      labels.forEach(lbl => {
        ctx.strokeStyle = 'rgba(0, 240, 255, 0.6)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(lbl.pt.x, lbl.pt.y);
        ctx.lineTo(lbl.pt.x + lbl.offX, lbl.pt.y + lbl.offY);
        ctx.stroke();

        ctx.fillStyle = 'rgba(8, 14, 28, 0.88)';
        ctx.strokeStyle = 'rgba(0, 240, 255, 0.4)';
        const tw = ctx.measureText(lbl.title).width + 10;
        ctx.fillRect(lbl.pt.x + lbl.offX - 4, lbl.pt.y + lbl.offY - 10, tw, 14);
        ctx.strokeRect(lbl.pt.x + lbl.offX - 4, lbl.pt.y + lbl.offY - 10, tw, 14);

        ctx.fillStyle = '#00f0ff';
        ctx.fillText(lbl.title, lbl.pt.x + lbl.offX, lbl.pt.y + lbl.offY);
      });
    }

    ctx.restore();
  }

  /* ==========================================================================
     HUD & TECHNICAL METRIC OVERLAY
     ========================================================================== */
  renderHUDOverlay() {
    const ctx = this.ctx;
    ctx.save();

    // Bottom-Left Coordinate Axis Triad
    const gx = 36;
    const gy = this.height - 36;
    const gLen = 20;
    const cosY = Math.cos(this.cam.rotY), sinY = Math.sin(this.cam.rotY);
    const cosX = Math.cos(this.cam.rotX), sinX = Math.sin(this.cam.rotX);

    const xEnd = { x: gx + gLen * cosY, y: gy + gLen * sinX * sinY };
    const yEnd = { x: gx, y: gy - gLen * cosX };
    const zEnd = { x: gx + gLen * sinY, y: gy - gLen * sinX * cosY };

    ctx.lineWidth = 1.5;
    // X (Pitch)
    ctx.strokeStyle = '#ef4444';
    ctx.beginPath(); ctx.moveTo(gx, gy); ctx.lineTo(xEnd.x, xEnd.y); ctx.stroke();
    // Y (Yaw)
    ctx.strokeStyle = '#10b981';
    ctx.beginPath(); ctx.moveTo(gx, gy); ctx.lineTo(yEnd.x, yEnd.y); ctx.stroke();
    // Z (Depth)
    ctx.strokeStyle = '#00f0ff';
    ctx.beginPath(); ctx.moveTo(gx, gy); ctx.lineTo(zEnd.x, zEnd.y); ctx.stroke();

    // Corner HUD Brackets
    const bLen = 10;
    ctx.strokeStyle = 'rgba(0, 240, 255, 0.4)';
    ctx.lineWidth = 1;
    // Top-Left
    ctx.beginPath(); ctx.moveTo(10, 10 + bLen); ctx.lineTo(10, 10); ctx.lineTo(10 + bLen, 10); ctx.stroke();
    // Top-Right
    ctx.beginPath(); ctx.moveTo(this.width - 10 - bLen, 10); ctx.lineTo(this.width - 10, 10); ctx.lineTo(this.width - 10, 10 + bLen); ctx.stroke();
    // Bottom-Left
    ctx.beginPath(); ctx.moveTo(10, this.height - 10 - bLen); ctx.lineTo(10, this.height - 10); ctx.lineTo(10 + bLen, this.height - 10); ctx.stroke();
    // Bottom-Right
    ctx.beginPath(); ctx.moveTo(this.width - 10 - bLen, this.height - 10); ctx.lineTo(this.width - 10, this.height - 10); ctx.lineTo(this.width - 10, this.height - 10 - bLen); ctx.stroke();

    // Top-Center Dynamic Component Information Card (Slow, Readable, Educational)
    // Constrained width with safe clearance so it NEVER overlaps side callout columns
    const sideClearance = 162; // Side callouts extend to x: 10..148 on left, and x: (width-148)..width on right
    const maxCenterW = Math.max(160, this.width - (sideClearance * 2));
    const cardW = Math.min(320, maxCenterW);
    const cardH = 28;
    const cardX = (this.width - cardW) / 2;
    const cardY = 8;

    ctx.fillStyle = 'rgba(8, 14, 28, 0.92)';
    ctx.strokeStyle = 'rgba(0, 240, 255, 0.5)';
    ctx.lineWidth = 1.2;
    if (ctx.roundRect) ctx.roundRect(cardX, cardY, cardW, cardH, 5);
    else ctx.rect(cardX, cardY, cardW, cardH);
    ctx.fill(); ctx.stroke();

    const state = this.getComponentDetailedState();

    ctx.fillStyle = '#00f0ff';
    ctx.font = 'bold 9.5px "Orbitron", monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`${state.badge} • ${state.degText}`, cardX + cardW / 2, cardY + 11.5);

    // Primary Readings Subtitle
    ctx.fillStyle = '#cbd5e1';
    ctx.font = '8px "JetBrains Mono", monospace';
    const firstMetric = (state.chips && state.chips[0]) ? `${state.chips[0].label}: ${state.chips[0].val}` : '';
    const secondMetric = (state.chips && state.chips[1]) ? ` | ${state.chips[1].label}: ${state.chips[1].val}` : '';
    let subtitle = `${firstMetric}${secondMetric}`;
    if (ctx.measureText(subtitle).width > cardW - 16) {
      subtitle = firstMetric;
    }
    ctx.fillText(subtitle, cardX + cardW / 2, cardY + 22.5);

    // Mode Tag in bottom right
    ctx.fillStyle = '#94a3b8';
    ctx.font = '8.5px "JetBrains Mono", monospace';
    ctx.textAlign = 'right';
    const speedStr = this.isPaused ? 'FREEZE' : `${this.speedMultiplier}x`;
    const crankDeg = Math.round((this.crankAngle * 180 / Math.PI) % 720);
    const modeStr = this.width > 750
      ? `SPEED: ${speedStr} | CRANK: ${crankDeg}° | VIEW: ${this.viewMode.toUpperCase()} | EXPLODED: ${Math.round(this.explodedFactor * 100)}%`
      : `CRANK: ${crankDeg}° | ${speedStr}`;
    ctx.fillText(modeStr, this.width - 16, this.height - 14);

    ctx.restore();
  }
}

window.Subsystem3DViewer = Subsystem3DViewer;
