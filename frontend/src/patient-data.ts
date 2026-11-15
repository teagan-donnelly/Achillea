// Shared helpers for the Patients tab (directory + longitudinal profile).
// Everything here derives from the live simulation State or existing /api endpoints; nothing is
// invented. When a field is absent from the data it is omitted, never guessed.
import type { Chart, Event, Patient, State } from "./types";
import { words } from "./api";

const STAFF: Record<string, string> = { "nurse-demo": "Jordan Ellis, RN" };
/** Display name for a staff id. Unknown ids are shown as recorded. */
export const staffName = (id?: string | null) => (id ? (STAFF[id] ?? id) : "Unknown author");

export const unitName = (unit: string) =>
  unit === "ICU" ? "ICU" : unit === "L_AND_D" ? "Labor & delivery" : words(unit);
export const unitShort = (unit: string) =>
  unit === "ICU" ? "ICU" : unit === "L_AND_D" ? "L&D" : words(unit);

/** Care phase, unless it only repeats the unit ("ICU stay" on an ICU patient). */
export function carePhase(p: Patient) {
  const phase = p.carePhase?.trim();
  if (!phase) return null;
  return phase.toLowerCase().startsWith(unitShort(p.unit).toLowerCase()) ? null : phase;
}

const ms = (iso?: string | null) => (iso ? Date.parse(iso) : NaN);

export function clock(iso: string) {
  const t = ms(iso);
  return Number.isFinite(t)
    ? new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : "Time unavailable";
}

function dayStart(t: number) {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** "Today", "Yesterday", or "Sat, Nov 14" relative to the demo clock. */
export function dayLabel(iso: string, now: number) {
  const t = ms(iso);
  if (!Number.isFinite(t)) return "Date unavailable";
  const diff = Math.round((dayStart(now) - dayStart(t)) / 86400000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return new Date(t).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
}

/** Time today, otherwise a short date and time. */
export function stamp(iso: string, now: number) {
  const label = dayLabel(iso, now);
  return label === "Today" ? clock(iso) : `${label}, ${clock(iso)}`;
}

/** Short relative stamp for list rows: "14:05" today, "Yesterday", or "Nov 14". */
export function shortStamp(iso: string, now: number) {
  const label = dayLabel(iso, now);
  if (label === "Today") return clock(iso);
  if (label === "Yesterday") return label;
  return new Date(ms(iso)).toLocaleDateString([], { month: "short", day: "numeric" });
}

export const entryTypeName = (type: string) =>
  ({
    OBSERVATION: "Nursing observation",
    ASSESSMENT: "Bedside assessment",
    CARE_NOTE: "Care note",
    TASK_COMPLETION: "Task completion",
    REPOSITIONING: "Repositioning",
  })[type] ?? words(type).replace(/^./, (c) => c.toUpperCase());

/** When a chart entry entered the record: confirmation time, falling back to authoring time. */
export const chartTime = (c: Chart) => c.confirmedAt ?? c.authoredAt;

/** Latest nurse documentation activity for a patient (confirmed charts, completed tasks, reviews). */
export function lastDocumented(state: State, patientId: string) {
  const candidates: { at: string; label: string }[] = [];
  for (const c of state.charts)
    if (c.patientId === patientId && c.status !== "DRAFT")
      candidates.push({ at: chartTime(c), label: "Charted" });
  for (const t of state.tasks)
    if (t.patientId === patientId && t.status === "COMPLETED" && t.completedAt)
      candidates.push({ at: t.completedAt, label: "Task completed" });
  for (const m of state.movements)
    if (m.patientId === patientId && m.reviewedAt)
      candidates.push({ at: m.reviewedAt, label: "Reviewed" });
  return candidates
    .filter((c) => Number.isFinite(ms(c.at)))
    .reduce<{ at: string; label: string } | null>(
      (best, c) => (!best || ms(c.at) > ms(best.at) ? c : best),
      null,
    );
}

/** Earliest time this patient appears in the data we hold (for "Full stay"). */
export function stayStart(state: State, patientId: string, extra: (string | null | undefined)[] = []) {
  const times = [
    state.demoStartedAt,
    ...state.vitals.filter((v) => v.patientId === patientId).map((v) => v.observedAt),
    ...state.events.filter((e) => e.patientId === patientId).map((e) => e.timestamp),
    ...state.charts.filter((c) => c.patientId === patientId).map((c) => c.authoredAt),
    ...extra,
  ]
    .map(ms)
    .filter(Number.isFinite);
  return times.length ? new Date(Math.min(...times)).toISOString() : null;
}

/** Monitoring receipts are high-volume plumbing, not clinical history. */
export const isReceiptEvent = (e: Event) =>
  e.type === "vital.received" || e.type.startsWith("sample.") || e.type.startsWith("orientation.");

export function sessionGet(key: string) {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}
export function sessionSet(key: string, value: string) {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    /* Storage unavailable: preference simply is not retained. */
  }
}

/** Human name for a device / sensor id ("torso-sim-01" -> "Torso sensor"). */
export function deviceName(id: string, region?: string | null) {
  const key = `${region ?? ""} ${id}`.toLowerCase();
  if (/bedside_monitor|monitor/.test(key)) return "Bedside monitor";
  if (/upper_torso|torso|chest/.test(key)) return "Torso sensor";
  if (/pelvis/.test(key)) return "Pelvis sensor";
  return "Device";
}

/** Replace raw device ids inside free text with their human names. */
export const humaniseIds = (text: string) =>
  text.replace(/\b(?:monitor|torso|chest|pelvis)-[a-z0-9-]+/gi, (id) => deviceName(id));
