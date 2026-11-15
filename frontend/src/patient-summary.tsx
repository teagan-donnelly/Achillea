// Summary tab of the patient record: a few calm rows built only from fields the data carries.
// Detail lives one tap away (sheets, Monitoring detail, collapsed sections).
import { useId, useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { Patient, Round, State } from "./types";
import type { Mutate } from "./app-context";
import { TaskList } from "./TaskList";
import { latestReadings, metricName, patientMonitor, readingState } from "./Monitoring";
import { repositioningStatus } from "./repositioning";
import { MovementReview, pendingMovements } from "./patient-movements";
import { RepositioningRow } from "./patient-repositioning";
import { carePhase, clock, deviceName, staffName, stamp } from "./patient-data";

/** Expandable section. The status line sits inside the toggle so it is announced with the title. */
export function Disclosure({
  title,
  status,
  open,
  onToggle,
  children,
  id,
}: {
  title: string;
  status?: ReactNode;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
  id?: string;
}) {
  const panel = useId();
  return (
    <section className={`pt-disclosure${open ? " is-open" : ""}`} id={id}>
      <h2 className="pt-disclosure-h">
        <button type="button" aria-expanded={open} aria-controls={panel} onClick={onToggle}>
          <span className="pt-disclosure-text">
            <span className="pt-disclosure-title">{title}</span>
            {status && <span className="pt-disclosure-status">{status}</span>}
          </span>
          <ChevronDown className="pt-disclosure-chev" aria-hidden strokeWidth={2} />
        </button>
      </h2>
      <div id={panel} className="pt-disclosure-body" hidden={!open}>
        {children}
      </div>
    </section>
  );
}

export type SummaryFocus = "tasks" | "repositioning" | "sensors" | null;

const VITAL_ORDER = ["HEART_RATE", "SPO2", "RESPIRATORY_RATE", "TEMPERATURE"];
const shortUnit = (u: string) => (u === "breaths/min" ? "/min" : u);
/** Patient summaries that only describe the simulator are not clinical content. */
const isMetaSummary = (s: string) => /simulat|mimic|demo|replay|synthetic/i.test(s);

export function PatientSummary({
  state,
  patient: p,
  rounds,
  mutate,
  busy,
  now,
  focus,
}: {
  state: State;
  patient: Patient;
  rounds: Round[];
  mutate: Mutate;
  busy: boolean;
  now: number;
  focus: SummaryFocus;
}) {
  const location = useLocation();
  const patientRounds = rounds.filter((r) => r.task.patientId === p.id);
  const completed = state.tasks
    .filter((t) => t.patientId === p.id && t.status === "COMPLETED")
    .sort((a, b) => Date.parse(b.completedAt ?? "") - Date.parse(a.completedAt ?? ""));
  const reposition = repositioningStatus(state, p, now);
  const pending = pendingMovements(state, p.id);
  const current = latestReadings(state.vitals.filter((v) => v.patientId === p.id)).sort(
    (a, b) => (VITAL_ORDER.indexOf(a.metric) + 1 || 99) - (VITAL_ORDER.indexOf(b.metric) + 1 || 99),
  );
  const monitor = patientMonitor(state, p.id);
  const readings = current.map((v) => {
    const status = readingState(v, monitor);
    const unavailable = ["Unavailable", "Disconnected", "Signal unavailable"].includes(status);
    const value = unavailable ? "–" : v.metric === "TEMPERATURE" ? v.value.toFixed(1) : String(Math.round(v.value));
    const label = `${metricName(v.metric)}, ${unavailable ? "value unavailable" : `${value} ${v.unit}`}, ${status}, observed ${stamp(v.observedAt, now)}`;
    return { v, status, value, label };
  });
  const devices = (state.devices ?? []).filter((d) => d.patientId === p.id);
  const phase = carePhase(p);
  const offline = devices.filter((d) => d.connectionState !== "CONNECTED").length;
  const latestReading = current.reduce<(typeof current)[number] | null>(
    (a, b) => (!a || Date.parse(b.observedAt) > Date.parse(a.observedAt) ? b : a),
    null,
  );

  const [open, setOpen] = useState<Record<string, boolean>>(() => ({
    tasks: focus === "tasks",
    sensors: focus === "sensors",
  }));
  // A deep link (?section=…) opens its section without collapsing the others.
  const [lastFocus, setLastFocus] = useState(focus);
  if (focus !== lastFocus) {
    setLastFocus(focus);
    if (focus) setOpen((o) => ({ ...o, [focus]: true }));
  }
  const toggle = (key: string) => setOpen((o) => ({ ...o, [key]: !o[key] }));

  return (
    <div className="pt-summary">
      <dl className="pt-facts pt-about">
        {p.summary && !isMetaSummary(p.summary) && (
          <div className="is-wide">
            <dt>Summary</dt>
            <dd>{p.summary.replace(/\.$/, "")}</dd>
          </div>
        )}
        <div>
          <dt>Nurse</dt>
          <dd>{staffName(p.nurseId)}</dd>
        </div>
        {phase && (
          <div>
            <dt>Care phase</dt>
            <dd>{phase}</dd>
          </div>
        )}
        {p.repositionPlan && reposition.plan && (
          <div>
            <dt>Turns</dt>
            <dd>Every {reposition.plan.intervalMinutes} min</dd>
          </div>
        )}
      </dl>

      <div className="pt-lines">
        {p.repositionPlan && <RepositioningRow state={state} patient={p} mutate={mutate} busy={busy} now={now} />}
        {current.length > 0 && (
          <Link
            to={`/monitoring/${p.id}`}
            state={{ from: location.pathname }}
            className="pt-line-row"
            aria-label={`Vitals, open monitoring. ${readings.map((r) => r.label).join("; ")}`}
          >
            <span className="pt-line-label">Vitals</span>
            <span className="pt-line-value pt-vitals">
              {readings.map(({ v, status, value, label }) => (
                  <span key={v.metric} role="img" aria-label={label} className={status === "Recent reading" ? undefined : "is-old"}>
                    <span className="pt-reading-value"><b>{value}</b><span>{shortUnit(v.unit)}</span></span>
                    {status !== "Recent reading" && <span className="pt-reading-state">{status}</span>}
                  </span>
              ))}
            </span>
            <ChevronRight className="ach-chevron" aria-hidden strokeWidth={2} />
          </Link>
        )}
      </div>

      {(patientRounds.length > 0 || completed.length > 0) && (
        <Disclosure
          id="care-tasks"
          title="Care tasks"
          status={
            patientRounds.length
              ? `${patientRounds.length} open · next due ${clock(patientRounds[0]!.task.dueAt)}`
              : `${completed.length} completed`
          }
          open={open.tasks}
          onToggle={() => toggle("tasks")}
        >
          <div className="pt-tasks">
            <TaskList rounds={patientRounds} state={state} mutate={mutate} busy={busy} />
            {completed.length > 0 && (
              <ul className="pt-done">
                {completed.map((t) => (
                  <li key={t.id}>
                    <span>Completed: {t.title}</span>
                    <small>
                      {staffName(t.verifiedBy)} · {t.completedAt ? stamp(t.completedAt, now) : "time unavailable"}
                    </small>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Disclosure>
      )}

      {(devices.length > 0 || current.length > 0 || p.repositionPlan) && (
        <Disclosure
          title={p.repositionPlan ? "Sensor monitoring" : "Devices"}
          status={
            [pending ? `${pending} to review` : "", offline ? `${offline} offline` : ""].filter(Boolean).join(" · ") ||
            undefined
          }
          open={open.sensors}
          onToggle={() => toggle("sensors")}
        >
          <ul className="pt-devices">
            {devices.map((d) => (
              <li key={d.id}>
                <span>{deviceName(d.id, d.bodyRegion)}</span>
                <span className={d.connectionState === "CONNECTED" ? "" : "is-warn"}>
                  {d.connectionState === "CONNECTED"
                    ? d.freshness === "FRESH"
                      ? "Connected"
                      : "No recent data"
                    : d.connectionState === "DELAYED"
                      ? "Delayed"
                      : "Offline"}
                </span>
              </li>
            ))}
          </ul>
          {latestReading && (
            <p className="pt-provenance-line">
              Observed {clock(latestReading.observedAt)} · received {clock(latestReading.receivedAt)} ·{" "}
              {latestReading.source}
            </p>
          )}
          {open.sensors && p.repositionPlan && (
            <MovementReview state={state} patient={p} mutate={mutate} busy={busy} />
          )}
          <details className="pt-details">
            <summary>Monitor simulation controls</summary>
            <div className="pt-actions">
              <button
                type="button"
                className="ach-button secondary"
                disabled={busy || monitor?.connectionState === "DISCONNECTED"}
                onClick={() => void mutate(`/demo/scenarios/vital?patientId=${p.id}`).catch(() => {})}
              >
                Receive simulated monitor reading
              </button>
              {monitor?.connectionState === "DISCONNECTED" && (
                <button
                  type="button"
                  className="ach-button secondary"
                  disabled={busy}
                  onClick={() => void mutate(`/demo/scenarios/monitor-reconnect?patientId=${p.id}`).catch(() => {})}
                >
                  Reconnect simulated monitor
                </button>
              )}
            </div>
          </details>
        </Disclosure>
      )}
    </div>
  );
}
