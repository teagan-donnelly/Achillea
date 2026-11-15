import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { patientReturnState } from "./navigation-context";
import {
  Activity,
  CheckCircle,
  ClipboardList,
  HeartPulse,
  Radio,
} from "lucide-react";
import type { Event, Patient } from "./types";
import { time, words } from "./api";
export interface EventGroup {
  key: string;
  events: Event[];
}
// Only identical monitor receipt descriptions within the same ten-minute window
// are folded. A nursing/device/review event always ends the receipt run.
export function groupReceipts(events: Event[]): EventGroup[] {
  const sorted = events
    .slice()
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
  const groups: EventGroup[] = [];
  let run = new Map<string, EventGroup>();
  let boundary = "start";
  for (const event of sorted) {
    if (event.type !== "vital.received") {
      run = new Map();
      boundary = event.id;
      groups.push({ key: event.id, events: [event] });
      continue;
    }
    const key = JSON.stringify([
        event.patientId,
        event.source,
        event.details,
        Math.floor(Date.parse(event.timestamp) / 600000),
      ]),
      existing = run.get(key);
    if (existing) existing.events.push(event);
    else {
      const group = { key: `receipts-${boundary}-${key}`, events: [event] };
      run.set(key, group);
      groups.push(group);
    }
  }
  return groups;
}
function EventRow({
  event: e,
  patients,
}: {
  event: Event;
  patients: Patient[];
}) {
  const location = useLocation();
  const p = patients.find((p) => p.id === e.patientId),
    done =
      /chart\.confirmed|chart\.amendment|task\.complete/.test(e.type) ||
      (e.type === "movement.reviewed" &&
        e.details.startsWith("CONFIRMED_CARE")),
    device = e.type.startsWith("device"),
    monitor = /^(vital|movement|device)/.test(e.type),
    Icon = done
      ? CheckCircle
      : e.type.startsWith("chart")
        ? ClipboardList
        : e.type.startsWith("vital")
          ? HeartPulse
          : monitor
            ? Radio
            : Activity;
  return (
    <article
      className={`event-row ${done ? "documented" : device ? "device-event" : monitor ? "observed" : "workflow"}`}
    >
      <span className="event-icon">
        <Icon size={18} />
      </span>
      <div>
        <span className="event-category">
          {done
            ? "Recorded confirmation"
            : device
              ? "Device status"
              : e.type.startsWith("movement")
                ? "Sensor observation"
                : monitor
                  ? "Monitor observation"
                  : e.type.startsWith("chart")
                    ? "Documentation"
                    : "Task / workflow"}
        </span>
        <strong>{words(e.type.replaceAll(".", " "))}</strong>
        <p>{e.details}</p>
        <small>
          {p ? `${p.name} / Room ${p.room}` : "Demo environment"} /{" "}
          {words(e.source)}
        </small>
        {p && (
          <Link
            state={patientReturnState(location)}
            className="text-link"
            to={`/patients/${p.id}?section=${e.type.startsWith("chart") ? "chart" : e.type.startsWith("movement") ? "sensors" : device || e.type.startsWith("vital") ? "vitals" : e.type.startsWith("task") ? "tasks" : "overview"}`}
          >
            View {e.type.startsWith("chart") ? "documentation" : "patient"} /
          </Link>
        )}
      </div>
      <time dateTime={e.timestamp}>{time(e.timestamp)}</time>
    </article>
  );
}
export function EventTimeline({
  events,
  patients,
  defaultGrouped = true,
}: {
  events: Event[];
  patients: Patient[];
  defaultGrouped?: boolean;
}) {
  const [grouped, setGrouped] = useState(defaultGrouped);
  const groups = grouped
    ? groupReceipts(events)
    : events
        .slice()
        .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))
        .map((e) => ({ key: e.id, events: [e] }));
  let previous = "";
  return (
    <div className="event-timeline">
      {events.some((e) => e.type === "vital.received") && (
        <label className="timeline-grouping">
          <input
            type="checkbox"
            checked={grouped}
            onChange={(e) => setGrouped(e.target.checked)}
          />
          Group repeated monitor receipts{" "}
          <span>Full event history is retained</span>
        </label>
      )}
      {groups.map((group) => {
        const event = group.events[0],
          day = new Date(event.timestamp).toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
            year: "numeric",
          }),
          showDay = day !== previous;
        previous = day;
        const p = patients.find((p) => p.id === event.patientId);
        return (
          <div key={group.key}>
            {showDay && <h3 className="timeline-date">{day}</h3>}
            {group.events.length === 1 ? (
              <EventRow event={event} patients={patients} />
            ) : (
              <details className="receipt-group">
                <summary>
                  <HeartPulse size={18} />
                  <span>
                    <strong>{group.events.length} monitor receipts</strong>
                    <small>
                      {p ? `${p.name} / Room ${p.room}` : "Demo environment"} /{" "}
                      {words(event.source)}
                    </small>
                    <small>
                      {time(group.events.at(-1)!.timestamp)} -{" "}
                      {time(event.timestamp)}
                    </small>
                  </span>
                  <span className="disclosure-label">View events</span>
                </summary>
                <div className="receipt-history">
                  {group.events.map((e) => (
                    <EventRow key={e.id} event={e} patients={patients} />
                  ))}
                </div>
              </details>
            )}
          </div>
        );
      })}
      {!events.length && (
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
