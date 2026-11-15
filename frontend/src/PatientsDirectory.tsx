import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { ChevronRight, Search, X } from "lucide-react";
import type { ScreenProps } from "./app-context";
import { Avatar, EmptyState, Screen, ScreenHeader, type Tone } from "./ui";
import { feedPatient, type Tone as FeedTone } from "./monitoring-feed";
import { useDemoNow } from "./RepositioningViews";
import {
  lastDocumented,
  sessionGet,
  sessionSet,
  shortStamp,
  unitShort,
} from "./patient-data";

/**
 * Patients tab (/patients): an inbox of the patients assigned to the demo nurse. Rows open the
 * longitudinal patient record. "Assigned" is the only access scope the backend models, so there is
 * no "All accessible" filter.
 */

const SEARCH_KEY = "achillea-patients-search";
const AVATAR_TONE: Record<FeedTone, Tone> = {
  alert: "red",
  warning: "amber",
  offline: "grey",
  stable: "green",
};
const ATTENTION_TEXT: Record<FeedTone, string> = {
  alert: "Needs review",
  warning: "Watch",
  offline: "Monitor offline",
  stable: "",
};

export function PatientsDirectory({
  state,
  patients,
  unit,
  selectUnit,
}: ScreenProps) {
  const location = useLocation();
  const now = useDemoNow(state);
  const [search, setSearch] = useState(() => sessionGet(SEARCH_KEY) ?? "");
  const scrollKey = `achillea-patients-scroll-${unit}`;
  useEffect(() => {
    const saved = Number(sessionGet(scrollKey) ?? 0);
    const frame = window.setTimeout(() => {
      if (saved > 0 || window.scrollY > 0)
        window.scrollTo({ top: saved, behavior: "instant" });
    });
    const remember = () => sessionSet(scrollKey, String(window.scrollY));
    window.addEventListener("scroll", remember, { passive: true });
    return () => {
      window.clearTimeout(frame);
      window.removeEventListener("scroll", remember);
    };
  }, [scrollKey]);
  const update = (value: string) => {
    setSearch(value);
    sessionSet(SEARCH_KEY, value);
  };
  const rows = useMemo(
    () =>
      [...patients]
        .sort((a, b) =>
          a.room.localeCompare(b.room, undefined, { numeric: true }),
        )
        .map((p) => ({
          p,
          feed: feedPatient(state, p, now),
          doc: lastDocumented(state, p.id),
        })),
    [patients, state, now],
  );
  const q = search.trim().toLowerCase();
  const matches = rows.filter(({ p }) =>
    [p.name, p.room, `room ${p.room}`, p.id].some((v) =>
      v.toLowerCase().includes(q),
    ),
  );

  return (
    <Screen className="pt-dir">
      <ScreenHeader title="Patients" />
      <h2 className="visually-hidden">Your patients</h2>

      <div className="pt-dir-tools">
        <label className="pt-search">
          <Search aria-hidden strokeWidth={2} />
          <input
            type="search"
            aria-label="Search assigned patients"
            placeholder="Search name, room, or ID"
            value={search}
            onChange={(e) => update(e.target.value)}
            autoComplete="off"
            enterKeyHint="search"
          />
          {search && (
            <button
              type="button"
              className="pt-search-clear"
              aria-label="Clear search"
              onClick={() => update("")}
            >
              <X aria-hidden strokeWidth={2.5} />
            </button>
          )}
        </label>
        <div className="pt-filters" data-no-swipe>
          <div
            className="pt-chips"
            role="group"
            aria-label="Assigned patient unit"
          >
            <button
              type="button"
              aria-pressed={unit === "L_AND_D"}
              onClick={() => selectUnit("L_AND_D", "/patients")}
            >
              L&amp;D{unit === "L_AND_D" ? ` (${patients.length})` : ""}
            </button>
            <button
              type="button"
              aria-pressed={unit === "ICU"}
              onClick={() => selectUnit("ICU", "/patients")}
            >
              ICU{unit === "ICU" ? ` (${patients.length})` : ""}
            </button>
          </div>
        </div>
      </div>

      {patients.length === 0 ? (
        <EmptyState title="No patients" />
      ) : matches.length === 0 ? (
        <EmptyState title="No matches">
          Try a patient name, room number, or patient ID.
        </EmptyState>
      ) : (
        <ul className="pt-inbox" aria-label="Assigned patients">
          {matches.map(({ p, feed, doc }) => {
            const attention = ATTENTION_TEXT[feed.tone];
            const detail = doc
              ? `${doc.label} ${shortStamp(doc.at, now)}`
              : null;
            return (
              <li key={p.id} className="pt-inbox-item">
                <Link
                  to={`/patients/${p.id}`}
                  state={{ from: location.pathname }}
                  className="ach-row pt-row"
                  aria-label={`${p.name}, Room ${p.room}, ${unitShort(p.unit)}${attention ? `, ${attention}` : ""}. Open patient overview`}
                >
                  <Avatar name={p.name} tone={AVATAR_TONE[feed.tone]} />
                  <span className="ach-row-main">
                    <h3 className="ach-row-title">{p.name}</h3>
                    <span className="ach-row-subtitle">
                      Room {p.room} · {unitShort(p.unit)}
                      {detail && (
                        <span className="pt-row-detail"> · {detail}</span>
                      )}
                    </span>
                  </span>
                  <span className="ach-row-trailing">
                    {attention && (
                      <span
                        className={`pt-dot tone-${feed.tone}`}
                        title={attention}
                        aria-hidden
                      />
                    )}
                    <ChevronRight
                      className="ach-chevron"
                      aria-hidden
                      strokeWidth={2}
                    />
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Screen>
  );
}
