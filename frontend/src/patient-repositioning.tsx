// Repositioning in the patient record: one status row, and a sheet for the nurse's turn review.
// The confirmation workflow matches RepositioningDetail: the backend persists the nurse-verified
// confirmation (POST /patients/{id}/repositioning/confirm) or the movement review before the
// schedule changes. Sensor movement alone never confirms care.
import { useCallback, useState } from "react";
import { ChevronRight } from "lucide-react";
import type { Patient, State } from "./types";
import type { Mutate } from "./app-context";
import { words } from "./api";
import { deadlineText, repositioningStatus } from "./repositioning";
import { BottomSheet } from "./ui";
import { clock, stamp } from "./patient-data";

export function RepositioningRow({
  state,
  patient: p,
  mutate,
  busy,
  now,
}: {
  state: State;
  patient: Patient;
  mutate: Mutate;
  busy: boolean;
  now: number;
}) {
  const s = repositioningStatus(state, p, now);
  const [open, setOpen] = useState(false),
    [note, setNote] = useState(""),
    [verified, setVerified] = useState(false),
    [outcome, setOutcome] = useState("CONFIRMED_CARE"),
    [error, setError] = useState(""),
    [movementId, setMovementId] = useState("");
  const close = useCallback(() => setOpen(false), []);
  const movements = state.movements
    .filter((m) => m.patientId === p.id)
    .sort((a, b) => Date.parse(b.capturedAt) - Date.parse(a.capturedAt));
  const selected = movements.find((m) => m.id === (movementId || s.latest?.id));
  const status = Number.isFinite(s.due) ? deadlineText(s.due, now).replace(/^Due in/, "in") : "No schedule";
  const tone = s.schedule === "OVERDUE" ? "red" : s.schedule === "DUE_SOON" ? "amber" : null;

  async function confirm() {
    if (!selected) return;
    setError("");
    try {
      await mutate(
        outcome === "CONFIRMED_CARE" ? `/patients/${p.id}/repositioning/confirm` : `/movements/${selected.id}/review`,
        { movementId: selected.id, status: outcome, text: note, verified },
      );
      setOpen(false);
      setVerified(false);
      setNote("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save review");
    }
  }

  return (
    <>
      <button
        type="button"
        className="pt-line-row"
        aria-label={`Repositioning, ${s.schedule === "OVERDUE" ? deadlineText(s.due, now) : status}`}
        onClick={() => setOpen(true)}
      >
        <span className="pt-line-label">Repositioning</span>
        <span className={`pt-line-value${tone ? ` tone-${tone}` : ""}`}>
          {tone && <span className={`pt-dot tone-${tone === "red" ? "alert" : "warning"}`} aria-hidden />}
          {status}
        </span>
        <ChevronRight className="ach-chevron" aria-hidden strokeWidth={2} />
      </button>
      <BottomSheet open={open} onClose={close} title="Repositioning">
        <div className="pt-turn">
          <dl className="pt-facts">
            <div>
              <dt>Next turn</dt>
              <dd className={tone ? `tone-${tone}` : undefined}>
                {Number.isFinite(s.due) ? deadlineText(s.due, now) : "No schedule"}
              </dd>
            </div>
            {s.plan && (
              <div>
                <dt>Interval</dt>
                <dd>Every {s.plan.intervalMinutes} min</dd>
              </div>
            )}
            <div className="is-wide">
              <dt>Last confirmed turn</dt>
              <dd>{s.plan?.lastConfirmedCareAt ? stamp(s.plan.lastConfirmedCareAt, now) : "None yet"}</dd>
            </div>
          </dl>
          {s.plan && movements.length > 0 ? (
            <section className="pt-turn-review" aria-label="Repositioning Review">
              <h3 className="pt-sub-title">Review & document turn</h3>
              <label className="pt-field">
                <span>Movement to review</span>
                <select
                  value={selected?.id ?? ""}
                  onChange={(e) => {
                    setMovementId(e.target.value);
                    setVerified(false);
                  }}
                >
                  {movements.map((m) => (
                    <option key={m.id} value={m.id}>
                      {clock(m.capturedAt)} · {words(m.classification)} · {words(m.verificationStatus)}
                    </option>
                  ))}
                </select>
              </label>
              {selected && (
                <p className="pt-quiet">
                  Chest {selected.chestBefore}° → {selected.chestAfter}° · Pelvis {selected.pelvisBefore}° →{" "}
                  {selected.pelvisAfter}°
                </p>
              )}
              <label className="pt-field">
                <span>Nurse review</span>
                <select
                  value={outcome}
                  onChange={(e) => {
                    setOutcome(e.target.value);
                    setVerified(false);
                  }}
                >
                  <option value="CONFIRMED_CARE">Repositioning completed</option>
                  <option value="NOT_CARE">Movement observed, not a qualifying turn</option>
                  <option value="NEEDS_REVIEW">Unable to verify / further review</option>
                </select>
              </label>
              <label className="pt-field">
                <span>Bedside observation</span>
                <textarea
                  maxLength={5000}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Document what you personally verified"
                />
              </label>
              {outcome === "CONFIRMED_CARE" && (
                <label className="pt-check">
                  <input type="checkbox" checked={verified} onChange={(e) => setVerified(e.target.checked)} />
                  <span>I verified the turn at the bedside. Sensor movement alone does not confirm care.</span>
                </label>
              )}
              {error && <p role="alert">{error}</p>}
              <button
                type="button"
                className="ach-button"
                disabled={
                  busy ||
                  !selected ||
                  selected.verificationStatus === "CONFIRMED_CARE" ||
                  (outcome === "CONFIRMED_CARE" && (!verified || !note.trim()))
                }
                onClick={() => void confirm()}
              >
                {outcome === "CONFIRMED_CARE" ? "Confirm & document" : "Save nurse review"}
              </button>
            </section>
          ) : (
            <p className="pt-quiet">No movements to review</p>
          )}
        </div>
      </BottomSheet>
    </>
  );
}
