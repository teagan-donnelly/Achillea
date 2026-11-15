import { Activity, ClipboardList, Check, Radio } from "lucide-react";
import { time } from "./api";
export interface TimelineRecord {
  id: string;
  at: string;
  category: string;
  title: string;
  detail: string;
  source: string;
}
export function TimelineRail({
  records,
  selectedId,
  onSelect,
}: {
  records: TimelineRecord[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  // One marker per hour/category. The six most recent groups are spaced for touch,
  // not positioned on a continuous time scale; every displayed timestamp is real.
  const groups = new Map<string, TimelineRecord[]>();
  for (const r of records.slice().reverse()) {
    const key = `${Math.floor(Date.parse(r.at) / 3600000)}-${r.category}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  const windows = Array.from(groups.values())
    .sort((a, b) => Date.parse(a.at(-1)!.at) - Date.parse(b.at(-1)!.at))
    .slice(-6);
  return (
    <div
      className="timeline-rail"
      aria-label="Recent event groups within 24 hours"
      data-no-swipe
    >
      {windows.map((group) => {
        const r = group.at(-1)!,
          Icon =
            r.category === "Monitoring"
              ? Activity
              : r.category === "Documentation"
                ? ClipboardList
                : r.category === "Care tasks"
                  ? Check
                  : Radio;
        return (
          <button
            key={r.id}
            className={`rail-marker category-${r.category.toLowerCase().replaceAll(" ", "-")}`}
            aria-pressed={selectedId === r.id}
            aria-label={`${r.category}, ${time(r.at)}, ${group.length} source records`}
            onClick={() => onSelect(r.id)}
          >
            <span className="rail-time">
              {new Date(r.at).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
                hour12: false,
              })}
            </span>
            <span className="rail-icon">
              <Icon size={16} />
            </span>
            <small>
              {group.length > 1 ? `${group.length} records` : r.category}
            </small>
          </button>
        );
      })}
      {!windows.length && <p>No timestamped events in the last 24 hours.</p>}
    </div>
  );
}
