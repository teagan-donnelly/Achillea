import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { Activity, ArrowUp, ChevronRight, FileText } from "lucide-react";
import { BottomSheet, Pill, Segmented } from "./ui";
import type { Mutate } from "./TaskList";
import type { Round, State, Task } from "./types";
import { patientReturnState } from "./navigation-context";
import {
  clock,
  confirmedMovements,
  displayTitle,
  plainReason,
  hasSensorEvidence,
  patientLine,
  patientOf,
  relativeDue,
  sentence,
  staffName,
  taskGroup,
} from "./task-model";

export type SheetMode = "details" | "complete" | "defer";

const PRIORITIES = [
  { value: "ROUTINE", label: "Routine" },
  { value: "TIMELY", label: "Timely" },
  { value: "HIGH", label: "High" },
] as const;

function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="tk-info-row">
      <span className="tk-info-label">{label}</span>
      <span className="tk-info-value">{children}</span>
    </div>
  );
}

/**
 * Task detail sheet: context from real task fields plus only the actions the backend supports
 * (acknowledge, defer, priority, reorder, complete). Completion always needs explicit bedside
 * verification; repositioning tasks also need a previously nurse-confirmed movement.
 */
export function TaskSheet({
  task,
  round,
  state,
  rounds,
  mutate,
  busy,
  now,
  mode,
  onMode,
  onClose,
}: {
  task: Task | undefined;
  round?: Round;
  state: State;
  rounds: Round[];
  mutate: Mutate;
  busy: boolean;
  now: number;
  mode: SheetMode;
  onMode: (mode: SheetMode) => void;
  onClose: () => void;
}) {
  const location = useLocation();
  const [error, setError] = useState(""),
    [reason, setReason] = useState(""),
    [verified, setVerified] = useState(false),
    [movementId, setMovementId] = useState(""),
    [note, setNote] = useState(""),
    [saving, setSaving] = useState(false);
  const inFlight = useRef(false);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const pending = busy || saving;
  const formRef = useRef<HTMLFormElement>(null);
  const taskId = task?.id;
  useEffect(() => {
    setError("");
    setReason("");
    setVerified(false);
    setMovementId("");
    setNote("");
  }, [taskId]);
  useEffect(() => {
    // A canceled review must not leave the next completion pre-verified.
    setVerified(false);
    setMovementId("");
  }, [mode]);
  useEffect(() => {
    if (mode !== "details") {
      formRef.current?.scrollIntoView?.({ block: "nearest" });
      formRef.current
        ?.querySelector<HTMLElement>(
          mode === "defer" ? "textarea" : 'select,input[type="checkbox"]',
        )
        ?.focus({ preventScroll: true });
    }
  }, [mode]);
  useEffect(() => {
    if (error) {
      errorRef.current?.focus();
      errorRef.current?.scrollIntoView?.({ block: "nearest" });
    }
  }, [error]);

  if (!task) return null;
  const t = task;
  const done = t.status === "COMPLETED";
  const patient = patientOf(state, t.patientId);
  const group = done ? null : taskGroup(t, now);
  const movement = t.relatedMovementId
    ? state.movements.find((m) => m.id === t.relatedMovementId)
    : undefined;
  const device = t.relatedDeviceId
    ? state.devices?.find((d) => d.id === t.relatedDeviceId)
    : undefined;
  const chart = done
    ? state.charts.find((c) => c.linkedTaskId === t.id && c.status !== "DRAFT")
    : undefined;
  const options = confirmedMovements(state, t);
  const canReorder = round?.rank === 3;
  const back = patientReturnState(location);

  async function run(action: string, body: unknown, close: boolean) {
    if (pending || inFlight.current) return;
    inFlight.current = true;
    setSaving(true);
    setError("");
    try {
      await mutate(`/tasks/${t.id}/${action}`, body);
      if (close) onClose();
      else onMode("details");
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "The action could not be saved.",
      );
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }

  function canLeave() {
    return (
      !pending &&
      (!(note.trim() || reason.trim()) ||
        window.confirm(
          "Leave this task without saving your note or deferral reason?",
        ))
    );
  }
  function closeReview() {
    if (canLeave()) onClose();
  }

  const dueText = done
    ? t.completedAt
      ? clock(t.completedAt, now)
      : "—"
    : `${clock(t.dueAt, now)} · ${relativeDue(t.dueAt, now)}`;

  const footer = done ? undefined : mode === "complete" ? (
    <>
      <button
        type="button"
        className="ach-button secondary tk-cancel"
        disabled={pending}
        onClick={() => onMode("details")}
      >
        Cancel
      </button>
      <button
        type="submit"
        form="tk-complete-form"
        className="ach-button"
        disabled={
          pending || !verified || (t.verificationRequired && !movementId)
        }
      >
        Confirm completion
      </button>
    </>
  ) : mode === "defer" ? (
    <>
      <button
        type="button"
        className="ach-button secondary tk-cancel"
        disabled={pending}
        onClick={() => onMode("details")}
      >
        Cancel
      </button>
      <button
        type="submit"
        form="tk-defer-form"
        className="ach-button"
        disabled={pending || !reason.trim()}
      >
        Save deferral
      </button>
    </>
  ) : (
    <div className="tk-footer-stack">
      <div className="tk-quiet-actions">
        <button
          type="button"
          className="tk-quiet"
          disabled={pending || t.status === "ACKNOWLEDGED"}
          onClick={() => void run("acknowledge", {}, false)}
        >
          {t.status === "ACKNOWLEDGED" ? "Reviewed" : "Acknowledge"}
        </button>
        <button
          type="button"
          className="tk-quiet"
          disabled={pending}
          onClick={() => {
            setError("");
            onMode("defer");
          }}
        >
          Defer
        </button>
      </div>
      <button
        type="button"
        className="ach-button tk-primary"
        disabled={pending}
        onClick={() => {
          setError("");
          onMode("complete");
        }}
      >
        Complete
      </button>
    </div>
  );

  return (
    <BottomSheet
      open
      onClose={closeReview}
      title={displayTitle(t)}
      footer={footer}
    >
      <div
        className="tk-sheet"
        aria-busy={pending}
        onClickCapture={(event) => {
          if ((event.target as HTMLElement).closest("a") && !canLeave())
            event.preventDefault();
        }}
      >
        {saving && (
          <p className="tk-saving" role="status">
            Saving to the patient record...
          </p>
        )}
        {(t.status === "ACKNOWLEDGED" || t.status === "DEFERRED") && (
          <div className="tk-sheet-pills">
            <Pill>{t.status === "ACKNOWLEDGED" ? "Reviewed" : "Deferred"}</Pill>
          </div>
        )}

        <div className="tk-info">
          <Link
            className="tk-info-row tk-info-link"
            to={`/patients/${t.patientId}?section=tasks#task-${t.id}`}
            state={back}
            aria-label={`Open bedside workspace, ${patientLine(patient)}`}
          >
            <span className="tk-info-label">Patient</span>
            <span className="tk-info-value">
              {patientLine(patient)}
              <ChevronRight aria-hidden strokeWidth={2} />
            </span>
          </Link>
          <InfoRow label={done ? "Completed" : "Due"}>
            <span className={group === "OVERDUE" ? "tk-overdue" : undefined}>
              {dueText}
            </span>
          </InfoRow>
          {done && t.verifiedBy && (
            <InfoRow label="Verified by">{staffName(t.verifiedBy)}</InfoRow>
          )}
          <InfoRow label={done ? "Documentation" : "Requires"}>
            {done
              ? chart
                ? "Chart entry filed"
                : "Task history"
              : t.verificationRequired
                ? "Verification + confirmed movement"
                : "Bedside verification"}
          </InfoRow>
        </div>

        {!done && mode === "details" && plainReason(round?.reason) && (
          <p className="tk-context">{plainReason(round?.reason)}</p>
        )}

        {t.deferReason && mode === "details" && (
          <section className="tk-block">
            <h3>Deferred</h3>
            <p>{t.deferReason}</p>
          </section>
        )}

        {chart && (
          <section className="tk-block">
            <h3>Chart entry</h3>
            <p>{chart.text}</p>
          </section>
        )}

        {mode === "details" && (movement || device || hasSensorEvidence(t)) && (
          <section className="tk-block">
            <h3>Sensors</h3>
            {movement && (
              <p>
                {sentence(movement.classification)} movement ·{" "}
                {clock(movement.capturedAt, now)} ·{" "}
                {sentence(movement.verificationStatus)}
              </p>
            )}
            {device && (
              <p>
                {sentence(device.bodyRegion)} sensor ·{" "}
                {sentence(device.connectionState)}
              </p>
            )}
            <Link className="tk-link" to={`/monitoring/${t.patientId}`}>
              <Activity aria-hidden strokeWidth={2} /> Review sensor evidence
            </Link>
          </section>
        )}

        {!done && mode === "details" && (
          <section className="tk-block">
            <h3>Priority</h3>
            <Segmented
              label={`Set priority for ${displayTitle(t)}`}
              value={t.priority}
              onChange={(next) => {
                if (!pending && next !== t.priority)
                  void run("priority", { priority: next }, false);
              }}
              options={PRIORITIES.map((p) => ({
                value: p.value,
                label: p.label,
              }))}
            />
          </section>
        )}

        {!done && mode === "details" && (
          <div className="tk-sheet-links">
            <Link
              className="tk-action-row"
              to={`/patients/${t.patientId}?section=chart&task=${t.id}`}
              state={back}
            >
              <FileText aria-hidden strokeWidth={1.75} />
              <span>Document</span>
              <ChevronRight className="tk-chev" aria-hidden strokeWidth={2} />
            </Link>
            {canReorder && (
              <button
                type="button"
                className="tk-action-row"
                aria-label={`Move ${t.title} earlier`}
                disabled={pending}
                onClick={() =>
                  void run(
                    "reorder",
                    { order: Math.min(...rounds.map((r) => r.task.order)) - 1 },
                    false,
                  )
                }
              >
                <ArrowUp aria-hidden strokeWidth={1.75} />
                <span>Move earlier in sequence</span>
              </button>
            )}
          </div>
        )}

        {done && (
          <div className="tk-sheet-links">
            <Link
              className="tk-action-row"
              to={`/patients/${t.patientId}?section=chart`}
              state={back}
            >
              <FileText aria-hidden strokeWidth={1.75} />
              <span>Open chart</span>
              <ChevronRight className="tk-chev" aria-hidden strokeWidth={2} />
            </Link>
          </div>
        )}

        {!done && mode === "complete" && (
          <form
            id="tk-complete-form"
            ref={formRef}
            className="tk-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (!verified || (t.verificationRequired && !movementId)) return;
              void run(
                "complete",
                note.trim()
                  ? {
                      verified,
                      movementId: movementId || null,
                      text: note.trim(),
                    }
                  : { verified, movementId: movementId || null },
                true,
              );
            }}
          >
            <p className="tk-context tk-completion-hint">
              Completion records this care in the chart. Add a note here if
              needed.
            </p>
            {t.verificationRequired && (
              <label className="tk-field">
                <span>Previously nurse-confirmed movement</span>
                <select
                  disabled={pending}
                  required
                  value={movementId}
                  onChange={(e) => setMovementId(e.target.value)}
                >
                  <option value="">Select confirmed care</option>
                  {options.map((m) => (
                    <option key={m.id} value={m.id}>
                      {sentence(m.classification)} · {clock(m.capturedAt, now)}
                    </option>
                  ))}
                </select>
                {!options.length && (
                  <small>
                    No confirmed movement available. Review the movement and
                    document bedside care first.
                  </small>
                )}
              </label>
            )}
            {t.verificationRequired && !options.length && (
              <Link
                className="tk-link"
                to={`/patients/${t.patientId}?section=repositioning`}
                state={back}
              >
                Review movement and bedside care
                <ChevronRight aria-hidden strokeWidth={2} />
              </Link>
            )}
            <label className="tk-field">
              <span>Note (optional)</span>
              <textarea
                disabled={pending}
                maxLength={5000}
                value={note}
                placeholder="Add a bedside note"
                onChange={(e) => setNote(e.target.value)}
              />
            </label>
            <label className="tk-check">
              <input
                disabled={pending}
                type="checkbox"
                required
                checked={verified}
                onChange={(e) => setVerified(e.target.checked)}
              />
              <span>I verified this care at the bedside</span>
            </label>
          </form>
        )}

        {!done && mode === "defer" && (
          <form
            id="tk-defer-form"
            ref={formRef}
            className="tk-form"
            onSubmit={(e) => {
              e.preventDefault();
              void run("defer", { reason }, true);
            }}
          >
            <p className="tk-context">
              Review will be due 30 minutes after saving.
            </p>
            <label className="tk-field">
              <span>Reason for deferral</span>
              <textarea
                disabled={pending}
                required
                maxLength={1000}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
          </form>
        )}

        {error && (
          <p ref={errorRef} className="tk-error" role="alert" tabIndex={-1}>
            {error}
          </p>
        )}
      </div>
    </BottomSheet>
  );
}

/** A patient's sensor checks (one backend task per sensor); each opens the normal task sheet. */
export function SensorGroupSheet({
  rounds,
  state,
  now,
  onOpenTask,
  onClose,
}: {
  rounds: Round[];
  state: State;
  now: number;
  onOpenTask: (taskId: string) => void;
  onClose: () => void;
}) {
  const first = rounds[0];
  if (!first) return null;
  const patientId = first.task.patientId;
  return (
    <BottomSheet open onClose={onClose} title="Check sensors">
      <div className="tk-sheet">
        <div className="tk-info">
          <div className="tk-info-row">
            <span className="tk-info-label">Patient</span>
            <span className="tk-info-value">
              {patientLine(patientOf(state, patientId))}
            </span>
          </div>
        </div>
        <ul className="tk-sheet-links" aria-label="Sensors">
          {rounds.map(({ task }) => {
            const device = task.relatedDeviceId
              ? state.devices?.find((d) => d.id === task.relatedDeviceId)
              : undefined;
            const overdue = Date.parse(task.dueAt) < now - 60_000;
            return (
              <li key={task.id}>
                <button
                  type="button"
                  className="tk-action-row"
                  onClick={() => onOpenTask(task.id)}
                >
                  <span>
                    {device
                      ? `${sentence(device.bodyRegion)} sensor`
                      : displayTitle(task)}
                    <small>
                      {device ? `${sentence(device.connectionState)} · ` : ""}
                      <time className={overdue ? "tk-overdue" : undefined}>
                        {clock(task.dueAt, now)}
                      </time>
                    </small>
                  </span>
                  <ChevronRight
                    className="tk-chev"
                    aria-hidden
                    strokeWidth={2}
                  />
                </button>
              </li>
            );
          })}
        </ul>
        <Link className="tk-link" to={`/monitoring/${patientId}`}>
          <Activity aria-hidden strokeWidth={2} /> Review sensor evidence
        </Link>
      </div>
    </BottomSheet>
  );
}
