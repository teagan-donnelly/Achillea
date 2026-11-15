// Pure data logic for the Handoff tab. Everything is derived from live state (tasks, charts,
// movements, devices, events) or from nurse-authored handoff records. No summaries are generated:
// this module only selects, filters, orders and labels recorded facts.
import type { Chart, Patient, Round, State, Task } from "./types";
import type { Handoff, HandoffStatus, ShiftLabel } from "./handoff-types";
import { feedPatient } from "./monitoring-feed";
import type { Tone } from "./ui";

// ---------------------------------------------------------------- shifts

/** Day = 07:00-19:00, Night = 19:00-07:00 (local time); a night belongs to the date it starts. */
export function shiftOf(now: number): { shiftDate: string; shiftLabel: ShiftLabel } {
  const d = new Date(now);
  const h = d.getHours();
  if (h >= 7 && h < 19) return { shiftDate: isoDate(d), shiftLabel: "Day" };
  if (h < 7) d.setDate(d.getDate() - 1);
  return { shiftDate: isoDate(d), shiftLabel: "Night" };
}

function isoDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Start and end (ms, local time) of a shift. */
export function shiftWindow(shiftDate: string, shiftLabel: ShiftLabel): { start: number; end: number } {
  const [y, m, day] = shiftDate.split("-").map(Number);
  const start = new Date(y!, (m ?? 1) - 1, day ?? 1, shiftLabel === "Day" ? 7 : 19).getTime();
  const end = new Date(y!, (m ?? 1) - 1, (day ?? 1) + (shiftLabel === "Day" ? 0 : 1), shiftLabel === "Day" ? 19 : 7).getTime();
  return { start, end };
}

const sameShift = (h: Pick<Handoff, "shiftDate" | "shiftLabel">, s: { shiftDate: string; shiftLabel: ShiftLabel }) =>
  h.shiftDate === s.shiftDate && h.shiftLabel === s.shiftLabel;

/** "Sat 14 Nov" */
export function shiftDay(shiftDate: string) {
  const [y, m, d] = shiftDate.split("-").map(Number);
  return new Date(y!, (m ?? 1) - 1, d ?? 1).toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });
}

export const shiftName = (label: ShiftLabel) => `${label} shift`;

// ---------------------------------------------------------------- lists

export const isOpenHandoff = (h: Handoff) => h.status !== "ACKNOWLEDGED";

/**
 * The demo has one nurse, so the same person both prepares and receives handoffs:
 *   Outgoing = DRAFT / READY (being prepared or sent),
 *   Incoming = READY / REVIEWED (awaiting review or acknowledgment),
 *   History  = ACKNOWLEDGED.
 * Most recently updated first.
 */
export function bucketHandoffs(list: Handoff[]) {
  const sorted = [...list].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt) || a.id.localeCompare(b.id));
  return {
    incoming: sorted.filter((h) => h.status === "READY" || h.status === "REVIEWED"),
    outgoing: sorted.filter((h) => h.status === "DRAFT" || h.status === "READY"),
    history: sorted.filter((h) => h.status === "ACKNOWLEDGED"),
  };
}

export interface HistoryGroup {
  key: string;
  shiftDate: string;
  shiftLabel: ShiftLabel;
  items: Handoff[];
}

/** Acknowledged handoffs grouped by shift, newest shift first (night after day on the same date). */
export function historyGroups(list: Handoff[]): HistoryGroup[] {
  const groups = new Map<string, HistoryGroup>();
  for (const h of list) {
    const key = `${h.shiftDate}-${h.shiftLabel}`;
    if (!groups.has(key)) groups.set(key, { key, shiftDate: h.shiftDate, shiftLabel: h.shiftLabel, items: [] });
    groups.get(key)!.items.push(h);
  }
  return [...groups.values()]
    .sort((a, b) => b.shiftDate.localeCompare(a.shiftDate) || (a.shiftLabel === "Night" ? -1 : 1) - (b.shiftLabel === "Night" ? -1 : 1))
    .map((g) => ({ ...g, items: g.items.sort((a, b) => (a.room ?? "").localeCompare(b.room ?? "", undefined, { numeric: true })) }));
}

/** Assigned patients that have no open (unacknowledged) handoff for the current shift. */
export function startCandidates(patients: Patient[], handoffs: Handoff[], now: number) {
  const shift = shiftOf(now);
  return patients
    .filter((p) => !handoffs.some((h) => h.patientId === p.id && isOpenHandoff(h) && sameShift(h, shift)))
    .sort((a, b) => a.room.localeCompare(b.room, undefined, { numeric: true }));
}

/** Earlier handoffs for the same patient (everything except `currentId`), newest shift first. */
export function previousHandoffs(handoffs: Handoff[], patientId: string, currentId?: string) {
  const current = handoffs.find((h) => h.id === currentId);
  const currentStart = current ? shiftWindow(current.shiftDate, current.shiftLabel).start : Infinity;
  return handoffs
    .filter((h) => h.patientId === patientId && h.id !== currentId && shiftWindow(h.shiftDate, h.shiftLabel).start < currentStart)
    .sort((a, b) => shiftWindow(b.shiftDate, b.shiftLabel).start - shiftWindow(a.shiftDate, a.shiftLabel).start || Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

// ---------------------------------------------------------------- labels

export const STATUS_PILL: Record<HandoffStatus, { label: string; tone: Tone }> = {
  DRAFT: { label: "Draft", tone: "grey" },
  READY: { label: "Ready", tone: "green" },
  REVIEWED: { label: "Reviewed", tone: "amber" },
  ACKNOWLEDGED: { label: "Acknowledged", tone: "neutral" },
};

const STAFF: Record<string, string> = { "nurse-demo": "Jordan Ellis, RN" };
export const staffName = (id: string | null | undefined) => (id ? (STAFF[id] ?? id) : "Unassigned");

/** First lines of nurse-written text, for compact previews. */
export function brief(text: string | null | undefined, max = 120) {
  const clean = (text ?? "").trim().split(/\n+/).slice(0, 2).join(" · ");
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}

export function clock(at: string | number) {
  return new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/** "Sun 15 Nov, 07:12" in local time. */
export function stamp(at: string) {
  return new Date(at).toLocaleString([], { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

/** "Just now", "12 min ago", "3 h ago", else a date + time. */
export function ago(at: string | null | undefined, now: number) {
  if (!at) return "—";
  const minutes = Math.round((now - Date.parse(at)) / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 12 * 60) return `${Math.round(minutes / 60)} h ago`;
  return new Date(at).toLocaleString([], { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

// ---------------------------------------------------------------- outstanding care

const CLOSED_TASK = new Set(["COMPLETED", "CANCELLED"]);
export const isOpenTask = (t: Task) => !CLOSED_TASK.has(t.status);

/** Open tasks for a patient: server rank first (from /api/rounds), then due time. Never creates tasks. */
export function openTasks(state: State, rounds: Round[], patientId: string): Task[] {
  const rank = new Map(rounds.map((r) => [r.task.id, r.rank]));
  const byId = new Map<string, Task>();
  for (const t of state.tasks) if (t.patientId === patientId && isOpenTask(t)) byId.set(t.id, t);
  for (const r of rounds) if (r.task.patientId === patientId && isOpenTask(r.task) && !byId.has(r.task.id)) byId.set(r.task.id, r.task);
  return [...byId.values()].sort(
    (a, b) =>
      (rank.get(a.id) ?? 999) - (rank.get(b.id) ?? 999) || Date.parse(a.dueAt) - Date.parse(b.dueAt) || a.order - b.order,
  );
}

export const openTaskCount = (state: State, rounds: Round[], patientId: string) => openTasks(state, rounds, patientId).length;

export function taskState(t: Task, now: number): { label: string; tone: Tone } {
  if (t.status === "DEFERRED") return { label: "Deferred", tone: "amber" };
  if (Number.isFinite(Date.parse(t.dueAt)) && Date.parse(t.dueAt) < now) return { label: "Overdue", tone: "red" };
  if (t.status === "ACKNOWLEDGED") return { label: "Acknowledged", tone: "grey" };
  return { label: "Open", tone: "neutral" };
}

// ---------------------------------------------------------------- current situation

export interface Concern {
  id: string;
  text: string;
  tone: Tone;
  /** Where this fact comes from. */
  source: "Sensor" | "Monitor" | "Schedule" | "Documentation" | "Tasks";
}

/** Active concerns, each backed by a recorded fact (device state, review queue, task, chart draft). */
export function activeConcerns(state: State, patient: Patient, rounds: Round[], now: number): Concern[] {
  const feed = feedPatient(state, patient, now);
  const out: Concern[] = feed.reasons.map((r, i) => ({
    id: `reason-${i}`,
    text: r.text,
    tone: r.kind === "schedule" ? "amber" : "red",
    source: r.kind === "device" ? "Sensor" : r.kind === "vital" ? "Monitor" : r.kind === "review" ? "Sensor" : "Schedule",
  }));
  const overdue = openTasks(state, rounds, patient.id).filter((t) => taskState(t, now).label === "Overdue").length;
  if (overdue) out.push({ id: "overdue", text: `${overdue} overdue task${overdue === 1 ? "" : "s"}`, tone: "red", source: "Tasks" });
  const drafts = state.charts.filter((c) => c.patientId === patient.id && c.status === "DRAFT").length;
  if (drafts)
    out.push({ id: "drafts", text: `${drafts} chart draft${drafts === 1 ? "" : "s"} awaiting confirmation`, tone: "amber", source: "Documentation" });
  return out;
}

// ---------------------------------------------------------------- shift timeline

export type Origin = "sensor" | "nurse" | "verified";

export interface TimelineItem {
  id: string;
  at: string;
  title: string;
  detail?: string;
  /** sensor = generated by a device; nurse = documented by a nurse; verified = sensor-detected, nurse-confirmed. */
  origin: Origin;
  source: string;
}

const REGION: Record<string, string> = {
  BEDSIDE_MONITOR: "Bedside monitor",
  UPPER_TORSO: "Torso sensor",
  PELVIS: "Pelvis sensor",
};

function deviceLabel(state: State, details: string) {
  const id = details.split(/[\s:·]/)[0] ?? "";
  const d = state.devices?.find((x) => x.id === id);
  if (d) return REGION[d.bodyRegion] ?? d.bodyRegion;
  if (/monitor/i.test(id)) return "Bedside monitor";
  if (/torso/i.test(id)) return "Torso sensor";
  if (/pelvis/i.test(id)) return "Pelvis sensor";
  return "Device";
}

function deviceEventTitle(state: State, type: string, details: string): string | null {
  const device = deviceLabel(state, details);
  if (type === "device.disconnected") return `${device} disconnected`;
  if (type === "device.delayed") return `${device} delayed`;
  if (type === "device.connected") return `${device} reconnected`;
  if (type === "device.freshness" && /STALE/.test(details)) return `${device} data went stale`;
  return null;
}

function chartTitle(c: Chart) {
  const kind = c.type.toLowerCase().replaceAll("_", " ");
  return c.status === "AMENDED" ? `Chart correction confirmed · ${kind}` : `Chart entry confirmed · ${kind}`;
}

const within = (at: string | null | undefined, w: { start: number; end: number }) => {
  const t = at ? Date.parse(at) : NaN;
  return Number.isFinite(t) && t >= w.start && t < w.end;
};

/**
 * What happened during a shift window, oldest first: confirmed chart entries, completed tasks,
 * nurse-verified turns and significant device events. Raw vital batches are left out.
 */
export function shiftTimeline(state: State, patientId: string, window: { start: number; end: number }): TimelineItem[] {
  const items: TimelineItem[] = [];
  const completed = state.tasks.filter((t) => t.patientId === patientId && t.status === "COMPLETED" && within(t.completedAt, window));
  const completedIds = new Set(completed.map((t) => t.id));
  for (const c of state.charts)
    if (
      c.patientId === patientId &&
      (c.status === "CONFIRMED" || c.status === "AMENDED") &&
      within(c.confirmedAt, window) &&
      // Task completion entries are listed once, as the completed task.
      !(c.type === "TASK_COMPLETION" && c.linkedTaskId && completedIds.has(c.linkedTaskId))
    )
      items.push({ id: `chart-${c.id}`, at: c.confirmedAt!, title: chartTitle(c), detail: brief(c.text, 140), origin: "nurse", source: staffName(c.nurseId) });
  for (const t of completed)
    items.push({ id: `task-${t.id}`, at: t.completedAt!, title: `Completed · ${t.title}`, origin: "nurse", source: staffName(t.verifiedBy ?? "nurse-demo") });
  for (const e of state.events) {
    if (e.patientId !== patientId || !within(e.timestamp, window)) continue;
    if (e.type === "task.completed" || e.type === "task.complete") {
      // Only events for tasks no longer in state (otherwise the task itself is listed above).
      const taskId = e.details.split(":")[0];
      if (state.tasks.some((t) => t.id === taskId) || completed.some((t) => Math.abs(Date.parse(t.completedAt!) - Date.parse(e.timestamp)) < 2000)) continue;
      items.push({ id: `event-${e.id}`, at: e.timestamp, title: "Task completed", detail: e.details.split(":").slice(1).join(":").trim() || undefined, origin: "nurse", source: staffName(e.source) });
    } else if (e.type.startsWith("device.")) {
      const title = deviceEventTitle(state, e.type, e.details);
      if (title) items.push({ id: `event-${e.id}`, at: e.timestamp, title, origin: "sensor", source: e.source === "SIMULATED_MONITOR" ? "Simulated monitor" : "Device status" });
    }
  }
  for (const m of state.movements)
    if (m.patientId === patientId && m.verificationStatus === "CONFIRMED_CARE" && within(m.reviewedAt ?? m.capturedAt, window))
      items.push({
        id: `move-${m.id}`,
        at: m.reviewedAt ?? m.capturedAt,
        title: "Turn verified",
        detail: `Detected by sensors at ${clock(m.capturedAt)} · confirmed by nurse`,
        origin: "verified",
        source: staffName(m.reviewerId ?? "nurse-demo"),
      });
  return items.sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.id.localeCompare(b.id));
}
