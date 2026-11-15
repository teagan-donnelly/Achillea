import { Check } from "lucide-react";
import type { Patient, Round, Task } from "./types";
import {
  clock,
  displayTitle,
  patientLine,
  relativeDue,
  staffName,
  taskGroup,
} from "./task-model";

/** Reminders-style priority marks: "!!" for HIGH, "!" for TIMELY, nothing for routine. */
export function PriorityMark({ priority }: { priority: string }) {
  if (priority !== "HIGH" && priority !== "TIMELY") return null;
  return (
    <span
      className="tk-bang"
      role="img"
      aria-label={priority === "HIGH" ? "High priority" : "Timely priority"}
    >
      {priority === "HIGH" ? "!!" : "!"}
    </span>
  );
}

/** "3:12 AM · 13 min" in red when overdue, otherwise just the due time. */
function DueLine({
  dueAt,
  now,
  extra,
}: {
  dueAt: string;
  now: number;
  extra?: string;
}) {
  const overdue = Date.parse(dueAt) < now - 60_000;
  const rel = relativeDue(dueAt, now).replace(/ overdue$/, "");
  return (
    <span className="tk-when">
      <time dateTime={dueAt} className={overdue ? "overdue" : undefined}>
        {clock(dueAt, now)}
        {overdue && ` · ${rel}`}
      </time>
      {extra && <span className="tk-status"> · {extra}</span>}
    </span>
  );
}

const statusOf = (t: Task) =>
  t.status === "ACKNOWLEDGED"
    ? "Reviewed"
    : t.status === "DEFERRED"
      ? "Deferred"
      : "";

/**
 * Reminders-style open task row. The circle never completes in one tap: it opens the sheet on
 * the verification step. The rest of the row opens the task details.
 */
export function TaskRow({
  round,
  patient,
  now,
  onOpen,
}: {
  round: Round;
  patient: Patient | undefined;
  now: number;
  onOpen: (taskId: string, mode: "details" | "complete") => void;
}) {
  const t = round.task;
  const title = displayTitle(t);
  const rel = relativeDue(t.dueAt, now);
  return (
    <li className="tk-row" id={`task-${t.id}`}>
      <button
        type="button"
        className="tk-circle"
        aria-label={`Complete ${title}`}
        onClick={() => onOpen(t.id, "complete")}
      />
      <div className="tk-row-body">
        <button
          type="button"
          className="tk-row-main"
          aria-label={`${title}, ${patientLine(patient)}, due ${clock(t.dueAt, now)}, ${rel}${t.priority !== "ROUTINE" ? `, ${t.priority.toLowerCase()} priority` : ""}`}
          onClick={() => onOpen(t.id, "details")}
        >
          <span className="tk-title">
            <PriorityMark priority={t.priority} />
            {title}
          </span>
          <DueLine dueAt={t.dueAt} now={now} extra={statusOf(t)} />
          <span className="tk-sub">{patientLine(patient)}</span>
        </button>
      </div>
    </li>
  );
}

/** One row for a patient's sensor checks (one backend task per sensor). */
export function SensorGroupRow({
  rounds,
  patient,
  now,
  onOpen,
}: {
  rounds: Round[];
  patient: Patient | undefined;
  now: number;
  onOpen: () => void;
}) {
  const first = rounds[0]!.task;
  const overdue = rounds.some((r) => taskGroup(r.task, now) === "OVERDUE");
  const priority = rounds.some((r) => r.task.priority === "HIGH")
    ? "HIGH"
    : rounds.some((r) => r.task.priority === "TIMELY")
      ? "TIMELY"
      : "ROUTINE";
  const earliestDue = rounds.reduce(
    (due, r) =>
      Date.parse(r.task.dueAt) < Date.parse(due) ? r.task.dueAt : due,
    first.dueAt,
  );
  const label = `Check sensors, ${patientLine(patient)}, ${rounds.length} sensors${overdue ? ", overdue" : ""}${priority !== "ROUTINE" ? `, ${priority.toLowerCase()} priority` : ""}`;
  return (
    <li className="tk-row" id={`task-${first.id}`}>
      <button
        type="button"
        className="tk-circle"
        aria-label={`Open ${label}`}
        onClick={onOpen}
      />
      <div className="tk-row-body">
        <button
          type="button"
          className="tk-row-main"
          aria-label={label}
          onClick={onOpen}
        >
          <span className="tk-title">
            <PriorityMark priority={priority} />
            Check sensors
          </span>
          <DueLine dueAt={earliestDue} now={now} />
          <span className="tk-sub">
            {patientLine(patient)} · {rounds.length} sensors
          </span>
        </button>
      </div>
    </li>
  );
}

/** Completed task: filled check, muted text, completion time and verifier. */
export function CompletedRow({
  task: t,
  patient,
  now,
  onOpen,
}: {
  task: Task;
  patient: Patient | undefined;
  now: number;
  onOpen: (taskId: string) => void;
}) {
  const title = displayTitle(t);
  return (
    <li className="tk-row done">
      <span className="tk-circle checked" aria-hidden>
        <Check strokeWidth={2} />
      </span>
      <div className="tk-row-body">
        <button
          type="button"
          className="tk-row-main"
          aria-label={`${title}, ${patientLine(patient)}, completed${t.completedAt ? ` ${clock(t.completedAt, now)}` : ""}`}
          onClick={() => onOpen(t.id)}
        >
          <span className="tk-title">{title}</span>
          <span className="tk-when">
            {t.completedAt && (
              <time dateTime={t.completedAt}>{clock(t.completedAt, now)}</time>
            )}
            {t.verifiedBy && (
              <span className="tk-status"> · {staffName(t.verifiedBy)}</span>
            )}
          </span>
          <span className="tk-sub">{patientLine(patient)}</span>
        </button>
      </div>
    </li>
  );
}
