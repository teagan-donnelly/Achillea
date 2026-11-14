import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { patientReturnState } from "./navigation-context";
import type { ActivityItem, Event, Patient, State } from "./types";
import { time, words } from "./api";
import { EventTimeline } from "./EventTimeline";

export function BackendActivity({
  items,
  events,
  patients,
  state,
}: {
  items: ActivityItem[];
  events: Event[];
  patients: Patient[];
  state: State;
}) {
  const [original, setOriginal] = useState(false);
  const location = useLocation();
  return (
    <>
      <label className="timeline-grouping">
        <input
          type="checkbox"
          checked={original}
          onChange={(e) => setOriginal(e.target.checked)}
        />
        Show original event history
      </label>
      {original ? (
        <EventTimeline
          events={events}
          patients={patients}
          defaultGrouped={false}
        />
      ) : (
        <div className="event-timeline" aria-label="Backend activity summaries">
          {items.map((item) => {
            const patient = patients.find((p) => p.id === item.patientId);
            return (
              <article
                className="event-row workflow backend-summary"
                key={item.id}
              >
                <div>
                  <small>{words(item.category)}</small>
                  <strong>{item.summary}</strong>
                  <p>
                    {patient
                      ? `${patient.name} / Room ${patient.room}`
                      : "Demo environment"}
                  </p>
                  <small>
                    {time(item.startedAt)} – {time(item.timestamp)} /{" "}
                    {item.sourceId ?? "Source unavailable"}
                  </small>
                  {patient && (
                    <Link
                      state={patientReturnState(location)}
                      className="text-link"
                      to={`/patients/${patient.id}?section=${item.category === "DOCUMENTATION" ? "chart" : item.category === "SENSOR_REVIEW" ? "sensors" : item.category === "TASK_ATTENTION" ? "tasks" : "vitals"}`}
                    >
                      View patient record
                    </Link>
                  )}
                  <details>
                    <summary>View source evidence</summary>
                    {item.measurementIds.map((id) => {
                      const vital = state.vitals.find((v) => v.id === id);
                      return (
                        <p key={id}>
                          {vital
                            ? `${words(vital.metric)}: ${vital.value} ${vital.unit} / ${words(vital.quality)} / observed ${time(vital.observedAt)}`
                            : "Historical measurement"}
                          <br />
                          <small>Measurement ID: {id}</small>
                        </p>
                      );
                    })}
                    {item.rawEventIds.map((id) => (
                      <p key={id}>
                        <small>Event ID: {id}</small>
                      </p>
                    ))}
                    {item.sourceEventIds.length > 0 && (
                      <small>
                        Source observation IDs: {item.sourceEventIds.join(", ")}
                      </small>
                    )}
                  </details>
                </div>
                <time dateTime={item.timestamp}>{time(item.timestamp)}</time>
              </article>
            );
          })}
          {!items.length && (
            <p className="empty">No recorded activity in this view.</p>
          )}
        </div>
      )}
    </>
  );
}
