import { useState } from "react";
import type { Patient } from "./types";
import type { Mutate } from "./TaskList";

export function ScheduleReview({
  patients,
  mutate,
  busy,
}: {
  patients: Patient[];
  mutate: Mutate;
  busy: boolean;
}) {
  const [patientId, setPatientId] = useState(""),
    [title, setTitle] = useState(""),
    [due, setDue] = useState(""),
    [priority, setPriority] = useState("ROUTINE"),
    [error, setError] = useState("");
  return (
    <details className="schedule-review">
      <summary>Schedule a synthetic review</summary>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!Number.isFinite(Date.parse(due))) {
            setError("Choose a valid review time.");
            return;
          }
          void mutate("/demo/tasks", {
            patientId,
            title,
            dueAt: new Date(due).toISOString(),
            priority,
          })
            .then(() => {
              setTitle("");
              setDue("");
              setError("");
            })
            .catch((e) =>
              setError(
                e instanceof Error
                  ? e.message
                  : "Scheduling failed; your input is retained",
              ),
            );
        }}
      >
        <p>
          Educational workflow scheduling only. Priority is explicit, not a
          clinical risk score.
        </p>
        <label>
          Assigned patient
          <select
            required
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
            maxLength={200}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <label>
          Review time (local)
          <input
            required
            type="datetime-local"
            value={due}
            onChange={(e) => setDue(e.target.value)}
          />
        </label>
        <label>
          Workflow priority
          <select
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
          >
            <option value="ROUTINE">Routine</option>
            <option value="TIMELY">Timely</option>
            <option value="HIGH">Explicit high priority</option>
          </select>
        </label>
        {error && <p role="alert">{error}</p>}
        <button disabled={busy || !patientId || !title.trim() || !due}>
          Schedule review
        </button>
      </form>
    </details>
  );
}
