import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, HeartPulse, Radio } from "lucide-react";
import type { Chart, Round, State } from "./types";
import { time, words } from "./api";
import { TaskList, type Mutate } from "./TaskList";
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
  const [params] = useSearchParams();
  const p = state.patients.find((p) => p.id === id && p.unit === unit);
  const [tab, setTab] = useState(
      params.get("section") === "chart"
        ? "Chart"
        : params.get("section") === "tasks"
          ? "Care tasks"
          : "Overview",
    ),
    [text, setText] = useState(""),
    [type, setType] = useState("OBSERVATION"),
    [draft, setDraft] = useState(""),
    [verified, setVerified] = useState(false),
    [linkVitals, setLinkVitals] = useState(false),
    [task, setTask] = useState(""),
    [amend, setAmend] = useState(""),
    [review, setReview] = useState(""),
    [reviewNote, setReviewNote] = useState(""),
    [reviewVerified, setReviewVerified] = useState(false);
  const [dirty, setDirty] = useState(false),
    [needsSave, setNeedsSave] = useState(true);
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
    const saved = sessionStorage.getItem(`achillea-note-${id}`);
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
      sessionStorage.setItem(
        `achillea-note-${id}`,
        JSON.stringify({ text, type, task, linkVitals, draft, amend }),
      );
  }, [id, dirty, text, type, task, linkVitals, draft, amend]);
  if (!p)
    return (
      <>
        <h1>Patient unavailable in this demo unit.</h1>
        <p>Switch to the patientâ€™s assigned unit to continue.</p>
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
  const current = Array.from(new Set(vitals.map((v) => v.metric))).map(
    (metric) => vitals.filter((v) => v.metric === metric).at(-1)!,
  );
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
    <div data-no-swipe>
      <Link className="back" to="/patients">
        <ArrowLeft size={16} /> Assigned patients
      </Link>
      <div className="patient-heading">
        <div>
          <h1>{p.name}</h1>
          <p>
            Room {p.room} Â·{" "}
            {p.unit === "ICU" ? "ICU expansion scenario" : "Labor & delivery"}{" "}
            Â· Jordan Ellis, RN
          </p>
          <small>Synthetic ID: {p.id}</small>
        </div>
        <button onClick={() => setTab("Chart")}>Document care</button>
      </div>
      <div className="tabs" aria-label="Patient sections">
        {["Overview", "Vitals", "Care tasks", "Chart"].map((t) => (
          <button
            aria-pressed={tab === t}
            className={tab === t ? "selected" : ""}
            key={t}
            onClick={() => setTab(t)}
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
          <div className="vital-grid">
            {current.map((v) => (
              <article className="vital" key={v.metric}>
                <h3>
                  <HeartPulse size={16} />
                  {words(v.metric)}
                </h3>
                <p className="reading">
                  {v.quality === "MISSING" ? "Unavailable" : v.value}
                  <span>{v.unit}</span>
                </p>
                <small>
                  Observed {time(v.observedAt)} Â· received {time(v.receivedAt)}
                </small>
                <small>
                  {v.source} Â· {words(v.quality)}
                </small>
                <div
                  className="trend"
                  aria-label={`${words(v.metric)} time series`}
                >
                  {vitals
                    .filter((x) => x.metric === v.metric)
                    .slice(-6)
                    .map((x) => (
                      <span key={x.id}>
                        <strong>{x.value}</strong>
                        <small>{time(x.observedAt)}</small>
                      </span>
                    ))}
                </div>
              </article>
            ))}
          </div>
          <button
            className="secondary"
            disabled={busy}
            onClick={() =>
              void mutate(`/demo/scenarios/vital?patientId=${id}`).catch(
                () => {},
              )
            }
          >
            Receive simulated monitor reading
          </button>
        </>
      )}
      {(tab === "Care tasks" || tab === "Overview") && (
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
                Completed: {t.title} Â· {t.verifiedBy} Â·{" "}
                {t.completedAt && time(t.completedAt)}
              </p>
            ))}
        </section>
      )}
      {tab === "Overview" && (
        <section className="plan">
          <h2>Care plan</h2>
          <p>
            {p.summary}.{" "}
            {p.repositionPlan
              ? "Positioning review is prescribed in this synthetic patientâ€™s plan."
              : "No repositioning-review protocol is assigned to this L&D patient."}
          </p>
        </section>
      )}
      {p.repositionPlan && (tab === "Overview" || tab === "Care tasks") && (
        <section className="sensor-panel">
          <div className="section-heading">
            <h2>Repositioning monitoring</h2>
            <span>Prototype heuristic</span>
          </div>
          <p>
            Orientation observations do not confirm repositioning or pressure
            relief.
          </p>
          <div className="sensor-regions">
            <div>
              <Radio size={22} />
              <strong>Upper torso</strong>
              <small>
                {latest ? "Connected - simulated" : "Connectivity unavailable"}
              </small>
              <span>
                {latest ? `${latest.chestAfter}Â°` : "No observation"}
              </span>
              <small>
                Simulated Â·{" "}
                {latest ? time(latest.capturedAt) : "Awaiting sample"}
              </small>
            </div>
            <div>
              <Radio size={22} />
              <strong>Pelvis</strong>
              <small>
                {!latest
                  ? "Connectivity unavailable"
                  : latest.quality === "PELVIS_DISCONNECTED"
                    ? "Disconnected - review needed"
                    : "Connected - simulated"}
              </small>
              <span>
                {latest?.quality === "PELVIS_DISCONNECTED"
                  ? "Unknown / disconnected"
                  : latest
                    ? `${latest.pelvisAfter}Â°`
                    : "No observation"}
              </span>
              <small>
                {latest?.quality === "PELVIS_DISCONNECTED"
                  ? "Missing data is not no movement"
                  : "Simulated orientation"}
              </small>
            </div>
          </div>
          <p>
            Last detected movement:{" "}
            <strong>
              {latest ? time(latest.capturedAt) : "No observations"}
            </strong>
          </p>
          <p>
            Last nurse-confirmed care:{" "}
            <strong>
              {lastConfirmed?.reviewedAt
                ? time(lastConfirmed.reviewedAt)
                : "None in this demo"}
            </strong>
          </p>
          {!movements.length && (
            <p>
              No movement candidates yet. Use Demo controls to generate
              independent region observations.
            </p>
          )}
          {movements
            .slice(-4)
            .reverse()
            .map((m) => (
              <article className="movement" key={m.id}>
                <strong>{words(m.classification)}</strong>
                <p>
                  {words(m.quality)} Â· {time(m.capturedAt)} Â·{" "}
                  {words(m.verificationStatus)}
                </p>
                <details>
                  <summary>Sensor observation details</summary>
                  <small>
                    Chest {m.chestBefore}Â° â†’ {m.chestAfter}Â° Â· Pelvis{" "}
                    {m.pelvisBefore}Â° â†’ {m.pelvisAfter}Â° Â· Source samples:{" "}
                    {m.sampleIds.length}
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
                        onChange={(e) => setReviewVerified(e.target.checked)}
                      />
                      I verified actual care, beyond the sensor observation.
                    </label>
                    <button
                      disabled={busy || !reviewVerified || !reviewNote.trim()}
                    >
                      Confirm care observation
                    </button>
                    <p>
                      Then explicitly complete the prescribed task below to
                      create its confirmed chart entry.
                    </p>
                  </form>
                )}
              </article>
            ))}
        </section>
      )}
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
              Unconfirmed work is retained in this browser tab. Save a draft to
              store it in the demo record.
            </p>
            <p>
              For {p.name} Â· Room {p.room}. Review patient identity and source
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
                    {words(v.metric)}: {v.value} {v.unit} Â·{" "}
                    {time(v.observedAt)} Â· {v.source}
                  </p>
                ))}
              </div>
            )}
            <button disabled={busy || !text.trim()} onClick={() => void save()}>
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
                  I reviewed the saved entry, patient identity, and provenance.
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
                    void mutate(`/chart/drafts/${draft}/confirm`, { verified })
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
                    {time(c.confirmedAt ?? c.authoredAt)} Â· {c.nurseId}
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
                          {words(v.metric)} {v.value} {v.unit} Â·{" "}
                          {time(v.observedAt)} Â· {v.source}
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
    </div>
  );
}
