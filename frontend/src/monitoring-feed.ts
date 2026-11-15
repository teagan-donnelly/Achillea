// Data model for the Monitoring feed. Everything is derived from the live simulation state
// (the same State the rest of the app polls / receives over /api/stream): patients, vitals,
// devices, orientation samples, movements and repositioning plans. Nothing is invented:
// a measurement appears only if the simulation has produced it.
import type { Device, OrientationSample, Patient, State, Vital } from "./types";
import { latestReadings, metricName, readingState } from "./Monitoring";
import { repositioningStatus } from "./repositioning";

export type Attention = "ATTENTION" | "OFFLINE" | "STABLE";
export type FeedFilter = "ALL" | "ATTENTION" | "STABLE";
/** Colour of the room ring and card accent: red, amber, green, gray. */
export type Tone = "alert" | "warning" | "stable" | "offline";

/** Why a patient needs attention. Only "device" and "vital" reasons are meant for card text. */
export interface AttentionReason {
  kind: "device" | "vital" | "review" | "schedule";
  text: string;
}

export type MeasurementState = "LIVE" | "OLD" | "CHECK" | "UNAVAILABLE";

export interface FeedMeasurement {
  /** Backend metric key (HEART_RATE, SPO2, ...) or ROLL_UPPER_TORSO / ROLL_PELVIS. */
  key: string;
  label: string;
  /** null when the reading exists but carries no usable value (missing / disconnected). */
  value: number | null;
  unit: string;
  state: MeasurementState;
  /** Short human state, e.g. "Live", "Old reading", "Disconnected". */
  stateText: string;
  /** Source capture time of the reading (ISO), when known. */
  at: string | null;
}

export interface FeedPatient {
  patient: Patient;
  attention: Attention;
  tone: Tone;
  statusLabel: string;
  reasons: AttentionReason[];
  /** Vital signs the simulation has produced for this patient, in a fixed clinical order. */
  vitals: FeedMeasurement[];
  /** Body roll from the torso/pelvis sensors, when the patient has them. */
  posture: FeedMeasurement[];
  /** Devices that are not delivering data (disconnected or delayed). */
  offlineDevices: { id: string; region: string; state: string }[];
  /** Most recent capture time across all measurements (ISO), or null. */
  updatedAt: string | null;
}

const VITAL_ORDER = ["HEART_RATE", "SPO2", "RESPIRATORY_RATE", "BLOOD_PRESSURE_SYSTOLIC", "BLOOD_PRESSURE_DIASTOLIC", "TEMPERATURE"];
const SHORT_LABEL: Record<string, string> = {
  HEART_RATE: "Heart rate",
  SPO2: "SpO₂",
  RESPIRATORY_RATE: "Resp. rate",
  TEMPERATURE: "Temp",
  BLOOD_PRESSURE_SYSTOLIC: "BP sys",
  BLOOD_PRESSURE_DIASTOLIC: "BP dia",
};
const REGION_LABEL: Record<string, string> = {
  BEDSIDE_MONITOR: "Bedside monitor",
  UPPER_TORSO: "Torso sensor",
  PELVIS: "Pelvis sensor",
};

function measurementState(text: string): MeasurementState {
  if (text === "Recent reading") return "LIVE";
  if (text === "Old reading" || text === "Delayed reading") return "OLD";
  if (text === "Check signal quality") return "CHECK";
  return "UNAVAILABLE";
}

function vitalMeasurement(v: Vital, monitor?: Device): FeedMeasurement {
  const text = readingState(v, monitor);
  const state = measurementState(text);
  return {
    key: v.metric,
    label: SHORT_LABEL[v.metric] ?? metricName(v.metric),
    value: state === "UNAVAILABLE" || !Number.isFinite(v.value) ? null : v.value,
    unit: v.unit,
    state,
    stateText: state === "LIVE" ? "Live" : text,
    at: v.observedAt ?? null,
  };
}

function postureMeasurements(state: State, patientId: string, now: number): FeedMeasurement[] {
  const out: FeedMeasurement[] = [];
  for (const region of ["UPPER_TORSO", "PELVIS"]) {
    const device = state.devices?.find(
      (d) => d.patientId === patientId && d.bodyRegion === region,
    );
    if (!device) continue; // patient has no such sensor
    const latest = (state.samples ?? [])
      .filter((s) => s.patientId === patientId && s.bodyRegion === region)
      .reduce<OrientationSample | undefined>(
        (best, s) =>
          !best || Date.parse(s.capturedAt) > Date.parse(best.capturedAt) ? s : best,
        undefined,
      );
    const label = region === "UPPER_TORSO" ? "Torso" : "Pelvis";
    const key = `ROLL_${region}`;
    if (device.connectionState === "DISCONNECTED") {
      out.push({ key, label, value: null, unit: "°", state: "UNAVAILABLE", stateText: "Disconnected", at: latest?.capturedAt ?? null });
    } else if (!latest) {
      out.push({ key, label, value: null, unit: "°", state: "UNAVAILABLE", stateText: "No data yet", at: null });
    } else {
      const old =
        device.freshness === "STALE" ||
        device.connectionState === "DELAYED" ||
        now - Date.parse(latest.capturedAt) > 120000;
      out.push({
        key,
        label,
        value: latest.rollDegrees,
        unit: "°",
        state: old ? "OLD" : "LIVE",
        stateText: old ? "Old reading" : "Live",
        at: latest.capturedAt,
      });
    }
  }
  return out;
}

/** Builds one feed entry from live state. `now` is the demo clock (ms). */
export function feedPatient(state: State, patient: Patient, now = Date.now()): FeedPatient {
  const devices = (state.devices ?? []).filter((d) => d.patientId === patient.id);
  const monitor = devices.find((d) => d.bodyRegion === "BEDSIDE_MONITOR");
  const vitals = latestReadings(state.vitals.filter((v) => v.patientId === patient.id))
    .map((v) => vitalMeasurement(v, monitor))
    .sort(
      (a, b) =>
        (VITAL_ORDER.indexOf(a.key) + 1 || 99) - (VITAL_ORDER.indexOf(b.key) + 1 || 99) ||
        a.key.localeCompare(b.key),
    );
  const posture = postureMeasurements(state, patient.id, now);

  const offlineDevices = devices
    .filter((d) => d.connectionState !== "CONNECTED" || d.freshness === "STALE")
    .map((d) => ({
      id: d.id,
      region: REGION_LABEL[d.bodyRegion] ?? d.bodyRegion,
      state:
        d.connectionState === "DISCONNECTED"
          ? "Disconnected"
          : d.connectionState === "DELAYED"
            ? "Delayed"
            : "No recent data",
    }));

  const reasons: AttentionReason[] = [];
  for (const d of offlineDevices)
    reasons.push({ kind: "device", text: `${d.region} ${d.state.toLowerCase()}` });
  for (const v of vitals)
    if (v.state === "CHECK") reasons.push({ kind: "vital", text: `${v.label}: check signal` });
  const pendingReview = state.movements.filter(
    (m) =>
      m.patientId === patient.id &&
      m.reviewRequired &&
      ["UNREVIEWED", "NEEDS_REVIEW"].includes(m.verificationStatus),
  ).length;
  if (pendingReview)
    reasons.push({ kind: "review", text: `${pendingReview} movement${pendingReview > 1 ? "s" : ""} to review` });
  if (patient.repositionPlan && repositioningStatus(state, patient, now).schedule === "OVERDUE")
    reasons.push({ kind: "schedule", text: "Repositioning overdue" });

  const monitorOffline =
    !monitor || monitor.connectionState === "DISCONNECTED" || (vitals.length === 0 && posture.every((p) => p.value === null));
  const attention: Attention = monitorOffline ? "OFFLINE" : reasons.length ? "ATTENTION" : "STABLE";
  const tone: Tone =
    attention === "OFFLINE"
      ? "offline"
      : reasons.some((r) => r.kind !== "schedule")
        ? "alert"
        : reasons.length || [...vitals, ...posture].some((m) => m.state === "OLD")
          ? "warning"
          : "stable";
  const times = [...vitals, ...posture].map((m) => m.at).filter((t): t is string => !!t);
  return {
    patient,
    attention,
    tone,
    statusLabel:
      attention === "OFFLINE"
        ? !monitor || monitor.connectionState === "DISCONNECTED"
          ? "Monitor offline"
          : "Awaiting data"
        : attention === "ATTENTION"
          ? "Needs attention"
          : "Stable",
    reasons,
    vitals,
    posture,
    offlineDevices,
    updatedAt: times.length ? times.reduce((a, b) => (Date.parse(a) > Date.parse(b) ? a : b)) : null,
  };
}

/** Offline patients count as needing attention (they need someone to check the equipment). */
export const needsAttention = (f: FeedPatient) => f.attention !== "STABLE";

/** Feed for a list of patients: most urgent first, then by room. */
export function buildFeed(state: State, patients: Patient[], now = Date.now()): FeedPatient[] {
  const rank: Record<Attention, number> = { ATTENTION: 0, OFFLINE: 1, STABLE: 2 };
  return patients
    .map((p) => feedPatient(state, p, now))
    .sort(
      (a, b) =>
        rank[a.attention] - rank[b.attention] ||
        a.patient.room.localeCompare(b.patient.room, undefined, { numeric: true }),
    );
}

export function filterFeed(feed: FeedPatient[], filter: FeedFilter) {
  return filter === "ALL"
    ? feed
    : filter === "ATTENTION"
      ? feed.filter(needsAttention)
      : feed.filter((f) => !needsAttention(f));
}
