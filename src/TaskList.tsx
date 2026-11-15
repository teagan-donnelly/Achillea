import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { patientReturnState } from "./navigation-context";
import { ArrowUp, Check, Clock } from "lucide-react";
import type { Round, State, Chart, Task } from "./types";
import { time, words } from "./api";
import { RoundReasons } from "./RoundReasons";
export type Mutate = (
  path: string,
  body?: unknown,
  method?: string,
) => Promise<Chart | State | Task>;
export function TaskList({
  rounds,
  state,
  mutate,
  busy,
  compact = false,
}: {
  rounds: Round[];
  state: State;
  mutate: Mutate;
  busy: boolean;
  compact?: boolean;
}) {
  const location = useLocation();
  const [active, setActive] = useState(""),
    [reason, setReason] = useState(""),
    [verified, setVerified] = useState(false),
    [movementId, setMovementId] = useState("");
  async function run(id: string, action: string, body: unknown = {}) {
    try {
      await mutate(`/tasks/${id}/${action}`, body);
      setActive("");
      setReason("");
      setVerified(false);
    } catch {
      /* Feedback is displayed by the app. */
    }
  }
  return (
    <div className="task-list" data-no-swipe>
      {!rounds.length && (
        <div className="empty">
          <Check size={24} />
          <h3>All caught up.</h3>
          <p>No active tasks for this unit.</p>
        </div>
      )}
      {rounds.map(({ task: t, reason: why, rank, reasonCodes }) => (
        <article
          className={`task ${rank === 0 ? "high" : ""}`}
          key={t.id}
          id={`task-${t.id}`}
        >
          <div className="task-top">
            <span className={`status ${rank <= 1 ? "attention" : ""}`}>
              <Clock size={13} />
              {rank === 0 ? "Review requested" : words(t.status)}
            </span>
            <time dateTime={t.dueAt}>Due {time(t.dueAt)}</time>
          </div>
          <h3>
            <Link
              state={patientReturnState(location)}
              to={`/patients/${t.patientId}`}
            >
              {t.title}
            </Link>
          </h3>
          <p>
            {state.patients.find((p) => p.id === t.patientId)?.name} · Room{" "}
            {state.patients.find((p) => p.id === t.patientId)?.room}
          </p>
          <small>
            {why} · {words(t.source)}
          </small>
          {t.deferReason && <p>Deferred: {t.deferReason}</p>}
          <RoundReasons codes={reasonCodes} />
          {compact ? (
            <Link className="text-link" to="/rounds">
              Review task →
            </Link>
          ) : (
            <>
              <div className="actions">
                <button
                  className="secondary"
                  disabled={busy || t.status === "ACKNOWLEDGED"}
                  onClick={() => void run(t.id, "acknowledge")}
                >
                  Acknowledge
                </button>
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() => {
                    setActive(t.id + "-defer");
                    setReason("");
                  }}
                >
                  Defer
                </button>
                <button
                  disabled={busy}
                  onClick={() => {
                    setActive(t.id + "-complete");
                    setVerified(false);
                    setMovementId("");
                  }}
                >
                  Complete
                </button>
                <details className="task-options">
                  <summary>More actions</summary>
                  <button
                    className="secondary"
                    aria-label={`Set priority for ${t.title}`}
                    disabled={busy}
                    onClick={() =>
                      void run(t.id, "priority", {
                        priority: t.priority === "HIGH" ? "ROUTINE" : "HIGH",
                      })
                    }
                  >
                    {t.priority === "HIGH"
                      ? "Routine priority"
                      : "Set high priority"}
                  </button>
                  {rank === 3 && (
                    <button
                      className="secondary"
                      aria-label={`Move ${t.title} earlier`}
                      disabled={busy}
                      onClick={() =>
                        void run(t.id, "reorder", {
                          order:
                            Math.min(...rounds.map((r) => r.task.order)) - 1,
                        })
                      }
                    >
                      <ArrowUp size={16} /> Move earlier
                    </button>
                  )}
                </details>
              </div>
              {active === t.id + "-defer" && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void run(t.id, "defer", { reason });
                  }}
                >
                  <label>
                    Reason for deferral
                    <textarea
                      required
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                    />
                  </label>
                  <p>Reschedules this demo task for 30 minutes from now.</p>
                  <button disabled={busy || !reason.trim()}>
                    Save deferral
                  </button>
                </form>
              )}
              {active === t.id + "-complete" && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void run(t.id, "complete", {
                      verified,
                      movementId: movementId || null,
                    });
                  }}
                >
                  {t.verificationRequired && (
                    <label>
                      Previously nurse-confirmed movement
                      <select
                        required
                        value={movementId}
                        onChange={(e) => setMovementId(e.target.value)}
                      >
                        <option value="">Select confirmed care</option>
                        {state.movements
                          .filter(
                            (m) =>
                              m.patientId === t.patientId &&
                              m.verificationStatus === "CONFIRMED_CARE" &&
                              !state.charts.some(
                                (c) =>
                                  c.status !== "DRAFT" &&
                                  c.linkedMovementId === m.id &&
                                  state.tasks.some(
                                    (task) =>
                                      task.id === c.linkedTaskId &&
                                      task.status === "COMPLETED",
                                  ),
                              ),
                          )
                          .map((m) => (
                            <option key={m.id} value={m.id}>
                              {words(m.classification)} · {time(m.capturedAt)}
                            </option>
                          ))}
                      </select>
                      <small>
                        Review a candidate on the patient page before completing
                        this task.
                      </small>
                    </label>
                  )}
                  <label className="checkbox">
                    <input
                      type="checkbox"
                      required
                      checked={verified}
                      onChange={(e) => setVerified(e.target.checked)}
                    />
                    I verified this care at the bedside (synthetic demo).
                  </label>
                  <button
                    disabled={
                      busy ||
                      !verified ||
                      (t.verificationRequired && !movementId)
                    }
                  >
                    Confirm completion
                  </button>
                </form>
              )}
            </>
          )}
        </article>
      ))}
    </div>
  );
}
