import { Link } from "react-router-dom";
import {
  Activity,
  CheckCircle,
  ClipboardList,
  HeartPulse,
  Radio,
} from "lucide-react";
import type { Event, Patient } from "./types";
import { time, words } from "./api";
export function EventTimeline({
  events,
  patients,
}: {
  events: Event[];
  patients: Patient[];
}) {
  const sorted = events
    .slice()
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
  let previous = "";
  return (
    <div className="event-timeline">
      {sorted.map((e) => {
        const day = new Date(e.timestamp).toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
            year: "numeric",
          }),
          showDay = day !== previous;
        previous = day;
        const p = patients.find((p) => p.id === e.patientId),
          done =
            /chart\.confirmed|task\.complete/.test(e.type) ||
            (e.type === "movement.reviewed" &&
              e.details.startsWith("CONFIRMED_CARE")),
          monitor = /^(vital|movement|device)/.test(e.type),
          Icon = done
            ? CheckCircle
            : e.type.startsWith("chart")
              ? ClipboardList
              : e.type.startsWith("vital")
                ? HeartPulse
                : e.type.startsWith("movement")
                  ? Radio
                  : Activity;
        return (
          <div key={e.id}>
            {showDay && <h3 className="timeline-date">{day}</h3>}
            <article
              className={`event-row ${done ? "documented" : monitor ? "observed" : "workflow"}`}
            >
              <span className="event-icon">
                <Icon size={18} />
              </span>
              <div>
                <span className="event-category">
                  {done
                    ? "Recorded action"
                    : monitor
                      ? "Device observation"
                      : "Workflow event"}
                </span>
                <strong>{words(e.type.replaceAll(".", " "))}</strong>
                <p>{e.details}</p>
                <small>
                  {p ? `${p.name} · Room ${p.room}` : "Demo environment"} ·{" "}
                  {words(e.source)}
                </small>
                {p && (
                  <Link
                    className="text-link"
                    to={`/patients/${p.id}?section=${e.type.startsWith("chart") ? "chart" : e.type.startsWith("movement") ? "sensors" : e.type.startsWith("task") ? "tasks" : "overview"}`}
                  >
                    View{" "}
                    {e.type.startsWith("chart") ? "documentation" : "patient"} →
                  </Link>
                )}
              </div>
              <time dateTime={e.timestamp}>{time(e.timestamp)}</time>
            </article>
          </div>
        );
      })}
      {!sorted.length && (
        <div className="empty">
          <Activity size={24} />
          <h3>No recorded activity in this view</h3>
          <p>
            Monitor observations, task actions and confirmed documentation will
            appear here after the server records them.
          </p>
        </div>
      )}
    </div>
  );
}
