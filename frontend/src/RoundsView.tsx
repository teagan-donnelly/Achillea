import { useCallback, useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import type { Round, State } from "./types";
import type { Mutate } from "./TaskList";
import { ScheduleReview } from "./ScheduleReview";
import { useDemoNow } from "./RepositioningViews";
import {
  BottomSheet,
  EmptyState,
  Screen,
  ScreenHeader,
  Section,
  Segmented,
} from "./ui";
import { SensorGroupSheet, TaskSheet, type SheetMode } from "./task-sheet";
import { CompletedRow, SensorGroupRow, TaskRow } from "./task-row";
import {
  dayKey,
  dayLabel,
  groupRounds,
  listEntries,
  patientOf,
  type TaskGroup,
} from "./task-model";

type View = "open" | "history";
const GROUPS: TaskGroup[] = ["OVERDUE", "DUE", "UPCOMING"];

/**
 * Tasks tab (/rounds), Apple Reminders style. Open work comes from the server-ranked queue
 * (GET /api/rounds) grouped by backend scheduleState; completed work comes from state.tasks.
 */
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
  const now = useDemoNow(state);
  const [searchParams, setSearchParams] = useSearchParams();
  const [view, setView] = useState<View>("open"),
    [patientFilter, setPatientFilter] = useState(
      () => searchParams.get("patient") ?? "",
    ),
    [showCompleted, setShowCompleted] = useState(false),
    [historyDay, setHistoryDay] = useState(""),
    [selected, setSelected] = useState<{ id: string; mode: SheetMode } | null>(
      null,
    ),
    [scheduling, setScheduling] = useState(false),
    [sensorGroup, setSensorGroup] = useState("");

  const unit = label.startsWith("ICU") ? "ICU" : "L_AND_D";
  const completed = useMemo(
    () =>
      state.tasks
        .filter(
          (t) =>
            t.status === "COMPLETED" &&
            state.patients.some((p) => p.id === t.patientId && p.unit === unit),
        )
        .sort(
          (a, b) =>
            Date.parse(b.completedAt ?? "") - Date.parse(a.completedAt ?? ""),
        ),
    [state.tasks, state.patients, unit],
  );

  // Patients that have any open or completed work in this unit, in room order.
  const filterPatients = useMemo(() => {
    const ids = new Set([
      ...rounds.map((r) => r.task.patientId),
      ...completed.map((t) => t.patientId),
    ]);
    return state.patients
      .filter((p) => ids.has(p.id))
      .sort((a, b) =>
        a.room.localeCompare(b.room, undefined, { numeric: true }),
      );
  }, [rounds, completed, state.patients]);
  const activePatient = filterPatients.some((p) => p.id === patientFilter)
    ? patientFilter
    : "";
  const matches = (patientId: string) =>
    !activePatient || patientId === activePatient;

  const open = rounds.filter((r) => matches(r.task.patientId));
  const groups = groupRounds(open, now);
  const todayCompleted = completed.filter(
    (t) =>
      matches(t.patientId) &&
      t.completedAt !== null &&
      dayKey(t.completedAt) === dayKey(new Date(now).toISOString()),
  );
  const history = completed.filter(
    (t) => matches(t.patientId) && t.completedAt,
  );
  const days = [...new Set(history.map((t) => dayKey(t.completedAt!)))];
  const activeDay = days.includes(historyDay) ? historyDay : "";
  const historyDays = days
    .filter((d) => !activeDay || d === activeDay)
    .map((d) => ({
      key: d,
      tasks: history.filter((t) => dayKey(t.completedAt!) === d),
    }));

  const openTask = useCallback(
    (id: string, mode: SheetMode = "details") => setSelected({ id, mode }),
    [],
  );
  const linkedTaskId = searchParams.get("task");
  // Handoff links reference the original task, never a second copy of the care action.
  const linkedTask = linkedTaskId
    ? (rounds.find((r) => r.task.id === linkedTaskId)?.task ??
      state.tasks.find((t) => t.id === linkedTaskId))
    : undefined;
  const linkedAccessible =
    linkedTask &&
    state.patients.some(
      (p) => p.id === linkedTask.patientId && p.unit === unit,
    );
  const activeSelection =
    selected ??
    (linkedAccessible ? { id: linkedTask.id, mode: "details" as const } : null);
  const closeSheet = useCallback(() => {
    setSelected(null);
    if (searchParams.has("task")) {
      const next = new URLSearchParams(searchParams);
      next.delete("task");
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams]);
  const closeSensors = useCallback(() => setSensorGroup(""), []);
  const closeSchedule = useCallback(() => setScheduling(false), []);
  const selectedRound = activeSelection
    ? rounds.find((r) => r.task.id === activeSelection.id)
    : undefined;
  const selectedTask = activeSelection
    ? (selectedRound?.task ??
      state.tasks.find((t) => t.id === activeSelection.id))
    : undefined;
  const openCount = (patientId: string) =>
    rounds.filter((r) => r.task.patientId === patientId).length;
  const sensorRounds = sensorGroup
    ? rounds.filter(
        (r) =>
          r.task.patientId === sensorGroup && r.task.type === "DEVICE_REVIEW",
      )
    : [];
  const filterName = patientOf(state, activePatient)?.name;

  return (
    <Screen className="tk">
      <ScreenHeader
        title="Tasks"
        right={
          <button
            type="button"
            className="ach-icon-button"
            aria-label="Schedule a review"
            onClick={() => setScheduling(true)}
          >
            <Plus aria-hidden strokeWidth={1.75} />
          </button>
        }
      />
      <Segmented<View>
        label="Task view"
        value={view}
        onChange={setView}
        options={[
          {
            value: "open",
            label: open.length ? `Open ${open.length}` : "Open",
          },
          { value: "history", label: "History" },
        ]}
      />

      {filterPatients.length > 1 && (
        <div
          className="tk-filter"
          role="group"
          aria-label="Filter by patient"
          data-no-swipe
        >
          <button
            type="button"
            aria-pressed={!activePatient}
            onClick={() => setPatientFilter("")}
          >
            All patients
          </button>
          {filterPatients.map((p) => (
            <button
              key={p.id}
              type="button"
              aria-pressed={activePatient === p.id}
              aria-label={`${p.name}, Room ${p.room}`}
              onClick={() =>
                setPatientFilter(activePatient === p.id ? "" : p.id)
              }
            >
              <span className="tk-filter-person">
                {p.name.split(" ")[0]}
                <span>Room {p.room}</span>
              </span>
              {openCount(p.id) > 0 && <small>{openCount(p.id)}</small>}
            </button>
          ))}
        </div>
      )}

      {view === "open" ? (
        <>
          {open.length === 0 && (
            <EmptyState
              title={
                filterName ? `Nothing open for ${filterName}` : "All caught up"
              }
            />
          )}
          {filterPatients
            .map((p) => ({
              p,
              list: GROUPS.flatMap((g) => groups[g]).filter((r) => r.task.patientId === p.id),
            }))
            .filter((x) => x.list.length)
            .map(({ p, list }) => (
            <Section key={p.id} title={`Room ${p.room} · ${p.name}`} count={list.length}>
              <ul className="tk-list" id={`tasks-${p.id}`}>
                {listEntries(list).map((e) =>
                  e.kind === "task" ? (
                    <TaskRow
                      key={e.round.task.id}
                      round={e.round}
                      patient={patientOf(state, e.round.task.patientId)}
                      now={now}
                      onOpen={openTask}
                    />
                  ) : (
                    <SensorGroupRow
                      key={e.key}
                      rounds={e.rounds}
                      patient={patientOf(state, e.patientId)}
                      now={now}
                      onOpen={() => setSensorGroup(e.patientId)}
                    />
                  ),
                )}
              </ul>
            </Section>
          ))}
          {todayCompleted.length > 0 && (
            <Section
              title="Completed today"
              count={todayCompleted.length}
              action={
                <button
                  type="button"
                  className="tk-text-button"
                  aria-expanded={showCompleted}
                  onClick={() => setShowCompleted((v) => !v)}
                >
                  {showCompleted ? "Hide" : "Show"}
                </button>
              }
            >
              {showCompleted && (
                <ul className="tk-list">
                  {todayCompleted.map((t) => (
                    <CompletedRow
                      key={t.id}
                      task={t}
                      patient={patientOf(state, t.patientId)}
                      now={now}
                      onOpen={openTask}
                    />
                  ))}
                </ul>
              )}
            </Section>
          )}
        </>
      ) : (
        <>
          {days.length > 1 && (
            <label className="tk-day-filter">
              <span>Date</span>
              <select
                aria-label="Filter history by date"
                value={activeDay}
                onChange={(e) => setHistoryDay(e.target.value)}
              >
                <option value="">All dates</option>
                {days.map((d) => (
                  <option key={d} value={d}>
                    {dayLabel(`${d}T12:00:00`, now)}
                  </option>
                ))}
              </select>
            </label>
          )}
          {historyDays.length === 0 && (
            <EmptyState title="No completed tasks" />
          )}
          {historyDays.map((d) => (
            <Section
              key={d.key}
              title={dayLabel(`${d.key}T12:00:00`, now)}
              count={d.tasks.length}
            >
              <ul className="tk-list">
                {d.tasks.map((t) => (
                  <CompletedRow
                    key={t.id}
                    task={t}
                    patient={patientOf(state, t.patientId)}
                    now={now}
                    onOpen={openTask}
                  />
                ))}
              </ul>
            </Section>
          ))}
        </>
      )}

      {sensorGroup && !activeSelection && sensorRounds.length > 0 && (
        <SensorGroupSheet
          rounds={sensorRounds}
          state={state}
          now={now}
          onOpenTask={(id) => setSelected({ id, mode: "details" })}
          onClose={closeSensors}
        />
      )}
      {activeSelection && (
        <TaskSheet
          task={selectedTask}
          round={selectedRound}
          state={state}
          rounds={rounds}
          mutate={mutate}
          busy={busy}
          now={now}
          mode={activeSelection.mode}
          onMode={(mode) => setSelected({ id: activeSelection.id, mode })}
          onClose={closeSheet}
        />
      )}
      <BottomSheet
        open={scheduling}
        onClose={closeSchedule}
        title="Schedule a review"
      >
        <div className="tk-sheet">
          <ScheduleReview
            bare
            patients={state.patients.filter((p) => p.unit === unit)}
            mutate={mutate}
            busy={busy}
            initialPatientId={activePatient}
            now={now}
            onScheduled={closeSchedule}
          />
        </div>
      </BottomSheet>
    </Screen>
  );
}
