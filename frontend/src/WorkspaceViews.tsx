import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, CheckCircle, ClipboardList, Radio } from "lucide-react";
import type { Patient, Round, State } from "./types";
import { time, words } from "./api";
import {
  freshness,
  latestReadings,
  readingState,
  metricName,
  sourceName,
  Trend,
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
  const vitals = state.vitals.filter((v) => v.patientId === p.id),
    current = latestReadings(vitals);
  const monitor = patientMonitor(state, p.id);
  const sensors = state.devices?.filter(
    (d) => d.patientId === p.id && d.bodyRegion !== "BEDSIDE_MONITOR",
  );
  const tasks = rounds.filter((r) => r.task.patientId === p.id),
    next = tasks[0];
  const drafts = state.charts.filter(
      (c) => c.patientId === p.id && c.status === "DRAFT",
    ).length,
    movement = state.movements.filter((m) => m.patientId === p.id).at(-1);
  return (
    <Link className="patient-card" to={`/patients/${p.id}`}>
      <div className="patient-card-heading">
        <span className="room">
          <small>ROOM</small>
          {p.room}
        </span>
        <div>
          <h2>{p.name}</h2>
          <small>
            {p.unit === "ICU" ? "ICU" : "Labor & delivery"} · {p.id}
          </small>
        </div>
        <ArrowRight size={18} />
      </div>
      <p>{p.summary}</p>
      <DeviceStatus device={monitor} />
      <div className="compact-vitals">
        {current.map((v) => (
          <div key={v.metric}>
            <small>{metricName(v.metric)}</small>
            <strong>
              {["Unavailable", "Disconnected", "Signal unavailable"].includes(
                readingState(v, monitor),
              )
                ? "Unavailable"
                : v.value}{" "}
              <span>{v.unit}</span>
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
            <small>{sourceName(v)}</small>
            <Trend
              compact
              readings={vitals.filter((x) => x.metric === v.metric)}
            />
            <small>
              {words(v.quality)} · {time(v.observedAt)}
            </small>
          </div>
        ))}
        {!current.length && <span>No monitor readings available</span>}
      </div>
      <div className="patient-care">
        <span>
          <ClipboardList size={15} />
          {tasks.length} outstanding · {tasks.filter((r) => r.rank <= 1).length}{" "}
          need review
        </span>
        {drafts > 0 && <span>{drafts} drafts awaiting confirmation</span>}
        {p.repositionPlan && (
          <span>
            <Radio size={15} />
            {sensors?.length
              ? sensors.some((d) => d.connectionState === "DISCONNECTED")
                ? "Sensor disconnected · orientation unknown"
                : `Simulated sensors: ${sensors.map((d) => `${words(d.bodyRegion)} ${words(d.freshness)}`).join(" · ")}`
              : !movement
                ? "Sensor status unavailable"
                : movement.quality === "PELVIS_DISCONNECTED"
                  ? "Pelvic sensor disconnected"
                  : `Last simulated sensor report: connected at ${time(movement.capturedAt)}`}
          </span>
        )}
        <p>
          {next
            ? `Next scheduled: ${next.task.title} · ${time(next.task.dueAt)}`
            : "No scheduled care tasks"}
        </p>
        <strong className="text-link">Open patient overview →</strong>
      </div>
    </Link>
  );
}
export function ActivityHome({
  state,
  patients,
  rounds,
  label,
}: {
  state: State;
  patients: Patient[];
  rounds: Round[];
  label: string;
}) {
  const [filter, setFilter] = useState("all"),
    [patient, setPatient] = useState("");
  const assigned = (id: string | null) =>
    id !== null && patients.some((p) => p.id === id);
  const drafts = state.charts.filter(
    (c) => assigned(c.patientId) && c.status === "DRAFT",
  );
  const movements = state.movements.filter(
    (m) =>
      assigned(m.patientId) &&
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
          <p className="eyebrow">YOUR SHIFT · {label}</p>
          <h1>Activity</h1>
        </div>
        <span className="shift-person">Jordan Ellis, RN</span>
      </div>
      <section className="attention-section">
        <div className="section-heading">
          <h2>Needs attention</h2>
          <span className="count-badge">{count} to review</span>
        </div>
        <div className="attention-list">
          {attention.map((r) => (
            <Link
              key={r.task.id}
              to={`/patients/${r.task.patientId}?section=tasks#task-${r.task.id}`}
            >
              <ClipboardList size={20} />
              <span>
                <strong>{r.task.title}</strong>
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
            <Link key={p.id} to={`/patients/${p.id}?section=sensors`}>
              <Radio size={20} />
              <span>
                <strong>Pelvic sensor disconnected</strong>
                <small>{identity(p.id)} · Review monitoring availability</small>
              </span>
              <ArrowRight size={17} />
            </Link>
          ))}
          {unavailableMonitors.map((d) => (
            <Link key={d.id} to={`/patients/${d.patientId}?section=vitals`}>
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
            <Link key={m.id} to={`/patients/${m.patientId}?section=sensors`}>
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
      </section>
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
          next scheduled
        </span>
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
        <EventTimeline events={events} patients={patients} />
      </section>
    </>
  );
}
