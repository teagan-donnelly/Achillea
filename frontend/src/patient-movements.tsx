// Sensor movement candidates and the explicit nurse review of each one. Workflow unchanged from
// the previous PatientView: a sensor observation never confirms care on its own.
import { useState } from "react";
import type { Movement, Patient, State } from "./types";
import type { Mutate } from "./app-context";
import { words } from "./api";
import { SensorEvidence } from "./SensorEvidence";
import { clock } from "./patient-data";

export function pendingMovements(state: State, patientId: string) {
  return state.movements.filter(
    (m) =>
      m.patientId === patientId &&
      m.reviewRequired !== false &&
      !["CONFIRMED_CARE", "NOT_CARE"].includes(m.verificationStatus),
  ).length;
}

export function MovementReview({
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
  const [review, setReview] = useState(""),
    [reviewNote, setReviewNote] = useState(""),
    [reviewVerified, setReviewVerified] = useState(false),
    [showAll, setShowAll] = useState(false);
  const movements = state.movements.filter((m) => m.patientId === p.id),
    latest = movements.at(-1);

  return (
    <div className="pt-movements">
      <h3 className="pt-sub-title">Repositioning monitoring</h3>
      <p className="pt-caution">
        Orientation observations do not confirm repositioning or pressure relief.
      </p>
      <div className="pt-regions">
        <SensorRegion state={state} patientId={p.id} region="UPPER_TORSO" latest={latest} />
        <SensorRegion state={state} patientId={p.id} region="PELVIS" latest={latest} />
      </div>
      <details className="pt-details">
        <summary>Sensor history</summary>
        <SensorEvidence patientId={p.id} revision={state.serverTime} />
      </details>
      {!movements.length && (
        <p className="pt-quiet">No movements yet</p>
      )}
      <ul className="pt-movement-list">
        {movements
          .slice(showAll ? 0 : -4)
          .reverse()
          .map((m) => (
            <li className="pt-movement" key={m.id}>
              <div className="pt-movement-head">
                <strong>{words(m.classification).replace(/^./, (c) => c.toUpperCase())}</strong>
                <time dateTime={m.capturedAt}>{clock(m.capturedAt)}</time>
              </div>
              <p className="pt-quiet">
                Sensor · {words(m.quality)} · {words(m.verificationStatus)}
              </p>
              {m.reviewRequired && (
                <p className="pt-flag">Review required: {m.reviewReasonCodes?.map(words).join(" / ")}</p>
              )}
              <details className="pt-details">
                <summary>Sensor observation details</summary>
                <small>
                  Chest {m.chestBefore}° → {m.chestAfter}° · Pelvis {m.pelvisBefore}° → {m.pelvisAfter}° · Source
                  samples: {m.sampleIds.length}
                  <br />
                  Torso source: {m.chestSensorId ?? "Unavailable"} · Pelvis source: {m.pelvisSensorId ?? "Unavailable"}
                  <br />
                  Heuristic confidence:{" "}
                  {m.confidence == null ? "Unavailable" : `${Math.round(m.confidence * 100)}% (simulation only)`}
                </small>
              </details>
              {m.verificationStatus !== "CONFIRMED_CARE" && (
                <div className="pt-actions">
                  <button
                    type="button"
                    className="ach-button"
                    onClick={() => {
                      setReview(m.id);
                      setReviewNote("");
                      setReviewVerified(false);
                    }}
                  >
                    Review candidate
                  </button>
                  <button
                    type="button"
                    className="ach-button secondary"
                    disabled={busy}
                    onClick={() => void mutate(`/movements/${m.id}/review`, { status: "NOT_CARE" }).catch(() => {})}
                  >
                    Not care
                  </button>
                  <button
                    type="button"
                    className="ach-button secondary"
                    disabled={busy}
                    onClick={() =>
                      void mutate(`/movements/${m.id}/review`, { status: "NEEDS_REVIEW" }).catch(() => {})
                    }
                  >
                    Needs review
                  </button>
                </div>
              )}
              {review === m.id && (
                <form
                  className="pt-review-form"
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
                  <h4>Sensor review</h4>
                  <p className="pt-quiet">
                    {p.name} · Room {p.room} · {clock(m.capturedAt)}
                  </p>
                  <label className="pt-field">
                    <span>Bedside verification note</span>
                    <textarea
                      required
                      value={reviewNote}
                      onChange={(e) => setReviewNote(e.target.value)}
                      placeholder="Describe the care you personally verified"
                    />
                  </label>
                  <label className="pt-check">
                    <input
                      type="checkbox"
                      checked={reviewVerified}
                      required
                      onChange={(e) => setReviewVerified(e.target.checked)}
                    />
                    <span>I verified actual care, beyond the sensor observation.</span>
                  </label>
                  <button className="ach-button" disabled={busy || !reviewVerified || !reviewNote.trim()}>
                    Confirm care observation
                  </button>
                </form>
              )}
            </li>
          ))}
      </ul>
      {movements.length > 4 && (
        <button type="button" className="pt-text-button" onClick={() => setShowAll(!showAll)}>
          {showAll ? "Show latest four movements" : `Show all ${movements.length} movements`}
        </button>
      )}
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
  const device = state.devices?.find((d) => d.patientId === patientId && d.bodyRegion === region);
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
    (latest?.sampleIds.some((id) => id.endsWith(region === "PELVIS" ? "-pelvis" : "-chest"))
      ? region === "PELVIS"
        ? latest.pelvisAfter
        : latest.chestAfter
      : undefined);
  const captured = sample?.capturedAt ?? latest?.capturedAt;
  return (
    <div className={`pt-region${disconnected ? " is-off" : ""}`}>
      <strong>{region === "PELVIS" ? "Pelvis" : "Upper torso"}</strong>
      <span className="pt-region-value">
        {disconnected ? "Unknown / disconnected" : angle === undefined ? "No observation" : `${angle}°`}
      </span>
      <small>{disconnected ? "" : captured ? clock(captured) : ""}</small>
    </div>
  );
}
