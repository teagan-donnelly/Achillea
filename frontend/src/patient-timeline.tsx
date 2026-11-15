// Timeline tab: the whole stay as one chronological feed, grouped by day. Nurse documentation,
// completed tasks, nurse movement reviews and confirmed repositioning sit beside significant
// sensor/system events. High-volume monitoring receipts are left out (they live in Trends).
import { useEffect, useMemo, useState } from "react";
import type { Event, Patient, State } from "./types";
import { api, words } from "./api";
import { mergeEvidence } from "./workspace-feed";
import { EmptyState } from "./ui";
import { chartTime, clock, dayLabel, deviceName, entryTypeName, humaniseIds, isReceiptEvent, staffName } from "./patient-data";

type Origin = "nurse" | "sensor" | "system";
interface Item {
  id: string;
  at: string;
  title: string;
  detail?: string;
  origin: Origin;
  source: string;
  attention?: boolean;
  /** Simultaneous events with the same key collapse into one line ("3 sensors went offline"). */
  group?: { key: string; plural: (n: number) => string; part: string };
}

/** Event types that duplicate an entity already shown from its own record. */
const COVERED = /^(chart\.|movement\.reviewed|task\.completed?$|repositioning\.confirmed|demo\.)/;
const EVENT_LIMIT = 500;
const PAGE = 25;

const UUID = /^([0-9a-f]{8}-[0-9a-f-]{27,}):\s*/i;
const ISO = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?Z?/g;
const cap = (s: string) => s.replace(/^./, (c) => c.toUpperCase());

/** Plain-language title (and optional grouping) for a backend event. */
function describeEvent(e: Event, state: State): Pick<Item, "title" | "detail" | "group"> {
  const id = UUID.exec(e.details)?.[1];
  const rest = e.details.replace(UUID, "");
  const deviceId = /^([a-z]+-[a-z0-9-]+):/i.exec(rest)?.[1] ?? "";
  const device = deviceName(deviceId || e.source);
  const deviceGroup = (key: string, verb: string) => ({
    key,
    plural: (n: number) => `${n} devices ${verb}`,
    part: device,
  });
  const taskTitle = humaniseIds(
    (id && state.tasks.find((t) => t.id === id)?.title) ||
      rest
        .replace(/\s+-\s+[A-Z_]+ by scheduled time.*$/, "")
        .replace(/\s+due\s+\S+$/, "")
        .replace(/;\s*no clinical urgency inferred\.?$/i, ""),
  );
  const taskGroup = (key: string, verb: string) => ({
    key,
    plural: (n: number) => `${n} tasks ${verb}`,
    part: taskTitle,
  });
  switch (e.type) {
    case "device.disconnected":
      return { title: `${device} went offline`, group: deviceGroup("off", "went offline") };
    case "device.connected":
      return { title: `${device} back online`, group: deviceGroup("on", "back online") };
    case "device.delayed":
      return { title: `${device} delayed`, group: deviceGroup("delay", "delayed") };
    case "device.freshness":
      return /STALE|UNKNOWN/.test(rest)
        ? { title: `${device} stopped reporting`, group: deviceGroup("stale", "stopped reporting") }
        : { title: `${device} reporting again`, group: deviceGroup("fresh", "reporting again") };
    case "task.created":
      return { title: `${taskTitle} added`, group: taskGroup("added", "added") };
    case "task.updated":
      return { title: `${taskTitle} updated`, group: taskGroup("updated", "updated") };
    case "task.schedule.overdue":
      return { title: `${taskTitle} overdue`, group: taskGroup("overdue", "overdue") };
    case "movement.detected":
    case "movement.candidate":
      return { title: "Movement detected" };
    case "patient.assigned":
      return { title: "Assigned to you" };
    default:
      return {
        title: cap(words(e.type.replaceAll(".", " "))),
        detail: humaniseIds(rest.replace(ISO, (iso) => clock(iso))) || undefined,
      };
  }
}

export function buildTimeline(state: State, patientId: string, events: Event[]): Item[] {
  const items: Item[] = [];
  const charts = state.charts.filter((c) => c.patientId === patientId);
  for (const c of charts) {
    if (c.status === "DRAFT") continue;
    items.push({
      id: `chart-${c.id}`,
      at: chartTime(c),
      title: c.amendmentOfId
        ? `Amendment · ${entryTypeName(c.type)}`
        : c.type === "TASK_COMPLETION"
          ? "Task completed"
          : entryTypeName(c.type),
      detail: c.text,
      origin: "nurse",
      source: staffName(c.nurseId),
    });
  }
  for (const t of state.tasks)
    if (
      t.patientId === patientId &&
      t.status === "COMPLETED" &&
      t.completedAt &&
      !charts.some((c) => c.linkedTaskId === t.id && c.status !== "DRAFT")
    )
      items.push({
        id: `task-${t.id}`,
        at: t.completedAt,
        title: `Task completed · ${t.title}`,
        origin: "nurse",
        source: staffName(t.verifiedBy),
      });
  for (const m of state.movements) {
    if (m.patientId !== patientId) continue;
    items.push({
      id: `move-${m.id}`,
      at: m.capturedAt,
      title: m.classification === "COORDINATED_TURN_CANDIDATE" ? "Possible turn detected" : "Movement detected",
      detail: `Chest ${m.chestBefore}° → ${m.chestAfter}°, pelvis ${m.pelvisBefore}° → ${m.pelvisAfter}°`,
      origin: "sensor",
      source: "",
      attention: m.quality !== "SIMULATED_GOOD",
    });
    if (m.reviewedAt && m.verificationStatus !== "UNREVIEWED")
      items.push({
        id: `review-${m.id}`,
        at: m.reviewedAt,
        title:
          m.verificationStatus === "CONFIRMED_CARE"
            ? "Movement reviewed · care confirmed"
            : m.verificationStatus === "NOT_CARE"
              ? "Movement reviewed · not care"
              : `Movement reviewed · ${words(m.verificationStatus)}`,
        origin: "nurse",
        source: staffName(m.reviewerId),
      });
  }
  const plan = state.repositioningPlans?.find((r) => r.patientId === patientId);
  if (plan?.lastConfirmedCareAt && !charts.some((c) => c.id === plan.confirmedChartId))
    items.push({
      id: `repo-${plan.lastConfirmedCareAt}`,
      at: plan.lastConfirmedCareAt,
      title: "Repositioning confirmed",
      origin: "nurse",
      source: "Nurse confirmation (author unavailable)",
    });
  for (const e of events) {
    if (e.patientId !== patientId || isReceiptEvent(e) || COVERED.test(e.type) || e.type === "task.schedule.due")
      continue;
    const nurse = e.type.startsWith("handoff.");
    const sensor = e.source.includes("MONITOR") || e.type.startsWith("device.") || e.type.startsWith("movement.");
    items.push({
      id: `event-${e.id}`,
      at: e.timestamp,
      ...describeEvent(e, state),
      origin: nurse ? "nurse" : sensor ? "sensor" : "system",
      source: nurse ? staffName(e.source) : e.source,
      attention: /disconnected|overdue|delayed|stale/i.test(`${e.type} ${e.details}`),
    });
  }
  // Repeated identical notices within the same minute (e.g. one overdue notice per task copy) show once.
  const seen = new Set<string>();
  return items
    .filter((i) => Number.isFinite(Date.parse(i.at)))
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || a.id.localeCompare(b.id))
    .filter((i) => {
      if (i.origin === "nurse") return true;
      const key = `${i.title}|${i.detail}|${i.at.slice(0, 16)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .reduce<Item[]>((out, i) => {
      const last = out.at(-1);
      if (last?.group && i.group && last.group.key === i.group.key && last.at.slice(0, 16) === i.at.slice(0, 16)) {
        const parts = [...new Set([...(last.detail ? last.detail.split(", ") : [last.group.part]), i.group.part])];
        out[out.length - 1] = { ...last, title: parts.length > 1 ? last.group.plural(parts.length) : last.title, detail: parts.length > 1 ? parts.join(", ") : undefined };
      } else out.push(i);
      return out;
    }, []);
}

const ORIGIN_LABEL: Record<Origin, string> = { nurse: "Nurse", sensor: "Sensor", system: "System" };

export function PatientTimelineFeed({ state, patient, now }: { state: State; patient: Patient; now: number }) {
  const [history, setHistory] = useState<{ patientId: string; events: Event[]; cursor: Event | null; hasOlder: boolean }>({ patientId: patient.id, events: [], cursor: null, hasOlder: false });
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);
  const [shown, setShown] = useState(PAGE);
  const revision = (state.serverTime ?? "").slice(0, 16);
  useEffect(() => {
    let active = true;
    api<Event[]>(`/events?patientId=${encodeURIComponent(patient.id)}&limit=${EVENT_LIMIT}`)
      .then((r) => {
        if (!active) return;
        if (Array.isArray(r)) setHistory((previous) => {
          const initial = previous.patientId !== patient.id || previous.cursor === null;
          return {
            patientId: patient.id,
            events: mergeEvidence(previous.patientId === patient.id ? previous.events : [], r),
            cursor: initial ? r.at(-1) ?? null : previous.cursor,
            hasOlder: initial ? r.length >= EVENT_LIMIT : previous.hasOlder,
          };
        });
        setError(!Array.isArray(r));
      })
      .catch(() => active && setError(true));
    return () => {
      active = false;
    };
  }, [patient.id, revision]);

  const showEarlier = async () => {
    if (items.length > shown) {
      setShown((n) => n + PAGE);
      return;
    }
    if (history.patientId !== patient.id || !history.cursor || !history.hasOlder || loading) return;
    setLoading(true);
    const cursor = history.cursor;
    try {
      const page = await api<Event[]>(`/events?patientId=${encodeURIComponent(patient.id)}&limit=${EVENT_LIMIT}&before=${encodeURIComponent(cursor.timestamp)}&beforeId=${encodeURIComponent(cursor.id)}`);
      if (!Array.isArray(page)) throw new Error("Invalid history response");
      setHistory((previous) => previous.patientId !== patient.id ? previous : ({
        patientId: patient.id,
        events: mergeEvidence(previous.events, page),
        cursor: page.at(-1) ?? previous.cursor,
        hasOlder: page.length >= EVENT_LIMIT,
      }));
      setError(false);
      setShown((n) => n + PAGE);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  const events = useMemo(() => mergeEvidence(state.events, history.patientId === patient.id ? history.events : []), [state.events, history, patient.id]);
  const items = useMemo(() => buildTimeline(state, patient.id, events), [state, patient.id, events]);
  const visible = items.slice(0, shown);
  const groups: { day: string; items: Item[] }[] = [];
  for (const item of visible) {
    const day = dayLabel(item.at, now);
    const last = groups.at(-1);
    if (last?.day === day) last.items.push(item);
    else groups.push({ day, items: [item] });
  }

  return (
    <section className="pt-timeline" aria-label="Patient timeline">
      {!items.length ? (
<EmptyState title="Nothing recorded yet" />
      ) : (
        groups.map((g) => (
          <div key={g.day} className="pt-day">
            <h3 className="pt-day-label">{g.day}</h3>
            <ol className="pt-feed">
              {g.items.map((i) => (
                <li key={i.id} className={`pt-event origin-${i.origin}${i.attention ? " is-attention" : ""}`}>
                  <time dateTime={i.at}>{clock(i.at)}</time>
                  <span className="pt-event-dot" aria-hidden />
                  <div className="pt-event-body">
                    <strong>{i.title}</strong>
                    {i.detail && <p>{i.detail}</p>}
                    <small className={`pt-origin origin-${i.origin}`}>
                      {i.origin === "nurse" ? i.source || "Nurse" : `${ORIGIN_LABEL[i.origin]}${i.source ? ` · ${i.source}` : ""}`}
                    </small>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        ))
      )}
      {(items.length > shown || (history.patientId === patient.id && history.hasOlder)) && (
        <button type="button" className="pt-more" disabled={loading} onClick={() => void showEarlier()}>
          {loading ? "Loading earlier records…" : "Show earlier"}
        </button>
      )}
      {error && (
        <p className="pt-coverage" role="status">Some history could not be loaded. Available records are still shown.</p>
      )}
    </section>
  );
}
