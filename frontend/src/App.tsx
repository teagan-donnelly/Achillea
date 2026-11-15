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
  Search,
  Users,
  Wifi,
  WifiOff,
} from "lucide-react";
import type { ActivityItem, Chart, Patient, Round, State, Task } from "./types";
import { api } from "./api";
import { PatientView } from "./PatientView";
import { RoundsView } from "./RoundsView";
import { ActivityHome, PatientCard } from "./WorkspaceViews";
import { SwipeNavigation } from "./SwipeNavigation";
import { loadWorkspace, type WorkspaceSnapshot } from "./workspace-feed";
export default function App() {
  const [state, setState] = useState<State | null>(null),
    [rounds, setRounds] = useState<Round[]>([]),
    [activity, setActivity] = useState<ActivityItem[]>([]),
    [unit, setUnit] = useState("L_AND_D"),
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
  function patientCard(p: Patient) {
    return (
      <PatientCard key={p.id} patient={p} state={state!} rounds={rounds} />
    );
  }
  return (
    <div className="app">
      <aside className="sidebar">
        <Link to="/" className="brand">
          <Leaf size={28} />
          <span>
            Achillea<small>Care that moves with you.</small>
          </span>
        </Link>
        <nav aria-label="Main navigation">
          {[
            ["/", "Activity", Activity],
            ["/patients", "Patients", Users],
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
            <FlaskConical size={18} /> Demo information
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
              onChange={(e) => {
                currentUnit.current = e.target.value;
                unitGeneration.current++;
                feed.current = null;
                setState(null);
                setActivity([]);
                setUpdatedAt(null);
                setUnit(e.target.value);
                setRounds([]);
                setSearch("");
                navigate("/");
              }}
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
            aria-label="Open demo information"
            onClick={() => setDemo(!demo)}
          >
            <FlaskConical size={19} />
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
                <strong>Unable to refresh your workspace.</strong>
                <p>
                  {error}. Check your connection and sign-in session, then
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
                  path="/patients"
                  element={
                    <>
                      <h1>Your patients</h1>
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
                      <div className="surface">
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
      <aside
        hidden={!demo}
        className="demo-panel"
        aria-label="Demo information"
      >
        <div className="section-heading">
          <h2>
            <FlaskConical size={20} /> Synthetic demo
          </h2>
          <button className="secondary" onClick={() => setDemo(false)}>
            Close
          </button>
        </div>
        <p>
          Observations, orientation and device status come from the external
          simulator. Achillea displays the stored evidence.
        </p>
        <ol>
          <li>Review assigned patients and source timestamps.</li>
          <li>Save a chart draft, review it, then explicitly confirm.</li>
          <li>Review movement evidence before verifying prescribed care.</li>
          <li>Use rounds and activity history to follow nursing work.</li>
        </ol>
        <p>Movement never confirms care. All records are synthetic.</p>
      </aside>
    </div>
  );
}
