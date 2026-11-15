import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  Check,
  ChevronDown,
  CloudOff,
  Save,
  ShieldCheck,
} from "lucide-react";
import type { ScreenProps } from "./app-context";
import type { Patient } from "./types";
import { Avatar, Screen, ScreenHeader, Section } from "./ui";
import { useDemoNow } from "./RepositioningViews";
import { setNurseSnapshot, useHandoffContext } from "./handoff-context";
import { LastShiftCard, PatientTabs, SnapshotEditor, SummaryCarousel, ringFor } from "./handoff-ui";
import { GapsCard, NextStepBar, hasRecorded, reportSections, buildReport, type NextStep, type ReportContext } from "./handoff-report";
import {
  HandoffApiError,
  UNAVAILABLE_MESSAGE,
  acknowledgeHandoff,
  createHandoff,
  getHandoff,
  markHandoffReady,
  markHandoffReviewed,
  saveHandoffDraft,
} from "./handoff-api";
import {
  EMPTY_SECTIONS,
  SECTION_FIELDS,
  type Handoff,
  type HandoffDetail,
  type HandoffSections,
  type HandoffStatus,
} from "./handoff-types";
import {
  brief,
  clock,
  openTasks,
  previousHandoffs,
  shiftDay,
  shiftName,
  shiftOf,
  staffName,
  stamp,
  STATUS_PILL,
  taskState,
} from "./handoff-model";
import type { HandoffList } from "./Handoff";

const STEPS: HandoffStatus[] = ["DRAFT", "READY", "REVIEWED", "ACKNOWLEDGED"];
const NOTE_GROUPS: { title: string; keys: (keyof HandoffSections)[] }[] = [
  { title: "Situation", keys: ["currentConcerns"] },
  { title: "This shift", keys: ["changesDuringShift", "interventionsAndResponse"] },
  { title: "For the next shift", keys: ["outstandingFollowUp", "nextShiftPriorities"] },
  { title: "Other", keys: ["additionalObservations"] },
];

const sameSections = (a: HandoffSections, b: HandoffSections) =>
  SECTION_FIELDS.every((f) => (a[f.key] ?? "") === (b[f.key] ?? ""));

/** Native disclosure with a quiet chevron; used for every expandable block on this screen. */
function Disclosure({
  summary,
  children,
  defaultOpen = false,
  className = "",
}: {
  summary: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  className?: string;
}) {
  return (
    <details
      className={`hx-disclosure ${className}`}
      open={defaultOpen || undefined}
    >
      <summary>
        <span className="hx-disclosure-main">{summary}</span>
        <ChevronDown
          className="hx-disclosure-chev"
          aria-hidden
          strokeWidth={2}
        />
      </summary>
      <div className="hx-disclosure-body">{children}</div>
    </details>
  );
}

interface Props extends ScreenProps {
  handoffId: string | null;
  patientId: string | null;
  list: HandoffList;
  backTo: string;
  onOpen: (id: string) => void;
}

/** One handoff, expanded: facts from live state (sections 1-4), nurse notes (5), earlier shifts (6). */
export function HandoffDetailView({
  state,
  patients,
  rounds,
  handoffId,
  patientId,
  list,
  backTo,
  onOpen,
}: Props) {
  const now = useDemoNow(state);
  const [detail, setDetail] = useState<HandoffDetail | null>(null);
  const [loadError, setLoadError] = useState("");
  const [draft, setDraft] = useState<HandoffSections>(EMPTY_SECTIONS);
  const [receiver, setReceiver] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const [savedMessage, setSavedMessage] = useState("");
  const [verified, setVerified] = useState(false);
  const [pane, setPane] = useState("summary");
  const { ctx, reload: reloadCtx } = useHandoffContext(
    detail?.handoff.patientId ?? patientId ?? undefined,
    state,
  );

  const load = useCallback(async () => {
    if (!handoffId) return;
    try {
      const next = await getHandoff(handoffId);
      setDetail(next);
      setDraft({ ...EMPTY_SECTIONS, ...next.handoff.sections });
      setReceiver(next.handoff.receiverId ?? "");
      setLoadError("");
    } catch (e) {
      setLoadError(
        e instanceof HandoffApiError && e.status === 404
          ? "This handoff could not be found. Return to the handoff list and try again."
          : (e as Error).message,
      );
    }
  }, [handoffId]);
  useEffect(() => {
    void load();
  }, [load]);

  const handoff: Handoff | null = detail?.handoff ?? null;
  const pid = handoff?.patientId ?? patientId ?? "";
  const patient: Patient | undefined =
    state.patients.find((p) => p.id === pid) ??
    patients.find((p) => p.id === pid);
  const name = handoff?.patientName ?? patient?.name ?? "Patient";
  const room = handoff?.room ?? patient?.room ?? "—";
  const unitName =
    (handoff?.unit ?? patient?.unit) === "ICU" ? "ICU" : "Labor & delivery";
  const shift = handoff
    ? { shiftDate: handoff.shiftDate, shiftLabel: handoff.shiftLabel }
    : shiftOf(now);

  const tasks = useMemo(
    () => (pid ? openTasks(state, rounds, pid) : []),
    [state, rounds, pid],
  );
  const earlier = previousHandoffs(list.handoffs, pid, handoff?.id);
  const overdue = tasks.filter(
    (t) => taskState(t, now).label === "Overdue",
  ).length;

  const editable = handoff?.status === "DRAFT";
  const dirty =
    !!handoff &&
    editable &&
    (!sameSections(draft, { ...EMPTY_SECTIONS, ...handoff.sections }) ||
      receiver.trim() !== (handoff.receiverId ?? ""));
  const hasContent = SECTION_FIELDS.some((f) => draft[f.key].trim());

  useEffect(() => {
    if (!dirty) return;
    const warnBeforeReload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    const warnBeforeNavigation = (event: MouseEvent) => {
      if (
        event.button !== 0 ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const link =
        event.target instanceof Element
          ? event.target.closest("a[href]")
          : null;
      if (!link || link.getAttribute("href")?.startsWith("#")) return;
      if (
        !window.confirm("You have unsaved handoff notes. Leave without saving?")
      ) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", warnBeforeReload);
    document.addEventListener("click", warnBeforeNavigation, true);
    return () => {
      window.removeEventListener("beforeunload", warnBeforeReload);
      document.removeEventListener("click", warnBeforeNavigation, true);
    };
  }, [dirty]);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setActionError("");
    setSavedMessage("");
    try {
      await action();
      await Promise.all([load(), list.reload()]);
      setSavedMessage("Handoff saved");
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // Autosave: persist the draft 2 s after the last edit without reloading the form (no lost keystrokes).
  useEffect(() => {
    if (!handoff || !editable || !dirty || busy) return;
    const id = handoff.id;
    const timer = setTimeout(async () => {
      try {
        const saved = await saveHandoffDraft(id, {
          sections: draft,
          receiverId: receiver.trim(),
        });
        setDetail((d) => (d && d.handoff.id === id ? { ...d, handoff: saved } : d));
        setSavedMessage("Draft autosaved");
      } catch {
        // Manual save still reports errors; autosave retries on the next edit.
      }
    }, 2000);
    return () => clearTimeout(timer);
  }, [handoff, editable, dirty, busy, draft, receiver]);

  function saveDraft() {
    if (!handoff || !editable || !dirty || busy) return;
    void run(() =>
      saveHandoffDraft(handoff.id, {
        sections: draft,
        receiverId: receiver.trim(),
      }),
    );
  }

  async function start() {
    if (!patientId) return;
    setBusy(true);
    setActionError("");
    try {
      const created = await createHandoff({ patientId });
      await list.reload();
      onOpen(created.id);
    } catch (e) {
      setActionError(
        e instanceof HandoffApiError && e.status === 404
          ? UNAVAILABLE_MESSAGE
          : (e as Error).message,
      );
    } finally {
      setBusy(false);
    }
  }

  const pill = handoff ? STATUS_PILL[handoff.status] : null;

  const heroRing = ringFor(
    (ctx as ReportContext | null) ?? undefined,
    !!handoff && (handoff.status === "READY" || handoff.status === "REVIEWED"),
    handoff?.status === "ACKNOWLEDGED",
  );
  const missingCount = heroRing.toCheck;
  const nextStep: NextStep | null = !handoff
    ? handoffId
      ? null
      : { label: "Start handoff", hint: "Report generated from the record", run: () => void start(), disabled: busy }
    : handoff.status === "DRAFT"
      ? !hasContent && hasRecorded(ctx as ReportContext)
        ? {
            label: "Use report as notes",
            hint: "Notes are empty",
            run: () => {
              setDraft(reportSections(buildReport(ctx as ReportContext, draft, name, room), draft));
              setSavedMessage("");
              setPane("notes");
            },
          }
        : dirty
          ? { label: "Save", hint: "Unsaved changes", run: saveDraft, disabled: busy }
          : {
              label: "Mark ready",
              hint: missingCount ? `${missingCount} missing or unverified` : "Nothing missing",
              run: () => void run(() => markHandoffReady(handoff.id)),
              disabled: busy || !hasContent,
            }
      : handoff.status === "READY"
        ? { label: "Mark reviewed", hint: "Ready for the next nurse", run: () => void run(() => markHandoffReviewed(handoff.id)), disabled: busy }
        : handoff.status === "REVIEWED"
          ? { label: "Verify receipt", hint: "Incoming nurse", run: () => setPane("notes") }
          : null;

  return (
    <Screen className="hx hx-detail">
      <ScreenHeader
        back={backTo}
        backLabel="Back to Handoff"
        title="Handoff"
        subtitle={pid ? `Room ${room} · ${name}` : undefined}
        right={
          editable ? (
            <button
              type="button"
              className="ach-icon-button"
              aria-label="Save handoff draft"
              title="Save handoff draft"
              disabled={busy || !dirty}
              onClick={saveDraft}
            >
              <Save aria-hidden strokeWidth={1.75} />
            </button>
          ) : undefined
        }
      />

      <div className="hu-hero">
        <Avatar name={name} tone={heroRing.toCheck ? "amber" : "green"} />
        <div>
          <h2>{name}</h2>
          <p>
            Room {room} · {unitName} · {shift.shiftLabel} {shiftDay(shift.shiftDate)}
          </p>
          <div className="hu-stats">
            <span className={heroRing.toCheck ? "is-warn" : undefined}>
              <b>{heroRing.toCheck}</b>to check
            </span>
            <span className={overdue ? "is-warn" : undefined}>
              <b>{tasks.length}</b>open tasks
            </span>
            <span>
              <b>{pill ? pill.label : "Not started"}</b>handoff
            </span>
          </div>
        </div>
      </div>

      {loadError && (
        <div className="hx-notice" role="alert">
          <CloudOff aria-hidden strokeWidth={1.75} />
          <strong>Couldn’t load handoff</strong>
          <button type="button" className="hx-link-button" onClick={() => void load()}>
            Retry
          </button>
        </div>
      )}

      <PatientTabs
        active={pane}
        onChange={setPane}
        panes={[
          {
            key: "summary",
            label: "Summary",
            content: (
              <>
                <LastShiftCard handoff={earlier[0]} />
                {ctx && (
                  <SummaryCarousel
                    ctx={ctx as ReportContext}
                    draft={draft}
                    name={name}
                    room={room}
                    editable={!!editable}
                    onUse={(sections) => {
                      setDraft(sections);
                      setSavedMessage("");
                      setPane("notes");
                    }}
                  />
                )}
              </>
            ),
          },
          {
            key: "check",
            label: "Check",
            count: heroRing.toCheck,
            content: ctx ? (
              <GapsCard ctx={ctx as ReportContext} draft={draft} onChanged={reloadCtx} onFillSnapshot={() => setPane("notes")} />
            ) : (
              <p className="hu-empty">Loading…</p>
            ),
          },
          {
            key: "notes",
            label: "Notes",
            content: (
              <>
                <div className="hu-card hu-notes-card">
      {/* ---------- 5 Notes for the next shift ---------- */}
      <div id="hx-notes" className="hx-anchor" />
      <Section title="Notes">
        {handoff ? (
          <>
            <ol className="hx-steps" aria-label="Handoff progress">
              {STEPS.map((s, i) => {
                const reached = STEPS.indexOf(handoff.status) >= i;
                const at =
                  s === "DRAFT"
                    ? handoff.createdAt
                    : s === "READY"
                      ? handoff.readyAt
                      : s === "REVIEWED"
                        ? handoff.reviewedAt
                        : handoff.acknowledgedAt;
                return (
                  <li
                    key={s}
                    className={reached ? "is-reached" : undefined}
                    aria-current={handoff.status === s ? "step" : undefined}
                  >
                    <span className="hx-step-dot" aria-hidden>
                      {reached && <Check strokeWidth={3} />}
                    </span>
                    <span className="hx-step-label">
                      {STATUS_PILL[s].label}
                    </span>
                    <span className="hx-step-time">
                      {reached && at ? clock(at) : ""}
                    </span>
                  </li>
                );
              })}
            </ol>

            <div
              className="hx-notes"
              onKeyDown={(event) => {
                if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
                  event.preventDefault();
                  saveDraft();
                }
              }}
            >
              {editable && hasRecorded(ctx as ReportContext) && (
                <button
                  type="button"
                  className="hu-fill"
                  onClick={() => {
                    setDraft(reportSections(buildReport(ctx as ReportContext, draft, name, room), draft));
                    setSavedMessage("");
                  }}
                >
                  Fill from shift summary
                </button>
              )}
              {NOTE_GROUPS.map((g) => (
                <fieldset key={g.title} className="hu-note-group">
                  <legend>{g.title}</legend>
                  {g.keys.map((key) => {
                    const f = SECTION_FIELDS.find((x) => x.key === key)!;
                    const text = draft[f.key];
                    return (
                      <label key={f.key} className="hu-note-field">
                        <span>{f.label}</span>
                        {editable ? (
                          <textarea
                            aria-label={f.label}
                            placeholder={f.hint}
                            value={text}
                            disabled={busy}
                            maxLength={5000}
                            rows={Math.min(8, Math.max(2, text.split(/\n/).length + 1))}
                            onChange={(e) => {
                              setDraft({ ...draft, [f.key]: e.target.value });
                              setSavedMessage("");
                            }}
                          />
                        ) : (
                          <p className="hx-note-text">{text.trim() || "Empty"}</p>
                        )}
                      </label>
                    );
                  })}
                </fieldset>
              ))}
            </div>

            {editable && (
              <label className="hx-field">
                <span>Receiving nurse</span>
                <input
                  value={receiver}
                  disabled={busy}
                  placeholder="Optional"
                  maxLength={160}
                  onChange={(e) => {
                    setReceiver(e.target.value);
                    setSavedMessage("");
                  }}
                />
              </label>
            )}

            <div className="hx-actions">
              {handoff.status === "DRAFT" && (
                <>
                  <p className="hx-action-hint" id="hx-ready-hint">
                    {dirty
                      ? "Unsaved changes — save your draft before marking it ready."
                      : !hasContent
                        ? "Notes are empty."
                        : "Draft saved."}
                  </p>
                  <div className="hx-action-row">
                    <button
                      type="button"
                      className="ach-button secondary"
                      disabled={busy || !dirty}
                      onClick={saveDraft}
                    >
                      {busy ? "Saving…" : "Save draft"}
                    </button>
                    <button
                      type="button"
                      className="ach-button"
                      aria-describedby="hx-ready-hint"
                      disabled={busy || dirty || !hasContent}
                      onClick={() =>
                        void run(() => markHandoffReady(handoff.id))
                      }
                    >
                      Mark ready
                    </button>
                  </div>
                </>
              )}
              {handoff.status === "READY" && (
                <>
                  <div className="hx-action-row">
                    <button
                      type="button"
                      className="ach-button"
                      disabled={busy}
                      onClick={() =>
                        void run(() => markHandoffReviewed(handoff.id))
                      }
                    >
                      Mark reviewed
                    </button>
                  </div>
                </>
              )}
              {handoff.status === "REVIEWED" && (
                <>
                  <label className="hx-verify">
                    <input
                      type="checkbox"
                      checked={verified}
                      onChange={(e) => setVerified(e.target.checked)}
                    />
                    <span>
                      I’ve reviewed these notes and the outstanding care
                    </span>
                  </label>
                  <div className="hx-action-row">
                    <button
                      type="button"
                      className="ach-button"
                      disabled={busy || !verified}
                      onClick={() =>
                        void run(() => acknowledgeHandoff(handoff.id))
                      }
                    >
                      Acknowledge
                    </button>
                  </div>
                </>
              )}
              {handoff.status === "ACKNOWLEDGED" && (
                <p className="hx-done">
                  <ShieldCheck aria-hidden strokeWidth={1.75} />
                  Acknowledged by {staffName(handoff.acknowledgedBy)}
                  {handoff.acknowledgedAt
                    ? ` · ${stamp(handoff.acknowledgedAt)}`
                    : ""}
                </p>
              )}
              {actionError && (
                <p className="hx-inline-error" role="alert">
                  {actionError}
                </p>
              )}
              {savedMessage && (
                <p className="hx-save-status" role="status">
                  {savedMessage}
                </p>
              )}
            </div>

            {detail && detail.versions.length > 0 && (
              <Disclosure
                className="hx-versions"
                summary={
                  <>
                    <span className="hx-disclosure-title">Version history</span>
                    <span className="hx-disclosure-preview">
                      {detail.versions.length} saved version
                      {detail.versions.length === 1 ? "" : "s"}
                    </span>
                  </>
                }
              >
                <ol className="hx-version-list">
                  {[...detail.versions]
                    .sort((a, b) => b.version - a.version)
                    .map((v) => (
                      <li key={v.id}>
                        <Disclosure
                          summary={
                            <>
                              <span className="hx-disclosure-title">
                                Version {v.version}
                                {v.version === handoff.version && (
                                  <span className="hx-current"> · current</span>
                                )}
                              </span>
                              <span className="hx-disclosure-preview">
                                {staffName(v.savedBy)} · {stamp(v.savedAt)}
                              </span>
                            </>
                          }
                        >
                          <dl className="hx-dl">
                            {SECTION_FIELDS.filter((f) =>
                              v.sections?.[f.key]?.trim(),
                            ).map((f) => (
                              <div key={f.key}>
                                <dt>{f.label}</dt>
                                <dd className="hx-pre">{v.sections[f.key]}</dd>
                              </div>
                            ))}
                            {!SECTION_FIELDS.some((f) =>
                              v.sections?.[f.key]?.trim(),
                            ) && <p className="hx-quiet">Empty draft</p>}
                          </dl>
                        </Disclosure>
                      </li>
                    ))}
                </ol>
              </Disclosure>
            )}
          </>
        ) : handoffId ? (
          !loadError && <p className="hx-quiet">Loading handoff…</p>
        ) : (
          <div className="hx-start-card">
            <button
              type="button"
              className="ach-button"
              disabled={busy || list.status === "unavailable"}
              onClick={() => void start()}
            >
              Start handoff
            </button>
            {actionError && (
              <p className="hx-inline-error" role="alert">
                {actionError}
              </p>
            )}
          </div>
        )}
      </Section>

                </div>
                {ctx && (
                  <SnapshotEditor
                    ctx={ctx}
                    draft={draft}
                    editable={!!editable}
                    onChange={(label, value) => {
                      setDraft(setNurseSnapshot(draft, label, value));
                      setSavedMessage("");
                    }}
                  />
                )}
              </>
            ),
          },
          {
            key: "history",
            label: "History",
            content: (
              <div className="hu-card">
      {/* ---------- 6 Previous shift history ---------- */}
      <Section title="Previous shifts" count={earlier.length}>
        {earlier.length === 0 ? (
          <p className="hx-quiet">No earlier handoffs</p>
        ) : (
          <ul className="hx-history">
            {earlier.map((h) => (
              <li key={h.id}>
                <Disclosure
                  summary={
                    <>
                      <span className="hx-disclosure-title">
                        {shiftDay(h.shiftDate)} · {shiftName(h.shiftLabel)}
                      </span>
                      <span className="hx-disclosure-preview">
                        {staffName(h.senderId)} · {STATUS_PILL[h.status].label}
                        {h.acknowledgedAt ? ` ${clock(h.acknowledgedAt)}` : ""}
                      </span>
                    </>
                  }
                >
                  <p className="hx-note-text">
                    {brief(h.sections?.currentConcerns, 220) ||
                      "No concerns written"}
                  </p>
                  <button
                    type="button"
                    className="hx-link-button"
                    onClick={() => {
                      if (
                        !dirty ||
                        window.confirm(
                          "You have unsaved handoff notes. Leave without saving?",
                        )
                      )
                        onOpen(h.id);
                    }}
                  >
                    Open full handoff
                  </button>
                </Disclosure>
              </li>
            ))}
          </ul>
        )}
      </Section>
              </div>
            ),
          },
        ]}
      />
      <NextStepBar step={nextStep} />
    </Screen>
  );
}
