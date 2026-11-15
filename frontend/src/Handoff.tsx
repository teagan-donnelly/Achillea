import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "./api";
import { ringFor } from "./handoff-ui";
import type { ReportContext } from "./handoff-report";
import { ChevronRight, CloudOff, Search, X } from "lucide-react";
import type { ScreenProps } from "./app-context";
import { Avatar, EmptyState, Screen, ScreenHeader } from "./ui";
import "./patients.css";
import { useDemoNow } from "./RepositioningViews";
import {
  HandoffUnavailableError,
  UNAVAILABLE_MESSAGE,
  listHandoffs,
} from "./handoff-api";
import type { Handoff as HandoffRecord } from "./handoff-types";
import {
  brief,
  isOpenHandoff,
  openTaskCount,
  shiftOf,
  stamp,
  STATUS_PILL,
} from "./handoff-model";
import { HandoffDetailView } from "./handoff-detail";

type Tab = "incoming" | "outgoing" | "history";
const TABS: { value: Tab; label: string }[] = [
  { value: "incoming", label: "Incoming" },
  { value: "outgoing", label: "Outgoing" },
  { value: "history", label: "History" },
];

export type ListStatus = "loading" | "ready" | "unavailable" | "error";

export interface HandoffList {
  handoffs: HandoffRecord[];
  status: ListStatus;
  message: string;
  reload: () => Promise<void>;
}

/**
 * Handoff records for the unit. Reloads when the unit changes and whenever a new handoff.* event
 * arrives in live state (another device saved or advanced a handoff).
 */
function useHandoffList(unit: string, signal: string): HandoffList {
  const [handoffs, setHandoffs] = useState<HandoffRecord[]>([]);
  const [status, setStatus] = useState<ListStatus>("loading");
  const [message, setMessage] = useState("");
  const generation = useRef(0);
  const invalidatePending = useCallback(() => {
    generation.current++;
  }, []);
  const reload = useCallback(async () => {
    const mine = ++generation.current;
    try {
      const list = await listHandoffs({ unit });
      if (mine !== generation.current) return;
      setHandoffs(list);
      setStatus("ready");
      setMessage("");
    } catch (e) {
      if (mine !== generation.current) return;
      setStatus(e instanceof HandoffUnavailableError ? "unavailable" : "error");
      setMessage(
        e instanceof HandoffUnavailableError
          ? UNAVAILABLE_MESSAGE
          : (e as Error).message,
      );
    }
  }, [unit]);
  useEffect(() => {
    void reload();
    return invalidatePending;
  }, [reload, signal, invalidatePending]);
  return { handoffs, status, message, reload };
}

/** Handoff context per patient for the list rings (refreshed on handoff changes and every 15 s). */
function usePatientContexts(ids: string[], signal: string) {
  const [map, setMap] = useState<Record<string, ReportContext>>({});
  const key = ids.join(",");
  useEffect(() => {
    let alive = true;
    const load = () =>
      Promise.all(
        key
          .split(",")
          .filter(Boolean)
          .map((id) =>
            api<ReportContext>(`/patients/${encodeURIComponent(id)}/handoff-context`)
              .then((c) => [id, c] as const)
              .catch(() => null),
          ),
      ).then((pairs) => {
        if (!alive) return;
        const next: Record<string, ReportContext> = {};
        for (const pair of pairs) if (pair && pair[1] && Array.isArray(pair[1].missing)) next[pair[0]] = pair[1];
        setMap(next);
      });
    void load();
    const timer = setInterval(load, 15000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [key, signal]);
  return map;
}

/** Handoff tab (/activity): structured shift-to-shift communication. */
export function Handoff(props: ScreenProps) {
  const { state, patients, rounds, unit } = props;
  const now = useDemoNow(state);
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const tab = (
    TABS.some((t) => t.value === params.get("tab"))
      ? params.get("tab")
      : "incoming"
  ) as Tab;
  const handoffId = params.get("handoff");
  const previewPatient = params.get("patient");
  const query = params.get("q") ?? "";
  const searchInput = useRef<HTMLInputElement>(null);
  const search = query.trim().toLocaleLowerCase();
  // state.handoffs (newer backends) changes on every handoff save/transition and arrives over SSE.
  const live = (
    state as { handoffs?: { id: string; status: string; version: number }[] }
  ).handoffs;
  const signal = `${live?.map((h) => `${h.id}:${h.status}:${h.version}`).join(",") ?? ""}|${state.events.filter((e) => e.type.startsWith("handoff.")).length}`;
  const list = useHandoffList(unit, signal);
  const contexts = usePatientContexts(
    patients.map((p) => p.id),
    signal,
  );
  const [startError] = useState("");
  const shift = shiftOf(now);

  const go = useCallback(
    (next: Record<string, string>) =>
      navigate(
        `/activity?${new URLSearchParams({ tab, ...(query ? { q: query } : {}), ...next }).toString()}`,
      ),
    [navigate, tab, query],
  );

  const assigned = useMemo(
    () => new Set(patients.map((p) => p.id)),
    [patients],
  );
  const mine = useMemo(
    () => list.handoffs.filter((h) => assigned.has(h.patientId)),
    [list.handoffs, assigned],
  );
  const matches = (patientId: string, name?: string, room?: string) => {
    const p = patients.find((item) => item.id === patientId);
    return (
      !search ||
      [name ?? p?.name, room ?? p?.room, patientId].some((value) =>
        value?.toLocaleLowerCase().includes(search),
      )
    );
  };
  const listLocation = `/activity?${new URLSearchParams({ tab, ...(query ? { q: query } : {}) })}`;
  function setQuery(value: string) {
    navigate(
      `/activity?${new URLSearchParams({ tab, ...(value ? { q: value } : {}) })}`,
      { replace: true },
    );
  }

  if (handoffId || previewPatient)
    return (
      <HandoffDetailView
        {...props}
        key={handoffId ?? previewPatient}
        handoffId={handoffId}
        patientId={previewPatient}
        list={list}
        backTo={listLocation}
        onOpen={(id) => go({ handoff: id })}
      />
    );

  const RANK = { check: 0, new: 1, none: 2, done: 3 } as const;
  const rows = patients
    .filter((p) => matches(p.id))
    .map((p) => {
      const own = mine
        .filter((h) => h.patientId === p.id)
        .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
      const current =
        own.find(
          (h) =>
            isOpenHandoff(h) &&
            h.shiftDate === shift.shiftDate &&
            h.shiftLabel === shift.shiftLabel,
        ) ?? own[0];
      const incoming = own.find(
        (h) => h.status === "READY" || h.status === "REVIEWED",
      );
      const { ring, toCheck } = ringFor(
        contexts[p.id],
        !!incoming,
        current?.status === "ACKNOWLEDGED",
      );
      return { p, current, incoming, ring, toCheck };
    })
    .sort(
      (a, b) =>
        RANK[a.ring] - RANK[b.ring] ||
        a.p.room.localeCompare(b.p.room, undefined, { numeric: true }),
    );
  const hrefFor = (r: (typeof rows)[number]) =>
    r.current
      ? `${listLocation}&handoff=${encodeURIComponent(r.current.id)}`
      : `${listLocation}&patient=${encodeURIComponent(r.p.id)}`;
  return (
    <Screen className="hx">
      <ScreenHeader title="Handoff" />
      <div className="hx-search" data-no-swipe>
        <Search aria-hidden strokeWidth={1.75} />
        <input
          type="search"
          ref={searchInput}
          aria-label="Search handoff patients"
          placeholder="Search patient or room"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        {query && (
          <button
            type="button"
            aria-label="Clear handoff search"
            onClick={() => {
              setQuery("");
              searchInput.current?.focus();
            }}
          >
            <X aria-hidden strokeWidth={1.75} />
          </button>
        )}
      </div>
      {(list.status === "unavailable" || list.status === "error") && (
        <div className="hx-notice" role="alert">
          <CloudOff aria-hidden strokeWidth={1.75} />
          <strong>Couldn’t load handoffs</strong>
          <button type="button" className="hx-link-button" onClick={() => void list.reload()}>
            Retry
          </button>
        </div>
      )}
      {startError && (
        <p className="hx-inline-error" role="alert">
          {startError}
        </p>
      )}
      {rows.length === 0 ? (
        <EmptyState title={search ? "No matching patients" : "No assigned patients"} />
      ) : (
        <ul className="pt-inbox" aria-label="Patients for handoff">
          {rows.map((r) => {
            const last = r.incoming ?? r.current;
            const status = last ? STATUS_PILL[last.status].label : "Not started";
            const detail = r.incoming
              ? `From last shift: ${brief(r.incoming.sections?.currentConcerns, 60) || "report ready"}`
              : last
                ? `Updated ${stamp(last.updatedAt)}`
                : `${openTaskCount(state, rounds, r.p.id)} open tasks`;
            return (
              <li key={r.p.id} className="pt-inbox-item">
                <Link
                  className="ach-row pt-row"
                  to={hrefFor(r)}
                  aria-label={`${r.p.name}, Room ${r.p.room}, ${status}${r.toCheck ? `, ${r.toCheck} to check` : ""}`}
                >
                  <Avatar name={r.p.name} tone={r.toCheck ? "amber" : last?.status === "ACKNOWLEDGED" ? "grey" : "green"} />
                  <span className="ach-row-main">
                    <h3 className="ach-row-title">{r.p.name}</h3>
                    <span className="ach-row-subtitle">
                      Room {r.p.room} · {status}
                      {r.toCheck > 0 && <> · {r.toCheck} to check</>}
                    </span>
                    <span className="ach-row-subtitle hu-row-detail">{detail}</span>
                  </span>
                  <span className="ach-row-trailing">
                    {r.toCheck > 0 && <span className="pt-dot tone-warning" aria-hidden />}
                    <ChevronRight className="ach-chevron" aria-hidden strokeWidth={2} />
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
