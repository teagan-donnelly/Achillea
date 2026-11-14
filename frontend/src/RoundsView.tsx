import { Link, useLocation } from "react-router-dom";
import { patientReturnState } from "./navigation-context";
import { ArrowRight, CheckCircle } from "lucide-react";
import type { Round, State } from "./types";
import { TaskList, type Mutate } from "./TaskList";
import { time } from "./api";
import { ScheduleReview } from "./ScheduleReview";
export function RoundsView({
  rounds,
  state,
  mutate,
  busy,
  label,
}: {
  rounds: Round[];
  state: State;
  mutate: Mutate;
  busy: boolean;
  label: string;
}) {
  const location = useLocation();
  const groups = [
    {
      title: "Now",
      description: "Explicit priority or scheduled review time has passed",
      items: rounds.filter((r) =>
        r.horizon ? r.horizon === "NOW" : r.rank <= 1,
      ),
    },
    {
      title: "Next",
      description: "Scheduled within the next 30 minutes",
      items: rounds.filter((r) =>
        r.horizon ? r.horizon === "NEXT" : r.rank === 2,
      ),
    },
    {
      title: "Later",
      description: "Remaining planned care, in the backend sequence",
      items: rounds.filter((r) =>
        r.horizon ? r.horizon === "LATER" : r.rank >= 3,
      ),
    },
  ];
  const completed = state.tasks.filter(
    (t) =>
      t.status === "COMPLETED" &&
      state.patients.some(
        (p) =>
          p.id === t.patientId &&
          p.unit === (label.startsWith("ICU") ? "ICU" : "L_AND_D"),
      ),
  );
  return (
    <>
      <div className="overview-heading">
        <div>
          <p className="eyebrow">CARE SEQUENCE · {label}</p>
          <h1>Rounds</h1>
        </div>
        <span className="count-badge">{rounds.length} open</span>
      </div>
      <nav className="schedule-track" aria-label="Schedule segments">
        {groups.map((g) => (
          <a href={`#schedule-${g.title.toLowerCase()}`} key={g.title}>
            <span>{g.title}</span>
            <strong>{g.items.length}</strong>
            <small>
              {g.items.length
                ? `${time(g.items[0].task.dueAt)} first in sequence`
                : "No planned tasks"}
            </small>
          </a>
        ))}
      </nav>
      <ScheduleReview patients={state.patients} mutate={mutate} busy={busy} />
      {rounds[0] && (
        <section className="next-action">
          <span className="eyebrow">NEXT SUGGESTED ACTION</span>
          <h2>{rounds[0].task.title}</h2>
          <p>
            {
              state.patients.find((p) => p.id === rounds[0].task.patientId)
                ?.name
            }{" "}
            · Room{" "}
            {
              state.patients.find((p) => p.id === rounds[0].task.patientId)
                ?.room
            }{" "}
            · Due {time(rounds[0].task.dueAt)}
          </p>
          <small>{rounds[0].reason}</small>
          <Link
            state={patientReturnState(location)}
            className="primary"
            to={`/patients/${rounds[0].task.patientId}?section=tasks#task-${rounds[0].task.id}`}
          >
            Open bedside workspace <ArrowRight size={17} />
          </Link>
        </section>
      )}
      <details className="explanation">
        <summary>How this sequence is determined</summary>
        <p>
          Explicit high priority, then overdue, due within 30 minutes, then
          routine future tasks. Backend due times and stable IDs break ties;
          routine tasks retain nurse-selected ordering. These are workflow
          rules, not clinical triage.
        </p>
      </details>
      <div className="round-queue">
        {groups
          .filter((g) => g.items.length)
          .map((g) => (
            <section
              key={g.title}
              id={`schedule-${g.title.toLowerCase()}`}
              className="schedule-segment"
            >
              <div className="section-heading">
                <div>
                  <h2>{g.title}</h2>
                  <p>{g.description}</p>
                </div>
                <span className="count-badge">{g.items.length} tasks</span>
              </div>
              <TaskList
                rounds={g.items}
                state={state}
                mutate={mutate}
                busy={busy}
              />
            </section>
          ))}
      </div>
      {!rounds.length && (
        <div className="empty">
          <CheckCircle size={28} />
          <h2>No open tasks in this unit</h2>
          <p>Completed care remains in the chart and activity history.</p>
        </div>
      )}
      <div className="schedule-summary">
        {groups
          .filter((g) => !g.items.length)
          .map((g) => (
            <span key={g.title} id={`schedule-${g.title.toLowerCase()}`}>
              {g.title}: no scheduled tasks
            </span>
          ))}
      </div>
      {completed.length > 0 && (
        <details className="completed-care">
          <summary>Completed care ({completed.length})</summary>
          {completed.map((t) => (
            <p key={t.id}>
              <CheckCircle size={15} /> {t.title} ·{" "}
              {t.completedAt && time(t.completedAt)}
            </p>
          ))}
        </details>
      )}
    </>
  );
}
