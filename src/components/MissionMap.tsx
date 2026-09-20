import React, { useEffect, useRef, useState, useMemo } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import {
  MissionPhase,
  LandingArea,
  MissionWaypoint,
  IncidentLocation,
  ContingencyRecommendation,
  MissionMapProps
} from '../types/mission-map';

// Standard Indian Western Sector Simulated Mission Waypoints (Tapas MALE UAV Flight Corridor)
export const DEMO_MISSION_ROUTE: MissionWaypoint[] = [
  { id: 'wp-0', name: 'AFS UTTARLAI (START)', phase: 'START', lat: 25.8115, lng: 71.4820, altitudeFt: 510, speedKts: 0 },
  { id: 'wp-1', name: 'DEPARTURE CLIMB (BARMER)', phase: 'TAKEOFF', lat: 25.8850, lng: 71.5520, altitudeFt: 2500, speedKts: 85 },
  { id: 'wp-2', name: 'CORRIDOR ALPHA (SANCHORE)', phase: 'CLIMB', lat: 26.1500, lng: 71.8500, altitudeFt: 12000, speedKts: 105 },
  { id: 'wp-3', name: 'OPERATIONAL CEILING (CRUISE)', phase: 'CRUISE', lat: 26.4200, lng: 72.1800, altitudeFt: 18000, speedKts: 118 },
  { id: 'wp-4', name: 'ISR SECTOR-B (THAR LOITER)', phase: 'LOITER', lat: 26.6500, lng: 72.4200, altitudeFt: 20000, speedKts: 104 },
  { id: 'wp-5', name: 'INBOUND TRANSIT (RETURN)', phase: 'RETURN', lat: 26.1200, lng: 71.8200, altitudeFt: 14000, speedKts: 120 },
  { id: 'wp-6', name: 'FINAL RECOVERY (LANDING)', phase: 'LANDING', lat: 25.8115, lng: 71.4820, altitudeFt: 510, speedKts: 65 }
];

// 3 Predefined Simulated Contingency Landing Areas (Explicitly Simulated Prototype Data)
export const PREDEFINED_LANDING_AREAS: Omit<LandingArea, 'distanceKm' | 'etaMinutes'>[] = [
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
    status: 'PRIMARY_RECOVERY',
    statusLabel: 'PRIMARY MILITARY RECOVERY',
    capabilities: ['Full Military Crash/Rescue', 'Arrestor Barrier', 'OEM Engine Depot', 'Borescope Facility']
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
    status: 'TACTICAL_DIVERT',
    statusLabel: 'TACTICAL RECOVERY STRIP',
    capabilities: ['Expeditionary Refuel', 'Emergency Strip Access', 'Rapid Inspection Bay']
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
    status: 'ALTERNATE_DIVERT',
    statusLabel: 'COASTAL INTERCEPT AIRFIELD',
    capabilities: ['Extended All-Weather Runway', 'Maritime Recovery Equipment', 'Avionics Spares']
  }
];

function calculateHaversineDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
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

export const MissionMap: React.FC<MissionMapProps> = ({
  mapboxToken = import.meta.env.VITE_MAPBOX_TOKEN || '',
  uavPosition = { lat: 26.6500, lng: 72.4200, heading: 42, altitudeFt: 18000, speedKts: 118 },
  currentPhase = 'CRUISE',
  engineHealthIndex = 96,
  aiDiagnosis = 'HEALTHY',
  quarantinedSensors = [],
  onSelectLandingArea,
  className = ''
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const uavMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const incidentMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const baseMarkersRef = useRef<mapboxgl.Marker[]>([]);
  const [selectedBaseId, setSelectedBaseId] = useState<string>('uttarlai');
  const [mapStyleMode, setMapStyleMode] = useState<'standard' | 'satellite'>('standard');
  const [mapError, setMapError] = useState<string | null>(null);

  // Dynamic distance and ETA calculations
  const landingAreas: LandingArea[] = useMemo(() => {
    return PREDEFINED_LANDING_AREAS.map(base => {
      const dist = calculateHaversineDistanceKm(uavPosition.lat, uavPosition.lng, base.lat, base.lng);
      const groundSpeedKmH = Math.max(80, uavPosition.speedKts * 1.852);
      const eta = Math.round((dist / groundSpeedKmH) * 60);
      return {
        ...base,
        distanceKm: dist,
        etaMinutes: eta
      };
    });
  }, [uavPosition.lat, uavPosition.lng, uavPosition.speedKts]);

  // Deterministic Contingency Recommendation Logic ("Bad Sensor ≠ Bad Engine" principle)
  const recommendation: ContingencyRecommendation = useMemo(() => {
    const isSensorFault = aiDiagnosis.includes('FAULT') || quarantinedSensors.length > 0;
    const isThermal = aiDiagnosis.includes('THERMAL') || engineHealthIndex < 65;
    const isLubrication = aiDiagnosis.includes('LUBRICATION') || engineHealthIndex < 45;

    const deesaBase = landingAreas.find(b => b.id === 'deesa') || landingAreas[1];
    const uttarlaiBase = landingAreas.find(b => b.id === 'uttarlai') || landingAreas[0];

    if (isLubrication) {
      return {
        action: 'EMERGENCY_DIVERT',
        actionTitle: `CRITICAL DIVERT — ${uttarlaiBase.shortName}`,
        recommendedAreaId: uttarlaiBase.id,
        recommendedAreaName: uttarlaiBase.name,
        distanceKm: uttarlaiBase.distanceKm,
        etaMinutes: uttarlaiBase.etaMinutes,
        urgency: 'CRITICAL',
        reasoning: 'Critical oil pump cavitation / bearing stress detected. Rapid seizure hazard with low Remaining Useful Life (< 6h). Execute priority divert to military facility with arrestor barrier.',
        evidence: [
          `EHI: ${Math.round(engineHealthIndex)}/100 (CRITICAL)`,
          `Severe oil pressure loss corroborated by bearing vibration`,
          `Target: ${uttarlaiBase.name} (${uttarlaiBase.distanceKm} km • ETA: ${uttarlaiBase.etaMinutes} min)`
        ],
        sensorShieldActive: false
      };
    }

    if (isThermal) {
      return {
        action: 'TACTICAL_DIVERT',
        actionTitle: `TACTICAL RECOVERY — ${deesaBase.shortName}`,
        recommendedAreaId: deesaBase.id,
        recommendedAreaName: deesaBase.name,
        distanceKm: deesaBase.distanceKm,
        etaMinutes: deesaBase.etaMinutes,
        urgency: 'WARNING',
        reasoning: 'Authentic multi-cylinder thermal runaway verified by dual trusted CHT/EGT sensors. Reduce throttle to loiter equilibrium and vector to nearest forward strip for borescope inspection.',
        evidence: [
          `EHI: ${Math.round(engineHealthIndex)}/100 (WARNING)`,
          `Dual thermocouples confirm continuous heat accumulation`,
          `Closest recovery strip: ${deesaBase.name} (${deesaBase.distanceKm} km • ETA: ${deesaBase.etaMinutes} min)`
        ],
        sensorShieldActive: false
      };
    }

    if (isSensorFault) {
      return {
        action: 'CONTINUE_SORTIE',
        actionTitle: 'CONTINUE SORTIE — SENSOR QUARANTINED',
        recommendedAreaId: uttarlaiBase.id,
        recommendedAreaName: 'AFS Uttarlai (Planned Turnaround)',
        distanceKm: uttarlaiBase.distanceKm,
        etaMinutes: uttarlaiBase.etaMinutes,
        urgency: 'ADVISORY',
        reasoning: 'PRINCIPLE: BAD SENSOR ≠ BAD ENGINE. Oil pressure transducer reported unphysical variance and has been quarantined. Engine physical condition remains nominal. Emergency diversion is NOT required.',
        evidence: [
          `EHI: ${Math.round(engineHealthIndex)}/100 (Protected by Sensor Shield)`,
          `Quarantined: ${quarantinedSensors.join(', ') || 'Oil Pressure Transducer'}`,
          `No mechanical failure symptoms detected`
        ],
        sensorShieldActive: true
      };
    }

    // Nominal flight
    return {
      action: 'CONTINUE_SORTIE',
      actionTitle: 'NOMINAL MISSION FLIGHTPATH',
      recommendedAreaId: uttarlaiBase.id,
      recommendedAreaName: 'AFS Uttarlai (Home Airfield)',
      distanceKm: uttarlaiBase.distanceKm,
      etaMinutes: uttarlaiBase.etaMinutes,
      urgency: 'ROUTINE',
      reasoning: 'All propulsion parameters and sensors verify inside calibrated ISA equilibrium. Full planned mission continuation authorized.',
      evidence: [
        `EHI: ${Math.round(engineHealthIndex)}/100 (NOMINAL)`,
        `All 9 telemetry sensors verified trusted`,
        `Endurance margin ample for planned route completion`
      ],
      sensorShieldActive: false
    };
  }, [aiDiagnosis, engineHealthIndex, quarantinedSensors, landingAreas]);

  // Incident state marker (dropped when non-healthy anomaly occurs)
  const incidentLocation: IncidentLocation | null = useMemo(() => {
    if (aiDiagnosis === 'HEALTHY') return null;
    return {
      active: true,
      lat: uavPosition.lat,
      lng: uavPosition.lng,
      phase: currentPhase,
      timestamp: new Date().toLocaleTimeString(),
      faultClass: aiDiagnosis,
      detectedFault: aiDiagnosis === 'SENSOR_FAULT' ? 'Transducer Freeze / Decoupling' : 'Mechanical Propulsion Anomaly',
      ehiAtIncident: Math.round(engineHealthIndex)
    };
  }, [aiDiagnosis, currentPhase, uavPosition.lat, uavPosition.lng, engineHealthIndex]);

  // Real Mapbox GL JS Map Initialization
  useEffect(() => {
    if (!mapContainerRef.current) return;

    // Check token presence (never expose token string in UI or console)
    if (!mapboxToken || typeof mapboxToken !== 'string' || !mapboxToken.trim()) {
      setMapError('MAPBOX TOKEN MISSING: Configure VITE_MAPBOX_TOKEN in .env to render real geographic map tiles.');
      return;
    }

    setMapError(null);
    mapboxgl.accessToken = mapboxToken.trim();

    try {
      const map = new mapboxgl.Map({
        container: mapContainerRef.current,
        // Requirement 3: Use real Mapbox Standard geographic style
        style: 'mapbox://styles/mapbox/standard',
        center: [71.8500, 25.5500], // Center around Rajasthan / Western India mission area
        zoom: 7.2,
        pitch: 25,
        attributionControl: false
      });

      // Requirement 8: Add standard Mapbox controls
      map.addControl(new mapboxgl.NavigationControl({ showCompass: true }), 'top-right');
      map.addControl(new mapboxgl.FullscreenControl(), 'top-right');

      map.on('style.load', () => {
        // Requirement 9: Apply dark/night lighting preset on Mapbox Standard style
        if (mapStyleMode === 'standard') {
          try {
            map.setConfigProperty('basemap', 'lightPreset', 'night');
            map.setConfigProperty('basemap', 'showPlaceLabels', true);
            map.setConfigProperty('basemap', 'showRoadLabels', true);
          } catch (e) {
            // Standard style loaded without config property overrides
          }
        }

        // Add Planned Route GeoJSON Line on top of real geographic map
        const coordinates = DEMO_MISSION_ROUTE.map(wp => [wp.lng, wp.lat]);
        if (!map.getSource('planned-route')) {
          map.addSource('planned-route', {
            type: 'geojson',
            data: {
              type: 'Feature',
              properties: {},
              geometry: {
                type: 'LineString',
                coordinates
              }
            }
          });

          // Route Glow Layer (Slot: top ensures it sits above 3D buildings and basemap in standard)
          const glowLayerDef: any = {
            id: 'route-glow',
            type: 'line',
            source: 'planned-route',
            layout: { 'line-join': 'round', 'line-cap': 'round' },
            paint: {
              'line-color': '#00F0FF',
              'line-width': 7,
              'line-opacity': 0.35
            }
          };
          if (mapStyleMode === 'standard') glowLayerDef.slot = 'top';
          map.addLayer(glowLayerDef);

          // Main Route Line
          const lineLayerDef: any = {
            id: 'route-line',
            type: 'line',
            source: 'planned-route',
            layout: { 'line-join': 'round', 'line-cap': 'round' },
            paint: {
              'line-color': '#00F0FF',
              'line-width': 2.5,
              'line-dasharray': [2, 1.5]
            }
          };
          if (mapStyleMode === 'standard') lineLayerDef.slot = 'top';
          map.addLayer(lineLayerDef);
        }

        // Add Waypoint Markers
        DEMO_MISSION_ROUTE.forEach(wp => {
          const el = document.createElement('div');
          el.className = 'mapbox-wp-marker';
          el.title = `${wp.name} (${wp.phase})`;
          new mapboxgl.Marker({ element: el })
            .setLngLat([wp.lng, wp.lat])
            .setPopup(new mapboxgl.Popup({ offset: 12 }).setHTML(`
              <div style="font-family:monospace; font-size:11px; color:#0A0E14; padding:2px;">
                <strong>${wp.name}</strong><br/>
                Phase: ${wp.phase}<br/>
                Alt: ${wp.altitudeFt.toLocaleString()} FT
              </div>
            `))
            .addTo(map);
        });

        // Add 3 Simulated Contingency Base Markers
        PREDEFINED_LANDING_AREAS.forEach(base => {
          const el = document.createElement('div');
          el.className = 'mapbox-base-marker';
          el.innerHTML = `
            <div class="base-marker-pin">
              <span class="base-marker-icon">⚲</span>
              <span class="base-marker-title">${base.shortName}</span>
            </div>
          `;
          el.addEventListener('click', () => {
            setSelectedBaseId(base.id);
            if (onSelectLandingArea) {
              const b = landingAreas.find(item => item.id === base.id);
              if (b) onSelectLandingArea(b);
            }
          });

          const m = new mapboxgl.Marker({ element: el })
            .setLngLat([base.lng, base.lat])
            .addTo(map);
          baseMarkersRef.current.push(m);
        });
      });

      map.on('error', (e) => {
        // Do NOT silently fall back to fake canvas; report clear error state
        setMapError('MAPBOX MAP FAILED TO LOAD: Failed to load geographic tiles. Please check your network connection and token.');
      });

      mapRef.current = map;
    } catch (err: any) {
      setMapError(`MAPBOX MAP FAILED TO LOAD: ${err.message || 'Initialization error'}`);
    }

    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, [mapboxToken]);

  // Update UAV Marker on the real map
  useEffect(() => {
    if (!mapRef.current) return;

    if (!uavMarkerRef.current) {
      const el = document.createElement('div');
      el.className = 'mapbox-uav-marker';
      el.innerHTML = `
        <div class="uav-aircraft-icon" id="uav-aircraft-icon">
          <svg width="34" height="34" viewBox="0 0 32 32" fill="none">
            <path d="M16 2L20 12L28 16L20 18L18 28L16 25L14 28L12 18L4 16L12 12L16 2Z" fill="#00F0FF" stroke="#0A0E14" stroke-width="1.5"/>
            <circle cx="16" cy="16" r="3" fill="#FFFFFF"/>
          </svg>
        </div>
      `;
      uavMarkerRef.current = new mapboxgl.Marker({ element: el, rotationAlignment: 'map' })
        .setLngLat([uavPosition.lng, uavPosition.lat])
        .addTo(mapRef.current);
    } else {
      uavMarkerRef.current.setLngLat([uavPosition.lng, uavPosition.lat]);
      const icon = uavMarkerRef.current.getElement().querySelector('#uav-aircraft-icon') as HTMLElement;
      if (icon) {
        icon.style.transform = `rotate(${uavPosition.heading}deg)`;
      }
    }
  }, [uavPosition.lat, uavPosition.lng, uavPosition.heading]);

  // Update Incident Marker on the real map
  useEffect(() => {
    if (!mapRef.current) return;

    if (incidentLocation && incidentLocation.active) {
      if (!incidentMarkerRef.current) {
        const el = document.createElement('div');
        el.className = 'mapbox-incident-marker pulse-red';
        el.innerHTML = `<span>⚠️ INCIDENT LOCATION</span>`;
        incidentMarkerRef.current = new mapboxgl.Marker({ element: el })
          .setLngLat([incidentLocation.lng, incidentLocation.lat])
          .addTo(mapRef.current);
      } else {
        incidentMarkerRef.current.setLngLat([incidentLocation.lng, incidentLocation.lat]);
      }
    } else if (incidentMarkerRef.current) {
      incidentMarkerRef.current.remove();
      incidentMarkerRef.current = null;
    }
  }, [incidentLocation]);

  return (
    <div className={`mission-map-module ${className}`}>
      {/* Top Telemetry & Mission Phase Ribbon */}
      <div className="map-hud-ribbon">
        <div className="hud-metric">
          <span className="hud-lbl">CURRENT PHASE</span>
          <span className="hud-val phase-chip">{currentPhase}</span>
        </div>
        <div className="hud-metric">
          <span className="hud-lbl">UAV POSITION</span>
          <span className="hud-val font-mono">{uavPosition.lat.toFixed(4)}°N, {uavPosition.lng.toFixed(4)}°E</span>
        </div>
        <div className="hud-metric">
          <span className="hud-lbl">ALTITUDE &bull; SPEED</span>
          <span className="hud-val font-mono">
            {Math.round(uavPosition.altitudeFt).toLocaleString()} FT &bull; {Math.round(uavPosition.speedKts)} KTS
          </span>
        </div>
        <div className="hud-metric">
          <span className="hud-lbl">ENGINE HEALTH (EHI)</span>
          <span className={`hud-val font-mono ${engineHealthIndex < 65 ? 'text-crit' : 'text-nominal'}`}>
            {Math.round(engineHealthIndex)}/100
          </span>
        </div>
      </div>

      {/* Main Map Viewport with Explicit Height */}
      <div className="map-viewport-wrapper" style={{ height: '520px', minHeight: '500px', position: 'relative' }}>
        {/* Real Geographic Map Style Toggle */}
        <div className="map-style-toggle" style={{ position: 'absolute', top: '10px', right: '52px', zIndex: 5 }}>
          <button
            type="button"
            className={`map-style-btn ${mapStyleMode === 'standard' ? 'active' : ''}`}
            onClick={() => {
              if (mapRef.current && mapStyleMode !== 'standard') {
                setMapStyleMode('standard');
                mapRef.current.setStyle('mapbox://styles/mapbox/standard');
              }
            }}
          >
            STANDARD
          </button>
          <button
            type="button"
            className={`map-style-btn ${mapStyleMode === 'satellite' ? 'active' : ''}`}
            onClick={() => {
              if (mapRef.current && mapStyleMode !== 'satellite') {
                setMapStyleMode('satellite');
                mapRef.current.setStyle('mapbox://styles/mapbox/satellite-streets-v12');
              }
            }}
          >
            SATELLITE
          </button>
        </div>

        <div 
          ref={mapContainerRef} 
          className="mapbox-canvas-container" 
          style={{ width: '100%', height: '100%', minHeight: '500px' }} 
        />

        {/* Clear Error State when Token is Missing or Map Fails (No Fake Radar Fallback) */}
        {mapError && (
          <div className="mapbox-error-state" style={{
            position: 'absolute',
            inset: 0,
            background: 'rgba(9, 14, 23, 0.95)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '24px',
            zIndex: 10
          }}>
            <div className="mapbox-error-card" style={{
              maxWidth: '460px',
              background: 'var(--surface-0, #0E131C)',
              border: '1px solid var(--status-critical, #EF4444)',
              borderRadius: '6px',
              padding: '20px',
              textAlign: 'center'
            }}>
              <span style={{ fontSize: '2rem', display: 'block', marginBottom: '8px' }}>⚠️</span>
              <h3 style={{ color: '#EF4444', fontSize: '1rem', fontWeight: 800, margin: '0 0 8px' }}>
                {mapError.includes('MISSING') ? 'MAPBOX TOKEN MISSING' : 'MAPBOX MAP FAILED TO LOAD'}
              </h3>
              <p style={{ color: '#94A3B8', fontSize: '0.75rem', lineHeight: 1.5, margin: '0 0 12px' }}>
                {mapError}
              </p>
              <div style={{
                background: 'rgba(239, 68, 68, 0.1)',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                padding: '8px',
                borderRadius: '4px',
                fontSize: '0.7rem',
                color: '#EDF2F7',
                fontFamily: 'monospace'
              }}>
                Add <code>VITE_MAPBOX_TOKEN</code> in your <code>.env</code> file.
              </div>
            </div>
          </div>
        )}

        {/* Dynamic Contingency Decision Support Card Overlay */}
        <div className={`contingency-advisory-overlay urgency-${recommendation.urgency.toLowerCase()}`}>
          <div className="advisory-header">
            <span className="advisory-tag">
              {recommendation.urgency === 'CRITICAL' ? '🚨 CRITICAL ADVISORY' : 
               recommendation.urgency === 'WARNING' ? '⚠️ CONTINGENCY ADVISORY' : 
               recommendation.urgency === 'ADVISORY' ? 'ℹ️ SENSOR ADVISORY' : '✓ SORTIE CLEAR'}
            </span>
            <span className="advisory-title">{recommendation.actionTitle}</span>
          </div>

          <p className="advisory-reason">{recommendation.reasoning}</p>

          <div className="advisory-evidence">
            {recommendation.evidence.map((ev, i) => (
              <div key={i} className="evidence-bullet">&bull; {ev}</div>
            ))}
          </div>

          {recommendation.recommendedAreaId && (
            <div className="advisory-metrics-row">
              <div>TARGET: <strong>{recommendation.recommendedAreaName}</strong></div>
              <div>DIST: <strong>{recommendation.distanceKm} KM</strong></div>
              <div>ETA: <strong>{recommendation.etaMinutes} MIN</strong></div>
            </div>
          )}
        </div>
      </div>

      {/* 3 Predefined Simulated Contingency Landing Bases Tray */}
      <div className="contingency-areas-tray">
        <div className="tray-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <span>SIMULATED CONTINGENCY LANDING BASES (DRDO SECTOR)</span>
          <span style="font-size: 0.65rem; color: #64748B;">*Decision-Support Prototype: Simulated Facilities Only</span>
        </div>
        <div className="areas-grid">
          {landingAreas.map(base => {
            const isRec = base.id === recommendation.recommendedAreaId;
            return (
              <div 
                key={base.id} 
                className={`area-card ${isRec ? 'is-recommended' : ''} ${selectedBaseId === base.id ? 'is-selected' : ''}`}
                onClick={() => {
                  setSelectedBaseId(base.id);
                  if (onSelectLandingArea) onSelectLandingArea(base);
                }}
              >
                <div className="area-card-header">
                  <span className="area-name">{base.shortName}</span>
                  <span className={`area-badge ${isRec ? 'badge-rec' : 'badge-base'}`}>
                    {isRec ? 'RECOMMENDED' : base.statusLabel}
                  </span>
                </div>
                <div className="area-stats">
                  <div>RWY: <strong>{base.runwayDesignation} ({base.runwayLengthFt.toLocaleString()} FT)</strong></div>
                  <div>SUITABILITY: <strong>{base.suitabilityScore}/100</strong></div>
                  <div>DISTANCE: <strong>{base.distanceKm} KM</strong></div>
                  <div>EST. ETA: <strong>{base.etaMinutes} MIN</strong></div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default MissionMap;
