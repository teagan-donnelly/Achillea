/**
 * Pure helpers for the Tasks tab (RoundsView) and the shared TaskList. Everything is derived from
 * backend fields (scheduleState, dueAt, priority, server rank, completedAt); nothing is invented.
 */
import type { Movement, Patient, Round, State, Task } from "./types";

export type TaskGroup = "OVERDUE" | "DUE" | "UPCOMING";

export const GROUP_TITLE: Record<TaskGroup, string> = {
  OVERDUE: "Overdue",
  DUE: "Due Now",
  UPCOMING: "Upcoming",
};

const MINUTE = 60_000;

/**
 * Backend scheduleState: OVERDUE (past due), DUE (exactly due), UPCOMING (within 30 min),
 * LATER (beyond 30 min). "Due Now" = DUE + UPCOMING. Without a scheduleState (older snapshots),
 * the same 30 minute rule is applied to dueAt.
 */
export function taskGroup(task: Task, now: number): TaskGroup {
  const s = task.scheduleState;
  if (s === "OVERDUE") return "OVERDUE";
  if (s === "DUE" || s === "UPCOMING") return "DUE";
  if (s === "LATER") return "UPCOMING";
  const due = Date.parse(task.dueAt);
  if (!Number.isFinite(due)) return "UPCOMING";
  if (due < now) return "OVERDUE";
  return due - now <= 30 * MINUTE ? "DUE" : "UPCOMING";
}

/** Splits the server-ranked queue into groups, preserving server order inside each group. */
export function groupRounds(rounds: Round[], now: number) {
  const groups: Record<TaskGroup, Round[]> = {
    OVERDUE: [],
    DUE: [],
    UPCOMING: [],
  };
  for (const r of rounds) groups[taskGroup(r.task, now)].push(r);
  return groups;
}

/** "14 min", "1 h 5 min", "2 d" for a positive millisecond span. */
function span(ms: number) {
  const minutes = Math.round(Math.abs(ms) / MINUTE);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60),
    rest = minutes % 60;
  if (hours < 24) return rest ? `${hours} h ${rest} min` : `${hours} h`;
  return `${Math.round(hours / 24)} d`;
}

/** Relative due phrase: "14 min overdue", "Due now", "In 22 min". */
export function relativeDue(dueAt: string, now: number) {
  const due = Date.parse(dueAt);
  if (!Number.isFinite(due)) return "";
  const diff = due - now;
  if (Math.abs(diff) < MINUTE) return "Due now";
  return diff < 0 ? `${span(diff)} overdue` : `In ${span(diff)}`;
}

function sameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** Clock time, with a short weekday when it is not on the same day as `now`. */
export function clock(value: string, now: number) {
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return "";
  const t = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return sameDay(d, new Date(now))
    ? t
    : `${d.toLocaleDateString([], { weekday: "short" })} ${t}`;
}

export function dayLabel(value: string | Date, now: number) {
  const d = new Date(value),
    today = new Date(now),
    yesterday = new Date(now - 24 * 60 * MINUTE);
  if (sameDay(d, today)) return "Today";
  if (sameDay(d, yesterday)) return "Yesterday";
  return d.toLocaleDateString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

/** Local calendar key (YYYY-MM-DD) for grouping completed work by day. */
export function dayKey(value: string) {
  const d = new Date(value);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function patientOf(state: State, id: string): Patient | undefined {
  return state.patients.find((p) => p.id === id);
}

export function patientLine(p: Patient | undefined) {
  return p ? `${p.name} · Room ${p.room}` : "Unassigned patient";
}

/**
 * Movements that can satisfy a repositioning completion: nurse-confirmed care for this patient
 * that has not already been used by another completed task (the backend enforces the same).
 */
export function confirmedMovements(state: State, task: Task): Movement[] {
  return state.movements.filter(
    (m) =>
      m.patientId === task.patientId &&
      m.verificationStatus === "CONFIRMED_CARE" &&
      !state.charts.some(
        (c) =>
          c.status !== "DRAFT" &&
          c.linkedMovementId === m.id &&
          state.tasks.some(
            (t) => t.id === c.linkedTaskId && t.status === "COMPLETED",
          ),
      ),
  );
}

export const words = (value: string) =>
  value.toLowerCase().replaceAll("_", " ");
export const sentence = (value: string) => {
  const w = words(value);
  return w.charAt(0).toUpperCase() + w.slice(1);
};

/** Sensor-backed tasks link to the Monitoring detail for that patient. */
export const hasSensorEvidence = (task: Task) =>
  Boolean(task.relatedMovementId || task.relatedDeviceId) ||
  task.type === "SENSOR_REVIEW";

/** The demo has a single nurse identity; unknown ids are shown as recorded. */
const STAFF: Record<string, string> = { "nurse-demo": "Jordan Ellis, RN" };
export const staffName = (id: string) => STAFF[id] ?? id;

/** Nurse-facing title: technical device reviews read "Check sensor connection"; never "simulated". */
export function displayTitle(task: Task) {
  if (task.type === "DEVICE_REVIEW") return "Check sensor connection";
  return task.title
    .replace(/\bsimulated\s+/gi, "")
    .replace(/^\w/, (c) => c.toUpperCase());
}

export type ListEntry =
  | { kind: "task"; round: Round }
  | { kind: "sensors"; key: string; patientId: string; rounds: Round[] };

/**
 * Collapses a patient's device-review tasks (one per stale sensor) into a single entry, placed
 * where the first of them ranks. A lone device review stays a normal row.
 */
export function listEntries(rounds: Round[]): ListEntry[] {
  const devices = new Map<string, Round[]>();
  for (const r of rounds)
    if (r.task.type === "DEVICE_REVIEW")
      devices.set(r.task.patientId, [
        ...(devices.get(r.task.patientId) ?? []),
        r,
      ]);
  const out: ListEntry[] = [];
  const placed = new Set<string>();
  for (const r of rounds) {
    const group =
      r.task.type === "DEVICE_REVIEW"
        ? devices.get(r.task.patientId)
        : undefined;
    if (!group || group.length < 2) out.push({ kind: "task", round: r });
    else if (!placed.has(r.task.patientId)) {
      placed.add(r.task.patientId);
      out.push({
        kind: "sensors",
        key: `sensors-${r.task.patientId}`,
        patientId: r.task.patientId,
        rounds: group,
      });
    }
  }
  return out;
}

/** The server reason without configuration notes such as "(configured demo rule)". */
export const plainReason = (reason: string | undefined) =>
  reason?.replace(/\s*\([^)]*\)\s*$/, "").trim() ?? "";
