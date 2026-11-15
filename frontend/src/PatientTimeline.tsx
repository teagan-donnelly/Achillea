import { TimelineRail } from "./TimelineRail";
import { useState } from "react";
import { Activity, ClipboardList, Radio, CheckCircle } from "lucide-react";
import type { State } from "./types";
import { time, words } from "./api";
import { metricName } from "./Monitoring";

const categories = [
  "Monitoring",
  "Documentation",
  "Sensor review",
  "Device",
  "Care tasks",
] as const;
type Category = (typeof categories)[number];
export function eventCategory(type: string): Category {
  return type.startsWith("chart")
    ? "Documentation"
    : type.startsWith("movement")
      ? "Sensor review"
      : type.startsWith("device")
        ? "Device"
        : type.startsWith("task")
          ? "Care tasks"
          : "Monitoring";
}
export function PatientTimeline({
  state,
  patientId,
}: {
  state: State;
  patientId: string;
}) {
  const [category, setCategory] = useState("All records"),
    [hour, setHour] = useState<number | null>(null),
    [selectedId, setSelectedId] = useState(""),
    [viewAll, setViewAll] = useState(false);
  const end = Date.parse(state.serverTime ?? "") || Date.now(),
    start = end - 86400000;
  const records = [
    ...state.events
      .filter((e) => e.patientId === patientId)
      .map((e) => ({
        id: e.id,
        at: e.timestamp,
        category: eventCategory(e.type),
        title: words(e.type.replaceAll(".", " ")),
        detail: e.details,
        source: e.source,
      })),
    ...state.vitals
      .filter((v) => v.patientId === patientId)
      .map((v) => ({
        id: v.id,
        at: v.observedAt,
        category: "Monitoring" as Category,
        title: metricName(v.metric),
        detail: `${v.quality === "MISSING" || !Number.isFinite(v.value) ? "Unavailable" : v.value} ${v.unit} · ${words(v.quality)} · received ${time(v.receivedAt)}`,
        source: v.source,
      })),
  ]
    .filter((e) => {
      const t = Date.parse(e.at);
      return t >= start && t <= end;
    })
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  const filtered = records.filter(
    (e) => category === "All records" || e.category === category,
  );
  const bucket = (at: string) =>
    Math.min(23, Math.floor((Date.parse(at) - start) / 3600000));
  const selected =
    hour === null
      ? filtered
      : filtered.filter((e) => Math.floor(bucket(e.at) / 4) === hour);
  const groups = categories
    .map((c) => ({
      category: c,
      records: selected.filter((e) => e.category === c),
    }))
    .filter((g) => g.records.length);
  const selectedEvent = selected.find((r) => r.id === selectedId);
  return (
    <section
      className="patient-day"
      aria-label="24-hour patient activity"
      data-no-swipe
    >
      <div className="section-heading">
        <div>
          <h2>24-Hour Activity Timeline</h2>
          <p>Last 24 hours · {records.length} source records</p>
        </div>
        <button
          className="timeline-view-all"
          aria-expanded={viewAll}
          onClick={() => setViewAll(!viewAll)}
        >
          {viewAll ? "Compact view" : "View all"}
        </button>
      </div>
      <TimelineRail
        records={selected}
        selectedId={selectedId}
        onSelect={setSelectedId}
      />
      <div className="timeline-legend">
        {groups.map((g) => (
          <span
            key={g.category}
            className={`legend-${g.category.toLowerCase().replaceAll(" ", "-")}`}
          >
            <Activity size={12} />
            {g.category}
          </span>
        ))}
      </div>
      {selectedEvent && (
        <div className="selected-event" role="status">
          <strong>{selectedEvent.title}</strong>
          <p>{selectedEvent.detail}</p>
          <small>
            {time(selectedEvent.at)} · {selectedEvent.source}
          </small>
        </div>
      )}
      <div
        hidden={!viewAll}
        className={viewAll ? "timeline-full is-visible" : "timeline-full"}
      >
        <div className="day-bars" aria-label="Four-hour activity windows">
          {Array.from({ length: 6 }, (_, i) => {
            const count = filtered.filter(
              (e) => Math.floor(bucket(e.at) / 4) === i,
            ).length;
            return (
              <button
                key={i}
                disabled={!count}
                aria-pressed={hour === i}
                aria-label={`From ${time(new Date(start + i * 4 * 3600000).toISOString())}: ${count} records`}
                onClick={() => {
                  setHour(hour === i ? null : i);
                  setSelectedId("");
                }}
              >
                {Array.from({ length: 4 }, (_, j) => {
                  const n = filtered.filter(
                    (e) => bucket(e.at) === i * 4 + j,
                  ).length;
                  return (
                    <span
                      key={j}
                      style={{
                        height: n ? Math.min(100, 12 + n * 5) + "%" : "0%",
                      }}
                    />
                  );
                })}
              </button>
            );
          })}
        </div>
        <div className="day-axis">
          <span>{time(new Date(start).toISOString())}</span>
          <span>12 hours ago</span>
          <span>Now</span>
        </div>
        <label className="day-filter">
          Record type
          <select
            aria-label="Filter patient timeline"
            value={category}
            onChange={(e) => {
              setCategory(e.target.value);
              setHour(null);
              setSelectedId("");
            }}
          >
            <option>All records</option>
            {categories.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        {hour !== null && (
          <button
            className="text-link timeline-reset"
            onClick={() => setHour(null)}
          >
            Show all 24 hours
          </button>
        )}
        <div className="day-records">
          {groups.map((g) => {
            const Icon =
              g.category === "Documentation"
                ? ClipboardList
                : g.category === "Monitoring"
                  ? Activity
                  : g.category === "Care tasks"
                    ? CheckCircle
                    : Radio;
            return (
              <details
                key={g.category}
                className={`day-group category-${g.category.toLowerCase().replaceAll(" ", "-")}`}
              >
                <summary>
                  <Icon size={17} />
                  <span>{g.category}</span>
                  <span>{g.records.length} records</span>
                </summary>
                <ol>
                  {g.records.map((e) => (
                    <li key={e.id}>
                      <time dateTime={e.at}>{time(e.at)}</time>
                      <div>
                        <strong>{e.title}</strong>
                        <p>{e.detail}</p>
                        <small>
                          {words(e.source)} · Record {e.id}
                        </small>
                      </div>
                    </li>
                  ))}
                </ol>
              </details>
            );
          })}
        </div>
        {!selected.length && (
          <p className="empty">No recorded activity in this time range.</p>
        )}
      </div>
      <p className="timeline-note">
        Recent groups are spaced for selection; timestamps show actual source
        times. View all to filter and inspect every record.
      </p>
    </section>
  );
}
