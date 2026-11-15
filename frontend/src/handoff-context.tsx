// Structured, source-linked handoff: Patient Snapshot, Shift Activity, Next Shift Priorities.
// Everything here is assembled by the backend (GET /patients/{id}/handoff-context) from the same
// records Monitoring, Rounds and Tasks use; nurse-entered text stays in the handoff sections.
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { api, time } from "./api";
import type { HandoffSections } from "./handoff-types";
import { AlertCard, recordedTime, type EvidenceReading, type MonitoringAlert, type ReplayStatus } from "./replay";
import { metricName } from "./Monitoring";
import "./replay.css";

interface Field {
  key: string;
  label: string;
  value: string | null;
  source: string | null;
}
interface Item {
  id: string;
  title: string;
  detail: string | null;
  sourceType: "alert" | "task" | "chart" | "movement";
  sourceId: string;
  timestamp: string | null;
  status: string | null;
  responsible: string | null;
  dueAt: string | null;
  kind?: "DOCUMENTATION_GAP" | "MONITORING_ALERT" | "TASK" | "UNVERIFIED_MOVEMENT";
}
export interface HandoffContext {
  patientId: string;
  generatedAt: string;
  snapshot: Field[];
  activity: {
    latestVitals: (EvidenceReading & { quality: string })[];
    monitor: { connectionState: string; freshness: string; mode: string } | null;
    replay: ReplayStatus;
    alerts: MonitoringAlert[];
    assessments: Item[];
    care: Item[];
    medications: Item[];
    movement: {
      lastSensorMovement: Item | null;
      lastConfirmedRepositioning: string | null;
      openRepositioningTasks: number;
      sensors: { id: string; region: string; connectionState: string; freshness: string }[];
    };
    timeline: Item[];
  };
  priorities: { prompt: Item[]; upcoming: Item[]; routine: Item[] };
  counts: { requiresReview: number; outstandingTasks: number; unverified: number; documentationGaps: number };
}

/** Configurable handoff completion template (demo). */
export const HANDOFF_TEMPLATE: { key: string; label: string; test: (c: HandoffContext, d: HandoffSections) => boolean }[] = [
  { key: "alerts", label: "Monitoring alerts reviewed", test: (c) => c.activity.alerts.every((a) => a.state !== "FLAGGED") },
  { key: "code", label: "Code status documented", test: (c, d) => !!snapshotValue(c, d, "codeStatus") },
  { key: "allergies", label: "Allergies documented", test: (c, d) => !!snapshotValue(c, d, "allergies") },
  { key: "situation", label: "Current concerns written", test: (_c, d) => !!d.currentConcerns.trim() },
  { key: "priorities", label: "Next-shift priorities written", test: (_c, d) => !!d.nextShiftPriorities.trim() },
];

const SNAPSHOT_RE = (label: string) => new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}: (.*)$`, "m");

/** Nurse-entered snapshot values live as "Label: value" lines in the additional-observations section. */
export function nurseSnapshot(d: HandoffSections, label: string) {
  return d.additionalObservations.match(SNAPSHOT_RE(label))?.[1]?.trim() || "";
}
export function setNurseSnapshot(d: HandoffSections, label: string, value: string): HandoffSections {
  const re = SNAPSHOT_RE(label);
  const line = `${label}: ${value}`;
  let text = d.additionalObservations;
  if (!value.trim()) text = text.replace(new RegExp(re.source + "\\n?", "m"), "");
  else if (re.test(text)) text = text.replace(re, line);
  else text = text ? `${text.replace(/\s+$/, "")}\n${line}` : line;
  return { ...d, additionalObservations: text };
}
function snapshotValue(c: HandoffContext, d: HandoffSections, key: string) {
  const f = c.snapshot.find((x) => x.key === key);
  return f ? f.value || nurseSnapshot(d, f.label) : "";
}

export function sourceHref(patientId: string, item: Pick<Item, "sourceType">) {
  if (item.sourceType === "alert") return `/monitoring/${patientId}`;
  if (item.sourceType === "movement") return `/repositioning`;
  return `/patients/${patientId}`;
}

const words = (v: string | null | undefined) => (v ? v.toLowerCase().replaceAll("_", " ") : "");

export function useHandoffContext(patientId: string | undefined, tick: unknown) {
  const [ctx, setCtx] = useState<HandoffContext | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    if (!patientId) return;
    try {
      const next = await api<HandoffContext>(`/patients/${encodeURIComponent(patientId)}/handoff-context`);
      if (!next || !Array.isArray(next.snapshot) || !next.activity || !next.priorities) throw new Error("Handoff context needs the updated backend");
      setCtx(next);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unavailable");
    }
  }, [patientId]);
  useEffect(() => {
    void load();
  }, [load, tick]);
  return { ctx, error, reload: load };
}

function Sec({ id, title, count, open = true, children }: { id?: string; title: string; count?: ReactNode; open?: boolean; children: ReactNode }) {
  return (
    <details id={id} className="hc-sec" open={open}>
      <summary>
        {title}
        {count !== undefined && <small>{count}</small>}
      </summary>
      {children}
    </details>
  );
}

function Sub({ title, count, open = false, children }: { title: string; count?: number; open?: boolean; children: ReactNode }) {
  return (
    <details className="hc-sub" open={open}>
      <summary>
        {title}
        {count !== undefined && <small>{count}</small>}
      </summary>
      {children}
    </details>
  );
}

function ItemRow({ item, patientId }: { item: Item; patientId: string }) {
  const cls = item.kind === "DOCUMENTATION_GAP" ? " is-gap" : item.kind === "MONITORING_ALERT" ? " is-alert" : "";
  return (
    <li className={`hc-item${cls}`}>
      <b>{item.title}</b>
      {item.detail && <p>{item.detail}</p>}
      <span className="rp-meta">
        <span>Source: {words(item.sourceType)}</span>
        {item.timestamp && <span>{time(item.timestamp)}</span>}
        {item.status && <span>Status: {words(item.status)}</span>}
        {item.responsible && <span>Nurse: {item.responsible === "nurse-demo" ? "Demo nurse" : item.responsible}</span>}
        {item.dueAt && <span>Due {time(item.dueAt)}</span>}
        <Link to={sourceHref(patientId, item)}>Open source</Link>
      </span>
    </li>
  );
}

function Items({ items, patientId, empty }: { items: Item[]; patientId: string; empty: string }) {
  if (!items.length) return <p className="hc-empty">{empty}</p>;
  return (
    <ul className="hc-list">
      {items.map((i) => (
        <ItemRow key={i.id} item={i} patientId={patientId} />
      ))}
    </ul>
  );
}

const VITAL_ORDER = ["HEART_RATE", "SPO2", "RESPIRATORY_RATE", "BLOOD_PRESSURE_SYSTOLIC", "BLOOD_PRESSURE_DIASTOLIC", "TEMPERATURE"];

export function priorityText(c: HandoffContext) {
  const lines: string[] = [];
  const add = (label: string, items: Item[]) =>
    items.forEach((i) => lines.push(`[${label}] ${i.title}${i.dueAt ? ` (due ${time(i.dueAt)})` : ""}`));
  add("Prompt review", c.priorities.prompt);
  add("Upcoming", c.priorities.upcoming);
  add("Routine", c.priorities.routine);
  return lines.join("\n");
}

export function activityText(c: HandoffContext) {
  return c.activity.timeline
    .slice(0, 6)
    .map((t) => `${t.timestamp ? time(t.timestamp) + " " : ""}${t.title}`)
    .join("\n");
}

export function HandoffStructured({
  ctx,
  draft,
  setDraft,
  editable,
  onChanged,
}: {
  ctx: HandoffContext;
  draft: HandoffSections;
  setDraft: (d: HandoffSections) => void;
  editable: boolean;
  onChanged: () => void | Promise<void>;
}) {
  const pid = ctx.patientId;
  const a = ctx.activity;
  const vitals = [...a.latestVitals].sort((x, y) => (VITAL_ORDER.indexOf(x.metric) + 1 || 99) - (VITAL_ORDER.indexOf(y.metric) + 1 || 99));
  const missing = ctx.snapshot.filter((f) => !f.value && !nurseSnapshot(draft, f.label)).length;
  const checks = HANDOFF_TEMPLATE.map((t) => ({ ...t, done: t.test(ctx, draft) }));
  const ready = checks.every((c) => c.done);
  const replayKind = a.monitor?.mode;
  const replaySource =
    replayKind === "SYNTHETIC_FIXTURE" ? "Synthetic fixture replay" : replayKind?.startsWith("RECORDED") ? "Recorded data replay (MIMIC-IV demo)" : "Simulated monitor";
  return (
    <div className="hc">
      <div className="hc-summary" aria-label="Handoff summary">
        <div className={`hc-stat${ctx.counts.requiresReview ? " is-warn" : ""}`}>
          <strong>{ctx.counts.requiresReview}</strong>
          <span>Items requiring review</span>
        </div>
        <div className="hc-stat">
          <strong>{ctx.counts.outstandingTasks}</strong>
          <span>Outstanding tasks</span>
        </div>
        <div className={`hc-stat${ctx.counts.unverified ? " is-warn" : ""}`}>
          <strong>{ctx.counts.unverified}</strong>
          <span>Unverified items</span>
        </div>
        <div className={`hc-stat${ctx.counts.documentationGaps ? " is-warn" : ""}`}>
          <strong>{ctx.counts.documentationGaps}</strong>
          <span>Documentation gaps</span>
        </div>
        <p className={`hc-ready${ready ? " is-ready" : ""}`} role="status">
          {ready
            ? "Ready for verification"
            : `${checks.filter((c) => !c.done).length} checklist items open`}
        </p>
      </div>

      {/* ---------- 1 Patient snapshot ---------- */}
      <Sec id="hc-snapshot" title="1 · Patient snapshot" count={missing ? `${missing} not documented` : "Complete"} open={false}>
        <dl className="hc-fields">
          {ctx.snapshot.map((f) => {
            const nurse = nurseSnapshot(draft, f.label);
            return (
              <div className="hc-field" key={f.key}>
                <dt>{f.label}</dt>
                <dd>
                  {f.value ? (
                    <>
                      {f.value}
                      <span className="hc-tag">Auto · {f.source}</span>
                    </>
                  ) : editable ? (
                    <input
                      className="hc-input"
                      aria-label={f.label}
                      placeholder="Not documented"
                      defaultValue={nurse}
                      maxLength={200}
                      onBlur={(e) => {
                        if (e.target.value.trim() !== nurse) setDraft(setNurseSnapshot(draft, f.label, e.target.value.trim()));
                      }}
                    />
                  ) : nurse ? (
                    <>
                      {nurse}
                      <span className="hc-tag is-nurse">Nurse-entered</span>
                    </>
                  ) : (
                    <span className="hc-missing">Not documented</span>
                  )}
                </dd>
              </div>
            );
          })}
        </dl>
      </Sec>

      {/* ---------- 2 Shift activity ---------- */}
      <Sec title="2 · Shift activity" count={`${a.timeline.length} events`}>
        <Sub title="Vital signs and trends" count={a.alerts.length} open>
          <p className="rp-meta">
            {replaySource} · monitor {words(a.monitor?.connectionState)} · {words(a.monitor?.freshness)}
          </p>
          {vitals.length ? (
            <div className="hc-vitals">
              {vitals.map((v) => (
                <div className="hc-vital" key={v.metric} title={v.source}>
                  <span>{metricName(v.metric)}</span>
                  <strong>{v.value}</strong> <small>{v.unit}</small>
                  <span>
                    {time(v.observedAt)}
                    {v.recordedMinute !== null ? ` · ${recordedTime(v.recordedMinute)}` : ""}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="hc-empty">No vital signs recorded.</p>
          )}
          {a.alerts.map((al) => (
            <AlertCard key={al.id} alert={al} onChanged={onChanged} />
          ))}
          <Link className="rp-meta" to={`/monitoring/${pid}`}>
            Open full recording and trends
          </Link>
        </Sub>
        <Sub title="Assessments" count={a.assessments.length}>
          <Items items={a.assessments} patientId={pid} empty="No assessments documented this shift." />
        </Sub>
        <Sub title="Care completed" count={a.care.length}>
          <Items items={a.care} patientId={pid} empty="No completed care documented this shift." />
        </Sub>
        <Sub title="Medications and treatments" count={a.medications.length}>
          <Items items={a.medications} patientId={pid} empty="No medication or treatment entries documented." />
        </Sub>
        <Sub title="Movement and positioning">
          <ul className="hc-list">
            <li className="hc-item">
              <b>Last nurse-confirmed repositioning</b>
              <p>{a.movement.lastConfirmedRepositioning ? time(a.movement.lastConfirmedRepositioning) : "Not documented"}</p>
            </li>
            {a.movement.lastSensorMovement && <ItemRow item={a.movement.lastSensorMovement} patientId={pid} />}
            <li className="hc-item">
              <b>Open repositioning tasks: {a.movement.openRepositioningTasks}</b>
              <p>
                Sensors:{" "}
                {a.movement.sensors.length
                  ? a.movement.sensors.map((s) => `${words(s.region)} ${words(s.connectionState)}`).join(", ")
                  : "none"}
              </p>
            </li>
          </ul>
        </Sub>
        <Sub title="Timeline" count={a.timeline.length} open>
          <Items items={a.timeline} patientId={pid} empty="No significant events this shift." />
        </Sub>
      </Sec>

      {/* ---------- 3 Next shift priorities ---------- */}
      <Sec
        title="3 · Next shift priorities"
       
        count={`${ctx.priorities.prompt.length + ctx.priorities.upcoming.length + ctx.priorities.routine.length} items`}
      >
        <h3 className="hc-group">Requires prompt review</h3>
        <Items items={ctx.priorities.prompt} patientId={pid} empty="Nothing flagged for prompt review." />
        <h3 className="hc-group">Upcoming</h3>
        <Items items={ctx.priorities.upcoming} patientId={pid} empty="Nothing upcoming." />
        <h3 className="hc-group">Routine</h3>
        <Items items={ctx.priorities.routine} patientId={pid} empty="No routine items." />
      </Sec>

      <div className="hc-card">
        <h3 className="hc-group">Handoff checklist</h3>
        <ul className="hc-check">
          {checks.map((c) => (
            <li key={c.key} className={c.done ? "is-done" : undefined}>
              {c.label}
            </li>
          ))}
        </ul>
        {editable && (
          <div className="rp-actions hc-fill">
            <button
              type="button"
              className="rp-action"
              onClick={() => setDraft({ ...draft, nextShiftPriorities: priorityText(ctx) || "No outstanding items in the record." })}
            >
              Fill priorities from record
            </button>
            <button
              type="button"
              className="rp-action"
              onClick={() => setDraft({ ...draft, changesDuringShift: activityText(ctx) || "No significant events recorded." })}
            >
              Fill shift changes from record
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

