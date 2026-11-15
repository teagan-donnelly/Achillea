import { useEffect, useState } from "react";
import {
  Link,
  useLocation,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { ArrowLeft, HeartPulse, Radio } from "lucide-react";
import type { Chart, Movement, Round, State } from "./types";
import { time, words } from "./api";
import {
  latestReadings,
  readingState,
  freshness,
  Trend,
  DeviceStatus,
  patientMonitor,
  metricName,
} from "./Monitoring";
import { EventTimeline } from "./EventTimeline";
import { TaskList, type Mutate } from "./TaskList";
import { CareSection } from "./CareSection";
import { PatientTimeline } from "./PatientTimeline";
import { SensorEvidence } from "./SensorEvidence";
export function PatientView({
  state,
  rounds,
  unit,
  mutate,
  busy,
}: {
  state: State;
  rounds: Round[];
  unit: string;
  mutate: Mutate;
  busy: boolean;
}) {
  const { id } = useParams();
  const location = useLocation();
  const returnTo = ["/", "/activity", "/patients", "/rounds"].includes(
    location.state?.from,
  )
    ? location.state.from
    : "/patients";
  const [params] = useSearchParams();
  const p = state.patients.find((p) => p.id === id && p.unit === unit);
  const requestedChart = state.charts.find(
    (c) =>
      c.id === params.get("entry") &&
      c.patientId === id &&
      c.status === "DRAFT",
  );
  const [tab, setTab] = useState(
      params.get("section") === "chart"
        ? "Chart"
        : params.get("section") === "tasks"
          ? "Care tasks"
          : params.get("section") === "vitals"
            ? "Vitals"
            : params.get("section") === "sensors"
              ? "Sensors"
              : "Overview",
    ),
    [text, setText] = useState(requestedChart?.text ?? ""),
    [type, setType] = useState(requestedChart?.type ?? "OBSERVATION"),
    [draft, setDraft] = useState(requestedChart?.id ?? ""),
    [verified, setVerified] = useState(false),
    [linkVitals, setLinkVitals] = useState(
      !!requestedChart?.linkedVitalIds.length,
    ),
    [task, setTask] = useState(requestedChart?.linkedTaskId ?? ""),
    [amend, setAmend] = useState(""),
    [review, setReview] = useState(""),
    [reviewNote, setReviewNote] = useState(""),
    [reviewVerified, setReviewVerified] = useState(false),
    [trendMetric, setTrendMetric] = useState(""),
    [showAllMovements, setShowAllMovements] = useState(false),
    [sensorExpanded, setSensorExpanded] = useState(true);
  const [dirty, setDirty] = useState(false),
    [needsSave, setNeedsSave] = useState(true),
    [storageError, setStorageError] = useState(false);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  useEffect(() => {
    if (!id) return;
    let saved: string | null = null;
    try {
      saved = sessionStorage.getItem(`achillea-note-${id}`);
    } catch {
      setStorageError(true);
    }
    if (saved) {
      try {
        const note = JSON.parse(saved);
        setText(note.text ?? "");
        setType(note.type ?? "OBSERVATION");
        setTask(note.task ?? "");
        setLinkVitals(!!note.linkVitals);
        setDraft(note.draft ?? "");
        setAmend(note.amend ?? "");
        setDirty(true);
      } catch {
        /* Ignore invalid local draft. */
      }
    }
  }, [id]);
  useEffect(() => {
    if (id && dirty)
      try {
        sessionStorage.setItem(
          `achillea-note-${id}`,
          JSON.stringify({ text, type, task, linkVitals, draft, amend }),
        );
      } catch {
        setStorageError(true);
      }
  }, [id, dirty, text, type, task, linkVitals, draft, amend]);
  useEffect(() => {
    const section = params.get("section");
    const selected = (
      {
        chart: "Chart",
        tasks: "Care tasks",
        vitals: "Vitals",
        sensors: "Sensors",
        overview: "Overview",
      } as Record<string, string>
    )[section ?? ""];
    if (selected) {
      setTab(selected);
      if (selected === "Sensors") setSensorExpanded(true);
    }
  }, [params]);
  useEffect(() => {
    const anchor = window.location.hash.slice(1);
    if (anchor && tab === "Care tasks")
      document.getElementById(anchor)?.scrollIntoView?.({ block: "center" });
  }, [tab, id]);
  if (!p)
    return (
      <>
        <h1>Patient unavailable in this demo unit.</h1>
        <p>Switch to the patient’s assigned unit to continue.</p>
        <Link to="/patients">Back to assigned patients</Link>
      </>
    );
  const vitals = state.vitals.filter((v) => v.patientId === id),
    charts = state.charts.filter((c) => c.patientId === id),
    movements = state.movements.filter((m) => m.patientId === id),
    latest = movements.at(-1),
    lastConfirmed = movements
      .filter((m) => m.verificationStatus === "CONFIRMED_CARE")
      .at(-1);
  const current = latestReadings(vitals);
  const monitor = patientMonitor(state, p.id);
  const patientRounds = rounds.filter((r) => r.task.patientId === id),
    selectedMetric = current.some((v) => v.metric === trendMetric)
      ? trendMetric
      : current[0]?.metric;
  async function save() {
    try {
      const body = {
        patientId: id,
        type,
        text,
        linkedTaskId: task || null,
        linkedVitalIds: linkVitals ? current.map((v) => v.id) : [],
      };
      const result = (await mutate(
        amend
          ? `/chart/${amend}/amendments`
          : draft
            ? `/chart/drafts/${draft}`
            : "/chart/drafts",
        body,
        draft && !amend ? "PATCH" : "POST",
      )) as Chart;
      setDirty(true);
      setNeedsSave(false);
      setDraft(result.id);
      setAmend("");
      setVerified(false);
    } catch {
      /* App feedback. */
    }
  }
  return (
    <div className="patient-bedside" data-no-swipe>
      {storageError && (
        <p className="error" role="alert">
          Browser draft retention is unavailable. Save your draft before leaving
          this patient.
        </p>
      )}
      <Link className="back" to={returnTo}>
        <ArrowLeft size={16} />{" "}
        {returnTo === "/rounds"
          ? "Back to Rounds"
          : returnTo === "/" || returnTo === "/activity"
            ? "Back to Activity"
            : "Assigned patients"}
      </Link>
      <div className="patient-heading">
        <div>
          <h1>{p.name}</h1>
          <p>
            Room {p.room} ·{" "}
            {p.unit === "ICU" ? "ICU expansion scenario" : "Labor & delivery"} ·
            Jordan Ellis, RN
          </p>
          <small>Synthetic ID: {p.id}</small>
        </div>
        <button onClick={() => setTab("Chart")}>Document care</button>
      </div>
      <section
        className="patient-work-summary"
        aria-label="Patient care summary"
      >
        <div>
          <span className="summary-label">Care at a glance</span>
          <strong>
            {patientRounds.length} open tasks /{" "}
            {charts.filter((c) => c.status === "DRAFT").length} chart drafts
          </strong>
          <p>
            {patientRounds[0]
              ? `${patientRounds[0].task.title} - due ${time(patientRounds[0].task.dueAt)}`
              : "No outstanding scheduled tasks"}
          </p>
        </div>
        <button className="secondary" onClick={() => setTab("Care tasks")}>
          Review care
        </button>
      </section>
      <div className="tabs" aria-label="Patient sections">
        {[
          "Overview",
          "Vitals",
          "Care tasks",
          "Chart",
          ...(p.repositionPlan ? ["Sensors"] : []),
          "History",
        ].map((t) => (
          <button
            aria-pressed={tab === t}
            className={tab === t ? "selected" : ""}
            key={t}
            onClick={() => {
              setTab(t);
              if (t === "Sensors") setSensorExpanded(true);
            }}
          >
            {t}
          </button>
        ))}
      </div>
      {(tab === "Overview" || tab === "Vitals") && (
        <>
          <div className="section-heading">
            <h2>Latest observations</h2>
            <span>
              <Radio size={14} /> Simulated monitor
            </span>
          </div>
          <DeviceStatus device={monitor} />
          <div className="vital-grid">
            {current.map((v) => (
              <article className="vital" key={v.metric}>
                <h3>
                  <HeartPulse size={16} />
                  {metricName(v.metric)}
                </h3>
                <p className="reading">
                  {[
                    "Unavailable",
                    "Disconnected",
                    "Signal unavailable",
                  ].includes(readingState(v, monitor))
                    ? "Unavailable"
                    : v.value}
                  <span>{v.unit}</span>
                </p>
                <small>
                  Observed {time(v.observedAt)} · received {time(v.receivedAt)}
                </small>
                <small>
                  {v.source} · {words(v.quality)}
                </small>
                <span
                  className={
                    readingState(v, monitor) === "Old reading"
                      ? "freshness old"
                      : "freshness"
                  }
                >
                  {readingState(v, monitor)} · {freshness(v)}
                </span>
              </article>
            ))}
            {!current.length && (
              <p className="empty">
                No monitor readings available. Check source availability before
                documenting measurements.
              </p>
            )}
          </div>
          {tab === "Overview" && (
            <PatientTimeline state={state} patientId={p.id} />
          )}
          {selectedMetric && (
            <section className="monitor-history" data-no-swipe>
              <div className="section-heading">
                <div>
                  <p className="eyebrow">CONNECTED MONITORING</p>
                  <h2>Recorded trend</h2>
                </div>
                <label>
                  Measurement
                  <select
                    aria-label="Trend measurement"
                    value={selectedMetric}
                    onChange={(e) => setTrendMetric(e.target.value)}
                  >
                    {current.map((v) => (
                      <option key={v.metric} value={v.metric}>
                        {metricName(v.metric)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <Trend
                compact={tab === "Overview"}
                readings={vitals.filter((v) => v.metric === selectedMetric)}
              />
              <p className="monitor-footnote">
                Source observations inform your review. They do not confirm
                care.
              </p>
            </section>
          )}
          <details className="monitor-demo-controls">
            <summary>Monitor simulation controls</summary>
            <button
              className="secondary"
              disabled={busy || monitor?.connectionState === "DISCONNECTED"}
              onClick={() =>
                void mutate(`/demo/scenarios/vital?patientId=${id}`).catch(
                  () => {},
                )
              }
            >
              Receive simulated monitor reading
            </button>
            {monitor?.connectionState === "DISCONNECTED" && (
              <button
                className="secondary"
                disabled={busy}
                onClick={() =>
                  void mutate(
                    `/demo/scenarios/monitor-reconnect?patientId=${id}`,
                  ).catch(() => {})
                }
              >
                Reconnect simulated monitor
              </button>
            )}
          </details>
        </>
      )}
      <CareSection
        title="Pending tasks"
        summary={`${patientRounds.length} open tasks - ${patientRounds.filter((r) => r.rank <= 1).length} require review`}
        open={tab === "Care tasks"}
        onToggle={() =>
          setTab(tab === "Care tasks" ? "Overview" : "Care tasks")
        }
      >
        {tab === "Care tasks" && (
          <section>
            <h2>Care tasks</h2>
            <TaskList
              rounds={rounds.filter((r) => r.task.patientId === id)}
              state={state}
              mutate={mutate}
              busy={busy}
            />
            {state.tasks
              .filter((t) => t.patientId === id && t.status === "COMPLETED")
              .map((t) => (
                <p key={t.id}>
                  Completed: {t.title} · {t.verifiedBy} ·{" "}
                  {t.completedAt && time(t.completedAt)}
                </p>
              ))}
          </section>
        )}
      </CareSection>
      {tab === "Overview" && (
        <section className="plan">
          <h2>Care plan</h2>
          <p>
            {p.summary}.{" "}
            {p.repositionPlan
              ? "Positioning review is prescribed in this synthetic patient’s plan."
              : "No repositioning-review protocol is assigned to this L&D patient."}
          </p>
        </section>
      )}
      {p.repositionPlan && (
        <CareSection
          title="Sensor monitoring"
          summary={`${movements.filter((m) => m.reviewRequired !== false && !["CONFIRMED_CARE", "NOT_CARE"].includes(m.verificationStatus)).length} movements awaiting review - simulated chest & pelvis`}
          open={
            sensorExpanded &&
            ["Overview", "Care tasks", "Sensors"].includes(tab)
          }
          onToggle={() => {
            if (["Overview", "Care tasks", "Sensors"].includes(tab))
              setSensorExpanded(!sensorExpanded);
            else {
              setSensorExpanded(true);
              setTab("Sensors");
            }
          }}
        >
          {p.repositionPlan &&
            sensorExpanded &&
            (tab === "Overview" ||
              tab === "Care tasks" ||
              tab === "Sensors") && (
              <section className="sensor-panel">
                <div className="section-heading">
                  <h2>Repositioning monitoring</h2>
                  <span>Prototype heuristic</span>
                </div>
                <p>
                  Orientation observations do not confirm repositioning or
                  pressure relief.
                </p>
                <div className="sensor-regions">
                  <SensorRegion
                    state={state}
                    patientId={p.id}
                    region="UPPER_TORSO"
                    latest={latest}
                  />
                  <SensorRegion
                    state={state}
                    patientId={p.id}
                    region="PELVIS"
                    latest={latest}
                  />
                </div>
                <p>
                  Last detected movement:{" "}
                  <strong>
                    {latest ? time(latest.capturedAt) : "No observations"}
                  </strong>
                </p>
                <p>
                  Last nurse-confirmed movement review:{" "}
                  <strong>
                    {lastConfirmed?.reviewedAt
                      ? time(lastConfirmed.reviewedAt)
                      : "None in this demo"}
                  </strong>
                </p>
                <p>
                  Last documented care completion:{" "}
                  <strong>
                    {charts
                      .filter(
                        (c) =>
                          c.type === "TASK_COMPLETION" &&
                          c.status === "CONFIRMED" &&
                          c.linkedMovementId,
                      )
                      .at(-1)?.confirmedAt
                      ? time(
                          charts
                            .filter(
                              (c) =>
                                c.type === "TASK_COMPLETION" &&
                                c.status === "CONFIRMED" &&
                                c.linkedMovementId,
                            )
                            .at(-1)!.confirmedAt!,
                        )
                      : "None in this demo"}
                  </strong>
                </p>
                <SensorEvidence patientId={p.id} revision={state.serverTime} />
                {movements.length > 4 && (
                  <button
                    className="secondary"
                    onClick={() => setShowAllMovements(!showAllMovements)}
                  >
                    {showAllMovements
                      ? "Show latest four movements"
                      : `Show all ${movements.length} movements`}
                  </button>
                )}
                {!movements.length && (
                  <p>
                    No movement candidates yet. Use Demo controls to generate
                    independent region observations.
                  </p>
                )}
                {movements
                  .slice(showAllMovements ? 0 : -4)
                  .reverse()
                  .map((m) => (
                    <article className="movement" key={m.id}>
                      <strong>{words(m.classification)}</strong>
                      {m.reviewRequired && (
                        <p>
                          Review required:{" "}
                          {m.reviewReasonCodes?.map(words).join(" / ")}
                        </p>
                      )}
                      <p>
                        {words(m.quality)} · {time(m.capturedAt)} ·{" "}
                        {words(m.verificationStatus)}
                      </p>
                      <details>
                        <summary>Sensor observation details</summary>
                        <small>
                          Chest {m.chestBefore}° → {m.chestAfter}° · Pelvis{" "}
                          {m.pelvisBefore}° → {m.pelvisAfter}° · Source samples:{" "}
                          {m.sampleIds.length}
                          <br />
                          Torso source: {m.chestSensorId ?? "Unavailable"} ·
                          Pelvis source: {m.pelvisSensorId ?? "Unavailable"}
                          <br />
                          Heuristic confidence:{" "}
                          {m.confidence == null
                            ? "Unavailable"
                            : `${Math.round(m.confidence * 100)}% (simulation only)`}
                        </small>
                      </details>
                      {m.verificationStatus !== "CONFIRMED_CARE" && (
                        <div className="actions">
                          <button
                            className="secondary"
                            onClick={() => {
                              setReview(m.id);
                              setReviewNote("");
                              setReviewVerified(false);
                            }}
                          >
                            Review candidate
                          </button>
                          <button
                            className="secondary"
                            disabled={busy}
                            onClick={() =>
                              void mutate(`/movements/${m.id}/review`, {
                                status: "NOT_CARE",
                              }).catch(() => {})
                            }
                          >
                            Not care
                          </button>
                          <button
                            className="secondary"
                            disabled={busy}
                            onClick={() =>
                              void mutate(`/movements/${m.id}/review`, {
                                status: "NEEDS_REVIEW",
                              }).catch(() => {})
                            }
                          >
                            Needs review
                          </button>
                        </div>
                      )}
                      {review === m.id && (
                        <form
                          onSubmit={(e) => {
                            e.preventDefault();
                            void mutate(`/movements/${m.id}/review`, {
                              status: "CONFIRMED_CARE",
                              verified: reviewVerified,
                              text: reviewNote,
                            })
                              .then(() => setReview(""))
                              .catch(() => {});
                          }}
                        >
                          <label>
                            Bedside verification note
                            <textarea
                              required
                              value={reviewNote}
                              onChange={(e) => setReviewNote(e.target.value)}
                              placeholder="Describe the care you personally verified"
                            />
                          </label>
                          <label className="checkbox">
                            <input
                              type="checkbox"
                              checked={reviewVerified}
                              required
                              onChange={(e) =>
                                setReviewVerified(e.target.checked)
                              }
                            />
                            I verified actual care, beyond the sensor
                            observation.
                          </label>
                          <button
                            disabled={
                              busy || !reviewVerified || !reviewNote.trim()
                            }
                          >
                            Confirm care observation
                          </button>
                          <p>
                            Then explicitly complete the prescribed task below
                            to create its confirmed chart entry.
                          </p>
                        </form>
                      )}
                    </article>
                  ))}
              </section>
            )}
        </CareSection>
      )}
      <CareSection
        title="Original event history"
        summary="Inspect the complete recorded patient timeline"
        open={tab === "History"}
        onToggle={() => setTab(tab === "History" ? "Overview" : "History")}
      >
        {tab === "History" && (
          <section className="activity-timeline">
            <h2>Patient history</h2>
            <EventTimeline
              events={state.events.filter((e) => e.patientId === id)}
              patients={[p]}
            />
          </section>
        )}
      </CareSection>
      <CareSection
        title="Care & documentation"
        summary={`${charts.length} entries - ${charts.filter((c) => c.status === "DRAFT").length} drafts to confirm`}
        open={tab === "Chart"}
        onToggle={() => setTab(tab === "Chart" ? "Overview" : "Chart")}
      >
        {tab === "Chart" && (
          <div className="chart-layout">
            <section className="surface chart-form">
              <span className="status">
                {dirty
                  ? "Working draft - retained on this device"
                  : "Nurse-entered documentation"}
              </span>
              <h2>
                {amend
                  ? "Append correction"
                  : draft
                    ? "Edit bedside draft"
                    : "Document at the bedside"}
              </h2>
              <p>
                Unconfirmed work is retained in this browser tab. Save a draft
                to store it in the demo record.
              </p>
              <p>
                For {p.name} · Room {p.room}. Review patient identity and source
                data before confirming.
              </p>
              <label>
                Entry type
                <select
                  value={type}
                  onChange={(e) => {
                    setType(e.target.value);
                    setDirty(true);
                    setNeedsSave(true);
                    setVerified(false);
                  }}
                >
                  <option value="OBSERVATION">Nursing observation</option>
                  <option value="ASSESSMENT">Bedside assessment</option>
                  <option value="CARE_NOTE">Care note</option>
                </select>
              </label>
              <label>
                Link a care task
                <select
                  value={task}
                  onChange={(e) => {
                    setTask(e.target.value);
                    setDirty(true);
                    setNeedsSave(true);
                    setVerified(false);
                  }}
                >
                  <option value="">No task linked</option>
                  {state.tasks
                    .filter((t) => t.patientId === id)
                    .map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.title}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Observation / nurse narrative
                <textarea
                  maxLength={5000}
                  value={text}
                  onChange={(e) => {
                    setText(e.target.value);
                    setDirty(true);
                    setNeedsSave(true);
                    setVerified(false);
                  }}
                  placeholder="Enter your synthetic bedside observation"
                />
              </label>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={linkVitals}
                  onChange={(e) => {
                    setLinkVitals(e.target.checked);
                    setDirty(true);
                    setNeedsSave(true);
                    setVerified(false);
                  }}
                />
                Include latest simulated observations in saved draft
              </label>
              {linkVitals && (
                <div className="provenance">
                  {current.map((v) => (
                    <p key={v.id}>
                      {metricName(v.metric)}: {v.value} {v.unit} ·{" "}
                      {time(v.observedAt)} · {v.source}
                    </p>
                  ))}
                </div>
              )}
              <button
                disabled={busy || !text.trim()}
                onClick={() => void save()}
              >
                Save draft
              </button>
              {draft && (
                <div className="confirm-box">
                  {needsSave && (
                    <p role="status">
                      Save your changes before confirming this entry.
                    </p>
                  )}
                  <h3>Review saved draft</h3>
                  <p>{state.charts.find((c) => c.id === draft)?.text}</p>
                  <small>
                    {state.charts.find((c) => c.id === draft)?.provenance}
                  </small>
                  <label className="checkbox">
                    <input
                      type="checkbox"
                      checked={verified}
                      onChange={(e) => setVerified(e.target.checked)}
                    />
                    I reviewed the saved entry, patient identity, and
                    provenance.
                  </label>
                  <button
                    disabled={
                      busy ||
                      needsSave ||
                      !verified ||
                      state.charts.find((c) => c.id === draft)?.text !== text ||
                      state.charts.find((c) => c.id === draft)?.type !== type ||
                      (state.charts.find((c) => c.id === draft)?.linkedTaskId ??
                        "") !== task
                    }
                    onClick={() =>
                      void mutate(`/chart/drafts/${draft}/confirm`, {
                        verified,
                      })
                        .then(() => {
                          setDraft("");
                          setText("");
                          setDirty(false);
                          sessionStorage.removeItem(`achillea-note-${id}`);
                          setVerified(false);
                        })
                        .catch(() => {})
                    }
                  >
                    Confirm entry
                  </button>
                </div>
              )}
            </section>
            <section>
              <h2>Chart history</h2>
              {!charts.length && (
                <p className="empty">No entries yet. Save a draft to begin.</p>
              )}
              {charts
                .slice()
                .reverse()
                .map((c) => (
                  <article className="chart-entry" key={c.id}>
                    <span className="status">{words(c.status)}</span>
                    <h3>{words(c.type)}</h3>
                    <p className="narrative">{c.text}</p>
                    <small>
                      {time(c.confirmedAt ?? c.authoredAt)} · {c.nurseId}
                      <br />
                      {c.provenance}
                      {c.amendmentOfId && (
                        <>
                          <br />
                          Amends entry {c.amendmentOfId}
                        </>
                      )}
                    </small>
                    <div className="linked-readings">
                      {c.linkedVitalIds.map((vid) => {
                        const v = state.vitals.find((v) => v.id === vid);
                        return v ? (
                          <p key={vid}>
                            {metricName(v.metric)} {v.value} {v.unit} ·{" "}
                            {time(v.observedAt)} · {v.source}
                          </p>
                        ) : null;
                      })}
                    </div>
                    <button
                      className="secondary"
                      onClick={() => {
                        if (
                          dirty &&
                          text.trim() &&
                          !window.confirm(
                            "Replace the current working note with this entry? Save your draft first to keep it in the demo record.",
                          )
                        )
                          return;
                        setNeedsSave(c.status !== "DRAFT");
                        setDirty(true);
                        setText(c.status === "DRAFT" ? c.text : "");
                        setDraft(c.status === "DRAFT" ? c.id : "");
                        setAmend(c.status === "DRAFT" ? "" : c.id);
                        setType(c.type);
                        setTask(c.linkedTaskId ?? "");
                        setLinkVitals(c.linkedVitalIds.length > 0);
                        setVerified(false);
                      }}
                    >
                      {c.status === "DRAFT" ? "Edit draft" : "Append amendment"}
                    </button>
                  </article>
                ))}
            </section>
          </div>
        )}
      </CareSection>
    </div>
  );
}

function SensorRegion({
  state,
  patientId,
  region,
  latest,
}: {
  state: State;
  patientId: string;
  region: string;
  latest?: Movement;
}) {
  const device = state.devices?.find(
    (d) => d.patientId === patientId && d.bodyRegion === region,
  );
  const sample = state.samples
    ?.filter((x) => x.patientId === patientId && x.bodyRegion === region)
    .slice()
    .sort((a, b) => Date.parse(a.capturedAt) - Date.parse(b.capturedAt))
    .at(-1);
  const disconnected = device
    ? device.connectionState === "DISCONNECTED"
    : region === "PELVIS" && latest?.quality === "PELVIS_DISCONNECTED";
  const angle =
    sample?.rollDegrees ??
    (latest?.sampleIds.some((id) =>
      id.endsWith(region === "PELVIS" ? "-pelvis" : "-chest"),
    )
      ? region === "PELVIS"
        ? latest.pelvisAfter
        : latest.chestAfter
      : undefined);
  const captured = sample?.capturedAt ?? latest?.capturedAt;
  return (
    <div>
      <Radio size={22} />
      <strong>{region === "PELVIS" ? "Pelvis" : "Upper torso"}</strong>
      <small>
        {device
          ? `${words(device.connectionState)} · ${words(device.freshness)} (simulated)`
          : disconnected
            ? "Disconnected - review needed"
            : latest
              ? "Last report: connected (simulated)"
              : "Connectivity unavailable"}
      </small>
      <span>
        {disconnected
          ? "Unknown / disconnected"
          : angle === undefined
            ? "No observation"
            : `${angle}°`}
      </span>
      <small>
        {disconnected
          ? "Missing data is not no movement"
          : captured
            ? `Observed ${time(captured)}`
            : "Awaiting sample"}
      </small>
      {device && <small>Source: {device.id}</small>}
    </div>
  );
}
