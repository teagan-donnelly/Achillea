// Handoff tab building blocks: story rings, slider tabs with swipeable panes, summary carousel.
import { type ReactNode } from "react";
import { Sparkles } from "lucide-react";
import { time } from "./api";
import type { Handoff, HandoffSections } from "./handoff-types";
import { nurseSnapshot, type HandoffContext } from "./handoff-context";
import { buildReport, hasRecorded, reportSections, type ReportContext } from "./handoff-report";
import { staffName } from "./handoff-model";
import "./handoff-ui.css";

const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

/** Story-style avatar. ring: "new" (unread report), "check" (items to check), "done", "none". */
export function StoryAvatar({
  name,
  ring,
  size = 56,
  badge,
}: {
  name: string;
  ring: "new" | "check" | "done" | "none";
  size?: number;
  badge?: number;
}) {
  return (
    <span className={`hu-story is-${ring}`} style={{ width: size, height: size }}>
      <span className="hu-story-inner">{initials(name)}</span>
      {badge ? <span className="hu-badge">{badge}</span> : null}
    </span>
  );
}

export interface PaneDef {
  key: string;
  label: string;
  count?: number;
  content: ReactNode;
}

/** Capsule tab bar with the same sliding highlight as the bottom navigation. */
export function PatientTabs({ panes, active, onChange }: { panes: PaneDef[]; active: string; onChange: (k: string) => void }) {
  const index = Math.max(0, panes.findIndex((p) => p.key === active));
  return (
    <div className="hu-tabs-wrap">
      <div className="hu-tabs" role="tablist" aria-label="Patient handoff" style={{ ["--i" as string]: index, ["--n" as string]: panes.length }}>
        <span className="hu-tab-thumb" aria-hidden />
        {panes.map((p) => (
          <button
            key={p.key}
            type="button"
            role="tab"
            id={`hu-tab-${p.key}`}
            aria-selected={p.key === active}
            aria-controls={`hu-pane-${p.key}`}
            className={p.key === active ? "active" : undefined}
            onClick={() => onChange(p.key)}
          >
            {p.label}
            {p.count ? <span className="hu-tab-count">{p.count}</span> : null}
          </button>
        ))}
      </div>
      {panes.map((p) => (
        <section
          key={p.key}
          className={`hu-pane${p.key === active ? " is-active" : ""}`}
          role="tabpanel"
          id={`hu-pane-${p.key}`}
          aria-labelledby={`hu-tab-${p.key}`}
        >
          {p.content}
        </section>
      ))}
    </div>
  );
}

/** The report from the shift before: what the incoming nurse inherits. */
export function LastShiftCard({ handoff }: { handoff: Handoff | undefined }) {
  if (!handoff)
    return (
      <div className="hu-card hu-last is-empty">
        <h3>From last shift</h3>
        <p>No handoff from the previous shift.</p>
      </div>
    );
  const s = handoff.sections;
  const rows: [string, string][] = [
    ["Concerns", s.currentConcerns],
    ["Changes", s.changesDuringShift],
    ["Still to do", s.outstandingFollowUp || s.nextShiftPriorities],
  ];
  return (
    <div className="hu-card hu-last">
      <h3>From last shift</h3>
      <p className="hu-sub">
        {staffName(handoff.senderId)} · {handoff.shiftLabel} shift · {time(handoff.updatedAt)}
      </p>
      {rows
        .filter(([, v]) => v?.trim())
        .map(([k, v]) => (
          <div key={k} className="hu-last-row">
            <span>{k}</span>
            <p>{v.trim().split("\n").slice(0, 3).join("\n")}</p>
          </div>
        ))}
    </div>
  );
}

const SLIDES: { key: "situation" | "background" | "assessment" | "recommendation"; letter: string; title: string }[] = [
  { key: "situation", letter: "S", title: "Situation" },
  { key: "background", letter: "B", title: "Background" },
  { key: "assessment", letter: "A", title: "Assessment" },
  { key: "recommendation", letter: "R", title: "Recommendation" },
];

/** SBAR summary generated from the record, stacked top to bottom. */
export function SummaryCarousel({
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
  onUse: (s: HandoffSections) => void;
}) {
  const r = buildReport(ctx, draft, name, room);
  const filled = !!(draft.currentConcerns.trim() || draft.nextShiftPriorities.trim());
  return (
    <div className="hu-summary">
      <div className="hu-summary-head">
        <h3>
          <Sparkles aria-hidden size={16} /> Shift summary
        </h3>
        <span className="hu-sub">Updated {time(ctx.generatedAt)}</span>
      </div>
      <div className="hu-sbar">
        {SLIDES.map((s) => (
          <article key={s.key} className="hu-slide" aria-label={s.title}>
            <header>
              <span className="hu-letter">{s.letter}</span>
              {s.title}
            </header>
            {r[s.key].length ? (
              <ul>
                {r[s.key].map((l, i) => (
                  <li key={i}>{l}</li>
                ))}
              </ul>
            ) : (
              <p className="hu-sub">Nothing recorded</p>
            )}
          </article>
        ))}
      </div>
      {editable && hasRecorded(ctx) && (
        <button type="button" className="hu-primary" onClick={() => onUse(reportSections(r, draft))}>
          {filled ? "Refresh notes from summary" : "Use summary as notes"}
        </button>
      )}
    </div>
  );
}

/** Patient snapshot as quick fields: record values shown, missing ones typed in place. */
export function SnapshotEditor({
  ctx,
  draft,
  editable,
  onChange,
}: {
  ctx: HandoffContext;
  draft: HandoffSections;
  editable: boolean;
  onChange: (label: string, value: string) => void;
}) {
  const missing = ctx.snapshot.filter((f) => !f.value && !nurseSnapshot(draft, f.label)).length;
  return (
    <details className="hu-card hu-snapshot" id="hc-snapshot">
      <summary>
        <h3>Patient snapshot</h3>
        <span className={missing ? "hu-missing" : "hu-sub"}>{missing ? `${missing} not documented` : "Complete"}</span>
      </summary>
      <dl className="hu-fields">
        {ctx.snapshot.map((f) => {
          const nurse = nurseSnapshot(draft, f.label);
          return (
            <div key={f.key} className={!f.value && !nurse ? "is-missing" : undefined}>
              <dt>{f.label}</dt>
              <dd>
                {f.value ? (
                  f.value
                ) : editable ? (
                  <input
                    aria-label={f.label}
                    placeholder="Not documented"
                    defaultValue={nurse}
                    maxLength={200}
                    onBlur={(e) => {
                      if (e.target.value.trim() !== nurse) onChange(f.label, e.target.value.trim());
                    }}
                  />
                ) : (
                  nurse || <span className="hu-missing">Not documented</span>
                )}
              </dd>
            </div>
          );
        })}
      </dl>
    </details>
  );
}

/** Ring and badge for a patient from their handoff context. */
export function ringFor(ctx: ReportContext | undefined, hasIncoming: boolean, done: boolean) {
  const toCheck = ctx?.missing?.filter((m) => m.kind !== "SNAPSHOT").length ?? 0;
  const ring: "new" | "check" | "done" | "none" = hasIncoming ? "new" : toCheck ? "check" : done ? "done" : "none";
  return { ring, toCheck };
}
