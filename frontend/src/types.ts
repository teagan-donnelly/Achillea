export interface Patient {
  id: string;
  name: string;
  room: string;
  unit: string;
  summary: string;
  nurseId: string;
  repositionPlan: boolean;
  carePhase?: string | null;
  scenario?: string | null;
}
export interface Task {
  scheduleState?: string | null;
  relatedDeviceId?: string | null;
  relatedMovementId?: string | null;
  id: string;
  patientId: string;
  title: string;
  type: string;
  status: string;
  priority: string;
  source: string;
  dueAt: string;
  verificationRequired: boolean;
  deferReason: string | null;
  order: number;
  completedAt: string | null;
  verifiedBy: string | null;
}
export interface Vital {
  id: string;
  patientId: string;
  metric: string;
  value: number;
  unit: string;
  observedAt: string;
  receivedAt: string;
  source: string;
  sourceEventId: string;
  quality: string;
  sourceId?: string | null;
}
export interface Movement {
  reviewRequired?: boolean;
  reviewReasonCodes?: string[];
  id: string;
  patientId: string;
  classification: string;
  quality: string;
  verificationStatus: string;
  reviewerId: string | null;
  reviewedAt: string | null;
  chestBefore: number;
  pelvisBefore: number;
  chestAfter: number;
  pelvisAfter: number;
  capturedAt: string;
  sampleIds: string[];
  chestSensorId?: string | null;
  pelvisSensorId?: string | null;
  receivedAt?: string | null;
  confidence?: number | null;
}
export interface Chart {
  id: string;
  patientId: string;
  nurseId: string;
  type: string;
  text: string;
  status: string;
  linkedTaskId: string | null;
  linkedMovementId: string | null;
  linkedVitalIds: string[];
  authoredAt: string;
  confirmedAt: string | null;
  amendmentOfId: string | null;
  provenance: string;
}
export interface Event {
  id: string;
  patientId: string | null;
  type: string;
  source: string;
  details: string;
  timestamp: string;
}
export interface Device {
  updateIntervalSeconds?: number;
  id: string;
  patientId: string;
  bodyRegion: string;
  connectionState: string;
  freshness: string;
  mode: string;
  calibrationStatus: string;
  lastSeenAt: string | null;
  lastSampledAt: string | null;
  manualOverride?: boolean;
}
export interface OrientationSample {
  id: string;
  sensorId: string;
  patientId: string;
  bodyRegion: string;
  rollDegrees: number;
  capturedAt: string;
  receivedAt: string;
  quality: string;
  mode: string;
}
export interface State {
  patients: Patient[];
  tasks: Task[];
  vitals: Vital[];
  movements: Movement[];
  charts: Chart[];
  events: Event[];
  devices?: Device[];
  samples?: OrientationSample[];
  demoStartedAt?: string | null;
  serverTime?: string | null;
  monitorTick?: number;
}
export interface Round {
  reasonCodes?: string[];
  task: Task;
  reason: string;
  rank: number;
  horizon?: "NOW" | "NEXT" | "LATER";
}

export interface ActivityItem {
  id: string;
  patientId: string | null;
  category: string;
  type: string;
  sourceId: string | null;
  startedAt: string;
  timestamp: string;
  count: number;
  summary: string;
  measurementIds: string[];
  sourceEventIds: string[];
  rawEventIds: string[];
}
export interface MonitoringUpdates {
  serverTime: string;
  nextSince: string;
  inclusive: boolean;
  measurements: Vital[];
  orientationSamples: OrientationSample[];
  devices: Device[];
  events: Event[];
}
export interface SensorHistory {
  patientId: string;
  orientationUnit: string;
  ruleVersion: string;
  samples: OrientationSample[];
  devices: Device[];
  connectivityEvents: Event[];
  movements: { movement: Movement; charts: Chart[] }[];
}
export interface DemoStep {
  title: string;
  method: string;
  path: string;
  body: Record<string, unknown>;
  captureAs: string | null;
}
export interface DemoPlan {
  key: string;
  patientId: string;
  notice: string;
  beforeRounds: Round[];
  state: State;
  evidenceIds: Record<string, string>;
  steps: DemoStep[];
}
