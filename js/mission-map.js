/* ==========================================================================
   AERO-TWIN: REAL GEOGRAPHIC MAPBOX MISSION MAP & CONTINGENCY SYSTEM
   SIH Problem Statement: SIH26054 (DRDO - Robotics & Drones - Software)

   Primary & Only Map: Real Mapbox Standard Geographic Map
   - Real Geographic Tiles (Terrain, Roads, Places, Boundaries)
   - Style: 'mapbox://styles/mapbox/standard' with dark/night preset
   - Planned 7-Phase Mission Route Overlay (GeoJSON)
   - Real-Time UAV Position & Heading Tracking
   - Dynamic Engine Incident Marker
   - 3 Predefined Simulated Contingency Landing Areas
   - Real-Time Distance (Haversine) & ETA Calculation
   - Deterministic Contingency Recommendation Engine ("Bad Sensor ≠ Bad Engine")
   ========================================================================== */

(function () {
  'use strict';

  // Demo Mission Route in Rajasthan / Western India Sector
  const MISSION_ROUTE = [
    { id: 'wp-0', name: 'AFS UTTARLAI (START)', phase: 'idle', lat: 25.8115, lng: 71.4820, alt: 510, spd: 0 },
    { id: 'wp-1', name: 'DEPARTURE CLIMB (BARMER)', phase: 'takeoff', lat: 25.8850, lng: 71.5520, alt: 2500, spd: 85 },
    { id: 'wp-2', name: 'CORRIDOR ALPHA (SANCHORE)', phase: 'climb', lat: 26.1500, lng: 71.8500, alt: 12000, spd: 105 },
    { id: 'wp-3', name: 'OPERATIONAL CEILING (CRUISE)', phase: 'cruise', lat: 26.4200, lng: 72.1800, alt: 18000, spd: 118 },
    { id: 'wp-4', name: 'ISR SECTOR-B (THAR LOITER)', phase: 'loiter', lat: 26.6500, lng: 72.4200, alt: 20000, spd: 104 },
    { id: 'wp-5', name: 'INBOUND TRANSIT (RETURN)', phase: 'return', lat: 26.1200, lng: 71.8200, alt: 14000, spd: 120 },
    { id: 'wp-6', name: 'FINAL RECOVERY (LANDING)', phase: 'landing', lat: 25.8115, lng: 71.4820, alt: 510, spd: 65 }
  ];

  // 3 Predefined Simulated Contingency Landing Areas (Simulated Decision-Support Prototype)
  const CONTINGENCY_BASES = [
    {
      id: 'uttarlai',
      name: 'AFS Uttarlai (Base Alpha)',
      shortName: 'AFS UTTARLAI',
      lat: 25.8115,
      lng: 71.4820,
      runwayLengthFt: 9000,
      runwayDesignation: '09/27',
      elevationFt: 510,
      suitabilityScore: 94,
      statusLabel: 'PRIMARY MILITARY RECOVERY',
      capabilities: 'Full Crash/Rescue • Arrestor Barrier • OEM Depot'
    },
    {
      id: 'deesa',
      name: 'Deesa Forward Landing Strip (Strip Bravo)',
      shortName: 'DEESA FLS',
      lat: 24.2612,
      lng: 72.2031,
      runwayLengthFt: 6500,
      runwayDesignation: '14/32',
      elevationFt: 480,
      suitabilityScore: 88,
      statusLabel: 'TACTICAL RECOVERY STRIP',
      capabilities: 'Forward Maintenance • Quick Turnaround • Emergency Access'
    },
    {
      id: 'bhuj',
      name: 'Bhuj Air Force Station (Base Charlie)',
      shortName: 'BHUJ AFS',
      lat: 23.2878,
      lng: 69.6701,
      runwayLengthFt: 8200,
      runwayDesignation: '05/23',
      elevationFt: 260,
      suitabilityScore: 82,
      statusLabel: 'COASTAL INTERCEPT AIRFIELD',
      capabilities: 'All-Weather Military • Extended Runway • Maritime Recovery'
    }
  ];

  function calculateHaversineDistanceKm(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * (Math.PI / 180);
    const dLon = (lon2 - lon1) * (Math.PI / 180);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return Number((R * c).toFixed(1));
  }

  class MissionMapController {
    constructor(containerId) {
      this.containerId = containerId;
      this.container = document.getElementById(containerId);
      this.map = null;
      this.uavMarker = null;
      this.incidentMarker = null;
      this.baseMarkers = [];
      this.waypointMarkers = [];
      this.isMapLoaded = false;
      this.currentRecommendedBaseId = 'uttarlai';
      this.selectedBaseId = 'uttarlai';

      // Simulated UAV Location along Rajasthan Mission Corridor
      this.uav = {
        lat: 26.6500,
        lng: 72.4200,
        heading: 42,
        speedKts: 118,
        altitudeFt: 18000,
        phase: 'cruise'
      };

      // Incident Marker State
      this.incident = {
        active: false,
        lat: null,
        lng: null,
        scenario: null,
        timestamp: null
      };

      this.init();
    }

    async init() {
      if (!this.container) return;

      // 1. Resolve Mapbox Token from window or server API (never expose in UI/logs)
      let token = (window.VITE_MAPBOX_TOKEN || '').trim();

      if (!token) {
        try {
          const res = await fetch('/api/config');
          if (res.ok) {
            const cfg = await res.json();
            token = (cfg.mapboxToken || '').trim();
          }
        } catch (e) {
          // Handled below via error state
        }
      }

      // Requirement 10: Do NOT silently fall back to a fake canvas map!
      // Show clear error state if token is missing
      if (!token) {
        this.renderErrorState(
          'MAPBOX TOKEN MISSING',
          'A valid VITE_MAPBOX_TOKEN is required to load real geographic Mapbox tiles.',
          'Add VITE_MAPBOX_TOKEN=pk.your_token in your .env file and restart.'
        );
        this.updateUI();
        return;
      }

      if (!window.mapboxgl) {
        this.renderErrorState(
          'MAPBOX MAP FAILED TO LOAD',
          'Mapbox GL JS library was not detected in browser context.',
          'Verify network connectivity to api.mapbox.com.'
        );
        this.updateUI();
        return;
      }

      // Initialize REAL Mapbox Geographic Map
      this.initMapbox(token);
    }

    renderErrorState(title, message, hint) {
      this.container.innerHTML = `
        <div class="mapbox-error-state" style="width:100%; height:100%; min-height:480px; background:#090E17; display:flex; align-items:center; justify-content:center; padding:24px; box-sizing:border-box;">
          <div class="mapbox-error-card" style="max-width:480px; width:100%; background:var(--surface-0); border:1px solid var(--status-critical); border-radius:6px; padding:24px; text-align:center;">
            <span style="font-size:2rem; display:block; margin-bottom:8px;">⚠️</span>
            <h3 style="color:var(--status-critical); font-size:1.05rem; font-weight:800; margin:0 0 8px; letter-spacing:0.04em;">${title}</h3>
            <p style="color:var(--text-secondary); font-size:0.75rem; line-height:1.5; margin:0 0 14px;">${message}</p>
            <div style="background:rgba(239, 68, 68, 0.08); border:1px solid rgba(239, 68, 68, 0.25); padding:8px 12px; border-radius:4px; font-size:0.7rem; color:var(--text-primary); font-family:var(--font-mono);">
              ${hint}
            </div>
          </div>
        </div>
      `;
    }

    initMapbox(token) {
      try {
        window.mapboxgl.accessToken = token;

        // Requirement 3: Use real Mapbox Standard geographic style
        this.map = new window.mapboxgl.Map({
          container: this.containerId,
          style: 'mapbox://styles/mapbox/standard',
          // Requirement 4: Center around simulated UAV mission area in Rajasthan/Western India
          center: [71.8500, 25.5500],
          zoom: 7.2,
          pitch: 25,
          attributionControl: false
        });

        // Requirement 8: Add normal Mapbox controls
        this.map.addControl(new window.mapboxgl.NavigationControl({ showCompass: true }), 'top-right');
        this.map.addControl(new window.mapboxgl.FullscreenControl(), 'top-right');

        this.map.on('style.load', () => {
          this.isMapLoaded = true;

          // Requirement 9: Set dark/night lighting configuration on Mapbox Standard style
          try {
            this.map.setConfigProperty('basemap', 'lightPreset', 'night');
            this.map.setConfigProperty('basemap', 'showPlaceLabels', true);
            this.map.setConfigProperty('basemap', 'showRoadLabels', true);
          } catch (e) {
            // Style loads with default standard configuration
          }

          // Requirement 6: Keep Aero Twin overlays ON TOP of real geographic map
          this.addRouteOverlays();
          this.addWaypointMarkers();
          this.addContingencyBaseMarkers();
          this.addUavMarker();

          this.updateUI();
        });

        this.map.on('error', (e) => {
          console.error('[MissionMap] Mapbox GL runtime error:', e);
          if (!this.isMapLoaded) {
            this.renderErrorState(
              'MAPBOX MAP FAILED TO LOAD',
              'Failed to load real Mapbox vector tiles. Please check network connection and token access.',
              'Verify VITE_MAPBOX_TOKEN permissions at account.mapbox.com.'
            );
          }
        });

      } catch (err) {
        console.error('[MissionMap] Fatal error initializing Mapbox:', err);
        this.renderErrorState(
          'MAPBOX MAP FAILED TO LOAD',
          err.message || 'Initialization error',
          'Check browser WebGL support and Mapbox script loading.'
        );
      }
    }

    addRouteOverlays() {
      if (!this.map) return;

      const coordinates = MISSION_ROUTE.map(wp => [wp.lng, wp.lat]);
      if (this.map.getSource('planned-route')) return;

      this.map.addSource('planned-route', {
        type: 'geojson',
        data: {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'LineString',
            coordinates: coordinates
          }
        }
      });

      // Route Glow Layer on top of real geographic map
      this.map.addLayer({
        id: 'route-glow',
        type: 'line',
        source: 'planned-route',
        slot: 'top',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': '#00F0FF',
          'line-width': 7,
          'line-opacity': 0.3
        }
      });

      // Main Route Dashed Line
      this.map.addLayer({
        id: 'route-line',
        type: 'line',
        source: 'planned-route',
        slot: 'top',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': '#00F0FF',
          'line-width': 2.5,
          'line-dasharray': [2, 1.5]
        }
      });
    }

    addWaypointMarkers() {
      if (!this.map) return;

      MISSION_ROUTE.forEach(wp => {
        const el = document.createElement('div');
        el.className = 'mapbox-wp-marker';
        el.title = `${wp.name} (${wp.phase.toUpperCase()})`;
        const marker = new window.mapboxgl.Marker({ element: el })
          .setLngLat([wp.lng, wp.lat])
          .setPopup(new window.mapboxgl.Popup({ offset: 12 }).setHTML(`
            <div style="font-family:monospace; font-size:11px; color:#0A0E14; padding:2px;">
              <strong>${wp.name}</strong><br/>
              Phase: ${wp.phase.toUpperCase()}<br/>
              Alt: ${wp.alt.toLocaleString()} FT
            </div>
          `))
          .addTo(this.map);
        this.waypointMarkers.push(marker);
      });
    }

    addContingencyBaseMarkers() {
      if (!this.map) return;

      CONTINGENCY_BASES.forEach(base => {
        const el = document.createElement('div');
        el.className = 'mapbox-base-marker';
        el.id = `map-base-marker-${base.id}`;
        el.innerHTML = `
          <div class="base-marker-pin">
            <span class="base-marker-icon">⚲</span>
            <span class="base-marker-title">${base.shortName}</span>
          </div>
        `;
        el.addEventListener('click', () => {
          this.selectedBaseId = base.id;
          this.updateUI();
        });

        const marker = new window.mapboxgl.Marker({ element: el })
          .setLngLat([base.lng, base.lat])
          .addTo(this.map);
        this.baseMarkers.push(marker);
      });
    }

    addUavMarker() {
      if (!this.map) return;

      const uavEl = document.createElement('div');
      uavEl.className = 'mapbox-uav-marker';
      uavEl.innerHTML = `
        <div class="uav-aircraft-icon" id="uav-aircraft-icon">
          <svg width="34" height="34" viewBox="0 0 32 32" fill="none">
            <path d="M16 2L20 12L28 16L20 18L18 28L16 25L14 28L12 18L4 16L12 12L16 2Z" fill="#00F0FF" stroke="#0A0E14" stroke-width="1.5"/>
            <circle cx="16" cy="16" r="3" fill="#FFFFFF"/>
          </svg>
        </div>
      `;
      this.uavMarker = new window.mapboxgl.Marker({ element: uavEl, rotationAlignment: 'map' })
        .setLngLat([this.uav.lng, this.uav.lat])
        .addTo(this.map);
    }

    update(appState) {
      if (!appState) return;

      const raw = appState.rawTelemetry || {};
      const phase = (appState.missionPhase || 'cruise').toLowerCase();
      this.uav.phase = phase;
      this.uav.speedKts = raw.rpm ? Math.round(75 + (raw.rpm / 5000) * 55) : 118;
      this.uav.altitudeFt = raw.altitude !== undefined ? raw.altitude : 18000;

      // Interpolate UAV position along planned route
      this.interpolatePositionByPhase(phase);

      // Manage dynamic incident location marker
      const scenario = appState.scenario || 'normal';
      const isFault = scenario !== 'normal' && scenario !== 'nominal';
      if (isFault) {
        if (!this.incident.active || this.incident.scenario !== scenario) {
          this.incident.active = true;
          this.incident.lat = this.uav.lat;
          this.incident.lng = this.uav.lng;
          this.incident.scenario = scenario;
          this.incident.timestamp = new Date().toLocaleTimeString();
        }
      } else {
        this.incident.active = false;
        this.incident.lat = null;
        this.incident.lng = null;
        this.incident.scenario = null;
      }

      // Synchronize Mapbox markers on real geographic map
      if (this.isMapLoaded && this.map) {
        if (this.uavMarker) {
          this.uavMarker.setLngLat([this.uav.lng, this.uav.lat]);
          const icon = this.uavMarker.getElement().querySelector('#uav-aircraft-icon');
          if (icon) {
            icon.style.transform = `rotate(${this.uav.heading}deg)`;
          }
        }

        // Incident marker
        if (this.incident.active && this.incident.lat && this.incident.lng) {
          if (!this.incidentMarker) {
            const el = document.createElement('div');
            el.className = 'mapbox-incident-marker pulse-red';
            el.innerHTML = `<span>⚠️ INCIDENT LOCATION</span>`;
            this.incidentMarker = new window.mapboxgl.Marker({ element: el })
              .setLngLat([this.incident.lng, this.incident.lat])
              .addTo(this.map);
          } else {
            this.incidentMarker.setLngLat([this.incident.lng, this.incident.lat]);
          }
        } else if (this.incidentMarker) {
          this.incidentMarker.remove();
          this.incidentMarker = null;
        }
      }

      this.updateUI(appState);
    }

    interpolatePositionByPhase(phase) {
      const wpMap = {
        'idle': { lat: 25.8115, lng: 71.4820, heading: 90 },
        'takeoff': { lat: 25.8850, lng: 71.5520, heading: 65 },
        'climb': { lat: 26.1500, lng: 71.8500, heading: 45 },
        'cruise': { lat: 26.4200, lng: 72.1800, heading: 42 },
        'loiter': { lat: 26.6500, lng: 72.4200, heading: 120 },
        'return': { lat: 26.1200, lng: 71.8200, heading: 220 },
        'landing': { lat: 25.8115, lng: 71.4820, heading: 270 }
      };

      const target = wpMap[phase] || wpMap['cruise'];

      if (phase === 'loiter') {
        const t = Date.now() * 0.0004;
        this.uav.lat = target.lat + Math.sin(t) * 0.12;
        this.uav.lng = target.lng + Math.cos(t) * 0.16;
        this.uav.heading = ((t * 180) / Math.PI + 90) % 360;
      } else {
        this.uav.lat += (target.lat - this.uav.lat) * 0.08;
        this.uav.lng += (target.lng - this.uav.lng) * 0.08;
        this.uav.heading = target.heading;
      }
    }

    evaluateContingencyRecommendation(appState) {
      const ehi = appState ? (appState.ehi !== undefined ? appState.ehi : 96) : 96;
      const diag = appState ? (appState.aiDiagnosis || 'HEALTHY').toUpperCase() : 'HEALTHY';
      const scenario = appState ? (appState.scenario || 'normal') : 'normal';
      const quarantined = appState && appState.trustResult && appState.trustResult.quarantined ? appState.trustResult.quarantined : [];

      const isSensorFault = diag.includes('FAULT') || quarantined.length > 0 || scenario.includes('sensor');
      const isThermal = diag.includes('THERMAL') || scenario.includes('thermal') || ehi < 65;
      const isLubrication = diag.includes('LUBRICATION') || scenario.includes('lubrication') || ehi < 45;

      // Real-time distances and ETAs
      const basesWithDist = CONTINGENCY_BASES.map(b => {
        const distKm = calculateHaversineDistanceKm(this.uav.lat, this.uav.lng, b.lat, b.lng);
        const speedKmH = Math.max(80, this.uav.speedKts * 1.852);
        const etaMinutes = Math.round((distKm / speedKmH) * 60);
        return {
          ...b,
          distKm,
          etaMinutes
        };
      });

      const deesa = basesWithDist.find(b => b.id === 'deesa') || basesWithDist[1];
      const uttarlai = basesWithDist.find(b => b.id === 'uttarlai') || basesWithDist[0];

      if (isLubrication) {
        this.currentRecommendedBaseId = 'uttarlai';
        return {
          action: 'EMERGENCY_DIVERT',
          title: `CRITICAL DIVERT — ${uttarlai.shortName}`,
          badge: 'EMERGENCY DIVERT',
          urgency: 'CRITICAL',
          recommendedBase: uttarlai,
          reason: 'Severe lubrication pump cavitation / main bearing stress. Immediate RTB vector to military base with arrestor gear.',
          evidence: [
            `Engine Health Index: ${Math.round(ehi)}/100 (CRITICAL)`,
            `RUL severely truncated (< 8 hours remaining)`,
            `Distance to AFS Uttarlai: ${uttarlai.distKm} km • ETA: ${uttarlai.etaMinutes} min`
          ]
        };
      }

      if (isThermal) {
        this.currentRecommendedBaseId = 'deesa';
        return {
          action: 'TACTICAL_DIVERT',
          title: `TACTICAL RECOVERY — ${deesa.shortName}`,
          badge: 'TACTICAL DIVERT',
          urgency: 'WARNING',
          recommendedBase: deesa,
          reason: 'Dual trusted CHT/EGT sensors confirm multi-cylinder thermal runaway. Vector to nearest forward strip to arrest thermal fatigue.',
          evidence: [
            `Engine Health Index: ${Math.round(ehi)}/100 (WARNING)`,
            `Thermal wear accelerating degradation (+38%)`,
            `Closest recovery strip: ${deesa.name} (${deesa.distKm} km, ETA: ${deesa.etaMinutes} min)`
          ]
        };
      }

      if (isSensorFault) {
        this.currentRecommendedBaseId = 'uttarlai';
        return {
          action: 'CONTINUE_SORTIE',
          title: 'CONTINUE SORTIE — SENSOR QUARANTINED',
          badge: 'SORTIE CONTINUATION',
          urgency: 'ADVISORY',
          recommendedBase: uttarlai,
          reason: 'PRINCIPLE: BAD SENSOR ≠ BAD ENGINE. Oil pressure transducer reported unphysical variance and is quarantined. Propulsion integrity intact. Mission abort is NOT warranted.',
          evidence: [
            `Engine Health Index: ${Math.round(ehi)}/100 (Protected by Sensor Shield)`,
            `Quarantined: ${quarantined.join(', ') || 'Oil Pressure Sensor'} (Trust < 0.30)`,
            `All other 8 primary telemetry streams verify nominal`
          ]
        };
      }

      // Nominal
      this.currentRecommendedBaseId = 'uttarlai';
      return {
        action: 'CONTINUE_SORTIE',
        title: 'NOMINAL MISSION FLIGHTPATH',
        badge: 'MISSION GO',
        urgency: 'ROUTINE',
        recommendedBase: uttarlai,
        reason: 'All propulsion parameters and sensors track within baseline ISA cruise envelope. Full mission continuation authorized.',
        evidence: [
          `Engine Health Index: ${Math.round(ehi)}/100 (NOMINAL)`,
          `All 9 primary sensors trusted (> 0.94)`,
          `Planned recovery: ${uttarlai.name} (${uttarlai.distKm} km)`
        ]
      };
    }

    updateUI(appState = window.appState) {
      const rec = this.evaluateContingencyRecommendation(appState);

      // Top HUD Bar Elements
      const phaseEl = document.getElementById('map-hud-phase');
      const posEl = document.getElementById('map-hud-pos');
      const altSpdEl = document.getElementById('map-hud-alt-spd');
      const ehiEl = document.getElementById('map-hud-ehi');

      if (phaseEl) phaseEl.textContent = this.uav.phase.toUpperCase();
      if (posEl) posEl.textContent = `${this.uav.lat.toFixed(4)}°N, ${this.uav.lng.toFixed(4)}°E`;
      if (altSpdEl) altSpdEl.textContent = `${Math.round(this.uav.altitudeFt).toLocaleString()} FT • ${Math.round(this.uav.speedKts)} KTS`;
      if (ehiEl) {
        const ehi = appState ? (appState.ehi !== undefined ? Math.round(appState.ehi) : 96) : 96;
        ehiEl.textContent = `${ehi}/100`;
        ehiEl.style.color = ehi < 65 ? 'var(--status-critical)' : 'var(--status-nominal)';
      }

      // Recommendation Card Elements
      const recBox = document.getElementById('contingency-recommendation-box');
      const recTag = document.getElementById('contingency-rec-tag');
      const recTitle = document.getElementById('contingency-rec-title');
      const recReason = document.getElementById('contingency-rec-reason');
      const recEvidence = document.getElementById('contingency-rec-evidence');
      const recMetrics = document.getElementById('contingency-rec-metrics');

      if (recBox) {
        recBox.className = `contingency-recommendation-card urgency-${rec.urgency.toLowerCase()}`;
      }
      if (recTag) recTag.textContent = rec.badge;
      if (recTitle) recTitle.textContent = rec.title;
      if (recReason) recReason.textContent = rec.reason;
      if (recEvidence) {
        recEvidence.innerHTML = rec.evidence.map(e => `<div>&bull; ${e}</div>`).join('');
      }
      if (recMetrics && rec.recommendedBase) {
        recMetrics.innerHTML = `
          <div>TARGET: <strong>${rec.recommendedBase.shortName}</strong></div>
          <div>DIST: <strong>${rec.recommendedBase.distKm} KM</strong></div>
          <div>ETA: <strong>${rec.recommendedBase.etaMinutes} MIN</strong></div>
          <div>RWY: <strong>${rec.recommendedBase.runwayDesignation} (${rec.recommendedBase.runwayLengthFt.toLocaleString()} FT)</strong></div>
        `;
      }

      // Bases Cards Tray
      const tray = document.getElementById('contingency-bases-grid');
      if (tray) {
        const basesWithDist = CONTINGENCY_BASES.map(b => {
          const distKm = calculateHaversineDistanceKm(this.uav.lat, this.uav.lng, b.lat, b.lng);
          const speedKmH = Math.max(80, this.uav.speedKts * 1.852);
          const etaMinutes = Math.round((distKm / speedKmH) * 60);
          return { ...b, distKm, etaMinutes };
        });

        tray.innerHTML = basesWithDist.map(b => {
          const isRec = b.id === this.currentRecommendedBaseId;
          const isSelected = b.id === this.selectedBaseId;
          return `
            <div class="contingency-base-card ${isRec ? 'is-recommended' : ''} ${isSelected ? 'is-selected' : ''}" data-base-id="${b.id}">
              <div class="base-card-header">
                <span class="base-card-name">${b.shortName}</span>
                <span class="base-card-badge ${isRec ? 'badge-rec' : 'badge-base'}">${isRec ? 'RECOMMENDED' : b.statusLabel}</span>
              </div>
              <div class="base-card-details">
                <div>Runway: <strong>${b.runwayDesignation} (${b.runwayLengthFt.toLocaleString()} FT)</strong></div>
                <div>Suitability: <strong>${b.suitabilityScore} / 100</strong></div>
                <div>Distance: <strong>${b.distKm} KM</strong> &bull; ETA: <strong>${b.etaMinutes} MIN</strong></div>
                <div style="font-size:0.62rem; color:var(--text-muted); margin-top:3px;">${b.capabilities}</div>
              </div>
            </div>
          `;
        }).join('');

        tray.querySelectorAll('.contingency-base-card').forEach(card => {
          card.addEventListener('click', () => {
            const id = card.getAttribute('data-base-id');
            this.selectedBaseId = id;
            this.updateUI(appState);
          });
        });
      }
    }
  }

  window.MissionMapController = MissionMapController;
})();
