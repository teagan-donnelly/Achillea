import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  Activity,
  BedDouble,
  Bell,
  ChevronRight,
  LayoutGrid,
  TriangleAlert,
} from "lucide-react";
import type { Patient, State } from "./types";
import { ScreenHeader } from "./ui";
import { useDemoNow } from "./RepositioningViews";
import {
  buildFeed,
  filterFeed,
  needsAttention,
  type FeedFilter,
  type FeedMeasurement,
  type FeedPatient,
  type Tone,
} from "./monitoring-feed";

/**
 * Monitoring tab ("/"): room "stories", filter capsule and a feed of patient cards. Every value
 * comes from live simulation state via monitoring-feed.ts; this file is presentation only.
 */

const UNIT_LABEL: Record<string, string> = {
  ICU: "ICU",
  L_AND_D: "Labor & delivery",
};

const PILL: Record<Tone, string> = {
  alert: "Review",
  warning: "Watch",
  stable: "Stable",
  offline: "Offline",
};

const FILTERS: { id: FeedFilter; label: string; icon: ReactNode }[] = [
  {
    id: "ALL",
    label: "All",
    icon: <LayoutGrid aria-hidden strokeWidth={1.75} />,
  },
  {
    id: "ATTENTION",
    label: "Needs Attention",
    icon: <TriangleAlert aria-hidden strokeWidth={1.75} />,
  },
  {
    id: "STABLE",
    label: "Stable",
    icon: <Activity aria-hidden strokeWidth={1.75} />,
  },
];

const EMPTY_FILTER: Record<FeedFilter, string> = {
  ALL: "No patients to show",
  ATTENTION: "No patients need attention",
  STABLE: "No stable patients right now",
};

function unitLabel(unit: string) {
  return UNIT_LABEL[unit] ?? unit.replace(/_/g, " ");
}

function pillText(f: FeedPatient) {
  return f.tone === "offline"
    ? f.statusLabel === "Awaiting data"
      ? "Awaiting"
      : "Offline"
    : PILL[f.tone];
}

/** Grey sub-line: unit plus the care phase when it adds information ("ICU stay" does not). */
function subLine(f: FeedPatient) {
  const unit = unitLabel(f.patient.unit);
  const phase = f.patient.carePhase?.trim();
  return phase && !phase.toLowerCase().startsWith(unit.toLowerCase())
    ? `${unit} · ${phase}`
    : unit;
}

function formatValue(m: FeedMeasurement) {
  if (m.value === null) return "—";
  return m.key === "TEMPERATURE"
    ? m.value.toFixed(1)
    : String(Math.round(m.value));
}

/** Compact native labels for the vitals row; anything unknown falls back to the model's label. */
const METRIC_LABEL: Record<string, string> = {
  HEART_RATE: "HR",
  SPO2: "SpO₂",
  RESPIRATORY_RATE: "RR",
  TEMPERATURE: "Temp",
};
const shortUnit = (unit: string) => (unit === "breaths/min" ? "/min" : unit);
/** Symbols hug the number (97%, 38.2°C); words get a thin gap (113 bpm). */
const tightUnit = (unit: string) => /^[%°/]/.test(unit);

function Metric({ m }: { m: FeedMeasurement }) {
  const unit = shortUnit(m.unit);
  return (
    <div
      className={`mf-metric state-${m.state.toLowerCase()}`}
      title={`${m.label}: ${m.value === null ? m.stateText : `${formatValue(m)} ${m.unit}`}${m.state === "OLD" || m.state === "CHECK" ? ` (${m.stateText})` : ""}`}
    >
      <span className="mf-caption">
        {METRIC_LABEL[m.key] ?? m.label}
        {m.state === "CHECK" && <span className="mf-stale-dot" aria-hidden />}
      </span>
      <span className={m.value === null ? "mf-value is-empty" : "mf-value"}>
        {formatValue(m)}
        {m.value !== null && unit && (
          <small className={tightUnit(unit) ? "tight" : undefined}>
            {unit}
          </small>
        )}
      </span>
      {m.state !== "LIVE" && (
        <span className="mf-reading-state">{m.stateText}</span>
      )}
    </div>
  );
}

/**
 * Urgency of care for the room carousel (red / yellow / green). An offline monitor counts as red:
 * the patient cannot be watched until someone checks the equipment.
 */
type Urgency = "red" | "yellow" | "green";
function urgency(f: FeedPatient): Urgency {
  return f.tone === "alert" || f.tone === "offline"
    ? "red"
    : f.tone === "warning"
      ? "yellow"
      : "green";
}
const URGENCY_RANK: Record<Urgency, number> = { red: 0, yellow: 1, green: 2 };
/** Most urgent first; same colour: more active reasons first, then room. Re-sorted on every live update. */
const byUrgency = (a: FeedPatient, b: FeedPatient) =>
  URGENCY_RANK[urgency(a)] - URGENCY_RANK[urgency(b)] ||
  b.reasons.length - a.reasons.length ||
  a.patient.room.localeCompare(b.patient.room, undefined, { numeric: true });
const URGENCY_LABEL: Record<Urgency, string> = {
  red: "Urgent",
  yellow: "Watch",
  green: "Stable",
};

function PatientCard({ f }: { f: FeedPatient }) {
  const p = f.patient;
  const pill = pillText(f);
  const sub = subLine(f);
  return (
    <li>
      <Link
        to={`/monitoring/${p.id}`}
        className={`mf-card tone-${f.tone}`}
        aria-label={`Room ${p.room}, ${p.name}, ${pill}`}
      >
        <div className="mf-card-top">
          <div className="mf-id">
            <strong className="mf-name">{p.name}</strong>
            <span className="mf-sub">
              <span className="mf-room">Room {p.room}</span> · {sub}
            </span>
          </div>
          <span className={`mf-pill tone-${f.tone}`}>{pill}</span>
          <ChevronRight className="mf-chev" aria-hidden strokeWidth={2} />
        </div>
        {f.vitals.length > 0 && <hr className="mf-rule" />}
        {f.vitals.length > 0 && (
          <div className={`mf-metrics n-${Math.min(f.vitals.length, 4)}`}>
            {f.vitals.map((m) => (
              <Metric key={m.key} m={m} />
            ))}
          </div>
        )}
      </Link>
    </li>
  );
}

export function MonitoringFeed({
  state,
  patients,
}: {
  state: State;
  patients: Patient[];
}) {
  const now = useDemoNow(state);
  const [filter, setFilter] = useState<FeedFilter>("ALL");
  const feed = useMemo(
    () => buildFeed(state, patients, now),
    [state, patients, now],
  );
  const shown = [...filterFeed(feed, filter)].sort(byUrgency);
  const attentionCount = feed.filter(needsAttention).length;

  return (
    <div className="mf">
      <ScreenHeader
        title="Monitoring"
        right={
          <button
            type="button"
            className="ach-icon-button mf-bell"
            aria-label={
              attentionCount
                ? `${attentionCount} patient${attentionCount === 1 ? "" : "s"} need${attentionCount === 1 ? "s" : ""} attention`
                : "No patients need attention"
            }
            onClick={() => setFilter("ATTENTION")}
          >
            <Bell aria-hidden strokeWidth={1.75} />
            {attentionCount > 0 && <span className="mf-bell-dot" aria-hidden />}
          </button>
        }
      />

      {feed.length > 0 && (
        <nav className="mf-stories" aria-label="Rooms" data-no-swipe>
          <ul>
            {[...feed]
              .sort(byUrgency)
              .map((f) => (
                <li key={f.patient.id}>
                  <Link
                    to={`/monitoring/${f.patient.id}`}
                    className={`mf-story urgency-${urgency(f)}`}
                    aria-label={`Room ${f.patient.room}, ${f.patient.name}, ${URGENCY_LABEL[urgency(f)]}: ${pillText(f)}`}
                  >
                    <span className="mf-ring">
                      <span className="mf-avatar">
                        <BedDouble aria-hidden strokeWidth={1.5} />
                      </span>
                      {urgency(f) === "red" && (
                        <span className="mf-badge" aria-hidden>
                          !
                        </span>
                      )}
                    </span>
                    <span className="mf-story-label">
                      <span className="mf-story-room">
                        Room {f.patient.room}
                      </span>
                      <span className="mf-story-name">
                        {f.patient.name.split(" ")[0]}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
          </ul>
        </nav>
      )}

      <div
        className="mf-filter"
        role="group"
        aria-label="Filter patients"
        style={
          {
            "--mf-i": FILTERS.findIndex((x) => x.id === filter),
          } as CSSProperties
        }
      >
        <span className="mf-filter-thumb" aria-hidden />
        {FILTERS.map((x) => (
          <button
            key={x.id}
            type="button"
            aria-pressed={filter === x.id}
            aria-label={x.label}
            title={x.label}
            onClick={() => setFilter(x.id)}
          >
            {x.icon}
          </button>
        ))}
      </div>

      {patients.length === 0 ? (
        <p className="mf-empty">
          <strong>No patients in this unit yet</strong>
          <span>
            Patients appear here as soon as the simulation admits them.
          </span>
        </p>
      ) : shown.length === 0 ? (
        <p className="mf-empty">
          <strong>{EMPTY_FILTER[filter]}</strong>
          <span>
            {filter === "ATTENTION"
              ? "Every monitored patient is stable."
              : "Try another filter."}
          </span>
        </p>
      ) : (
        <ul className="mf-feed" aria-label="Patients">
          {shown.map((f) => (
            <PatientCard key={f.patient.id} f={f} />
          ))}
        </ul>
      )}
    </div>
  );
}
