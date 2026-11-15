import { useRef, useState } from "react";
import type { Patient } from "./types";
import type { Mutate } from "./TaskList";

export function ScheduleReview({
  patients,
  mutate,
  busy,
  bare = false,
  onScheduled,
  initialPatientId,
  now,
}: {
  patients: Patient[];
  mutate: Mutate;
  busy: boolean;
  /** Render only the form (e.g. inside a BottomSheet) instead of a disclosure. */
  bare?: boolean;
  onScheduled?: () => void;
  initialPatientId?: string;
  now?: number;
}) {
  const [patientId, setPatientId] = useState(() =>
      patients.some((p) => p.id === initialPatientId)
        ? initialPatientId!
        : patients.length === 1
          ? patients[0]!.id
          : "",
    ),
    [title, setTitle] = useState(""),
    [due, setDue] = useState(""),
    [priority, setPriority] = useState("ROUTINE"),
    [error, setError] = useState(""),
    [saving, setSaving] = useState(false);
  const inFlight = useRef(false);
  const pending = busy || saving;
  function chooseTime(minutes: number) {
    const date = new Date((now ?? Date.now()) + minutes * 60_000);
    setDue(
      new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
        .toISOString()
        .slice(0, 16),
    );
    setError("");
  }
  const form = (
    <form
      className={bare ? "schedule-review-form" : undefined}
      aria-busy={pending}
      onSubmit={(e) => {
        e.preventDefault();
        if (pending || inFlight.current) return;
        if (!Number.isFinite(Date.parse(due))) {
          setError("Choose a valid review time.");
          return;
        }
        inFlight.current = true;
        setSaving(true);
        setError("");
        void mutate("/demo/tasks", {
          patientId,
          title: title.trim(),
          dueAt: new Date(due).toISOString(),
          priority,
        })
          .then(() => {
            setTitle("");
            setDue("");
            setError("");
            onScheduled?.();
          })
          .catch((e) =>
            setError(
              e instanceof Error
                ? e.message
                : "Scheduling failed; your input is retained",
            ),
          )
          .finally(() => {
            inFlight.current = false;
            setSaving(false);
          });
      }}
    >
      {!bare && (
        <p>
          Educational workflow scheduling only. Priority is explicit, not a
          clinical risk score.
        </p>
      )}
      <label>
        Assigned patient
        <select
          required
          disabled={pending}
          value={patientId}
          onChange={(e) => setPatientId(e.target.value)}
        >
          <option value="">Choose a patient</option>
          {patients.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} / Room {p.room}
            </option>
          ))}
        </select>
      </label>
      <label>
        Review title
        <input
          required
          disabled={pending}
          maxLength={200}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </label>
      <label>
        Review time (local)
        <input
          required
          disabled={pending}
          type="datetime-local"
          value={due}
          onChange={(e) => setDue(e.target.value)}
        />
      </label>
      <div
        className="tk-time-shortcuts"
        role="group"
        aria-label="Choose review time"
      >
        {[15, 30, 60].map((minutes) => (
          <button
            type="button"
            key={minutes}
            disabled={pending}
            onClick={() => chooseTime(minutes)}
          >
            In {minutes === 60 ? "1 hour" : `${minutes} min`}
          </button>
        ))}
      </div>
      <label>
        Workflow priority
        <select
          value={priority}
          disabled={pending}
          onChange={(e) => setPriority(e.target.value)}
        >
          <option value="ROUTINE">Routine</option>
          <option value="TIMELY">Timely</option>
          <option value="HIGH">Explicit high priority</option>
        </select>
      </label>
      {error && <p role="alert">{error}</p>}
      <button disabled={pending || !patientId || !title.trim() || !due}>
        {pending ? "Scheduling..." : "Schedule review"}
      </button>
    </form>
  );
  if (bare) return form;
  return (
    <details className="schedule-review">
      <summary>Schedule a synthetic review</summary>
      {form}
    </details>
  );
}
