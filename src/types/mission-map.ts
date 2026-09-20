/**
 * AERO-TWIN: Mission Map & Contingency Decision Support Types
 * SIH Problem Statement SIH26054 | DRDO MALE UAV Aero Piston Engine Digital Twin
 */

export type MissionPhase = 
  | 'START' 
  | 'TAKEOFF' 
  | 'CLIMB' 
  | 'CRUISE' 
  | 'LOITER' 
  | 'RETURN' 
  | 'LANDING';

export interface MissionWaypoint {
  id: string;
  name: string;
  phase: MissionPhase;
  lat: number;
  lng: number;
  altitudeFt: number;
  speedKts: number;
}

export type LandingAreaStatus = 
  | 'PRIMARY_RECOVERY' 
  | 'TACTICAL_DIVERT' 
  | 'ALTERNATE_DIVERT' 
  | 'UNSUITABLE';

export interface LandingArea {
  id: string;
  name: string;
  shortName: string;
  lat: number;
  lng: number;
  runwayLengthFt: number;
  runwayDesignation: string;
  elevationFt: number;
  suitabilityScore: number; // 0 to 100
  distanceKm: number;       // Calculated dynamically from current UAV position
  etaMinutes: number;       // Calculated dynamically from UAV ground speed
  status: LandingAreaStatus;
  statusLabel: string;
  capabilities: string[];
}

export interface IncidentLocation {
  active: boolean;
  lat: number;
  lng: number;
  phase: MissionPhase;
  timestamp: string;
  faultClass: string;
  detectedFault: string;
  ehiAtIncident: number;
}

export type ContingencyAction = 
  | 'CONTINUE_SORTIE' 
  | 'HEIGHTENED_MONITORING' 
  | 'TACTICAL_DIVERT' 
  | 'EMERGENCY_DIVERT';

export interface ContingencyRecommendation {
  action: ContingencyAction;
  actionTitle: string;
  recommendedAreaId: string | null;
  recommendedAreaName: string;
  distanceKm: number | null;
  etaMinutes: number | null;
  urgency: 'ROUTINE' | 'ADVISORY' | 'WARNING' | 'CRITICAL';
  reasoning: string;
  evidence: string[];
  sensorShieldActive: boolean;
}

export interface MissionMapProps {
  mapboxToken?: string;
  uavPosition?: { lat: number; lng: number; heading: number; altitudeFt: number; speedKts: number };
  currentPhase?: MissionPhase;
  engineHealthIndex?: number;
  aiDiagnosis?: string;
  quarantinedSensors?: string[];
  onSelectLandingArea?: (area: LandingArea) => void;
  className?: string;
}
