// The generated shift report: built from the tracked record (vitals, alerts, notes, tasks, sensors)
// so the outgoing nurse reviews and corrects instead of retyping.
import { useState } from "react";
import { Link } from "react-router-dom";
import { Check, FileText, Sparkles } from "lucide-react";
import { api, time } from "./api";
import type { HandoffSections } from "./handoff-types";
import { nurseSnapshot, type HandoffContext } from "./handoff-context";
import { AlertCard } from "./replay";
import { metricName } from "./Monitoring";
import "./handoff-report.css";

export interface Trend {
  metric: string;
  unit: string;
  first: number;
  firstAt: string;
  latest: number;
  latestAt: string;
  latestId: string;
  min: number;
  max: number;
  count: number;
  points: number[];
}
export interface Coverage {
  readings: number;
  from: string | null;
  to: string;
  percent: number;
  typicalSeconds?: number;
  lastReadingAt: string | null;
  gaps: { from: string; to: string; seconds: number; open: boolean }[];
}
export interface MissingItem {
  kind: "DATA" | "REVIEW" | "DOCUMENTATION" | "SNAPSHOT";
  title: string;
  detail: string | null;
  sourceType: string;
  sourceId: string;
  action: "OPEN_MONITORING" | "ACKNOWLEDGE" | "DOCUMENT" | "OPEN_PATIENT" | "OPEN_REPOSITIONING" | "OPEN_TASKS" | "FILL_SNAPSHOT";
}
export type ReportContext = HandoffContext & { trends?: Trend[]; coverage?: Coverage; missing?: MissingItem[] };

const SHORT: Record<string, string> = {
  HEART_RATE: "HR",
  SPO2: "SpO₂",
  RESPIRATORY_RATE: "RR",
  BLOOD_PRESSURE_SYSTOLIC: "SBP",
  BLOOD_PRESSURE_DIASTOLIC: "DBP",
  TEMPERATURE: "Temp",
};
const ORDER = Object.keys(SHORT);
/** Demo thresholds for calling a start-to-now change notable in the report (not clinical rules). */
const NOTABLE: Record<string, number> = { HEART_RATE: 15, SPO2: 3, RESPIRATORY_RATE: 5, BLOOD_PRESSURE_SYSTOLIC: 20, BLOOD_PRESSURE_DIASTOLIC: 15, TEMPERATURE: 0.8 };

const fmt = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));
const unitText = (u: string) => (u === "breaths/min" ? "/min" : u === "%" || u === "°C" ? u : ` ${u}`);
const val = (v: number, u: string) => `${fmt(v)}${unitText(u)}`;
const sortTrends = (t: Trend[]) => [...t].sort((a, b) => (ORDER.indexOf(a.metric) + 1 || 99) - (ORDER.indexOf(b.metric) + 1 || 99));
const notable = (t: Trend) => Math.abs(t.latest - t.first) >= (NOTABLE[t.metric] ?? Infinity);
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
const duration = (s: number) => (s >= 3600 ? `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min` : s >= 120 ? `${Math.round(s / 60)} min` : `${s} s`);

/** Snapshot fields still undocumented after counting what the nurse typed in. */
function snapshotGaps(ctx: HandoffContext, draft: HandoffSections) {
  return ctx.snapshot.filter((f) => !f.value && !nurseSnapshot(draft, f.label));
}

export interface Report {
  situation: string[];
  background: string[];
  assessment: string[];
  recommendation: string[];
  changes: string[];
  interventions: string[];
  missing: string[];
}

export function buildReport(ctx: ReportContext, draft: HandoffSections, name: string, room: string): Report {
  const a = ctx.activity;
  const trends = sortTrends(ctx.trends ?? []);
  const cov = ctx.coverage;
  const open = a.alerts.filter((x) => x.state !== "RESOLVED");
  const latest = trends.map((t) => `${SHORT[t.metric] ?? t.metric} ${val(t.latest, t.unit)}`).join(", ");
  const situation = [
    `${name}, Room ${room}. ${ctx.snapshot.find((f) => f.key === "admission")?.value ?? "Admission reason not documented"}.`,
    latest ? `Latest vitals (${time(trends[0].latestAt)}): ${latest}.` : "No vital signs recorded this shift.",
    open.length
      ? `${plural(open.length, "open monitoring alert")}: ${open.map((x) => x.title.replace(/ — review at bedside$/, "")).join("; ")}.`
      : "No open monitoring alerts.",
  ];
  const background = ctx.snapshot
    .filter((f) => f.key !== "admission")
    .map((f) => {
      const v = f.value || nurseSnapshot(draft, f.label);
      return v ? `${f.label}: ${v}` : "";
    })
    .filter(Boolean);
  const undocumented = snapshotGaps(ctx, draft);
  if (undocumented.length) background.push(`Not documented: ${undocumented.map((f) => f.label.toLowerCase()).join(", ")}.`);

  const changes = trends
    .filter(notable)
    .map((t) => `${metricName(t.metric)} ${val(t.first, t.unit)} → ${val(t.latest, t.unit)} (range ${fmt(t.min)}–${val(t.max, t.unit)}, ${t.count} readings)`);
  const assessment = [
    ...(changes.length ? changes : trends.length ? ["Vital signs without notable change from start of shift."] : []),
    ...a.alerts.map((x) => {
      const state = { FLAGGED: "not yet reviewed", ACKNOWLEDGED: "acknowledged, no follow-up note", FOLLOW_UP_DOCUMENTED: "follow-up documented", RESOLVED: "resolved" }[x.state];
      return `${x.title.replace(/ — review at bedside$/, "")} at ${time(x.detectedAt)}: ${state}.`;
    }),
    ...a.assessments.slice(0, 3).map((x) => `${x.timestamp ? time(x.timestamp) + " " : ""}${x.title}: ${x.detail ?? ""}`.trim()),
  ];
  if (cov && cov.readings > 0)
    assessment.push(
      `Monitoring covered ${cov.percent}% of the shift${cov.gaps.length ? ` with ${plural(cov.gaps.length, "gap")} (${cov.gaps.map((g) => `${time(g.from)} ${duration(g.seconds)}${g.open ? ", ongoing" : ""}`).join("; ")})` : ""}.`,
    );

  const interventions = [
    ...a.care.slice(0, 5).map((x) => `${x.timestamp ? time(x.timestamp) + " " : ""}${x.title}${x.detail && x.sourceType === "chart" ? `: ${x.detail}` : ""}`),
    ...(a.movement.lastConfirmedRepositioning ? [`Repositioning confirmed by nurse at ${time(a.movement.lastConfirmedRepositioning)}.`] : []),
  ];
  const missing = (ctx.missing ?? [])
    .filter((m) => m.kind !== "SNAPSHOT")
    .map((m) => `${m.title}${m.detail ? ` — ${m.detail.startsWith("From ") ? m.detail.replace(/From (\S+)/, (_x, t) => `from ${time(t)}`).replace(/to (\S+)$/, (_x, t) => `to ${time(t)}`) : m.detail}` : ""}`);
  const recommendation = [
    ...ctx.priorities.prompt.map((i) => `Prompt: ${i.title}${i.dueAt ? ` (due ${time(i.dueAt)})` : ""}`),
    ...ctx.priorities.upcoming.map((i) => `Upcoming: ${i.title}${i.dueAt ? ` (due ${time(i.dueAt)})` : ""}`),
    ...ctx.priorities.routine.slice(0, 4).map((i) => `Routine: ${i.title}`),
  ];
  return { situation, background, assessment, recommendation, changes, interventions, missing };
}

/** Maps the report onto the six saved handoff sections; nurse snapshot entries are preserved. */
/** True only when the record holds something to summarise (readings, alerts, notes, care, tasks). */
export function hasRecorded(ctx: ReportContext | null | undefined) {
  if (!ctx) return false;
  const a = ctx.activity;
  return (
    (ctx.trends?.length ?? 0) > 0 ||
    a.alerts.length > 0 ||
    a.assessments.length > 0 ||
    a.care.length > 0 ||
    a.medications.length > 0 ||
    ctx.priorities.prompt.length + ctx.priorities.upcoming.length + ctx.priorities.routine.length > 0
  );
}

/**
 * Maps the report onto the six saved handoff sections using recorded facts only. A section with
 * nothing recorded keeps whatever the nurse already wrote (never filler text).
 */
export function reportSections(r: Report, draft: HandoffSections): HandoffSections {
  const recorded = (l: string[]) =>
    l.filter((x) => !/^(No vital signs recorded|No open monitoring alerts|Nothing recorded|Vital signs without notable change)/.test(x));
  const join = (l: string[], keep: string) => {
    const facts = recorded(l);
    return facts.length ? facts.map((x) => `• ${x}`).join("\n") : keep;
  };
  return {
    currentConcerns: join([...r.situation.slice(1), ...r.assessment.filter((x) => /not yet reviewed|no follow-up/.test(x))], draft.currentConcerns),
    changesDuringShift: join(r.changes.length ? r.changes : r.assessment.slice(0, 3), draft.changesDuringShift),
    interventionsAndResponse: join(r.interventions, draft.interventionsAndResponse),
    outstandingFollowUp: join(r.missing, draft.outstandingFollowUp),
    nextShiftPriorities: join(r.recommendation, draft.nextShiftPriorities),
    additionalObservations: draft.additionalObservations,
  };
}

function Block({ letter, title, lines }: { letter: string; title: string; lines: string[] }) {
  return (
    <section className="hr-block">
      <h3>
        <span aria-hidden>{letter}</span>
        {title}
      </h3>
      {lines.length ? (
        <ul>
          {lines.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ul>
      ) : (
        <p className="hr-none">Nothing recorded</p>
      )}
    </section>
  );
}

export function ShiftReport({
  ctx,
  draft,
  name,
  room,
  editable,
  onUse,
}: {
  ctx: ReportContext;
  draft: HandoffSections;
  name: string;
  room: string;
  editable: boolean;
  onUse: (sections: HandoffSections) => void;
}) {
  const r = buildReport(ctx, draft, name, room);
  const filled = !!(draft.currentConcerns.trim() || draft.nextShiftPriorities.trim());
  return (
    <section className="hr-card" aria-label="Shift report">
      <header className="hr-head">
        <div>
          <h2>Shift report</h2>
          <p>From the record · {time(ctx.generatedAt)}</p>
        </div>
        {editable && (
          <button type="button" className="hr-use" onClick={() => onUse(reportSections(r, draft))}>
            <Sparkles aria-hidden size={16} />
            {filled ? "Refresh notes" : "Use as notes"}
          </button>
        )}
      </header>
      <Block letter="S" title="Situation" lines={r.situation} />
      <Block letter="B" title="Background" lines={r.background} />
      <Block letter="A" title="Assessment" lines={r.assessment} />
      <Block letter="R" title="Recommendation" lines={r.recommendation} />
    </section>
  );
}

function Spark({ points }: { points: number[] }) {
  if (points.length < 2) return <svg className="hr-spark" viewBox="0 0 100 28" aria-hidden />;
  const lo = Math.min(...points),
    hi = Math.max(...points),
    span = hi - lo || 1;
  const d = points.map((p, i) => `${((i / (points.length - 1)) * 100).toFixed(1)},${(25 - ((p - lo) / span) * 22).toFixed(1)}`).join(" ");
  return (
    <svg className="hr-spark" viewBox="0 0 100 28" preserveAspectRatio="none" aria-hidden>
      <polyline points={d} fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function ShiftVitals({ ctx }: { ctx: ReportContext }) {
  const trends = sortTrends(ctx.trends ?? []);
  const cov = ctx.coverage;
  if (!trends.length && !cov) return null;
  const from = cov?.from ? Date.parse(cov.from) : 0;
  const total = cov?.from ? Math.max(1, Date.parse(cov.to) - from) : 1;
  return (
    <section className="hr-card" aria-label="Vitals this shift">
      <header className="hr-head">
        <div>
          <h2>Vitals this shift</h2>
          <p>{cov ? `${cov.readings} readings · ${cov.percent}% monitored` : ""}</p>
        </div>
        <Link className="hr-link" to={`/monitoring/${ctx.patientId}`}>
          Trends
        </Link>
      </header>
      {cov && cov.from && (
        <div className="hr-coverage" role="img" aria-label={`Monitoring coverage ${cov.percent}%, ${plural(cov.gaps.length, "gap")}`}>
          {cov.gaps.map((g, i) => (
            <span
              key={i}
              className={g.open ? "is-open" : undefined}
              style={{ left: `${((Date.parse(g.from) - from) / total) * 100}%`, width: `${Math.max(1.5, (g.seconds * 1000 / total) * 100)}%` }}
            />
          ))}
        </div>
      )}
      <div className="hr-tiles">
        {trends.map((t) => (
          <div key={t.metric} className={`hr-tile${notable(t) ? " is-notable" : ""}`}>
            <span className="hr-tile-label">{SHORT[t.metric] ?? metricName(t.metric)}</span>
            <strong>{fmt(t.latest)}</strong>
            <small>{t.unit === "breaths/min" ? "/min" : t.unit}</small>
            <Spark points={t.points} />
            <span className="hr-tile-meta">
              {fmt(t.first)} → {fmt(t.latest)} · {fmt(t.min)}–{fmt(t.max)}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

const KIND_LABEL: Record<MissingItem["kind"], string> = {
  DATA: "Missing data",
  REVIEW: "Needs review",
  DOCUMENTATION: "Not documented",
  SNAPSHOT: "Snapshot",
};

function linkFor(m: MissingItem, pid: string) {
  return m.action === "OPEN_MONITORING"
    ? `/monitoring/${pid}`
    : m.action === "OPEN_REPOSITIONING"
      ? "/repositioning"
      : m.action === "OPEN_TASKS"
        ? `/rounds?patient=${pid}`
        : `/patients/${pid}`;
}

export function GapsCard({
  ctx,
  draft,
  onChanged,
  onFillSnapshot,
}: {
  ctx: ReportContext;
  draft: HandoffSections;
  onChanged: () => void | Promise<void>;
  onFillSnapshot?: () => void;
}) {
  const [openAlert, setOpenAlert] = useState<string | null>(null);
  const [busy, setBusy] = useState("");
  const snap = snapshotGaps(ctx, draft).length;
  const items = (ctx.missing ?? [])
    .map((m) => (m.kind === "SNAPSHOT" ? { ...m, title: `${plural(snap, "snapshot field")} not documented` } : m))
    .filter((m) => m.kind !== "SNAPSHOT" || snap > 0);
  return (
    <section className="hr-card" aria-label="Missing or unverified">
      <header className="hr-head">
        <div>
          <h2>Missing or unverified</h2>
          <p>{items.length ? plural(items.length, "item") : "Nothing missing"}</p>
        </div>
        {!items.length && <Check aria-hidden className="hr-ok" />}
      </header>
      {items.length > 0 && (
        <ul className="hr-gaps">
          {items.map((m, i) => {
            const alert = m.sourceType === "alert" ? ctx.activity.alerts.find((x) => x.id === m.sourceId) : undefined;
            return (
              <li key={`${m.kind}-${m.sourceId}-${i}`} className={`is-${m.kind.toLowerCase()}`}>
                <div className="hr-gap-row">
                  <div className="hr-gap-text">
                    <span className="hr-kind">{KIND_LABEL[m.kind]}</span>
                    <b>{m.title}</b>
                    {m.detail && <span>{m.detail.startsWith("From ") ? m.detail.replace(/From (\S+)/, (_x, t) => `From ${time(t)}`).replace(/to (\S+)$/, (_x, t) => `to ${time(t)}`) : m.detail}</span>}
                  </div>
                  {m.action === "ACKNOWLEDGE" && alert ? (
                    <button
                      type="button"
                      className="hr-fix"
                      disabled={busy === m.sourceId}
                      onClick={async () => {
                        setBusy(m.sourceId);
                        try {
                          await api(`/monitoring/alerts/${encodeURIComponent(m.sourceId)}/acknowledge`, {});
                          await onChanged();
                        } finally {
                          setBusy("");
                        }
                      }}
                    >
                      Acknowledge
                    </button>
                  ) : m.action === "DOCUMENT" && alert ? (
                    <button type="button" className="hr-fix" onClick={() => setOpenAlert(openAlert === m.sourceId ? null : m.sourceId)}>
                      <FileText aria-hidden size={15} /> Note
                    </button>
                  ) : m.action === "FILL_SNAPSHOT" ? (
                    <button
                      type="button"
                      className="hr-fix"
                      onClick={() => {
                        onFillSnapshot?.();
                        setTimeout(() => {
                          const el = document.getElementById("hc-snapshot") as HTMLDetailsElement | null;
                          if (el) {
                            el.open = true;
                            el.scrollIntoView?.({ behavior: "smooth", block: "start" });
                          }
                        }, 0);
                      }}
                    >
                      Fill in
                    </button>
                  ) : (
                    <Link className="hr-fix" to={linkFor(m, ctx.patientId)}>
                      Open
                    </Link>
                  )}
                </div>
                {openAlert === m.sourceId && alert && <AlertCard alert={alert} onChanged={onChanged} />}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export type NextStep = { label: string; hint: string; run?: () => void; href?: string; disabled?: boolean };

export function NextStepBar({ step }: { step: NextStep | null }) {
  if (!step) return null;
  return (
    <div className="hr-next" role="region" aria-label="Next step">
      <span className="hr-next-hint">{step.hint}</span>
      {step.href ? (
        <a className="hr-next-btn" href={step.href}>
          {step.label}
        </a>
      ) : (
        <button type="button" className="hr-next-btn" disabled={step.disabled} onClick={step.run}>
          {step.label}
        </button>
      )}
    </div>
  );
}
