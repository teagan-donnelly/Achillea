import { useCallback, useEffect, useRef, useState } from "react";
import {
  Link,
  NavLink,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import {
  Activity,
  CalendarCheck,
  Check,
  FlaskConical,
  Leaf,
  RefreshCw,
  Search,
  Users,
  Wifi,
  WifiOff,
  Radio,
  MoreHorizontal,
} from "lucide-react";
import type { ActivityItem, Chart, Patient, Round, State, Task } from "./types";
import { api } from "./api";
import { PatientView } from "./PatientView";
import { RoundsView } from "./RoundsView";
import { ActivityHome, PatientCard } from "./WorkspaceViews";
import { SwipeNavigation } from "./SwipeNavigation";
import { loadWorkspace, type WorkspaceSnapshot } from "./workspace-feed";
import { PageHero } from "./VisualPrimitives";
import { DemoPresets } from "./DemoPresets";
import { RepositioningHome, SensorMonitoring } from "./RepositioningViews";
import { initialUnit, saveUnit } from "./unit-preference";
export default function App() {
  const [state, setState] = useState<State | null>(null),
    [rounds, setRounds] = useState<Round[]>([]),
    [activity, setActivity] = useState<ActivityItem[]>([]),
    [unit, setUnit] = useState(initialUnit),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [demo, setDemo] = useState(false),
    [busy, setBusy] = useState(false),
    [search, setSearch] = useState(""),
    [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const navigate = useNavigate(),
    location = useLocation();
  const currentUnit = useRef(unit),
    requestSequence = useRef(0),
    appliedSequence = useRef(0);
  const feed = useRef<WorkspaceSnapshot | null>(null),
    unitGeneration = useRef(0);
  const loaded = state !== null;
  useEffect(() => {
    const heading = document.querySelector<HTMLHeadingElement>("main h1");
    if (heading) {
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
    }
  }, [location.pathname, loaded]);
  const refresh = useCallback(async () => {
    const request = ++requestSequence.current;
    const generation = unitGeneration.current;
    try {
      const snapshot = await loadWorkspace(unit, feed.current);
      if (
        generation !== unitGeneration.current ||
        request < appliedSequence.current ||
        unit !== currentUnit.current
      )
        return;
      const { state: s, rounds: r } = snapshot;
      feed.current = snapshot;
      setActivity(snapshot.activity);
      appliedSequence.current = request;
      setState(s);
      setUpdatedAt(new Date().toISOString());
      setRounds(r);
      setError("");
    } catch (e) {
      if (
        generation !== unitGeneration.current ||
        request < appliedSequence.current ||
        unit !== currentUnit.current
      )
        return;
      appliedSequence.current = request;
      setError(e instanceof Error ? e.message : "Cannot connect");
    }
  }, [unit]);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 3000);
    return () => {
      clearInterval(timer);
    };
  }, [refresh]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 5000);
    return () => clearTimeout(timer);
  }, [notice]);
  async function mutate(path: string, body: unknown = {}, method?: string) {
    setBusy(true);
    try {
      const result = await api<Chart | State | Task>(path, body, method);
      if (path === "/demo/reset") feed.current = null;
      await refresh();
      setNotice("Saved to the synthetic demo record");
      return result;
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Action failed");
      throw e;
    } finally {
      setBusy(false);
    }
  }
  const patients = state?.patients.filter((p) => p.unit === unit) ?? [];
  const label =
    unit === "ICU" ? "ICU · expansion scenario" : "Labor & delivery";
  function selectUnit(next: string, destination = "/") {
    saveUnit(next);
    if (next === unit) return;
    currentUnit.current = next;
    unitGeneration.current++;
    feed.current = null;
    setState(null);
    setActivity([]);
    setUpdatedAt(null);
    setUnit(next);
    setRounds([]);
    setSearch("");
    navigate(
      destination === "/" &&
        ["/", "/patients", "/sensors", "/rounds", "/activity"].includes(
          location.pathname,
        )
        ? location.pathname
        : destination,
    );
  }
  async function loadRepositioningDemo() {
    if (
      !window.confirm(
        "Load synthetic repositioning demo schedules and sensor evidence? This assigns additional fictional ICU patients as needed. Saved care confirmations and documentation are preserved. No records are reset.",
      )
    )
      return;
    try {
      await mutate("/demo/repositioning");
      selectUnit("ICU");
      setDemo(false);
      navigate("/");
    } catch {
      /* App displays the server error without clearing existing records. */
    }
  }
  function patientCard(p: Patient) {
    return (
      <PatientCard key={p.id} patient={p} state={state!} rounds={rounds} />
    );
  }
  return (
    <div
      className={`app mockup-design route-${location.pathname === "/" || location.pathname === "/activity" ? "activity" : location.pathname === "/patients" ? "patients" : location.pathname === "/rounds" ? "rounds" : "bedside"}`}
    >
      <aside className="sidebar">
        <Link to="/" className="brand">
          <Leaf size={28} />
          <span>
            Achillea<small>Care that moves with you.</small>
          </span>
        </Link>
        <nav aria-label="Main navigation">
          {[
            ["/", "Home", Activity],
            ["/patients", "Patients", Users],
            ["/sensors", "Sensors", Radio],
            ["/rounds", "Rounds", CalendarCheck],
          ].map(([path, title, Icon]) => {
            const Glyph = Icon as typeof Activity;
            return (
              <NavLink
                end={path === "/"}
                key={path as string}
                to={path as string}
                className={
                  path === "/" && location.pathname === "/activity"
                    ? "active"
                    : undefined
                }
              >
                <Glyph size={20} />
                <span>{title as string}</span>
              </NavLink>
            );
          })}
        </nav>
        <div className="sidebar-bottom">
          <p>
            Designed for the bedside.
            <br />
            Built around your judgment.
          </p>
          <button className="demo-toggle" onClick={() => setDemo(!demo)}>
            <FlaskConical size={18} /> Demo controls
          </button>
          <div className="nurse">
            <span className="avatar">JE</span>
            <span>
              <strong>Jordan Ellis, RN</strong>
              <small>Demo nurse · assigned care</small>
            </span>
          </div>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <span className="mobile-brand">
            <Leaf size={21} /> Achillea
          </span>
          <label className="unit-picker">
            Demo unit
            <select
              aria-label="Demo unit"
              value={unit}
              onChange={(e) => selectUnit(e.target.value)}
            >
              <option value="L_AND_D">Labor & delivery</option>
              <option value="ICU">ICU · expansion scenario</option>
            </select>
          </label>
          <span className={`connection ${error ? "offline" : ""}`}>
            {error ? <WifiOff size={16} /> : <Wifi size={16} />}{" "}
            {error ? "Offline" : state ? "API connected" : "Connecting"}
          </span>
          {updatedAt && (
            <span className="refresh-time">
              Updated{" "}
              {new Date(updatedAt).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          )}
          <button
            className="mobile-demo secondary"
            aria-label="Open demo controls"
            onClick={() => setDemo(!demo)}
          >
            <MoreHorizontal size={19} />
          </button>
        </header>
        <div className="simulation">
          <FlaskConical size={14} />
          <span>Synthetic-data educational demo · Not for clinical use</span>
        </div>
        <SwipeNavigation disabled={demo}>
          <main id="main" key={location.pathname}>
            {error && (
              <div className="error" role="alert">
                <strong>Unable to reach the local backend.</strong>
                <p>
                  {error}. Check the backend and API proxy configuration, then
                  retry. Your unsaved note stays on screen.
                </p>
                <button onClick={() => void refresh()}>Retry connection</button>
              </div>
            )}
            {!state && !error && (
              <div className="loading" role="status">
                Connecting to your demo shift…
              </div>
            )}
            {state && (
              <Routes>
                <Route
                  path="/"
                  element={
                    <RepositioningHome
                      onLoadDemo={() => void loadRepositioningDemo()}
                      busy={busy}
                      onOpenIcu={() => selectUnit("ICU")}
                      key={unit}
                      state={state}
                      patients={patients}
                      label={label}
                    />
                  }
                />
                <Route
                  path="/sensors"
                  element={
                    <SensorMonitoring state={state} patients={patients} />
                  }
                />
                <Route
                  path="/patients"
                  element={
                    <>
                      <PageHero
                        title="Patients"
                        subtitle={`${label} · ${patients.length} assigned patients`}
                      />
                      <h2 className="visually-hidden">Your patients</h2>
                      <p>
                        Assigned to Jordan Ellis, RN · {label} · Synthetic
                        records
                      </p>
                      <label className="search">
                        <Search size={19} />
                        <input
                          aria-label="Search assigned patients"
                          placeholder="Search name, room, or synthetic wristband ID"
                          value={search}
                          onChange={(e) => setSearch(e.target.value)}
                        />
                      </label>
                      <div
                        className="filter-pills unit-filters"
                        aria-label="Assigned patient unit"
                        data-no-swipe
                      >
                        <button
                          aria-pressed={unit === "L_AND_D"}
                          onClick={() => selectUnit("L_AND_D", "/patients")}
                        >
                          L&amp;D
                          {unit === "L_AND_D" ? ` (${patients.length})` : ""}
                        </button>
                        <button
                          aria-pressed={unit === "ICU"}
                          onClick={() => selectUnit("ICU", "/patients")}
                        >
                          ICU{unit === "ICU" ? ` (${patients.length})` : ""}
                        </button>
                      </div>
                      <div className="surface patients-grid">
                        {patients
                          .filter((p) =>
                            (p.name + p.room + p.id)
                              .toLowerCase()
                              .includes(search.toLowerCase()),
                          )
                          .map(patientCard)}
                        {!patients.some((p) =>
                          (p.name + p.room + p.id)
                            .toLowerCase()
                            .includes(search.toLowerCase()),
                        ) && (
                          <p className="empty">
                            No assigned patients match your search.
                          </p>
                        )}
                      </div>
                    </>
                  }
                />
                <Route
                  path="/patients/:id"
                  element={
                    <PatientView
                      key={location.pathname}
                      state={state}
                      rounds={rounds}
                      unit={unit}
                      mutate={mutate}
                      busy={busy}
                    />
                  }
                />
                <Route
                  path="/rounds"
                  element={
                    <RoundsView
                      rounds={rounds}
                      state={state}
                      mutate={mutate}
                      busy={busy}
                      label={label}
                    />
                  }
                />
                <Route
                  path="/activity"
                  element={
                    <ActivityHome
                      key={unit}
                      state={state}
                      summaries={activity}
                      patients={patients}
                      rounds={rounds}
                      label={label}
                    />
                  }
                />
                <Route
                  path="*"
                  element={
                    <>
                      <h1>Page not found</h1>
                      <Link to="/">Return to your shift</Link>
                    </>
                  }
                />
              </Routes>
            )}
          </main>
        </SwipeNavigation>
        <footer>
          <Link to="/activity">Activity history</Link>
          Achillea · A calmer bedside workflow.
          <span>Simulated hardware. Human-confirmed care.</span>
        </footer>
      </div>
      {notice && (
        <div className="toast" role="status">
          <Check size={18} />
          {notice}
        </div>
      )}
      {
        <aside
          hidden={!demo}
          className="demo-panel"
          aria-label="Simulation control panel"
        >
          <div className="section-heading">
            <h2>
              <FlaskConical size={20} /> Demo studio
            </h2>
            <button className="secondary" onClick={() => setDemo(false)}>
              Close
            </button>
          </div>
          <p>
            Simulation controls only. Every action is recorded by the backend.
          </p>
          <DemoPresets
            key={`${unit}:${state?.demoStartedAt ?? "loading"}`}
            patients={patients}
            busy={busy}
            refresh={refresh}
            onNavigate={(pid, section) => {
              setDemo(false);
              navigate(`/patients/${pid}?section=${section}`);
            }}
          />
          <ol>
            <li>
              <button
                className="secondary"
                disabled={busy}
                onClick={() => void loadRepositioningDemo()}
              >
                Load repositioning demo
              </button>
            </li>
            <li>L&D: send a reading, open Maya, save and confirm a note.</li>
            <li>Switch to ICU. Compare partial and coordinated movement.</li>
            <li>Review movement, verify care, then complete the task.</li>
            <li>Show rounds and the activity timeline.</li>
          </ol>
          <div className="scenario-buttons">
            {[
              ["vital", "New monitor reading"],
              ["flagged", "Flagged synthetic reading"],
              ["partial", "Chest-only movement"],
              ["coordinated", "Coordinated turn candidate"],
              ...(unit === "ICU"
                ? [
                    ["pelvic-only", "Pelvis-only movement"],
                    ["sensor-delay", "Delayed sensor evidence"],
                    ["uncertain", "Uncertain sensor evidence"],
                    ["incomplete", "Incomplete sensor evidence"],
                  ]
                : []),
              ["no-movement", "Make turn review due"],
              ["disconnect", "Disconnect pelvis sensor"],
              ["reconnect", "Reconnect sensor"],
              ["monitor-disconnect", "Disconnect bedside monitor"],
              ["monitor-delay", "Delay bedside monitor"],
              ["monitor-reconnect", "Reconnect bedside monitor"],
            ].map(([key, title]) => (
              <button
                disabled={busy}
                className="secondary"
                key={key}
                onClick={() =>
                  void mutate(
                    `/demo/scenarios/${key}?patientId=${(key === "vital" || key === "flagged" || key.startsWith("monitor-") ? patients[0]?.id : state?.patients.find((p) => p.repositionPlan)?.id) ?? "synthetic-icu-01"}`,
                  ).catch(() => {})
                }
              >
                {title}
              </button>
            ))}
          </div>
          <button
            className="reset"
            disabled={busy}
            onClick={() => {
              if (
                window.confirm(
                  "Reset all synthetic demo records, including drafts?",
                )
              )
                void mutate("/demo/reset")
                  .then(() => {
                    for (const key of Object.keys(sessionStorage)) {
                      if (key.startsWith("achillea-note-"))
                        sessionStorage.removeItem(key);
                    }
                    navigate("/");
                  })
                  .catch(() => {});
            }}
          >
            <RefreshCw size={16} /> Reset synthetic demo
          </button>
          <small>
            Repositioning is enabled only by the ICU care plan. No AI key or
            hardware required.
          </small>
        </aside>
      }
    </div>
  );
}
