// Records tab: clinical documentation in chronological order, with authorship, provenance and
// amendment chains. Entries are never overwritten: corrections are appended as amendments.
import { useCallback, useState } from "react";
import type { Chart, State } from "./types";
import { metricName } from "./Monitoring";
import { BottomSheet, EmptyState, Pill } from "./ui";
import { chartTime, clock, dayLabel, entryTypeName, staffName, stamp } from "./patient-data";

const STATUS: Record<string, { label: string; tone: "green" | "amber" | "neutral" }> = {
  CONFIRMED: { label: "Confirmed", tone: "green" },
  AMENDED: { label: "Amended", tone: "neutral" },
  DRAFT: { label: "Draft", tone: "amber" },
};

/** Original entry first, then each amendment in order. */
function chain(charts: Chart[], c: Chart) {
  let root = c;
  const byId = new Map(charts.map((x) => [x.id, x]));
  while (root.amendmentOfId && byId.has(root.amendmentOfId)) root = byId.get(root.amendmentOfId)!;
  const out = [root];
  for (let next = charts.find((x) => x.amendmentOfId === root.id); next; next = charts.find((x) => x.amendmentOfId === next!.id))
    out.push(next);
  return out;
}

export function PatientRecords({
  state,
  patientId,
  now,
  onEdit,
}: {
  state: State;
  patientId: string;
  now: number;
  /** Edit a draft, or start an appended amendment of a confirmed entry. */
  onEdit: (c: Chart) => void;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const close = useCallback(() => setOpenId(null), []);
  const charts = state.charts.filter((c) => c.patientId === patientId);
  const drafts = charts.filter((c) => c.status === "DRAFT");
  const entries = charts
    .filter((c) => c.status !== "DRAFT")
    .sort((a, b) => Date.parse(chartTime(b)) - Date.parse(chartTime(a)));
  const open = charts.find((c) => c.id === openId);
  const groups: { day: string; items: Chart[] }[] = [];
  for (const c of entries) {
    const day = dayLabel(chartTime(c), now);
    const last = groups.at(-1);
    if (last?.day === day) last.items.push(c);
    else groups.push({ day, items: [c] });
  }

  const card = (c: Chart) => {
    const amends = c.amendmentOfId ? charts.find((x) => x.id === c.amendmentOfId) : undefined;
    const amendedBy = charts.find((x) => x.amendmentOfId === c.id);
    const status = STATUS[c.status] ?? { label: c.status, tone: "neutral" as const };
    return (
      <li key={c.id} className={`pt-record${c.status === "AMENDED" ? " is-superseded" : ""}`}>
        <button
          type="button"
          className="pt-record-open"
          aria-label={`Open ${entryTypeName(c.type)} from ${stamp(chartTime(c), now)}`}
          onClick={() => setOpenId(c.id)}
        />
        <div className="pt-record-head">
          <strong>{c.amendmentOfId ? `Amendment · ${entryTypeName(c.type)}` : entryTypeName(c.type)}</strong>
          <time dateTime={chartTime(c)}>{clock(chartTime(c))}</time>
        </div>
        <p className="pt-record-text">{c.text}</p>
        <div className="pt-record-foot">
          <Pill tone={status.tone}>{status.label}</Pill>
          <span>{staffName(c.nurseId)}</span>
          {amends && <span>Amends {stamp(chartTime(amends), now)} entry</span>}
          {amendedBy && <span>Amended {stamp(chartTime(amendedBy), now)}</span>}
          <button type="button" className="pt-record-action" onClick={() => onEdit(c)}>
            {c.status === "DRAFT" ? "Edit draft" : "Append amendment"}
          </button>
        </div>
      </li>
    );
  };

  return (
    <section className="pt-records" aria-label="Clinical records">
      {drafts.length > 0 && (
        <div className="pt-day">
          <h3 className="pt-day-label">Drafts to confirm</h3>
          <ul className="pt-record-list">{drafts.map(card)}</ul>
        </div>
      )}
      {entries.length === 0 && drafts.length === 0 && (
        <EmptyState title="No records yet" />
      )}
      {groups.map((g) => (
        <div key={g.day} className="pt-day">
          <h3 className="pt-day-label">{g.day}</h3>
          <ul className="pt-record-list">{g.items.map(card)}</ul>
        </div>
      ))}

      <BottomSheet
        open={!!open}
        onClose={close}
        title={open ? entryTypeName(open.type) : ""}
        footer={
          open && (
            <button
              type="button"
              className="ach-button"
              onClick={() => {
                setOpenId(null);
                onEdit(open);
              }}
            >
              {open.status === "DRAFT" ? "Edit this draft" : "Append an amendment"}
            </button>
          )
        }
      >
        {open && <RecordDetail chart={open} charts={charts} state={state} now={now} />}
      </BottomSheet>
    </section>
  );
}

function RecordDetail({ chart: c, charts, state, now }: { chart: Chart; charts: Chart[]; state: State; now: number }) {
  const history = chain(charts, c);
  const task = c.linkedTaskId ? state.tasks.find((t) => t.id === c.linkedTaskId) : undefined;
  return (
    <div className="pt-record-detail">
      <p className="pt-record-full">{c.text}</p>
      <dl className="pt-facts">
        <div>
          <dt>Status</dt>
          <dd>{STATUS[c.status]?.label ?? c.status}</dd>
        </div>
        <div>
          <dt>Author</dt>
          <dd>{staffName(c.nurseId)}</dd>
        </div>
        <div>
          <dt>Authored</dt>
          <dd>{stamp(c.authoredAt, now)}</dd>
        </div>
        {c.confirmedAt && (
          <div>
            <dt>Confirmed</dt>
            <dd>{stamp(c.confirmedAt, now)}</dd>
          </div>
        )}
        <div className="is-wide">
          <dt>Provenance</dt>
          <dd>{c.provenance}</dd>
        </div>
        {c.linkedTaskId && (
          <div className="is-wide">
            <dt>Linked task</dt>
            <dd>{task?.title ?? c.linkedTaskId}</dd>
          </div>
        )}
        {c.linkedMovementId && (
          <div className="is-wide">
            <dt>Linked sensor movement</dt>
            <dd className="pt-mono">{c.linkedMovementId}</dd>
          </div>
        )}
      </dl>
      {c.linkedVitalIds.length > 0 && (
        <>
          <h3 className="pt-sub-title">Linked readings</h3>
          <ul className="pt-provenance">
            {c.linkedVitalIds.map((id) => {
              const v = state.vitals.find((x) => x.id === id);
              return (
                <li key={id}>
                  {v
                    ? `${metricName(v.metric)} ${v.value} ${v.unit} · observed ${clock(v.observedAt)} · ${v.source}`
                    : `Reading ${id} (not loaded in this session)`}
                </li>
              );
            })}
          </ul>
        </>
      )}
      {history.length > 1 && (
        <>
          <h3 className="pt-sub-title">Amendment history</h3>
          <ol className="pt-chain">
            {history.map((h, i) => (
              <li key={h.id} className={h.id === c.id ? "is-current" : undefined}>
                <strong>{i === 0 ? "Original entry" : `Amendment ${i}`}</strong>
                <small>
                  {staffName(h.nurseId)} · {stamp(chartTime(h), now)} · {STATUS[h.status]?.label ?? h.status}
                </small>
                {h.id !== c.id && <p>{h.text}</p>}
              </li>
            ))}
          </ol>
        </>
      )}
    </div>
  );
}
