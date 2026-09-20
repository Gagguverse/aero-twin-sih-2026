/* ==========================================================================
   AERO TWIN — Photorealistic 3D Digital Twin Aero Piston Engine
   WebGL Three.js Implementation (Rotax 914 / Boxer-4 Aero Engine)
   Synchronized Real-Time Kinematics, Thermal Hotspots, Sensor Fault Halo &
   Interactive Engine Inspection / X-Ray Cutaway / Piston 1-4 Focus Modes
   ========================================================================== */

(function () {
  'use strict';

  class AeroPistonDigitalTwin {
    constructor(canvasId) {
      this.canvas = document.getElementById(canvasId);
      if (!this.canvas) return;

      // Ensure Three.js is loaded
      if (typeof THREE === 'undefined') {
        console.error('Three.js is not loaded. Cannot initialize 3D digital twin.');
        return;
      }

      this.state = {
        rpm: 4200,
        mode: 'normal', // 'normal' | 'sensor_fault' | 'thermal_degradation'
        status: 'NOMINAL',
        oilPressTrust: 0.97,
        cht: 178,
        egt: 824,
        heatFactor: 0.0,
        targetHeatFactor: 0.0
      };

      this.thermalMaterials = [];
      this.exhaustMaterials = [];
      this.sensorCallout = null;

      // Kinematic Reciprocating Engine Motion (Mechanical Working Principle)
      this.crankAngle = 0;
      this.motionPlaying = true; // Engine is running on dashboard startup
      this.speedFactor = 1.0;
      this.crankRadius = 0.30; // Visible, believable crank throw
      this.conrodLength = 1.35; // Connecting rod length (H-beam)
      this.kinematicPistons = []; // [{ cfg, pistonGroup, conrodGroup, crownMesh, rodBeam, pinMesh }]
      this.crankpinMeshes = [];
      this.highlightedMeshes = [];

      // Interactive Inspection & Component Mapping
      this.inspectionMode = 'inspect'; // 'inspect' | 'xray' | 'exploded'
      this.selectedComponentId = null;
      this.selectableComponents = new Map();
      this.pickableMeshes = [];
      this.cylinderAssemblies = [];
      this.highlightedMesh = null;
      this.originalMaterial = null;

      this._initThree();
      this._buildAeroEngine();
      this._setupLights();
      this._setupInteractions();
      this._animate = this._animate.bind(this);
      requestAnimationFrame(this._animate);
    }

    _initThree() {
      const rect = this.canvas.getBoundingClientRect();
      this.width = rect.width || this.canvas.parentElement?.clientWidth || 600;
      this.height = rect.height || this.canvas.parentElement?.clientHeight || 360;

      // Renderer
      this.renderer = new THREE.WebGLRenderer({
        canvas: this.canvas,
        antialias: true,
        alpha: true,
        powerPreference: 'high-performance'
      });
      this.renderer.setSize(this.width, this.height);
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = 1.25;
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

      // Scene
      this.scene = new THREE.Scene();

      // Camera
      this.camera = new THREE.PerspectiveCamera(38, this.width / this.height, 0.1, 100);
      this.camera.position.set(5.5, 3.8, 6.5);

      // OrbitControls
      if (THREE.OrbitControls) {
        this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.06;
        this.controls.minDistance = 2.0;
        this.controls.maxDistance = 16;
        this.controls.maxPolarAngle = Math.PI / 2 + 0.15;
        this.controls.target.set(0, 0.2, 0);
      }

      // Resize Listener
      window.addEventListener('resize', () => {
        this.resize();
      });
    }

    resize() {
      if (!this.canvas || !this.renderer || !this.camera) return;
      const rect = this.canvas.getBoundingClientRect();
      const parent = this.canvas.parentElement;
      const w = rect.width || (parent ? parent.clientWidth : 600) || 600;
      const h = rect.height || (parent ? parent.clientHeight : 360) || 360;
      if (w > 0 && h > 0) {
        this.width = w;
        this.height = h;
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(w, h);
      }
    }

    _setupLights() {
      // Studio Lighting
      const ambientLight = new THREE.AmbientLight(0x334155, 1.8);
      this.scene.add(ambientLight);

      // Key Sunlight
      this.keyLight = new THREE.DirectionalLight(0xffffff, 2.5);
      this.keyLight.position.set(8, 12, 8);
      this.keyLight.castShadow = true;
      this.keyLight.shadow.mapSize.width = 1024;
      this.keyLight.shadow.mapSize.height = 1024;
      this.keyLight.shadow.bias = -0.001;
      this.scene.add(this.keyLight);

      // Fill Light (Cool cyan for aero tech aesthetic)
      const fillLight = new THREE.DirectionalLight(0x38bdf8, 1.4);
      fillLight.position.set(-8, 6, -6);
      this.scene.add(fillLight);

      // Rim Light for edge definition on machined metal
      const rimLight = new THREE.DirectionalLight(0x6ee7b7, 1.1);
      rimLight.position.set(0, -6, -8);
      this.scene.add(rimLight);

      // Sensor Focus Diagnostic Point Light (Amber/Red)
      this.sensorLight = new THREE.PointLight(0xef4444, 0, 4);
      this.sensorLight.position.set(1.4, 1.2, 1.5);
      this.scene.add(this.sensorLight);

      // Engine Thermal Radiation Light
      this.thermalLight = new THREE.PointLight(0xef4444, 0, 6);
      this.thermalLight.position.set(0, 0.8, 0);
      this.scene.add(this.thermalLight);

      // Ground Plane with Technical Grid
      const grid = new THREE.GridHelper(14, 28, 0x334155, 0x1e2838);
      grid.position.y = -1.6;
      this.scene.add(grid);

      // Subtle shadow catcher floor
      const shadowPlaneGeo = new THREE.PlaneGeometry(16, 16);
      const shadowPlaneMat = new THREE.ShadowMaterial({ opacity: 0.35 });
      const shadowPlane = new THREE.Mesh(shadowPlaneGeo, shadowPlaneMat);
      shadowPlane.rotation.x = -Math.PI / 2;
      shadowPlane.position.y = -1.59;
      shadowPlane.receiveShadow = true;
      this.scene.add(shadowPlane);
    }

    _buildAeroEngine() {
      this.engineGroup = new THREE.Group();
      this.scene.add(this.engineGroup);

      // ======================================================================
      // 1. REALISTIC MATERIALS
      // ======================================================================
      // Cast aluminum crankcase
      this.matCrankcase = new THREE.MeshStandardMaterial({
        color: 0x64748b,
        roughness: 0.38,
        metalness: 0.72
      });

      // Machined gearbox housing
      this.matGearbox = new THREE.MeshStandardMaterial({
        color: 0x94a3b8,
        roughness: 0.25,
        metalness: 0.85
      });

      // Cylinder Head with thermal emissive capabilities
      this.matCylinderHead = new THREE.MeshStandardMaterial({
        color: 0x475569,
        roughness: 0.35,
        metalness: 0.75,
        emissive: 0x000000,
        emissiveIntensity: 0
      });
      this.thermalMaterials.push(this.matCylinderHead);

      // Cylinder Fin Material (Annular rings)
      this.matFins = new THREE.MeshStandardMaterial({
        color: 0x334155,
        roughness: 0.3,
        metalness: 0.82,
        emissive: 0x000000,
        emissiveIntensity: 0
      });
      this.thermalMaterials.push(this.matFins);

      // Stainless Steel Exhaust System
      this.matExhaust = new THREE.MeshStandardMaterial({
        color: 0x78716c,
        roughness: 0.28,
        metalness: 0.88,
        emissive: 0x000000,
        emissiveIntensity: 0
      });
      this.exhaustMaterials.push(this.matExhaust);

      // Chrome / Steel Bolts & Flanges
      this.matChrome = new THREE.MeshStandardMaterial({
        color: 0xf1f5f9,
        roughness: 0.12,
        metalness: 0.98
      });

      // Brass Sensor Fittings
      this.matBrass = new THREE.MeshStandardMaterial({
        color: 0xd97706,
        roughness: 0.22,
        metalness: 0.92
      });

      // Matte Black Carbon & Rubber lines
      this.matRubber = new THREE.MeshStandardMaterial({
        color: 0x0f172a,
        roughness: 0.85,
        metalness: 0.05
      });

      // Spark Plug Ceramic
      this.matCeramic = new THREE.MeshStandardMaterial({
        color: 0xf8fafc,
        roughness: 0.1,
        metalness: 0.1
      });

      // Internal Machined Aluminum Pistons (X-Ray & Inspection Focus)
      this.matPiston = new THREE.MeshStandardMaterial({
        color: 0x94a3b8,
        roughness: 0.28,
        metalness: 0.88,
        emissive: 0x000000,
        emissiveIntensity: 0
      });
      this.thermalMaterials.push(this.matPiston);

      // Forged Steel Connecting Rods
      this.matConrod = new THREE.MeshStandardMaterial({
        color: 0x64748b,
        roughness: 0.22,
        metalness: 0.92
      });

      // Precision Machined Crankshaft
      this.matCrankshaft = new THREE.MeshStandardMaterial({
        color: 0xcbd5e1,
        roughness: 0.16,
        metalness: 0.96
      });

      // ======================================================================
      // 2. CENTRAL CRANKCASE, INTERNAL CRANKSHAFT & OIL SUMP
      // ======================================================================
      // Central Block
      const crankGeo = new THREE.BoxGeometry(1.6, 1.4, 2.8);
      const crankMesh = new THREE.Mesh(crankGeo, this.matCrankcase);
      crankMesh.castShadow = true;
      crankMesh.receiveShadow = true;
      this.engineGroup.add(crankMesh);

      crankMesh.userData = {
        componentId: 'crankcase',
        name: 'Engine Crankcase',
        category: 'STRUCTURAL CORE',
        type: 'block',
        desc: 'Cast aluminum-alloy split crankcase with reinforced tie bolts housing main bearings and cylinder journals.'
      };
      this.selectableComponents.set('crankcase', {
        mesh: crankMesh,
        name: 'Engine Crankcase',
        category: 'STRUCTURAL CORE',
        type: 'block',
        desc: 'Cast aluminum-alloy split crankcase with reinforced tie bolts housing main bearings and cylinder journals.'
      });
      this.pickableMeshes.push(crankMesh);

      // Top Crankcase Ribbing
      for (let z = -1.1; z <= 1.1; z += 0.44) {
        const ribGeo = new THREE.BoxGeometry(1.68, 0.08, 0.08);
        const ribMesh = new THREE.Mesh(ribGeo, this.matCrankcase);
        ribMesh.position.set(0, 0.72, z);
        this.engineGroup.add(ribMesh);
      }

      // Centerline Split Flange
      const flangeGeo = new THREE.BoxGeometry(0.12, 1.5, 2.9);
      const flangeMesh = new THREE.Mesh(flangeGeo, this.matGearbox);
      this.engineGroup.add(flangeMesh);

      // Crankcase Perimeter Bolts
      const boltGeo = new THREE.CylinderGeometry(0.035, 0.035, 0.06, 8);
      for (let z = -1.2; z <= 1.2; z += 0.3) {
        [-0.82, 0.82].forEach(x => {
          const bolt = new THREE.Mesh(boltGeo, this.matChrome);
          bolt.rotation.z = Math.PI / 2;
          bolt.position.set(x, 0.6, z);
          this.engineGroup.add(bolt);

          const boltBot = new THREE.Mesh(boltGeo, this.matChrome);
          boltBot.rotation.z = Math.PI / 2;
          boltBot.position.set(x, -0.6, z);
          this.engineGroup.add(boltBot);
        });
      }

      // Internal Central Crankshaft
      this.crankshaftGroup = new THREE.Group();
      this.engineGroup.add(this.crankshaftGroup);

      const mainJournalGeo = new THREE.CylinderGeometry(0.18, 0.18, 2.8, 24);
      const mainJournal = new THREE.Mesh(mainJournalGeo, this.matCrankshaft);
      mainJournal.rotation.x = Math.PI / 2;
      this.crankshaftGroup.add(mainJournal);

      // Crankshaft Counterweight Webs & 4 Phased Crankpin Journals
      const crankLayout = [
        { index: 1, phase: 0, z: -0.72 },
        { index: 2, phase: Math.PI, z: -0.58 },
        { index: 3, phase: Math.PI * 0.5, z: 0.58 },
        { index: 4, phase: Math.PI * 1.5, z: 0.72 }
      ];

      this.crankpinMeshes = {};

      crankLayout.forEach(cl => {
        const px = this.crankRadius * Math.cos(cl.phase);
        const py = this.crankRadius * Math.sin(cl.phase);

        // Counterweight web (Opposite to crankpin for mechanical balance)
        const webGeo = new THREE.BoxGeometry(0.58, 0.34, 0.10);
        const web = new THREE.Mesh(webGeo, this.matCrankshaft);
        web.position.set(-px * 0.75, -py * 0.75, cl.z);
        this.crankshaftGroup.add(web);

        // Precision crankpin journal linking to connecting rod big end
        const pinGeo = new THREE.CylinderGeometry(0.12, 0.12, 0.18, 16);
        const pin = new THREE.Mesh(pinGeo, this.matChrome);
        pin.rotation.x = Math.PI / 2;
        pin.position.set(px, py, cl.z);
        this.crankshaftGroup.add(pin);
        this.crankpinMeshes[cl.index] = pin;
      });

      mainJournal.userData = {
        componentId: 'crankshaft',
        name: 'Forged Steel Crankshaft',
        category: 'ROTATIONAL CORE',
        type: 'crankshaft',
        desc: 'Multi-counterweight forged steel crankshaft dynamically balanced to transfer 180-220 hp to the PRSU.'
      };
      this.selectableComponents.set('crankshaft', {
        mesh: mainJournal,
        name: 'Forged Steel Crankshaft',
        category: 'ROTATIONAL CORE',
        type: 'crankshaft',
        desc: 'Multi-counterweight forged steel crankshaft dynamically balanced to transfer 180-220 hp to the PRSU.'
      });
      this.pickableMeshes.push(mainJournal);

      // Precision Ground Camshaft (runs parallel beneath crankshaft)
      this.camshaftGroup = new THREE.Group();
      this.engineGroup.add(this.camshaftGroup);

      const camJournalGeo = new THREE.CylinderGeometry(0.10, 0.10, 2.7, 16);
      const camJournal = new THREE.Mesh(camJournalGeo, this.matConrod);
      camJournal.rotation.x = Math.PI / 2;
      camJournal.position.set(0, -0.42, 0);
      this.camshaftGroup.add(camJournal);

      // 8 Cam Lobes for 4 cylinders (intake + exhaust per cylinder)
      for (let z = -0.95; z <= 0.95; z += 0.27) {
        const lobeGeo = new THREE.BoxGeometry(0.24, 0.14, 0.08);
        const lobe = new THREE.Mesh(lobeGeo, this.matChrome);
        lobe.position.set(0.04 * Math.sin(z * 4), -0.42 + 0.04 * Math.cos(z * 4), z);
        this.camshaftGroup.add(lobe);
      }

      camJournal.userData = {
        componentId: 'camshaft',
        name: 'Precision Ground Camshaft',
        category: 'TIMING & VALVETRAIN',
        type: 'camshaft',
        desc: 'Billet steel camshaft driven at 1:2 crank speed regulating valve timing and lift.'
      };
      this.selectableComponents.set('camshaft', {
        mesh: camJournal,
        name: 'Precision Ground Camshaft',
        category: 'TIMING & VALVETRAIN',
        type: 'camshaft',
        desc: 'Billet steel camshaft driven at 1:2 crank speed regulating valve timing and lift.'
      });
      this.pickableMeshes.push(camJournal);

      // Bottom Ribbed Oil Sump
      const sumpGeo = new THREE.BoxGeometry(1.2, 0.55, 2.2);
      const sumpMesh = new THREE.Mesh(sumpGeo, this.matCrankcase);
      sumpMesh.position.set(0, -0.9, 0);
      sumpMesh.castShadow = true;
      this.engineGroup.add(sumpMesh);

      // Positive-Displacement Trochoid Oil Pump Housing
      const pumpGeo = new THREE.CylinderGeometry(0.24, 0.24, 0.28, 20);
      const pumpMesh = new THREE.Mesh(pumpGeo, this.matGearbox);
      pumpMesh.rotation.x = Math.PI / 2;
      pumpMesh.position.set(0, -0.85, -1.08);
      pumpMesh.castShadow = true;
      this.engineGroup.add(pumpMesh);

      pumpMesh.userData = {
        componentId: 'lubrication_system',
        name: 'Oil Pump & Lubrication System',
        category: 'LUBRICATION SYSTEM',
        type: 'lubrication_system',
        desc: 'Positive-displacement trochoid oil pump supplying 40-60 PSI to the engine oil gallery.'
      };
      this.selectableComponents.set('lubrication_system', {
        mesh: pumpMesh,
        name: 'Oil Pump & Lubrication System',
        category: 'LUBRICATION SYSTEM',
        type: 'lubrication_system',
        desc: 'Positive-displacement trochoid oil pump supplying 40-60 PSI to the engine oil gallery.'
      });
      this.pickableMeshes.push(pumpMesh);

      // Oil Drain Plug (Brass)
      const drainGeo = new THREE.CylinderGeometry(0.08, 0.08, 0.12, 6);
      const drainMesh = new THREE.Mesh(drainGeo, this.matBrass);
      drainMesh.position.set(0, -1.2, 0.8);
      this.engineGroup.add(drainMesh);

      // Oil Filter Canister
      const filterGeo = new THREE.CylinderGeometry(0.26, 0.26, 0.65, 24);
      const filterMesh = new THREE.Mesh(filterGeo, this.matRubber);
      filterMesh.rotation.x = Math.PI / 2;
      filterMesh.position.set(-0.7, -0.85, 1.2);
      filterMesh.castShadow = true;
      this.engineGroup.add(filterMesh);

      // ======================================================================
      // 3. FRONT GEARBOX & ROTATING PROPELLER HUB
      // ======================================================================
      // Reduction Gearbox Housing (PRSU)
      const gbGeo = new THREE.CylinderGeometry(0.55, 0.72, 0.85, 32);
      const gbMesh = new THREE.Mesh(gbGeo, this.matGearbox);
      gbMesh.rotation.x = -Math.PI / 2;
      gbMesh.position.set(0, 0.2, -1.8);
      gbMesh.castShadow = true;
      this.engineGroup.add(gbMesh);

      gbMesh.userData = {
        componentId: 'gearbox',
        name: 'Propeller Reduction Gearbox (PRSU)',
        category: 'DRIVETRAIN',
        type: 'gearbox',
        desc: 'Helical reduction gear assembly matching engine crank speed to aerodynamic propeller efficiency.'
      };
      this.selectableComponents.set('gearbox', {
        mesh: gbMesh,
        name: 'Propeller Reduction Gearbox (PRSU)',
        category: 'DRIVETRAIN',
        type: 'gearbox',
        desc: 'Helical reduction gear assembly matching engine crank speed to aerodynamic propeller efficiency.'
      });
      this.pickableMeshes.push(gbMesh);

      // Propeller Drive Flange (Rotates)
      this.propFlangeGroup = new THREE.Group();
      this.propFlangeGroup.position.set(0, 0.2, -2.25);
      this.engineGroup.add(this.propFlangeGroup);

      const propFlangeGeo = new THREE.CylinderGeometry(0.48, 0.48, 0.14, 32);
      const propFlangeMesh = new THREE.Mesh(propFlangeGeo, this.matChrome);
      propFlangeMesh.rotation.x = Math.PI / 2;
      this.propFlangeGroup.add(propFlangeMesh);

      // Propeller Center Spinner Hub
      const spinnerGeo = new THREE.ConeGeometry(0.24, 0.5, 32);
      const spinnerMesh = new THREE.Mesh(spinnerGeo, this.matChrome);
      spinnerMesh.rotation.x = -Math.PI / 2;
      spinnerMesh.position.set(0, 0, -0.28);
      this.propFlangeGroup.add(spinnerMesh);

      // 6 Propeller Hub Bolts
      for (let i = 0; i < 6; i++) {
        const angle = (i / 6) * Math.PI * 2;
        const pBolt = new THREE.Mesh(boltGeo, this.matChrome);
        pBolt.position.set(Math.cos(angle) * 0.35, Math.sin(angle) * 0.35, -0.06);
        this.propFlangeGroup.add(pBolt);
      }

      // ======================================================================
      // 4. OPPOSED 4-CYLINDER ASSEMBLIES, PISTONS 1-4 & CONNECTING RODS
      // ======================================================================
      const cylinderConfigs = [
        { name: 'Cyl 1', index: 1, side: -1, z: -0.72, phase: 0 },
        { name: 'Cyl 2', index: 2, side: 1,  z: -0.58, phase: Math.PI },
        { name: 'Cyl 3', index: 3, side: -1, z: 0.58,  phase: Math.PI * 0.5 },
        { name: 'Cyl 4', index: 4, side: 1,  z: 0.72,  phase: Math.PI * 1.5 }
      ];

      this.kinematicPistons = [];

      cylinderConfigs.forEach(cfg => {
        const cylGroup = new THREE.Group();
        cylGroup.position.set(cfg.side * 0.8, 0.05, cfg.z);
        this.engineGroup.add(cylGroup);

        this.cylinderAssemblies.push({
          cfg,
          group: cylGroup,
          baseX: cfg.side * 0.8,
          side: cfg.side
        });

        // Cylinder Base Barrel
        const barrelGeo = new THREE.CylinderGeometry(0.52, 0.52, 1.25, 32);
        const barrelMesh = new THREE.Mesh(barrelGeo, this.matCrankcase);
        barrelMesh.rotation.z = (cfg.side * Math.PI) / 2;
        barrelMesh.position.x = cfg.side * 0.6;
        barrelMesh.castShadow = true;
        cylGroup.add(barrelMesh);

        barrelMesh.userData = {
          componentId: 'cyl_' + cfg.index,
          name: 'Cylinder Barrel ' + cfg.index,
          category: 'CYLINDER ' + cfg.index,
          type: 'cylinder',
          cylIndex: cfg.index,
          desc: 'High-strength finned aluminum cylinder barrel with Nikasil-coated combustion bore.'
        };
        this.selectableComponents.set('cyl_' + cfg.index, {
          mesh: barrelMesh,
          name: 'Cylinder Barrel ' + cfg.index,
          category: 'CYLINDER ' + cfg.index,
          type: 'cylinder',
          cylIndex: cfg.index,
          desc: 'High-strength finned aluminum cylinder barrel with Nikasil-coated combustion bore.'
        });
        this.pickableMeshes.push(barrelMesh);

        // Annular Cooling Fins (11 precision machined rings)
        for (let f = 0.15; f <= 1.05; f += 0.085) {
          const finGeo = new THREE.CylinderGeometry(0.68, 0.68, 0.02, 32);
          const finMesh = new THREE.Mesh(finGeo, this.matFins);
          finMesh.rotation.z = (cfg.side * Math.PI) / 2;
          finMesh.position.x = cfg.side * f;
          finMesh.castShadow = true;
          cylGroup.add(finMesh);
        }

        // ====================================================================
        // KINEMATIC CONNECTING ROD (Pivot at crankpin, swings & translates)
        // ====================================================================
        const conrodGroup = new THREE.Group();
        this.engineGroup.add(conrodGroup);

        // Big-end bearing (encircles crankpin at 0, 0, 0)
        const bigEndGeo = new THREE.CylinderGeometry(0.18, 0.18, 0.16, 20);
        const bigEnd = new THREE.Mesh(bigEndGeo, this.matConrod);
        bigEnd.rotation.x = Math.PI / 2;
        conrodGroup.add(bigEnd);

        // Forged H-beam rod body extending from 0 to conrodLength along X
        const rodLength = this.conrodLength;
        const rodBeam = new THREE.Mesh(new THREE.BoxGeometry(rodLength - 0.28, 0.13, 0.08), this.matConrod);
        rodBeam.position.x = rodLength * 0.5;
        conrodGroup.add(rodBeam);

        // H-beam reinforcement flanges
        const flangeTop = new THREE.Mesh(new THREE.BoxGeometry(rodLength - 0.26, 0.035, 0.12), this.matConrod);
        flangeTop.position.set(rodLength * 0.5, 0.065, 0);
        conrodGroup.add(flangeTop);
        const flangeBot = new THREE.Mesh(new THREE.BoxGeometry(rodLength - 0.26, 0.035, 0.12), this.matConrod);
        flangeBot.position.set(rodLength * 0.5, -0.065, 0);
        conrodGroup.add(flangeBot);

        // Small-end bearing (encircles wristpin at conrodLength, 0, 0)
        const smallEndGeo = new THREE.CylinderGeometry(0.12, 0.12, 0.15, 16);
        const smallEnd = new THREE.Mesh(smallEndGeo, this.matConrod);
        smallEnd.rotation.x = Math.PI / 2;
        smallEnd.position.x = rodLength;
        conrodGroup.add(smallEnd);

        rodBeam.userData = {
          componentId: 'conrod_' + cfg.index,
          name: 'Connecting Rod ' + cfg.index,
          category: 'CYLINDER ' + cfg.index,
          type: 'conrod',
          cylIndex: cfg.index,
          desc: 'Forged H-beam connecting rod dynamically transferring reciprocating piston pressure to the crankshaft.'
        };
        this.selectableComponents.set('conrod_' + cfg.index, {
          mesh: rodBeam,
          name: 'Connecting Rod ' + cfg.index,
          category: 'CYLINDER ' + cfg.index,
          type: 'conrod',
          cylIndex: cfg.index,
          desc: 'Forged H-beam connecting rod dynamically transferring reciprocating piston pressure to the crankshaft.'
        });
        this.pickableMeshes.push(rodBeam);

        // ====================================================================
        // KINEMATIC PISTON (Reciprocates along cylinder bore axis)
        // ====================================================================
        const pistonGroup = new THREE.Group();
        this.engineGroup.add(pistonGroup);

        const crownGeo = new THREE.CylinderGeometry(0.44, 0.44, 0.38, 32);
        const crownMesh = new THREE.Mesh(crownGeo, this.matPiston);
        crownMesh.rotation.z = (cfg.side * Math.PI) / 2;
        crownMesh.castShadow = true;
        pistonGroup.add(crownMesh);

        // 3 Precision Gas Compression Rings
        for (let r = -0.11; r <= 0.11; r += 0.08) {
          const ringGeo = new THREE.TorusGeometry(0.445, 0.015, 8, 32);
          const ringMesh = new THREE.Mesh(ringGeo, this.matChrome);
          ringMesh.rotation.y = Math.PI / 2;
          ringMesh.position.x = cfg.side * r;
          pistonGroup.add(ringMesh);
        }

        // Steel Wristpin at (0, 0, 0) inside pistonGroup
        const wristpinMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.62, 16), this.matChrome);
        wristpinMesh.rotation.x = Math.PI / 2;
        pistonGroup.add(wristpinMesh);

        crownMesh.userData = {
          componentId: 'piston_' + cfg.index,
          name: 'Piston ' + cfg.index,
          category: 'CYLINDER ' + cfg.index,
          type: 'piston',
          cylIndex: cfg.index,
          desc: 'Forged aluminum piston with 3 gas compression rings converting combustion expansion into reciprocating work.'
        };
        this.selectableComponents.set('piston_' + cfg.index, {
          mesh: crownMesh,
          name: 'Piston ' + cfg.index,
          category: 'CYLINDER ' + cfg.index,
          type: 'piston',
          cylIndex: cfg.index,
          desc: 'Forged aluminum piston with 3 gas compression rings converting combustion expansion into reciprocating work.'
        });
        this.pickableMeshes.push(crownMesh);

        // Register in kinematic cache
        this.kinematicPistons.push({
          cfg,
          pistonGroup,
          conrodGroup,
          crownMesh,
          rodBeam,
          pinMesh: this.crankpinMeshes[cfg.index]
        });

        // Heavy-duty Cast Cylinder Head
        const headGeo = new THREE.BoxGeometry(0.38, 0.98, 0.98);
        const headMesh = new THREE.Mesh(headGeo, this.matCylinderHead);
        headMesh.position.x = cfg.side * 1.35;
        headMesh.castShadow = true;
        cylGroup.add(headMesh);

        headMesh.userData = {
          componentId: 'head_' + cfg.index,
          name: 'Cylinder Head ' + cfg.index,
          category: 'CYLINDER ' + cfg.index,
          type: 'head',
          cylIndex: cfg.index,
          desc: 'Crossflow cylinder head with combustion chamber, intake/exhaust valves, and CHT thermocouple tap.'
        };
        this.selectableComponents.set('head_' + cfg.index, {
          mesh: headMesh,
          name: 'Cylinder Head ' + cfg.index,
          category: 'CYLINDER ' + cfg.index,
          type: 'head',
          cylIndex: cfg.index,
          desc: 'Crossflow cylinder head with combustion chamber, intake/exhaust valves, and CHT thermocouple tap.'
        });
        this.pickableMeshes.push(headMesh);

        // Rocker Box Valve Cover (Outer cap)
        const coverGeo = new THREE.BoxGeometry(0.12, 0.75, 0.75);
        const coverMesh = new THREE.Mesh(coverGeo, this.matGearbox);
        coverMesh.position.x = cfg.side * 1.56;
        cylGroup.add(coverMesh);

        coverMesh.userData = {
          componentId: 'valvetrain_' + cfg.index,
          name: 'Valve Cover & Rockers ' + cfg.index,
          category: 'CYLINDER ' + cfg.index,
          type: 'valvetrain',
          cylIndex: cfg.index,
          desc: 'Sealed rocker box valve cover enclosing dual overhead pushrod rockers and valve springs.'
        };
        this.selectableComponents.set('valvetrain_' + cfg.index, {
          mesh: coverMesh,
          name: 'Valve Cover & Rockers ' + cfg.index,
          category: 'CYLINDER ' + cfg.index,
          type: 'valvetrain',
          cylIndex: cfg.index,
          desc: 'Sealed rocker box valve cover enclosing dual overhead pushrod rockers and valve springs.'
        });
        this.pickableMeshes.push(coverMesh);

        // Rocker Cover Fasteners
        for (let ry = -0.28; ry <= 0.28; ry += 0.56) {
          for (let rz = -0.28; rz <= 0.28; rz += 0.56) {
            const rBolt = new THREE.Mesh(boltGeo, this.matChrome);
            rBolt.rotation.z = Math.PI / 2;
            rBolt.position.set(cfg.side * 1.63, ry, rz);
            cylGroup.add(rBolt);
          }
        }

        // Spark Plug & Ignition Lead Assembly (Top Boss)
        const plugHex = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.08, 6), this.matBrass);
        plugHex.position.set(cfg.side * 1.35, 0.52, 0);
        cylGroup.add(plugHex);

        const plugCeramic = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.18, 16), this.matCeramic);
        plugCeramic.position.set(cfg.side * 1.35, 0.64, 0);
        cylGroup.add(plugCeramic);

        plugHex.userData = {
          componentId: 'spark_plug',
          name: 'Aviation Spark Plug ' + cfg.index,
          category: 'IGNITION SYSTEM',
          type: 'spark_plug',
          cylIndex: cfg.index,
          desc: 'Dual aviation spark plug delivering timed high-voltage arc to initiate combustion.'
        };
        if (!this.selectableComponents.has('spark_plug') || cfg.index === 1) {
          this.selectableComponents.set('spark_plug', {
            mesh: plugHex,
            name: 'Aviation Spark Plug',
            category: 'IGNITION SYSTEM',
            type: 'spark_plug',
            cylIndex: cfg.index,
            desc: 'Dual aviation spark plug delivering timed high-voltage arc to initiate combustion.'
          });
        }
        this.pickableMeshes.push(plugHex);

        // Intake Valve Port & Stem Assembly
        const inValveGeo = new THREE.CylinderGeometry(0.045, 0.045, 0.22, 12);
        const inValveMesh = new THREE.Mesh(inValveGeo, this.matChrome);
        inValveMesh.position.set(cfg.side * 1.46, 0.28, cfg.z < 0 ? -0.16 : 0.16);
        cylGroup.add(inValveMesh);

        inValveMesh.userData = {
          componentId: 'intake_valve',
          name: 'Intake Valve Assembly ' + cfg.index,
          category: 'VALVETRAIN',
          type: 'intake_valve',
          cylIndex: cfg.index,
          desc: 'Nimonic alloy intake valve admitting stoichiometric air-fuel charge into combustion chamber.'
        };
        if (!this.selectableComponents.has('intake_valve') || cfg.index === 1) {
          this.selectableComponents.set('intake_valve', {
            mesh: inValveMesh,
            name: 'Intake Valve Assembly',
            category: 'VALVETRAIN',
            type: 'intake_valve',
            cylIndex: cfg.index,
            desc: 'Nimonic alloy intake valve admitting stoichiometric air-fuel charge into combustion chamber.'
          });
        }
        this.pickableMeshes.push(inValveMesh);

        // Exhaust Valve Port & Stem Assembly
        const exValveGeo = new THREE.CylinderGeometry(0.045, 0.045, 0.22, 12);
        const exValveMesh = new THREE.Mesh(exValveGeo, this.matBrass);
        exValveMesh.position.set(cfg.side * 1.46, -0.28, cfg.z < 0 ? 0.16 : -0.16);
        cylGroup.add(exValveMesh);

        exValveMesh.userData = {
          componentId: 'exhaust_valve',
          name: 'Sodium-Cooled Exhaust Valve ' + cfg.index,
          category: 'VALVETRAIN',
          type: 'exhaust_valve',
          cylIndex: cfg.index,
          desc: 'Sodium-filled heat-resistant exhaust valve discharging combustion gases to exhaust headers.'
        };
        if (!this.selectableComponents.has('exhaust_valve') || cfg.index === 1) {
          this.selectableComponents.set('exhaust_valve', {
            mesh: exValveMesh,
            name: 'Sodium-Cooled Exhaust Valve',
            category: 'VALVETRAIN',
            type: 'exhaust_valve',
            cylIndex: cfg.index,
            desc: 'Sodium-filled heat-resistant exhaust valve discharging combustion gases to exhaust headers.'
          });
        }
        this.pickableMeshes.push(exValveMesh);

        // HT Ignition Cable (Black lead)
        const wireGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.7, 12);
        const wireMesh = new THREE.Mesh(wireGeo, this.matRubber);
        wireMesh.rotation.z = -cfg.side * 0.4;
        wireMesh.position.set(cfg.side * 1.15, 0.78, 0);
        cylGroup.add(wireMesh);

        // CHT Thermocouple Sensor (Brass washer probe under cylinder head)
        const chtSensor = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.02, 8, 24), this.matBrass);
        chtSensor.rotation.x = Math.PI / 2;
        chtSensor.position.set(cfg.side * 1.35, 0.5, 0);
        cylGroup.add(chtSensor);
      });

      // ======================================================================
      // 5. EXHAUST HEADERS & TURBOCHARGER
      // ======================================================================
      this.exhaustGroup = new THREE.Group();
      this.engineGroup.add(this.exhaustGroup);

      // 4 Curved Exhaust Runners
      cylinderConfigs.forEach(cfg => {
        const curve = new THREE.CatmullRomCurve3([
          new THREE.Vector3(cfg.side * 1.3, -0.4, cfg.z),
          new THREE.Vector3(cfg.side * 1.1, -1.1, cfg.z + (cfg.z < 0 ? 0.3 : 0.0)),
          new THREE.Vector3(cfg.side * 0.5, -1.35, 1.4)
        ]);
        const pipeGeo = new THREE.TubeGeometry(curve, 20, 0.09, 16, false);
        const pipeMesh = new THREE.Mesh(pipeGeo, this.matExhaust);
        pipeMesh.castShadow = true;
        this.exhaustGroup.add(pipeMesh);

        // EGT Probe welded into each runner
        const egtProbe = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.16, 12), this.matBrass);
        egtProbe.position.set(cfg.side * 0.85, -1.15, cfg.z);
        egtProbe.rotation.z = (cfg.side * Math.PI) / 4;
        this.exhaustGroup.add(egtProbe);
      });

      // Exhaust 2-into-1 Merge Collector (Rear Underbody)
      const collectorGeo = new THREE.CylinderGeometry(0.24, 0.32, 0.9, 24);
      const collectorMesh = new THREE.Mesh(collectorGeo, this.matExhaust);
      collectorMesh.rotation.x = Math.PI / 2;
      collectorMesh.position.set(0, -1.38, 1.65);
      this.exhaustGroup.add(collectorMesh);

      collectorMesh.userData = {
        componentId: 'exhaust_system',
        name: 'Exhaust Manifold & Collector',
        category: 'EXHAUST SYSTEM',
        type: 'exhaust',
        desc: 'Stainless steel tuned exhaust headers and 2-into-1 merge collector feeding the turbo turbine with EGT probes.'
      };
      this.selectableComponents.set('exhaust_system', {
        mesh: collectorMesh,
        name: 'Exhaust Manifold & Collector',
        category: 'EXHAUST SYSTEM',
        type: 'exhaust',
        desc: 'Stainless steel tuned exhaust headers and 2-into-1 merge collector feeding the turbo turbine with EGT probes.'
      });
      this.pickableMeshes.push(collectorMesh);

      // Turbocharger Turbine Scroll
      const turboScrollGeo = new THREE.TorusGeometry(0.38, 0.18, 16, 32);
      const turboScroll = new THREE.Mesh(turboScrollGeo, this.matExhaust);
      turboScroll.position.set(0.3, -1.35, 2.15);
      this.exhaustGroup.add(turboScroll);

      turboScroll.userData = {
        componentId: 'turbocharger',
        name: 'Turbocharger System',
        category: 'FORCED INDUCTION',
        type: 'turbo',
        desc: 'Exhaust gas turbine and centrifugal compressor maintaining volumetric efficiency and manifold pressure at altitude.'
      };
      this.selectableComponents.set('turbocharger', {
        mesh: turboScroll,
        name: 'Turbocharger System',
        category: 'FORCED INDUCTION',
        type: 'turbo',
        desc: 'Exhaust gas turbine and centrifugal compressor maintaining volumetric efficiency and manifold pressure at altitude.'
      });
      this.pickableMeshes.push(turboScroll);

      // Turbo Compressor Housing (Aluminum)
      const turboCompGeo = new THREE.TorusGeometry(0.35, 0.16, 16, 32);
      const turboComp = new THREE.Mesh(turboCompGeo, this.matGearbox);
      turboComp.position.set(-0.3, -1.35, 2.15);
      this.exhaustGroup.add(turboComp);

      // Wastegate Canister
      const wastegateGeo = new THREE.CylinderGeometry(0.12, 0.12, 0.35, 16);
      const wastegate = new THREE.Mesh(wastegateGeo, this.matBrass);
      wastegate.rotation.x = Math.PI / 2;
      wastegate.position.set(0.65, -1.1, 2.15);
      this.exhaustGroup.add(wastegate);

      // ======================================================================
      // 6. INDUCTION SYSTEM & FUEL RAILS
      // ======================================================================
      this.intakeGroup = new THREE.Group();
      this.engineGroup.add(this.intakeGroup);

      // Central Intake Runner Tube
      const intakeMainGeo = new THREE.CylinderGeometry(0.18, 0.18, 1.8, 24);
      const intakeMain = new THREE.Mesh(intakeMainGeo, this.matGearbox);
      intakeMain.rotation.x = Math.PI / 2;
      intakeMain.position.set(0, 0.95, 0);
      this.intakeGroup.add(intakeMain);

      intakeMain.userData = {
        componentId: 'intake_system',
        name: 'Induction Plenum & Fuel Rail',
        category: 'INDUCTION & FUEL',
        type: 'intake',
        desc: 'Symmetric aluminum induction runners with electronic common-rail fuel injector distribution.'
      };
      this.selectableComponents.set('intake_system', {
        mesh: intakeMain,
        name: 'Induction Plenum & Fuel Rail',
        category: 'INDUCTION & FUEL',
        type: 'intake',
        desc: 'Symmetric aluminum induction runners with electronic common-rail fuel injector distribution.'
      });
      this.pickableMeshes.push(intakeMain);

      // Dual Cross Runners
      [-0.5, 0.5].forEach(z => {
        const crossGeo = new THREE.CylinderGeometry(0.12, 0.12, 2.2, 24);
        const cross = new THREE.Mesh(crossGeo, this.matGearbox);
        cross.rotation.z = Math.PI / 2;
        cross.position.set(0, 0.95, z);
        this.intakeGroup.add(cross);
      });

      // Fuel Rails & Injectors (Brass caps + Stainless pipes)
      const fuelRailGeo = new THREE.CylinderGeometry(0.04, 0.04, 2.4, 16);
      [-0.68, 0.68].forEach(x => {
        const fuelRail = new THREE.Mesh(fuelRailGeo, this.matBrass);
        fuelRail.rotation.x = Math.PI / 2;
        fuelRail.position.set(x, 0.72, 0);
        this.intakeGroup.add(fuelRail);
      });

      // Electronic Fuel Injectors (4 individual atomization injectors)
      cylinderConfigs.forEach(cfg => {
        const injGeo = new THREE.CylinderGeometry(0.045, 0.035, 0.22, 12);
        const injMesh = new THREE.Mesh(injGeo, this.matBrass);
        injMesh.position.set(cfg.side * 0.70, 0.82, cfg.z);
        injMesh.rotation.z = -cfg.side * 0.35;
        this.intakeGroup.add(injMesh);

        injMesh.userData = {
          componentId: 'fuel_system',
          name: 'Electronic Fuel Injector ' + cfg.index,
          category: 'FUEL SYSTEM',
          type: 'fuel_system',
          cylIndex: cfg.index,
          desc: 'High-pressure electronic fuel injector atomizing metered fuel into the induction stream.'
        };
        if (!this.selectableComponents.has('fuel_system') || cfg.index === 1) {
          this.selectableComponents.set('fuel_system', {
            mesh: injMesh,
            name: 'Electronic Fuel Injector & Rail',
            category: 'FUEL SYSTEM',
            type: 'fuel_system',
            cylIndex: cfg.index,
            desc: 'High-pressure electronic fuel injector atomizing metered fuel into the induction stream.'
          });
        }
        this.pickableMeshes.push(injMesh);
      });

      // ======================================================================
      // 7. OIL PRESSURE TRANSDUCER (CORE DIFFERENTIATOR SENSOR FOCUS)
      // ======================================================================
      this.oilSensorGroup = new THREE.Group();
      this.oilSensorGroup.position.set(0.72, 0.55, 1.25);
      this.engineGroup.add(this.oilSensorGroup);

      // Threaded Brass Nipple into Crankcase
      const sensorNipple = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.15, 6), this.matBrass);
      sensorNipple.rotation.x = Math.PI / 2;
      this.oilSensorGroup.add(sensorNipple);

      // Stainless Steel Sensor Transducer Canister
      const sensorCanGeo = new THREE.CylinderGeometry(0.16, 0.16, 0.38, 24);
      const sensorCan = new THREE.Mesh(sensorCanGeo, this.matChrome);
      sensorCan.rotation.x = Math.PI / 2;
      sensorCan.position.z = 0.22;
      this.oilSensorGroup.add(sensorCan);

      sensorCan.userData = {
        componentId: 'oil_system',
        name: 'Oil Pressure Transducer',
        category: 'LUBRICATION SYSTEM',
        type: 'sensor',
        desc: 'Main gallery piezoresistive pressure transducer monitoring vital lubrication delivery.'
      };
      this.selectableComponents.set('oil_system', {
        mesh: sensorCan,
        name: 'Oil Pressure Transducer',
        category: 'LUBRICATION SYSTEM',
        type: 'sensor',
        desc: 'Main gallery piezoresistive pressure transducer monitoring vital lubrication delivery.'
      });
      this.pickableMeshes.push(sensorCan);

      // Sensor Terminal Connector (Black molded plastic)
      const sensorPlug = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.18, 0.16), this.matRubber);
      sensorPlug.position.z = 0.48;
      this.oilSensorGroup.add(sensorPlug);

      // Wiring Pigtail Harness
      const sensorWire = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.5, 12), this.matRubber);
      sensorWire.rotation.y = 0.5;
      sensorWire.position.set(-0.15, 0.1, 0.65);
      this.oilSensorGroup.add(sensorWire);

      // Dynamic Diagnostic Fault Ring (Activates in SENSOR FAULT mode)
      const ringGeo = new THREE.TorusGeometry(0.36, 0.035, 16, 32);
      this.faultRingMat = new THREE.MeshBasicMaterial({
        color: 0xef4444,
        transparent: true,
        opacity: 0
      });
      this.faultRing = new THREE.Mesh(ringGeo, this.faultRingMat);
      this.faultRing.position.z = 0.22;
      this.oilSensorGroup.add(this.faultRing);

      // 3D Callout Billboard Sprite for Sensor Fault
      this.sensorCallout = this._createCalloutSprite();
      this.sensorCallout.position.set(0.72, 1.25, 1.25);
      this.sensorCallout.visible = false;
      this.engineGroup.add(this.sensorCallout);

      // Standardize selectable component registry for all 12 core subsystems
      this.selectableComponents.set('piston', this.selectableComponents.get('piston_1'));
      this.selectableComponents.set('cylinder', this.selectableComponents.get('cyl_1'));
      this.selectableComponents.set('conrod', this.selectableComponents.get('conrod_1'));
      this.selectableComponents.set('intake_manifold', this.selectableComponents.get('intake_system'));
      this.selectableComponents.set('exhaust_manifold', this.selectableComponents.get('exhaust_system'));
      this.selectableComponents.set('oil_pump', this.selectableComponents.get('lubrication_system'));
      this.selectableComponents.set('oil_system', this.selectableComponents.get('lubrication_system'));

      // Perform initial kinematic assembly placement
      this._updateKinematics();
    }

    _createCalloutSprite() {
      const canvas = document.createElement('canvas');
      canvas.width = 512;
      canvas.height = 160;
      const ctx = canvas.getContext('2d');

      ctx.fillStyle = 'rgba(15, 23, 42, 0.92)';
      ctx.strokeStyle = '#EF4444';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.roundRect(8, 8, 496, 144, 16);
      ctx.fill();
      ctx.stroke();

      ctx.font = 'bold 34px Inter, sans-serif';
      ctx.fillStyle = '#EF4444';
      ctx.fillText('⚠ OIL PRESSURE SENSOR', 30, 56);

      ctx.font = '24px JetBrains Mono, monospace';
      ctx.fillStyle = '#F87171';
      ctx.fillText('STATUS: FAULTY (Trust: 0.25)', 30, 96);

      ctx.font = '19px Inter, sans-serif';
      ctx.fillStyle = '#94A3B8';
      ctx.fillText('Frozen reading while RPM/load changed', 30, 130);

      const texture = new THREE.CanvasTexture(canvas);
      const spriteMat = new THREE.SpriteMaterial({ map: texture, transparent: true });
      const sprite = new THREE.Sprite(spriteMat);
      sprite.scale.set(2.4, 0.75, 1);
      return sprite;
    }

    _setupInteractions() {
      // Auto-rotation toggle on drag
      if (this.controls) {
        this.controls.addEventListener('start', () => {
          this.autoRotate = false;
        });
      }
      this.autoRotate = true;

      // Raycasting for Component Selection
      this.raycaster = new THREE.Raycaster();
      this.mouse = new THREE.Vector2();

      this.canvas.addEventListener('click', (e) => {
        const rect = this.canvas.getBoundingClientRect();
        this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

        this.raycaster.setFromCamera(this.mouse, this.camera);
        const intersects = this.raycaster.intersectObjects(this.pickableMeshes, true);
        if (intersects.length > 0) {
          let cur = intersects[0].object;
          while (cur && (!cur.userData || !cur.userData.componentId) && cur.parent !== this.engineGroup) {
            cur = cur.parent;
          }
          if (cur && cur.userData && cur.userData.componentId) {
            this.selectComponent(cur.userData.componentId);
          }
        }
      });

      this.canvas.addEventListener('mousemove', (e) => {
        const rect = this.canvas.getBoundingClientRect();
        this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

        this.raycaster.setFromCamera(this.mouse, this.camera);
        const intersects = this.raycaster.intersectObjects(this.pickableMeshes, true);
        if (intersects.length > 0) {
          this.canvas.style.cursor = 'pointer';
        } else {
          this.canvas.style.cursor = 'default';
        }
      });
    }

    selectComponent(componentId) {
      const aliasMap = {
        'piston': 'piston_1',
        'cylinder': 'cyl_1',
        'conrod': 'conrod_1',
        'head': 'head_1',
        'intake_manifold': 'intake_system',
        'exhaust_manifold': 'exhaust_system',
        'oil_pump': 'lubrication_system',
        'oil_system': 'lubrication_system'
      };
      if (aliasMap[componentId] && !this.selectableComponents.has(componentId)) {
        componentId = aliasMap[componentId];
      }
      this.selectedComponentId = componentId;
      const comp = this.selectableComponents.get(componentId);
      if (!comp) return;

      this.clearHighlights();

      // Mechanical relationship: When selecting a piston or connecting rod, highlight the full kinematic chain
      const isPiston = componentId.startsWith('piston_');
      const isConrod = componentId.startsWith('conrod_');
      const cylIdx = comp.cylIndex;

      if ((isPiston || isConrod) && cylIdx) {
        const kin = this.kinematicPistons.find(k => k.cfg.index === cylIdx);
        if (kin) {
          // Highlight Piston (Gleaming Cyan)
          this.highlightMesh(kin.crownMesh, 0x38bdf8, 0.98);
          // Highlight Connecting Rod (Cyan-Teal)
          this.highlightMesh(kin.rodBeam, 0x06b6d4, 0.90);
          // Highlight Crankpin Journal (Cyan)
          if (kin.pinMesh) {
            this.highlightMesh(kin.pinMesh, 0x38bdf8, 0.90);
          }
        }
      } else if (comp.mesh) {
        this.highlightMesh(comp.mesh, 0x38bdf8, 0.85);
      }

      // Smooth camera focus: distance 3.8 frames Cylinder + Piston + Conrod + Crankshaft clearly
      const worldPos = new THREE.Vector3();
      comp.mesh.getWorldPosition(worldPos);
      this.frameCameraOn(worldPos, comp.type === 'piston' ? 3.8 : 3.4);

      if (typeof window.onEngineComponentSelected === 'function') {
        window.onEngineComponentSelected(comp);
      }
    }

    highlightMesh(mesh, colorHex, intensity = 0.85) {
      if (!mesh) return;
      if (!this.highlightedMeshes) this.highlightedMeshes = [];
      this.highlightedMeshes.push({ mesh, originalMat: mesh.material });
      mesh.material = mesh.material.clone();
      mesh.material.emissive = new THREE.Color(colorHex);
      mesh.material.emissiveIntensity = intensity;
    }

    clearHighlights() {
      if (this.highlightedMeshes && this.highlightedMeshes.length > 0) {
        this.highlightedMeshes.forEach(item => {
          item.mesh.material = item.originalMat;
        });
        this.highlightedMeshes = [];
      }
      if (this.highlightedMesh && this.originalMaterial) {
        this.highlightedMesh.material = this.originalMaterial;
        this.highlightedMesh = null;
        this.originalMaterial = null;
      }
    }

    frameCameraOn(targetPos, distance = 3.6) {
      if (!this.camera || !this.controls) return;
      this.autoRotate = false;

      const duration = 650;
      const startTime = performance.now();
      const startPos = this.camera.position.clone();
      const startTarget = this.controls.target.clone();

      const offset = new THREE.Vector3(distance * 0.7, distance * 0.5, distance * 0.8);
      const targetCamPos = targetPos.clone().add(offset);

      const tween = (now) => {
        const elapsed = now - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const ease = 0.5 - Math.cos(progress * Math.PI) / 2;

        this.camera.position.lerpVectors(startPos, targetCamPos, ease);
        this.controls.target.lerpVectors(startTarget, targetPos, ease);
        this.controls.update();

        if (progress < 1) {
          requestAnimationFrame(tween);
        }
      };
      requestAnimationFrame(tween);
    }

    _updateKinematics() {
      const R = this.crankRadius;
      const L = this.conrodLength;
      const L2 = L * L;

      // Continuously rotate central crankshaft
      if (this.crankshaftGroup) {
        this.crankshaftGroup.rotation.z = this.crankAngle;
      }

      // Rotate camshaft at half crankshaft speed (1:2 4-stroke drive ratio)
      if (this.camshaftGroup) {
        this.camshaftGroup.rotation.z = this.crankAngle * 0.5;
      }

      // Drive each slider-crank kinematic chain
      for (let i = 0; i < this.kinematicPistons.length; i++) {
        const item = this.kinematicPistons[i];
        const alpha = this.crankAngle + item.cfg.phase;
        const xPin = R * Math.cos(alpha);
        const yPin = R * Math.sin(alpha);
        const radInner = Math.max(0.001, L2 - yPin * yPin);
        const xPiston = xPin + item.cfg.side * Math.sqrt(radInner);

        item.pistonGroup.position.set(xPiston, 0, item.cfg.z);
        item.conrodGroup.position.set(xPin, yPin, item.cfg.z);
        item.conrodGroup.rotation.z = Math.atan2(-yPin, xPiston - xPin);
      }
    }

    getComponentAnchor(componentId) {
      const aliasMap = {
        'piston': 'piston_1',
        'cylinder': 'cyl_1',
        'conrod': 'conrod_1',
        'head': 'head_1',
        'intake_manifold': 'intake_system',
        'exhaust_manifold': 'exhaust_system',
        'oil_pump': 'lubrication_system',
        'oil_system': 'lubrication_system'
      };
      const resolvedId = aliasMap[componentId] || componentId;

      if (resolvedId === 'piston_1' || resolvedId === 'piston') {
        const kin = this.kinematicPistons && this.kinematicPistons[0];
        if (kin && kin.crownMesh) {
          const p = new THREE.Vector3();
          kin.crownMesh.getWorldPosition(p);
          return p;
        }
      }
      if (resolvedId === 'conrod_1' || resolvedId === 'conrod') {
        const kin = this.kinematicPistons && this.kinematicPistons[0];
        if (kin && kin.rodBeam) {
          const p = new THREE.Vector3();
          kin.rodBeam.getWorldPosition(p);
          return p;
        }
      }

      const comp = this.selectableComponents.get(resolvedId) || this.selectableComponents.get(componentId);
      if (comp && comp.mesh) {
        const p = new THREE.Vector3();
        comp.mesh.getWorldPosition(p);
        return p;
      }

      // Calibrated fallbacks in local 3D engine space
      const fallbackMap = {
        spark_plug: new THREE.Vector3(-1.35, 0.64, -0.72),
        cylinder: new THREE.Vector3(-1.35, 0.05, -0.72),
        piston: new THREE.Vector3(-0.95, 0.05, -0.72),
        conrod: new THREE.Vector3(-0.45, 0.0, -0.72),
        crankshaft: new THREE.Vector3(0.0, 0.0, -0.2),
        camshaft: new THREE.Vector3(0.0, -0.42, -0.2),
        intake_valve: new THREE.Vector3(-1.46, 0.28, -0.88),
        exhaust_valve: new THREE.Vector3(-1.46, -0.28, -0.56),
        lubrication_system: new THREE.Vector3(0.0, -0.85, -1.08),
        fuel_system: new THREE.Vector3(-0.70, 0.82, -0.72),
        intake_manifold: new THREE.Vector3(0.0, 0.95, 0.0),
        exhaust_manifold: new THREE.Vector3(0.0, -1.38, 1.4)
      };
      return fallbackMap[componentId] || null;
    }

    projectToScreen(pos) {
      if (!this.camera || !this.canvas || !pos) return null;
      const v = pos.clone();
      v.project(this.camera);
      const rect = this.canvas.getBoundingClientRect();
      const w = rect.width || this.canvas.parentElement?.clientWidth || 600;
      const h = rect.height || this.canvas.parentElement?.clientHeight || 360;
      return {
        x: ((v.x * 0.5) + 0.5) * w,
        y: (-(v.y * 0.5) + 0.5) * h,
        inFront: v.z < 1.0
      };
    }

    toggleMotion() {
      this.motionPlaying = !this.motionPlaying;
      return this.motionPlaying;
    }

    setSpeedFactor(factor) {
      this.speedFactor = factor;
    }

    setInspectionMode(mode) {
      this.inspectionMode = mode;
      const isXray = mode === 'xray';
      const isExploded = mode === 'exploded';

      if (isXray) {
        this.matCrankcase.transparent = true;
        this.matCrankcase.opacity = 0.18;
        this.matFins.transparent = true;
        this.matFins.opacity = 0.14;
        this.matCylinderHead.transparent = true;
        this.matCylinderHead.opacity = 0.28;
        this.matGearbox.transparent = true;
        this.matGearbox.opacity = 0.22;

        this.matPiston.emissive = new THREE.Color(0x38bdf8);
        this.matPiston.emissiveIntensity = 0.45;
        this.matCrankshaft.emissive = new THREE.Color(0x6ee7b7);
        this.matCrankshaft.emissiveIntensity = 0.35;
        this.matConrod.emissive = new THREE.Color(0x06b6d4);
        this.matConrod.emissiveIntensity = 0.35;
      } else {
        this.matCrankcase.transparent = false;
        this.matCrankcase.opacity = 1.0;
        this.matFins.transparent = false;
        this.matFins.opacity = 1.0;
        this.matCylinderHead.transparent = false;
        this.matCylinderHead.opacity = 1.0;
        this.matGearbox.transparent = false;
        this.matGearbox.opacity = 1.0;

        this.matPiston.emissiveIntensity = 0;
        this.matCrankshaft.emissiveIntensity = 0;
        this.matConrod.emissiveIntensity = 0;
      }

      // Exploded Assembly Offsets (Cylinder banks slide out, leaving moving pistons/rods exposed)
      this.cylinderAssemblies.forEach(item => {
        const offset = isExploded ? item.side * 0.75 : 0;
        item.group.position.x = item.baseX + offset;
      });
      if (this.exhaustGroup) {
        this.exhaustGroup.position.y = isExploded ? -0.45 : 0;
      }
      if (this.intakeGroup) {
        this.intakeGroup.position.y = isExploded ? 0.45 : 0;
      }
    }

    resetInspection() {
      this.clearHighlights();
      this.selectedComponentId = null;
      this.setInspectionMode('inspect');
      this.setView('iso');
      this.autoRotate = false;
    }

    setView(viewName) {
      if (!this.camera || !this.controls) return;
      this.autoRotate = false;

      const duration = 750;
      const startTime = performance.now();
      const startPos = this.camera.position.clone();
      const startTarget = this.controls.target.clone();

      let targetPos = new THREE.Vector3(5.5, 3.8, 6.5);
      let targetLook = new THREE.Vector3(0, 0.2, 0);

      if (viewName === 'iso') {
        targetPos.set(5.5, 3.8, 6.5);
        targetLook.set(0, 0.2, 0);
      } else if (viewName === 'top') {
        targetPos.set(0.01, 8.5, 0.01);
        targetLook.set(0, 0, 0);
      } else if (viewName === 'front') {
        targetPos.set(0, 0.8, -6.5);
        targetLook.set(0, 0.2, -1.0);
      } else if (viewName === 'sensors') {
        targetPos.set(2.4, 1.8, 2.5);
        targetLook.set(0.7, 0.5, 1.2);
      }

      const tween = (now) => {
        const elapsed = now - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const ease = 0.5 - Math.cos(progress * Math.PI) / 2;

        this.camera.position.lerpVectors(startPos, targetPos, ease);
        this.controls.target.lerpVectors(startTarget, targetLook, ease);
        this.controls.update();

        if (progress < 1) {
          requestAnimationFrame(tween);
        }
      };
      requestAnimationFrame(tween);
    }

    updateState(telemetryData, mode = 'normal') {
      this.state.rpm = telemetryData.rpm || 4200;
      this.state.mode = mode;
      this.state.status = telemetryData.status || 'NOMINAL';
      this.state.oilPressTrust = telemetryData.oilPressTrust !== undefined ? telemetryData.oilPressTrust : 0.97;
      this.state.cht = telemetryData.cht || 178;
      this.state.egt = telemetryData.egt || 824;

      if (mode === 'thermal_degradation') {
        this.state.targetHeatFactor = 1.0;
        if (this.sensorCallout) this.sensorCallout.visible = false;
        if (this.faultRingMat) this.faultRingMat.opacity = 0;
        if (this.sensorLight) this.sensorLight.intensity = 0;
      } else if (mode === 'sensor_fault') {
        this.state.targetHeatFactor = 0.0;
        if (this.sensorCallout) this.sensorCallout.visible = true;
        if (this.faultRingMat) this.faultRingMat.opacity = 0.9;
        if (this.sensorLight) this.sensorLight.intensity = 2.5;
      } else {
        this.state.targetHeatFactor = 0.0;
        if (this.sensorCallout) this.sensorCallout.visible = false;
        if (this.faultRingMat) this.faultRingMat.opacity = 0;
        if (this.sensorLight) this.sensorLight.intensity = 0;
      }
    }

    _animate(time) {
      if (!this.renderer || !this.scene || !this.camera) return;

      // Pause rendering loop while Pre-UI Mission Brief is displayed to eliminate GPU/CPU lag
      if (document.body && document.body.classList.contains('brief-active')) {
        requestAnimationFrame(this._animate);
        return;
      }

      // Smooth Orbit Controls
      if (this.controls) {
        if (this.autoRotate) {
          this.engineGroup.rotation.y += 0.0035;
        }
        this.controls.update();
      }

      // Propeller Hub Rotation proportional to engine RPM
      if (this.propFlangeGroup && this.motionPlaying) {
        const propSpeed = (this.state.rpm / 60) * 0.025 * this.speedFactor;
        this.propFlangeGroup.rotation.z += propSpeed;
      }

      // Kinematic Reciprocating Engine Motion (Pistons + Connecting Rods + Crankshaft)
      if (this.motionPlaying) {
        const baseRpmFactor = (this.state.rpm / 4200);
        const angularSpeed = 0.048 * baseRpmFactor * this.speedFactor;
        this.crankAngle += angularSpeed;
      }
      this._updateKinematics();

      // Smooth Thermal Heatmap Transition
      this.state.heatFactor += (this.state.targetHeatFactor - this.state.heatFactor) * 0.05;

      if (this.state.heatFactor > 0.01) {
        const heatColor = new THREE.Color(0xef4444).lerp(new THREE.Color(0xf59e0b), 0.35);
        const emissivePulse = (Math.sin(time * 0.006) * 0.2 + 0.8) * this.state.heatFactor;

        this.thermalMaterials.forEach(mat => {
          mat.emissive.copy(heatColor);
          mat.emissiveIntensity = emissivePulse * 0.85;
        });

        this.exhaustMaterials.forEach(mat => {
          mat.emissive.copy(new THREE.Color(0xf97316));
          mat.emissiveIntensity = emissivePulse * 1.1;
        });

        if (this.thermalLight) {
          this.thermalLight.intensity = emissivePulse * 3.0;
        }
      } else if (this.inspectionMode !== 'xray') {
        this.thermalMaterials.forEach(mat => {
          mat.emissiveIntensity = 0;
        });
        this.exhaustMaterials.forEach(mat => {
          mat.emissiveIntensity = 0;
        });
        if (this.thermalLight) {
          this.thermalLight.intensity = 0;
        }
      }

      // Pulsing Sensor Fault Halo
      if (this.state.mode === 'sensor_fault' && this.faultRing) {
        const pulse = Math.sin(time * 0.008) * 0.5 + 0.5;
        const scale = 1.0 + pulse * 0.3;
        this.faultRing.scale.set(scale, scale, scale);
        this.faultRingMat.opacity = 0.5 + pulse * 0.5;
        if (this.sensorLight) {
          this.sensorLight.intensity = 1.5 + pulse * 2.0;
        }
      }

      this.renderer.render(this.scene, this.camera);
      if (typeof window.update3DCallouts === 'function') {
        window.update3DCallouts();
      }
      requestAnimationFrame(this._animate);
    }
  }

  // Attach globally
  window.AeroPistonDigitalTwin = AeroPistonDigitalTwin;
})();
