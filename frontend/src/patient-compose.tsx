// Bedside documentation for the patient record: draft -> save -> explicit verification -> confirm,
// and append-only amendments of confirmed entries. Logic is unchanged from the previous
// PatientView; only the presentation moved into a bottom sheet.
import { useEffect, useId, useRef, useState } from "react";
import type { Chart, Patient, State, Vital } from "./types";
import type { Mutate } from "./app-context";
import { metricName } from "./Monitoring";
import { BottomSheet } from "./ui";
import { clock, entryTypeName, stamp } from "./patient-data";

const noteKey = (id: string) => `achillea-note-${id}`;

export function useChartComposer({
  patientId,
  state,
  mutate,
  current,
  requested,
  initialTask,
}: {
  patientId: string | undefined;
  state: State;
  mutate: Mutate;
  /** Latest reading per metric (linked when "include latest observations" is checked). */
  current: Vital[];
  /** Draft requested through ?entry=, if any. */
  requested?: Chart;
  /** Task to link when documentation was opened from a task (?task=). */
  initialTask?: string;
}) {
  const [text, setText] = useState(requested?.text ?? ""),
    [type, setType] = useState(requested?.type ?? "OBSERVATION"),
    [draft, setDraft] = useState(requested?.id ?? ""),
    [verified, setVerified] = useState(false),
    [linkVitals, setLinkVitals] = useState(!!requested?.linkedVitalIds.length),
    [task, setTask] = useState(requested?.linkedTaskId ?? initialTask ?? ""),
    [amend, setAmend] = useState(""),
    [dirty, setDirty] = useState(false),
    [needsSave, setNeedsSave] = useState(true),
    [storageError, setStorageError] = useState(false),
    [savingDraft, setSavingDraft] = useState(false);
  const saving = useRef(false);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  // Restore an unconfirmed working note for this patient only.
  useEffect(() => {
    if (!patientId) return;
    let saved: string | null = null;
    try {
      saved = sessionStorage.getItem(noteKey(patientId));
    } catch {
      setStorageError(true);
    }
    if (saved) {
      try {
        const note = JSON.parse(saved);
        setText(note.text ?? "");
        setType(note.type ?? "OBSERVATION");
        setTask(note.task ?? "");
        setLinkVitals(!!note.linkVitals);
        setDraft(note.draft ?? "");
        setAmend(note.amend ?? "");
        setDirty(true);
      } catch {
        /* Ignore invalid local draft. */
      }
    }
  }, [patientId]);

  useEffect(() => {
    if (patientId && dirty)
      try {
        sessionStorage.setItem(
          noteKey(patientId),
          JSON.stringify({ text, type, task, linkVitals, draft, amend }),
        );
      } catch {
        setStorageError(true);
      }
  }, [patientId, dirty, text, type, task, linkVitals, draft, amend]);

  /** Any edit invalidates the saved draft and the verification. */
  const edited = () => {
    setDirty(true);
    setNeedsSave(true);
    setVerified(false);
  };

  async function save() {
    if (saving.current || !text.trim()) return false;
    saving.current = true;
    setSavingDraft(true);
    try {
      const body = {
        patientId,
        type,
        text,
        linkedTaskId: task || null,
        linkedVitalIds: linkVitals ? current.map((v) => v.id) : [],
      };
      const result = (await mutate(
        amend
          ? `/chart/${amend}/amendments`
          : draft
            ? `/chart/drafts/${draft}`
            : "/chart/drafts",
        body,
        draft && !amend ? "PATCH" : "POST",
      )) as Chart;
      setDirty(true);
      setNeedsSave(false);
      setDraft(result.id);
      setAmend("");
      setVerified(false);
      return true;
    } catch {
      /* App shows the error toast. */
      return false;
    } finally {
      saving.current = false;
      setSavingDraft(false);
    }
  }

  async function confirm() {
    if (saving.current) return false;
    saving.current = true;
    setSavingDraft(true);
    try {
      await mutate(`/chart/drafts/${draft}/confirm`, { verified });
      setDraft("");
      setText("");
      setDirty(false);
      setNeedsSave(true);
      try {
        sessionStorage.removeItem(noteKey(patientId ?? ""));
      } catch {
        /* Storage unavailable. */
      }
      setVerified(false);
      return true;
    } catch {
      return false;
    } finally {
      saving.current = false;
      setSavingDraft(false);
    }
  }

  /** Load an existing entry: drafts are edited in place, confirmed entries get an appended amendment. */
  function startFrom(c: Chart) {
    if (
      dirty &&
      text.trim() &&
      !window.confirm(
        "Replace the current working note with this entry? Save your draft first to keep it in the demo record.",
      )
    )
      return false;
    setNeedsSave(c.status !== "DRAFT");
    setDirty(true);
    setText(c.status === "DRAFT" ? c.text : "");
    setDraft(c.status === "DRAFT" ? c.id : "");
    setAmend(c.status === "DRAFT" ? "" : c.id);
    setType(c.type);
    setTask(c.linkedTaskId ?? "");
    setLinkVitals(c.linkedVitalIds.length > 0);
    setVerified(false);
    return true;
  }

  const saved = state.charts.find((c) => c.id === draft);
  const canConfirm =
    !!saved &&
    !needsSave &&
    verified &&
    saved.text === text &&
    saved.type === type &&
    (saved.linkedTaskId ?? "") === task;

  return {
    text,
    setText,
    type,
    setType,
    task,
    setTask,
    linkVitals,
    setLinkVitals,
    verified,
    setVerified,
    draft,
    amend,
    dirty,
    needsSave,
    storageError,
    saving: savingDraft,
    saved,
    canConfirm,
    edited,
    save,
    confirm,
    startFrom,
  };
}

export type Composer = ReturnType<typeof useChartComposer>;

export function ComposeSheet({
  open,
  onClose,
  composer: c,
  patient: p,
  state,
  current,
  busy,
  now,
  onConfirmed,
}: {
  open: boolean;
  onClose: () => void;
  composer: Composer;
  patient: Patient;
  state: State;
  current: Vital[];
  busy: boolean;
  now: number;
  onConfirmed: () => void;
}) {
  const amending = c.amend
    ? state.charts.find((x) => x.id === c.amend)
    : undefined;
  const review = useRef<HTMLHeadingElement>(null);
  const hintId = useId();
  const locked = busy || c.saving;
  async function saveDraft() {
    if (await c.save()) {
      requestAnimationFrame(() => {
        review.current?.scrollIntoView?.({
          block: "nearest",
          behavior: "auto",
        });
        review.current?.focus({ preventScroll: true });
      });
    }
  }
  const linkedTask = state.tasks.find(
    (task) => task.id === c.task && task.patientId === p.id,
  );
  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={
        c.amend
          ? "Append correction"
          : c.draft
            ? "Edit bedside draft"
            : "Document care"
      }
      footer={
        <div className="pt-compose-actions">
          <span className="pt-compose-status" role="status">
            {locked
              ? "Saving to the record..."
              : c.needsSave
                ? c.dirty
                  ? "Changes not saved to the record"
                  : "Save a draft, then review to confirm"
                : "Draft saved. Review before confirming."}
          </span>
          <div className="pt-compose-buttons">
            <button
              type="button"
              className={`ach-button pt-save${c.draft && !c.needsSave ? " secondary" : ""}`}
              disabled={locked || !c.text.trim() || (!!c.draft && !c.needsSave)}
              onClick={() => void saveDraft()}
            >
              Save draft
            </button>
            {c.draft && (
              <button
                type="button"
                className="ach-button"
                disabled={locked || !c.canConfirm}
                onClick={() =>
                  void c.confirm().then((ok) => {
                    if (ok) onConfirmed();
                  })
                }
              >
                Confirm entry
              </button>
            )}
          </div>
        </div>
      }
    >
      <div
        className="pt-compose"
        onKeyDown={(event) => {
          if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
            event.preventDefault();
            event.stopPropagation();
            if (!locked && c.text.trim() && (c.needsSave || !c.draft))
              void saveDraft();
          }
        }}
      >
        <p className="pt-compose-for">
          <strong>{p.name}</strong> · Room {p.room}
        </p>
        {amending && (
          <p className="pt-compose-note">
            Amends {entryTypeName(amending.type).toLowerCase()} ·{" "}
            {stamp(amending.confirmedAt ?? amending.authoredAt, now)}
          </p>
        )}
        <label className="pt-field pt-narrative">
          <span>Observation / nurse narrative</span>
          <textarea
            aria-label="Observation / nurse narrative"
            aria-describedby={hintId}
            disabled={locked}
            maxLength={5000}
            rows={5}
            value={c.text}
            onChange={(e) => {
              c.setText(e.target.value);
              c.edited();
            }}
            placeholder="Enter your synthetic bedside observation"
          />
          <span id={hintId} className="pt-writing-hint">
            <span>Write what you observed and the patient's response.</span>
            <span>{c.text.length.toLocaleString()} / 5,000</span>
          </span>
        </label>
        <details
          className="pt-entry-options"
          open={!!c.task || c.type !== "OBSERVATION" || undefined}
        >
          <summary>
            <span>
              Entry details
              <span>
                {entryTypeName(c.type)}
                {linkedTask ? ` / ${linkedTask.title}` : " / No task linked"}
              </span>
            </span>
          </summary>
          <div className="pt-entry-options-body">
            <label className="pt-field">
              <span>Entry type</span>
              <select
                disabled={locked}
                value={c.type}
                onChange={(e) => {
                  c.setType(e.target.value);
                  c.edited();
                }}
              >
                <option value="OBSERVATION">Nursing observation</option>
                <option value="ASSESSMENT">Bedside assessment</option>
                <option value="CARE_NOTE">Care note</option>
              </select>
            </label>
            <label className="pt-field">
              <span>Link a care task</span>
              <select
                disabled={locked}
                value={c.task}
                onChange={(e) => {
                  c.setTask(e.target.value);
                  c.edited();
                }}
              >
                <option value="">No task linked</option>
                {state.tasks
                  .filter((t) => t.patientId === p.id)
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.title}
                    </option>
                  ))}
              </select>
            </label>
          </div>
        </details>
        <label className="pt-check">
          <input
            type="checkbox"
            disabled={locked}
            checked={c.linkVitals}
            onChange={(e) => {
              c.setLinkVitals(e.target.checked);
              c.edited();
            }}
          />
          <span>Include latest simulated observations in saved draft</span>
        </label>
        {c.linkVitals && (
          <ul className="pt-provenance">
            {current.map((v) => (
              <li key={v.id}>
                {metricName(v.metric)}: {v.value} {v.unit} ·{" "}
                {clock(v.observedAt)} · {v.source}
              </li>
            ))}
            {!current.length && (
              <li>No simulated observations are available to link.</li>
            )}
          </ul>
        )}
        {c.draft && (
          <div className="pt-confirm">
            {c.needsSave && (
              <p role="status">
                Save your changes before confirming this entry.
              </p>
            )}
            <h3 ref={review} tabIndex={-1}>
              Review saved draft
            </h3>
            <p className="pt-confirm-text">{c.saved?.text}</p>
            {c.saved && <small>{c.saved.provenance}</small>}
            <label className="pt-check">
              <input
                type="checkbox"
                disabled={locked}
                checked={c.verified}
                onChange={(e) => c.setVerified(e.target.checked)}
              />
              <span>
                I reviewed the saved entry, patient identity, and provenance.
              </span>
            </label>
          </div>
        )}
      </div>
    </BottomSheet>
  );
}
