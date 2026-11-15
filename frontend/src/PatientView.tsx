import { useCallback, useEffect, useRef, useState } from "react";
import {
  Link,
  useLocation,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { PenLine } from "lucide-react";
import type { Chart, Round, State } from "./types";
import type { Mutate } from "./TaskList";
import { latestReadings } from "./Monitoring";
import { useDemoNow } from "./RepositioningViews";
import { feedPatient } from "./monitoring-feed";
import { Pill, Screen, ScreenHeader, Segmented, type Tone } from "./ui";
import { ComposeSheet, useChartComposer } from "./patient-compose";
import { PatientSummary, type SummaryFocus } from "./patient-summary";
import { PatientTimelineFeed } from "./patient-timeline";
import { PatientTrends } from "./patient-trends";
import { PatientRecords } from "./patient-records";
import { pendingMovements } from "./patient-movements";
import { carePhase, unitShort } from "./patient-data";

/**
 * Patient record (/patients/:id): the longitudinal view of one patient — Summary, Timeline,
 * Trends and Records — plus the bedside workflows (document care, task actions, movement review,
 * repositioning confirmation). Live monitoring lives in the Monitoring tab.
 */

type Tab = "summary" | "timeline" | "trends" | "records";
const TABS: { value: Tab; label: string }[] = [
  { value: "summary", label: "Summary" },
  { value: "timeline", label: "Timeline" },
  { value: "trends", label: "Trends" },
  { value: "records", label: "Records" },
];
/** ?section= deep links used across the app, mapped onto the new tabs. */
const SECTION: Record<string, { tab: Tab; focus: SummaryFocus }> = {
  summary: { tab: "summary", focus: null },
  overview: { tab: "summary", focus: null },
  tasks: { tab: "summary", focus: "tasks" },
  repositioning: { tab: "summary", focus: "repositioning" },
  sensors: { tab: "summary", focus: "sensors" },
  timeline: { tab: "timeline", focus: null },
  history: { tab: "timeline", focus: null },
  vitals: { tab: "trends", focus: null },
  trends: { tab: "trends", focus: null },
  chart: { tab: "records", focus: null },
  records: { tab: "records", focus: null },
};
const RETURN_ROUTES = [
  "/",
  "/activity",
  "/patients",
  "/sensors",
  "/rounds",
  "/settings",
  "/repositioning",
];

export function PatientView({
  state,
  rounds,
  unit,
  mutate,
  busy,
}: {
  state: State;
  rounds: Round[];
  unit: string;
  mutate: Mutate;
  busy: boolean;
}) {
  const { id } = useParams();
  const location = useLocation();
  const from: unknown = location.state?.from;
  const returnTo =
    typeof from === "string" &&
    (RETURN_ROUTES.includes(from) || from.startsWith("/monitoring/"))
      ? from
      : "/patients";
  const [params, setParams] = useSearchParams();
  const now = useDemoNow(state);
  const tabsRef = useRef<HTMLDivElement>(null);
  const p = state.patients.find((x) => x.id === id && x.unit === unit);
  const requested = state.charts.find(
    (c) =>
      c.id === params.get("entry") &&
      c.patientId === id &&
      c.status === "DRAFT",
  );
  const section = SECTION[params.get("section") ?? ""];
  const [tab, setTab] = useState<Tab>(
    section?.tab ?? (requested ? "records" : "summary"),
  );
  // Tasks links "Document" to ?section=chart&task=<id>: open documentation with that task linked.
  const taskParam = state.tasks.find(
    (t) => t.id === params.get("task") && t.patientId === id,
  )?.id;
  const [composeOpen, setComposeOpen] = useState(
    !!requested || !!taskParam || params.get("compose") === "1",
  );
  const vitals = state.vitals.filter((v) => v.patientId === id);
  const current = latestReadings(vitals);
  const composer = useChartComposer({
    patientId: id,
    state,
    mutate,
    current,
    requested,
    initialTask: taskParam,
  });

  // Follow ?section= when another screen deep-links into this record.
  const [lastSection, setLastSection] = useState(section);
  if (section !== lastSection) {
    setLastSection(section);
    if (section) setTab(section.tab);
  }

  const selectTab = (next: Tab) => {
    setTab(next);
    const q = new URLSearchParams(params);
    q.set("section", next);
    q.delete("entry");
    q.delete("task");
    q.delete("compose");
    setParams(q, { replace: true, state: location.state });
    // Keep the section switcher in view when switching from deep in a long tab.
    const bar = tabsRef.current;
    const headerHeight =
      tabsRef.current?.parentElement
        ?.querySelector(".ach-header")
        ?.getBoundingClientRect().height ?? 72;
    if (bar && bar.getBoundingClientRect().top < headerHeight)
      bar.scrollIntoView?.({ block: "start" });
  };

  useEffect(() => {
    const anchor = window.location.hash.slice(1);
    if (anchor && tab === "summary")
      document.getElementById(anchor)?.scrollIntoView?.({ block: "center" });
  }, [tab, id]);

  const closeCompose = useCallback(() => setComposeOpen(false), []);
  const backLabel =
    returnTo === "/rounds"
      ? "Back to Tasks"
      : returnTo === "/" || returnTo.startsWith("/monitoring")
        ? "Back to Monitoring"
        : returnTo === "/activity"
          ? "Back to Handoff"
          : returnTo === "/settings"
            ? "Back to Settings"
            : "Back to patients";

  if (!p)
    return (
      <Screen className="pt-profile">
        <ScreenHeader
          title="Patient"
          back="/patients"
          backLabel="Back to patients"
        />
        <div className="pt-missing">
          <h2>Patient unavailable in this demo unit.</h2>
          <p>Switch to the patient’s assigned unit to continue.</p>
          <Link to="/patients">Back to assigned patients</Link>
        </div>
      </Screen>
    );

  const feed = feedPatient(state, p, now);
  const drafts = state.charts.filter(
    (c) => c.patientId === p.id && c.status === "DRAFT",
  ).length;
  const pending = p.repositionPlan ? pendingMovements(state, p.id) : 0;
  const offline = feed.offlineDevices.filter(
    (d) => d.state !== "No recent data",
  ).length;
  const flags: { text: string; tone: Tone }[] = [];
  if (offline)
    flags.push({
      text:
        offline === 1
          ? `${feed.offlineDevices.find((d) => d.state !== "No recent data")!.region} offline`
          : `${offline} devices offline`,
      tone: "grey",
    });
  if (pending)
    flags.push({
      text: `${pending} movement${pending > 1 ? "s" : ""} to review`,
      tone: "amber",
    });
  if (drafts)
    flags.push({
      text: `${drafts} draft${drafts > 1 ? "s" : ""} to confirm`,
      tone: "amber",
    });
  const phase = carePhase(p);

  const startFrom = (c: Chart) => {
    if (composer.startFrom(c)) setComposeOpen(true);
  };

  return (
    <Screen className="pt-profile">
      <div data-no-swipe>
        <ScreenHeader
          title={p.name}
          subtitle={`Room ${p.room} · ${unitShort(p.unit)}${phase ? ` · ${phase}` : ""}`}
          back={returnTo}
          backLabel={backLabel}
          right={
            <button
              type="button"
              className="ach-icon-button pt-compose-button"
              aria-label="Document care"
              title={
                composer.dirty
                  ? "Document care (unsaved draft)"
                  : "Document care"
              }
              onClick={() => setComposeOpen(true)}
            >
              <PenLine aria-hidden strokeWidth={1.75} />
              {composer.dirty && !composeOpen && (
                <span className="pt-compose-dot" aria-hidden />
              )}
            </button>
          }
        />
        {composer.storageError && (
          <p className="pt-alert" role="alert">
            Browser draft retention is unavailable. Save your draft before
            leaving this patient.
          </p>
        )}
        {composer.dirty && !composeOpen && (
          <button
            type="button"
            className="pt-resume-note"
            onClick={() => setComposeOpen(true)}
          >
            <PenLine aria-hidden size={18} />
            <span>
              <strong>Continue working note</strong>
              <small>
                {composer.needsSave
                  ? composer.storageError
                    ? "Not saved; save before leaving this patient"
                    : "Changes kept in this browser; save to the record"
                  : "Saved draft ready for your review"}
              </small>
            </span>
            <span className="pt-resume-action">Resume</span>
          </button>
        )}
        {flags.length > 0 && (
          <ul className="pt-flags" aria-label="Patient flags">
            {flags.map((f) => (
              <li key={f.text}>
                <Pill tone={f.tone}>{f.text}</Pill>
              </li>
            ))}
          </ul>
        )}

        <div ref={tabsRef} className="pt-tabs">
          <Segmented
            label="Patient record sections"
            options={TABS}
            value={tab}
            onChange={selectTab}
          />
        </div>

        <div className="pt-panel">
          {tab === "summary" && (
            <PatientSummary
              state={state}
              patient={p}
              rounds={rounds}
              mutate={mutate}
              busy={busy}
              now={now}
              focus={section?.focus ?? null}
            />
          )}
          {tab === "timeline" && (
            <PatientTimelineFeed state={state} patient={p} now={now} />
          )}
          {tab === "trends" && (
            <PatientTrends state={state} patient={p} now={now} />
          )}
          {tab === "records" && (
            <PatientRecords
              state={state}
              patientId={p.id}
              now={now}
              onEdit={startFrom}
            />
          )}
        </div>
      </div>

      <ComposeSheet
        open={composeOpen}
        onClose={closeCompose}
        composer={composer}
        patient={p}
        state={state}
        current={current}
        busy={busy}
        now={now}
        onConfirmed={() => {
          setComposeOpen(false);
          setTab("records");
        }}
      />
    </Screen>
  );
}
