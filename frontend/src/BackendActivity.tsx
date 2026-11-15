import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { patientReturnState } from "./navigation-context";
import type { ActivityItem, Event, Patient, State } from "./types";
import { time, words } from "./api";
import { EventTimeline } from "./EventTimeline";
import { Activity, ClipboardList, Radio, CheckCircle } from "lucide-react";

// Preserve backend chronology; only adjacent monitoring summary windows fold together.
export function activityRuns(items: ActivityItem[]): ActivityItem[][] {
  const runs: ActivityItem[][] = [];
  for (const item of items) {
    const last = runs.at(-1);
    if (
      item.category === "MONITORING_SUMMARY" &&
      last?.[0].category === "MONITORING_SUMMARY"
    )
      last.push(item);
    else runs.push([item]);
  }
  return runs;
}
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
  function renderSummary(item: ActivityItem) {
    const patient = patients.find((p) => p.id === item.patientId);
    const Icon =
      item.category === "DOCUMENTATION"
        ? ClipboardList
        : item.category === "DEVICE_STATUS" || item.category === "SENSOR_REVIEW"
          ? Radio
          : item.category === "TASK_ATTENTION"
            ? CheckCircle
            : Activity;
    return (
      <article
        className={
          "event-row workflow backend-summary category-" +
          item.category.toLowerCase().replaceAll("_", "-")
        }
        key={item.id}
      >
        <span className="shift-event-icon">
          <Icon size={17} />
        </span>
        <div>
          <small>{words(item.category)}</small>
          <strong>{item.summary}</strong>
          <p>
            {patient
              ? patient.name + " / Room " + patient.room
              : "Demo environment"}
          </p>
          <small>
            {time(item.startedAt)} – {time(item.timestamp)} · Synthetic source
          </small>
          {patient && (
            <Link
              state={patientReturnState(location)}
              className="text-link"
              to={
                "/patients/" +
                patient.id +
                "?section=" +
                (item.category === "DOCUMENTATION"
                  ? "chart"
                  : item.category === "SENSOR_REVIEW"
                    ? "sensors"
                    : item.category === "TASK_ATTENTION"
                      ? "tasks"
                      : "vitals")
              }
            >
              View patient record
            </Link>
          )}
          <details>
            <summary>View source evidence</summary>
            <p>Source: {item.sourceId ?? "Source unavailable"}</p>
            {item.measurementIds.map((id) => {
              const vital = state.vitals.find((v) => v.id === id);
              return (
                <p key={id}>
                  {vital
                    ? words(vital.metric) +
                      ": " +
                      (vital.quality === "MISSING" ||
                      !Number.isFinite(vital.value)
                        ? "Unavailable"
                        : vital.value) +
                      " " +
                      vital.unit +
                      " / " +
                      words(vital.quality) +
                      " / observed " +
                      time(vital.observedAt)
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
  }
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
          {activityRuns(items).map((run) =>
            run[0].category === "MONITORING_SUMMARY" ? (
              <details className="monitoring-fold" key={run[0].id}>
                <summary>
                  Monitoring receipts -{" "}
                  {run.reduce((sum, item) => sum + item.count, 0)} measurements
                  across {run.length} windows
                </summary>
                {run.map(renderSummary)}
              </details>
            ) : (
              run.map(renderSummary)
            ),
          )}
          {!items.length && (
            <p className="empty">No recorded activity in this view.</p>
          )}
        </div>
      )}
    </>
  );
}
