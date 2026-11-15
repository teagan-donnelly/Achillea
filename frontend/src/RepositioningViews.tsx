import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { ArrowRight, Radio, Check, Clock, AlertTriangle } from "lucide-react";
import type { Patient, State } from "./types";
import type { Mutate } from "./TaskList";
import { PageHero, PatientAvatar } from "./VisualPrimitives";
import { time, words } from "./api";
import {
  deadlineText,
  repositioningStatus,
  scheduleLabel,
} from "./repositioning";

export function useDemoNow(state: State) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    setElapsed(0);
    const start = Date.now();
    const timer = setInterval(() => setElapsed(Date.now() - start), 15000);
    return () => clearInterval(timer);
  }, [state.serverTime]);
  return Date.parse(state.serverTime ?? new Date().toISOString()) + elapsed;
}
function TurnCard({
  patient: p,
  state,
  now,
}: {
  patient: Patient;
  state: State;
  now: number;
}) {
  const status = repositioningStatus(state, p, now),
    location = useLocation();
  return (
    <Link
      className={`turn-card turn-${status.schedule.toLowerCase()}`}
      to={`/patients/${p.id}?section=repositioning`}
      state={{ from: location.pathname }}
    >
      <div className="turn-identity">
        <PatientAvatar attention={status.schedule === "OVERDUE"} />
        <div>
          <h3>{p.name}</h3>
          <small>
            Room {p.room} · {p.unit === "ICU" ? "ICU" : "L&D"}
          </small>
        </div>
        <ArrowRight size={18} />
      </div>
      <strong className="turn-deadline">{deadlineText(status.due, now)}</strong>
      <p>{status.evidence}</p>
      <small>
        Last confirmed care:{" "}
        {status.plan?.lastConfirmedCareAt
          ? time(status.plan.lastConfirmedCareAt)
          : "None recorded; initial care-plan deadline"}
      </small>
      <small>
        {status.latest
          ? `Last simulated roll: chest ${status.latest.chestAfter}°, pelvis ${status.latest.pelvisAfter}°`
          : "Position unknown — no sensor history"}
      </small>
      {status.plan?.lastConfirmedCareAt && (
        <small>
          {Math.max(
            0,
            Math.floor(
              (now - Date.parse(status.plan.lastConfirmedCareAt)) / 60000,
            ),
          )}{" "}
          min since nurse confirmation
        </small>
      )}
      <span className="turn-review-link">
        Review patient <ArrowRight size={16} aria-hidden="true" />
      </span>
    </Link>
  );
}
export function RepositioningHome({
  state,
  patients,
  label,
  onOpenIcu,
  onLoadDemo,
  busy = false,
}: {
  state: State;
  patients: Patient[];
  label: string;
  onOpenIcu?: () => void;
  onLoadDemo?: () => void;
  busy?: boolean;
}) {
  const now = useDemoNow(state),
    eligible = patients.filter((p) => p.repositionPlan);
  const queue = [...eligible].sort(
    (a, b) =>
      repositioningStatus(state, a, now).due -
      repositioningStatus(state, b, now).due,
  );
  const overdue = queue.filter(
    (p) => repositioningStatus(state, p, now).schedule === "OVERDUE",
  );
  const soon = queue.filter(
    (p) => repositioningStatus(state, p, now).schedule === "DUE_SOON",
  );
  const onTrack = queue.filter((p) => {
    const s = repositioningStatus(state, p, now);
    return s.schedule === "ON_TRACK" && s.reporting;
  });
  const exceptions = queue.filter((p) => {
    const s = repositioningStatus(state, p, now);
    return (
      s.schedule === "UNKNOWN" || (s.schedule === "ON_TRACK" && !s.reporting)
    );
  });
  return (
    <div className="repositioning-home">
      <PageHero
        title="Repositioning Command Center"
        subtitle="Sensor-guided care for at-risk patients"
      />
      <div className="turn-metrics" aria-label="Repositioning summary">
        {[
          [overdue.length, "Overdue"],
          [soon.length, "Due soon"],
          [onTrack.length, "On track"],
        ].map(([count, label]) => (
          <div key={label}>
            <strong>{count}</strong>
            <span>{label}</span>
          </div>
        ))}
      </div>
      <div className="turn-context">
        <span>{eligible.length} patients with active repositioning plans</span>
        {onLoadDemo && (
          <button className="secondary" disabled={busy} onClick={onLoadDemo}>
            Load repositioning demo
          </button>
        )}
        <span>{label} · Individual care-plan deadlines</span>
        <Link to="/activity">Activity & history</Link>
      </div>
      <div className="command-columns">
        <section>
          <h2>Needs attention ({overdue.length})</h2>
          <p>
            Scheduled care is overdue. Movement alone cannot establish whether
            care occurred.
          </p>
          <div className="turn-queue">
            {overdue.map((p) => (
              <TurnCard key={p.id} patient={p} state={state} now={now} />
            ))}
            {!overdue.length && (
              <p className="empty">
                No overdue repositioning deadlines in this unit.
              </p>
            )}
          </div>
        </section>
        <section>
          <h2>Upcoming turns ({soon.length})</h2>
          <p>
            Within each patient's configured warning window. Later deadlines are
            under On-track patients.
          </p>
          <div className="turn-queue">
            {soon.map((p) => (
              <TurnCard key={p.id} patient={p} state={state} now={now} />
            ))}
            {!soon.length && (
              <p className="empty">
                No turns within the configured warning window.
              </p>
            )}
          </div>
          <div className="coverage-summary">
            <Radio size={20} />
            <strong>
              {
                eligible.filter(
                  (p) => repositioningStatus(state, p, now).reporting,
                ).length
              }
              /{eligible.length} patients with both sensors reporting
            </strong>
            <p>
              Synthetic telemetry · Unknown or disconnected evidence is never
              counted as on track.
            </p>
            <Link to="/sensors">Open Sensor Monitoring</Link>
          </div>
        </section>
      </div>
      {exceptions.length > 0 && (
        <section>
          <h2>Schedule or sensor exceptions ({exceptions.length})</h2>
          {exceptions.map((p) => (
            <TurnCard key={p.id} patient={p} state={state} now={now} />
          ))}
        </section>
      )}
      <details className="turn-ontrack">
        <summary>On-track patients ({onTrack.length})</summary>
        {onTrack.map((p) => (
          <TurnCard key={p.id} patient={p} state={state} now={now} />
        ))}
      </details>
      {patients.some((p) => !p.repositionPlan) && (
        <p className="empty">
          {patients.filter((p) => !p.repositionPlan).length} assigned patients
          have no active repositioning plan. Vitals and care remain available in{" "}
          <Link to="/patients">assigned patient records</Link>.
          {eligible.length === 0 && onOpenIcu && (
            <button className="secondary" onClick={onOpenIcu}>
              Open ICU repositioning patients
            </button>
          )}
        </p>
      )}
    </div>
  );
}
export function SensorMonitoring({
  state,
  patients,
}: {
  state: State;
  patients: Patient[];
}) {
  const [filter, setFilter] = useState("All"),
    now = useDemoNow(state),
    eligible = patients.filter((p) => p.repositionPlan);
  const filters = [
    "All",
    "Overdue",
    "Due soon",
    "On track",
    "Sensor unavailable",
  ];
  function matches(p: Patient, f: string) {
    const s = repositioningStatus(state, p, now);
    return (
      f === "All" ||
      (f === "Sensor unavailable"
        ? !s.reporting
        : f === "On track"
          ? s.reporting && s.schedule === "ON_TRACK"
          : scheduleLabel(s.schedule) === f)
    );
  }
  return (
    <>
      <PageHero
        title="Sensor Monitoring"
        subtitle="Movement & position evidence · Simulation"
      />
      <div className="filter-pills" data-no-swipe>
        {filters.map((f) => (
          <button
            key={f}
            aria-pressed={filter === f}
            onClick={() => setFilter(f)}
          >
            {f} ({eligible.filter((p) => matches(p, f)).length})
          </button>
        ))}
      </div>
      <p>
        {
          eligible.filter((p) => repositioningStatus(state, p, now).reporting)
            .length
        }
        /{eligible.length} patients reporting ·{" "}
        {eligible.reduce(
          (n, p) => n + repositioningStatus(state, p, now).pending,
          0,
        )}{" "}
        movement reviews pending
      </p>
      <div className="sensor-grid">
        {eligible
          .filter((p) => matches(p, filter))
          .map((p) => (
            <article className="sensor-patient" key={p.id}>
              <TurnCard patient={p} state={state} now={now} />
              <SensorReadings state={state} patient={p} />
            </article>
          ))}
      </div>
      {!eligible.filter((p) => matches(p, filter)).length && (
        <p className="empty">No patients match this sensor filter.</p>
      )}
    </>
  );
}
function SensorSamplePlot({
  state,
  patientId,
}: {
  state: State;
  patientId: string;
}) {
  const samples = (state.samples ?? [])
    .filter(
      (s) =>
        s.patientId === patientId &&
        ["UPPER_TORSO", "PELVIS"].includes(s.bodyRegion) &&
        Number.isFinite(s.rollDegrees) &&
        Number.isFinite(Date.parse(s.capturedAt)),
    )
    .sort((a, b) => Date.parse(a.capturedAt) - Date.parse(b.capturedAt))
    .slice(-80);
  if (!samples.length)
    return (
      <p className="empty">
        No timestamped sensor samples available. Movement events remain
        available below.
      </p>
    );
  const start = Date.parse(samples[0].capturedAt),
    end = Date.parse(samples.at(-1)!.capturedAt);
  return (
    <figure className="sensor-sample-plot">
      <figcaption>
        <strong>Recorded movement evidence</strong>
        <span>Chest and pelvis · Simulated roll angles</span>
      </figcaption>
      <svg
        viewBox="0 0 340 145"
        role="img"
        aria-label={`${samples.length} discrete sensor samples from ${time(samples[0].capturedAt)} to ${time(samples.at(-1)!.capturedAt)}. No continuous waveform inferred.`}
      >
        {[-180, 0, 180].map((angle) => (
          <g key={angle}>
            <line x1="38" x2="325" y1={65 - angle / 4} y2={65 - angle / 4} />
            <text x="3" y={69 - angle / 4}>
              {angle}°
            </text>
          </g>
        ))}
        {samples.map((s) => (
          <circle
            key={s.id}
            cx={
              38 +
              ((Date.parse(s.capturedAt) - start) / Math.max(1, end - start)) *
                287
            }
            cy={65 - Math.max(-180, Math.min(180, s.rollDegrees)) / 4}
            r="3.5"
            className={
              s.bodyRegion === "PELVIS" ? "sample-pelvis" : "sample-chest"
            }
            fillOpacity={s.quality === "SIMULATED_GOOD" ? 1 : 0.3}
          >
            <title>
              {s.bodyRegion === "PELVIS" ? "Pelvis" : "Chest"}: {s.rollDegrees}
              °, {time(s.capturedAt)}, {words(s.quality)}
            </title>
          </circle>
        ))}
        <text x="38" y="135">
          {time(samples[0].capturedAt)}
        </text>
        <text x="325" y="135" textAnchor="end">
          {time(samples.at(-1)!.capturedAt)}
        </text>
      </svg>
      <p className="sample-legend">
        <span>Chest</span>
        <span>Pelvis</span>
      </p>
      <small>
        {samples.length} recorded points; faded points have uncertain quality.
        Angles do not establish anatomical position or completed care.
      </small>
    </figure>
  );
}
function SensorReadings({
  state,
  patient,
}: {
  state: State;
  patient: Patient;
}) {
  return (
    <div className="region-readings">
      {["UPPER_TORSO", "PELVIS"].map((region) => {
        const d = state.devices?.find(
            (d) => d.patientId === patient.id && d.bodyRegion === region,
          ),
          sample = state.samples
            ?.filter(
              (s) => s.patientId === patient.id && s.bodyRegion === region,
            )
            .at(-1);
        return (
          <div
            key={region}
            className={
              !d ||
              d.connectionState !== "CONNECTED" ||
              d.freshness !== "FRESH" ||
              !sample
                ? "region-unavailable"
                : "region-reporting"
            }
          >
            <Radio size={18} />
            <strong>
              {region === "PELVIS" ? "Pelvis" : "Chest / upper torso"}
            </strong>
            <span>
              {d
                ? `${words(d.connectionState)} · ${words(d.freshness)}`
                : "Unknown · no device history"}
            </span>
            <span>
              {sample
                ? `Last recorded roll ${sample.rollDegrees}° · ${time(sample.capturedAt)}`
                : "Orientation unknown"}
            </span>
            <small>
              Last signal: {d?.lastSeenAt ? time(d.lastSeenAt) : "Unknown"} ·
              Simulated
            </small>
          </div>
        );
      })}
    </div>
  );
}
export function RepositioningDetail({
  state,
  patient: p,
  mutate,
  busy,
}: {
  state: State;
  patient: Patient;
  mutate: Mutate;
  busy: boolean;
}) {
  const now = useDemoNow(state),
    s = repositioningStatus(state, p, now),
    [review, setReview] = useState(false),
    [note, setNote] = useState(""),
    [verified, setVerified] = useState(false),
    [outcome, setOutcome] = useState("CONFIRMED_CARE"),
    [error, setError] = useState(""),
    [movementId, setMovementId] = useState("");
  const movements = state.movements
    .filter((m) => m.patientId === p.id)
    .sort((a, b) => Date.parse(b.capturedAt) - Date.parse(a.capturedAt));
  const selected = movements.find((m) => m.id === (movementId || s.latest?.id));
  async function confirm() {
    if (!selected) return;
    setError("");
    try {
      await mutate(
        outcome === "CONFIRMED_CARE"
          ? `/patients/${p.id}/repositioning/confirm`
          : `/movements/${selected.id}/review`,
        { movementId: selected.id, status: outcome, text: note, verified },
      );
      setReview(false);
      setVerified(false);
      setNote("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save review");
    }
  }
  return (
    <section className="repositioning-detail">
      <div className={`turn-status-panel turn-${s.schedule.toLowerCase()}`}>
        <AlertTriangle size={24} />
        <div>
          <h2>
            {s.schedule === "OVERDUE"
              ? "Repositioning overdue"
              : scheduleLabel(s.schedule)}
          </h2>
          <strong>{deadlineText(s.due, now)}</strong>
          {!s.plan && <p>No repositioning plan</p>}
        </div>
      </div>
      <div className="position-layout">
        <div className="body-position">
          <svg
            viewBox="0 0 180 240"
            role="img"
            aria-label="Sensor placement diagram: chest and pelvis. Not an inferred body orientation."
          >
            <circle cx="90" cy="30" r="20" />
            <path d="M63 58 Q90 48 117 58 L130 140 L114 152 L110 220 L94 220 L90 157 L86 220 L70 220 L66 152 L50 140 Z" />
            <path d="M63 63 L38 136 M117 63 L142 136" fill="none" />
            <circle className="sensor-dot" cx="90" cy="92" r="11" />
            <circle className="sensor-dot" cx="90" cy="143" r="11" />
          </svg>
        </div>
        <SensorReadings state={state} patient={p} />
      </div>
      <div className="last-care">
        <Check size={20} />
        <div>
          <strong>Last nurse-confirmed repositioning</strong>
          <p>
            {s.plan?.lastConfirmedCareAt
              ? new Date(s.plan.lastConfirmedCareAt).toLocaleString()
              : "None yet"}
          </p>
        </div>
      </div>
      <button
        disabled={!s.latest || !s.plan || busy}
        onClick={() => setReview(!review)}
      >
        Review & document turn <ArrowRight size={18} />
      </button>
      {review && (
        <section
          className="turn-review"
          data-no-swipe
          aria-label="Repositioning Review"
        >
          <h2>Repositioning Review</h2>
          <SensorSamplePlot state={state} patientId={p.id} />
          <p>
            {p.name} · Room {p.room} · {p.unit === "ICU" ? "ICU" : "L&D"}
          </p>
          <p>
            Discrete simulated movement events. Marker values are recorded roll
            angles, not a continuous waveform or validated position inference.
          </p>
          <label>
            Movement to review
            <select
              value={selected?.id ?? ""}
              onChange={(e) => {
                setMovementId(e.target.value);
                setVerified(false);
              }}
            >
              {movements.map((m) => (
                <option key={m.id} value={m.id}>
                  {time(m.capturedAt)} · {words(m.classification)} ·{" "}
                  {words(m.verificationStatus)}
                </option>
              ))}
            </select>
          </label>
          <ol className="movement-evidence">
            {movements.slice(0, 12).map((m) => (
              <li key={m.id}>
                <Clock size={16} />
                <time dateTime={m.capturedAt}>{time(m.capturedAt)}</time>
                <strong>{words(m.classification)}</strong>
                <span>
                  Chest {m.chestBefore}° → {m.chestAfter}° · Pelvis{" "}
                  {m.pelvisBefore}° → {m.pelvisAfter}°
                </span>
                <small>
                  {words(m.quality)} · {words(m.verificationStatus)}
                </small>
              </li>
            ))}
          </ol>
          {selected && (
            <p className="evidence-interpretation">
              {selected.classification === "COORDINATED_TURN_CANDIDATE"
                ? "Movement consistent with repositioning detected"
                : "Movement requires bedside review; it may not be a qualifying turn"}
              . {s.evidence}.
            </p>
          )}
          <label>
            Nurse review
            <select
              value={outcome}
              onChange={(e) => {
                setOutcome(e.target.value);
                setVerified(false);
              }}
            >
              <option value="CONFIRMED_CARE">Repositioning completed</option>
              <option value="NOT_CARE">
                Movement observed, not a qualifying turn
              </option>
              <option value="NEEDS_REVIEW">
                Unable to verify / further review
              </option>
            </select>
          </label>
          <label>
            Bedside observation
            <textarea
              maxLength={5000}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Document what you personally verified"
            />
          </label>
          {outcome === "CONFIRMED_CARE" && (
            <label className="verification">
              <input
                type="checkbox"
                checked={verified}
                onChange={(e) => setVerified(e.target.checked)}
              />
              I explicitly verified the prescribed care at the bedside. Sensor
              movement alone does not confirm care.
            </label>
          )}
          {error && <p role="alert">{error}</p>}
          <button
            disabled={
              busy ||
              !selected ||
              selected.verificationStatus === "CONFIRMED_CARE" ||
              (outcome === "CONFIRMED_CARE" && (!verified || !note.trim()))
            }
            onClick={() => void confirm()}
          >
            {outcome === "CONFIRMED_CARE"
              ? "Confirm & document"
              : "Save nurse review"}
          </button>
          <p>
            Confirmation is persisted by the backend before the care schedule
            changes. Existing entries remain immutable; use Care & documentation
            for append-only amendments.
          </p>
        </section>
      )}
    </section>
  );
}
