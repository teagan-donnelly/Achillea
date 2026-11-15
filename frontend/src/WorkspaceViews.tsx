import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { patientReturnState } from "./navigation-context";
import { ArrowRight, CheckCircle, ClipboardList, Radio } from "lucide-react";
import type { ActivityItem, Patient, Round, State } from "./types";
import { BackendActivity } from "./BackendActivity";
import { time, words } from "./api";
import {
  freshness,
  latestReadings,
  readingState,
  metricName,
  sourceName,
  DeviceStatus,
  patientMonitor,
} from "./Monitoring";
import { EventTimeline } from "./EventTimeline";
export function PatientCard({
  patient: p,
  state,
  rounds,
}: {
  patient: Patient;
  state: State;
  rounds: Round[];
}) {
  const location = useLocation();
  const allReadings = latestReadings(
    state.vitals.filter((v) => v.patientId === p.id),
  );
  const priority = ["HEART_RATE", "SPO2", "RESPIRATORY_RATE", "TEMPERATURE"];
  const current = allReadings
    .slice()
    .sort(
      (a, b) =>
        (priority.indexOf(a.metric) < 0 ? 99 : priority.indexOf(a.metric)) -
        (priority.indexOf(b.metric) < 0 ? 99 : priority.indexOf(b.metric)),
    )
    .slice(0, 3);
  const monitor = patientMonitor(state, p.id),
    tasks = rounds.filter((r) => r.task.patientId === p.id),
    next = tasks[0];
  const drafts = state.charts.filter(
    (c) => c.patientId === p.id && c.status === "DRAFT",
  ).length;
  const sensors = state.devices?.filter(
    (d) => d.patientId === p.id && d.bodyRegion !== "BEDSIDE_MONITOR",
  );
  const movement = state.movements.filter((m) => m.patientId === p.id).at(-1);
  const reviews = tasks.filter((r) =>
    r.horizon ? r.horizon === "NOW" : r.rank <= 1,
  ).length;
  return (
    <Link
      state={patientReturnState(location)}
      className="patient-card patient-card-v3"
      to={`/patients/${p.id}`}
    >
      <div className="patient-card-heading">
        <span className="room">
          <small>ROOM</small>
          {p.room}
        </span>
        <div>
          <h2>{p.name}</h2>
          <small>
            {p.unit === "ICU" ? "ICU" : "Labor & delivery"}
            {p.carePhase ? ` / ${p.carePhase}` : ""}
          </small>
        </div>
        <ArrowRight size={18} />
      </div>
      <p className="patient-context">{p.summary}</p>
      <div className="patient-flags">
        <span className={reviews ? "review-flag" : "routine-flag"}>
          <ClipboardList size={14} />
          {tasks.length} open / {reviews} need review
        </span>
        {drafts > 0 && (
          <span>
            {drafts} draft{drafts === 1 ? "" : "s"} to confirm
          </span>
        )}
      </div>
      <div className="compact-vitals" aria-label="Selected latest measurements">
        {current.map((v) => (
          <div key={v.metric}>
            <small>{metricName(v.metric)}</small>
            <strong>
              {["Unavailable", "Disconnected", "Signal unavailable"].includes(
                readingState(v, monitor),
              )
                ? "Unavailable"
                : v.value}
              <span> {v.unit}</span>
            </strong>
            <small
              className={
                readingState(v, monitor) === "Old reading"
                  ? "freshness old"
                  : "freshness"
              }
            >
              {readingState(v, monitor)} - {freshness(v)}
            </small>
            <small>
              <span>{sourceName(v)}</span> /{" "}
              <time dateTime={v.observedAt}>{time(v.observedAt)}</time>
            </small>
          </div>
        ))}
        {!current.length && <span>No monitor readings available</span>}
      </div>
      <DeviceStatus device={monitor} compact />
      {p.repositionPlan && (
        <span className="sensor-brief">
          <Radio size={14} />
          {sensors?.length
            ? sensors.some((d) => d.connectionState === "DISCONNECTED")
              ? "Sensor disconnected - orientation unknown"
              : `Simulated positioning sensors / ${sensors.some((d) => d.freshness !== "FRESH") ? "check freshness" : "fresh report"}`
            : movement?.quality === "PELVIS_DISCONNECTED"
              ? "Pelvic sensor disconnected"
              : "Sensor status unavailable"}
        </span>
      )}
      <div className="patient-next">
        <span className="summary-label">Next care action</span>
        <p>
          {next
            ? `${next.task.title} / ${time(next.task.dueAt)}`
            : "No scheduled care tasks"}
        </p>
        <span className="text-link">
          Open patient overview / trends & charting
        </span>
        {allReadings.length > current.length && (
          <small>
            {allReadings.length - current.length} more measurements in record
          </small>
        )}
      </div>
    </Link>
  );
}
export function ActivityHome({
  state,
  summaries,
  patients,
  rounds,
  label,
}: {
  state: State;
  summaries?: ActivityItem[];
  patients: Patient[];
  rounds: Round[];
  label: string;
}) {
  const location = useLocation();
  const [filter, setFilter] = useState("all"),
    [patient, setPatient] = useState(""),
    [allAttention, setAllAttention] = useState(false);
  const assigned = (id: string | null) =>
    id !== null && patients.some((p) => p.id === id);
  const drafts = state.charts.filter(
    (c) => assigned(c.patientId) && c.status === "DRAFT",
  );
  const movements = state.movements.filter(
    (m) =>
      assigned(m.patientId) &&
      m.reviewRequired !== false &&
      !["CONFIRMED_CARE", "NOT_CARE"].includes(m.verificationStatus),
  );
  const disconnected = patients.filter(
    (p) =>
      state.movements.filter((m) => m.patientId === p.id).at(-1)?.quality ===
      "PELVIS_DISCONNECTED",
  );
  const unavailableMonitors = (state.devices ?? []).filter(
    (d) =>
      assigned(d.patientId) &&
      d.bodyRegion === "BEDSIDE_MONITOR" &&
      (d.connectionState !== "CONNECTED" || d.freshness !== "FRESH"),
  );
  const attention = rounds.filter((r) => r.rank <= 1),
    count =
      attention.length +
      drafts.length +
      movements.length +
      disconnected.length +
      unavailableMonitors.length;
  const events = state.events
    .filter(
      (e) =>
        (!e.patientId || assigned(e.patientId)) &&
        (!patient || e.patientId === patient) &&
        (filter === "all" ||
          (filter === "documentation"
            ? e.type.startsWith("chart")
            : filter === "monitoring"
              ? /^(vital|movement|device)/.test(e.type)
              : e.type.startsWith("task"))),
    )
    .slice()
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
  function identity(id: string) {
    const p = patients.find((p) => p.id === id);
    return `${p?.name ?? "Assigned patient"} · Room ${p?.room ?? "—"}`;
  }
  return (
    <>
      <div className="overview-heading">
        <div>
          <h1>Activity</h1>
          <p>{label} · Your shift</p>
        </div>
        <span className="shift-person">Jordan Ellis, RN</span>
      </div>
      <section className="shift-summary" aria-label="Shift summary">
        <span>
          <strong>{patients.length}</strong>assigned patients
        </span>
        <span>
          <strong>{rounds.length}</strong>outstanding tasks
        </span>
        <span>
          <strong>
            {rounds.length
              ? time(
                  rounds
                    .slice()
                    .sort(
                      (a, b) =>
                        Date.parse(a.task.dueAt) - Date.parse(b.task.dueAt),
                    )[0].task.dueAt,
                )
              : "—"}
          </strong>
          next due action
        </span>
      </section>
      <section className="attention-section">
        <div className="section-heading">
          <h2>Needs attention</h2>
          <span className="count-badge">{count} to review</span>
        </div>
        <div
          id="shift-attention"
          className={`attention-list ${allAttention ? "expanded" : "condensed"}`}
        >
          {attention.map((r) => (
            <Link
              state={patientReturnState(location)}
              key={r.task.id}
              className={r.rank === 0 ? "attention-high" : "attention-due"}
              to={`/patients/${r.task.patientId}?section=tasks#task-${r.task.id}`}
            >
              <ClipboardList size={20} />
              <span>
                <strong>{r.task.title}</strong>
                {r.rank === 0 && <small>Explicit priority review</small>}
                <small>
                  {identity(r.task.patientId)} · Due {time(r.task.dueAt)}
                </small>
                <small>{r.reason}</small>
              </span>
              <ArrowRight size={17} />
            </Link>
          ))}
          {drafts.map((c) => (
            <Link
              state={patientReturnState(location)}
              key={c.id}
              to={`/patients/${c.patientId}?section=chart&entry=${c.id}`}
            >
              <ClipboardList size={20} />
              <span>
                <strong>Chart draft awaiting confirmation</strong>
                <small>
                  {identity(c.patientId)} · Saved {time(c.authoredAt)}
                </small>
              </span>
              <ArrowRight size={17} />
            </Link>
          ))}
          {disconnected.map((p) => (
            <Link
              state={patientReturnState(location)}
              key={p.id}
              to={`/patients/${p.id}?section=sensors`}
            >
              <Radio size={20} />
              <span>
                <strong>Pelvic sensor disconnected</strong>
                <small>{identity(p.id)} · Review monitoring availability</small>
              </span>
              <ArrowRight size={17} />
            </Link>
          ))}
          {unavailableMonitors.map((d) => (
            <Link
              state={patientReturnState(location)}
              key={d.id}
              to={`/patients/${d.patientId}?section=vitals`}
            >
              <Radio size={20} />
              <span>
                <strong>
                  Monitor {words(d.connectionState)} · {words(d.freshness)}
                </strong>
                <small>
                  {identity(d.patientId)} · Review source availability
                </small>
              </span>
              <ArrowRight size={17} />
            </Link>
          ))}
          {movements.map((m) => (
            <Link
              state={patientReturnState(location)}
              key={m.id}
              to={`/patients/${m.patientId}?section=sensors`}
            >
              <Radio size={20} />
              <span>
                <strong>Movement awaiting nurse review</strong>
                <small>
                  {identity(m.patientId)} · {time(m.capturedAt)}
                </small>
                <small>
                  {words(m.classification)} · Detection does not confirm care
                </small>
              </span>
              <ArrowRight size={17} />
            </Link>
          ))}
          {!count && (
            <div className="attention-clear">
              <CheckCircle size={23} />
              <span>No outstanding reviews. Upcoming care is in Rounds.</span>
            </div>
          )}
        </div>
        {count > 4 && (
          <button
            className="secondary attention-expand"
            aria-expanded={allAttention}
            aria-controls="shift-attention"
            onClick={() => setAllAttention(!allAttention)}
          >
            {allAttention
              ? "Show first four reviews"
              : `View all ${count} reviews`}
          </button>
        )}
      </section>
      <section className="activity-timeline">
        <div className="section-heading">
          <h2>Activity timeline</h2>
          <Link to="/rounds">
            Open rounds <ArrowRight size={16} />
          </Link>
        </div>
        <div className="filters">
          <select
            aria-label="Filter activity category"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            <option value="all">All activity</option>
            <option value="documentation">Documentation</option>
            <option value="monitoring">Monitoring</option>
            <option value="tasks">Care tasks</option>
          </select>
          <select
            aria-label="Filter activity by patient"
            value={patient}
            onChange={(e) => setPatient(e.target.value)}
          >
            <option value="">All assigned patients</option>
            {patients.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        {summaries ? (
          <BackendActivity
            state={state}
            events={events}
            patients={patients}
            items={summaries.filter(
              (item) =>
                (!patient || item.patientId === patient) &&
                (filter === "all" ||
                  (filter === "documentation"
                    ? item.type.startsWith("chart")
                    : filter === "monitoring"
                      ? /^(monitoring|measurement|vital|movement|device)/.test(
                          item.type,
                        )
                      : item.type.startsWith("task"))),
            )}
          />
        ) : (
          <EventTimeline events={events} patients={patients} />
        )}
      </section>
    </>
  );
}
