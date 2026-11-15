import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { RoundsView } from "./RoundsView";
import { ScheduleReview } from "./ScheduleReview";
import { TaskSheet } from "./task-sheet";
import type { Round, State, Task } from "./types";

const now = new Date(2026, 10, 15, 10).toISOString();
const task: Task = {
  id: "t1",
  patientId: "p1",
  title: "Review comfort",
  type: "REVIEW",
  status: "OPEN",
  priority: "ROUTINE",
  source: "NURSE",
  dueAt: now,
  verificationRequired: false,
  deferReason: null,
  order: 1,
  completedAt: null,
  verifiedBy: null,
};
const round: Round = { task, rank: 1, reason: "Scheduled bedside review" };
const state: State = {
  patients: [
    {
      id: "p1",
      name: "Test Patient",
      room: "201",
      unit: "ICU",
      summary: "Available context",
      nurseId: "nurse-demo",
      repositionPlan: false,
    },
  ],
  tasks: [task],
  vitals: [],
  movements: [],
  charts: [],
  events: [],
  serverTime: now,
};
afterEach(cleanup);
afterEach(() => vi.restoreAllMocks());
function show(data = state, path = "/rounds", rounds = [round]) {
  const mutate = vi.fn().mockResolvedValue(data);
  render(
    <MemoryRouter initialEntries={[path]}>
      <RoundsView
        rounds={rounds}
        state={data}
        mutate={mutate}
        busy={false}
        label="ICU"
      />
    </MemoryRouter>,
  );
  return mutate;
}

it("opens the original task from a handoff URL and closes without reopening it", () => {
  const mutate = show(state, "/rounds?task=t1&patient=p1");
  expect(
    screen.getByRole("dialog", { name: "Review comfort" }),
  ).toBeInTheDocument();
  expect(mutate).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("requires fresh bedside verification after canceling completion", async () => {
  const mutate = show();
  fireEvent.click(
    screen.getByRole("button", { name: "Complete Review comfort" }),
  );
  const confirm = () =>
    screen.getByRole("button", { name: "Confirm completion" });
  expect(confirm()).toBeDisabled();
  fireEvent.click(screen.getByLabelText("I verified this care at the bedside"));
  expect(confirm()).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  fireEvent.click(screen.getByRole("button", { name: "Complete" }));
  expect(confirm()).toBeDisabled();
  expect(mutate).not.toHaveBeenCalled();
  fireEvent.click(screen.getByLabelText("I verified this care at the bedside"));
  fireEvent.change(screen.getByLabelText("Note (optional)"), {
    target: { value: "Comfort reviewed at bedside" },
  });
  fireEvent.click(confirm());
  await waitFor(() =>
    expect(mutate).toHaveBeenCalledExactlyOnceWith("/tasks/t1/complete", {
      verified: true,
      movementId: null,
      text: "Comfort reviewed at bedside",
    }),
  );
});

it("keeps earlier-day completions visible without inventing a shift and preserves older history", () => {
  const early = {
    ...task,
    id: "early",
    title: "Early care",
    status: "COMPLETED",
    completedAt: new Date(2026, 10, 15, 5).toISOString(),
  };
  const old = {
    ...early,
    id: "old",
    title: "Previous care",
    completedAt: new Date(2026, 10, 13, 8).toISOString(),
  };
  show({ ...state, tasks: [early, old] }, "/rounds", []);
  expect(
    screen.getByRole("heading", { name: /Completed today/ }),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Show" }));
  expect(screen.getByText("Early care")).toBeInTheDocument();
  expect(screen.queryByText("Previous care")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("tab", { name: "History" }));
  expect(screen.getByText("Previous care")).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Filter history by date"), {
    target: { value: "2026-11-13" },
  });
  expect(screen.getByText("Previous care")).toBeInTheDocument();
  expect(screen.queryByText("Early care")).not.toBeInTheDocument();
});

it("does not open tasks outside the selected unit from a URL", () => {
  show(
    { ...state, patients: [{ ...state.patients[0]!, unit: "L_AND_D" }] },
    "/rounds?task=t1",
  );
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("keeps recorded priority and the earliest due time visible in grouped sensor checks", () => {
  const later = {
    ...task,
    type: "DEVICE_REVIEW",
    priority: "HIGH",
    dueAt: new Date(Date.parse(now) - 60_000).toISOString(),
  };
  const earlier = {
    ...later,
    id: "sensor2",
    priority: "ROUTINE",
    dueAt: new Date(Date.parse(now) - 300_000).toISOString(),
  };
  show({ ...state, tasks: [later, earlier] }, "/rounds", [
    { ...round, task: later },
    { ...round, task: earlier },
  ]);
  expect(
    screen.getByRole("img", { name: "High priority" }),
  ).toBeInTheDocument();
  expect(document.querySelector(".tk-when time")).toHaveAttribute(
    "datetime",
    earlier.dueAt,
  );
});

it("keeps the filtered patient selected when scheduling and offers explicit relative times", async () => {
  const second = {
    ...state.patients[0]!,
    id: "p2",
    name: "Second Patient",
    room: "202",
  };
  const secondTask = { ...task, id: "t2", patientId: "p2" };
  const mutate = show(
    {
      ...state,
      patients: [...state.patients, second],
      tasks: [task, secondTask],
    },
    "/rounds?patient=p2",
    [round, { ...round, task: secondTask }],
  );
  fireEvent.click(screen.getByRole("button", { name: "Schedule a review" }));
  expect(screen.getByLabelText("Assigned patient")).toHaveValue("p2");
  fireEvent.change(screen.getByLabelText("Review title"), {
    target: { value: "  Nurse review  " },
  });
  fireEvent.click(screen.getByRole("button", { name: "In 15 min" }));
  fireEvent.click(screen.getByRole("button", { name: "Schedule review" }));
  await waitFor(() =>
    expect(mutate).toHaveBeenCalledExactlyOnceWith("/demo/tasks", {
      patientId: "p2",
      title: "Nurse review",
      priority: "ROUTINE",
      dueAt: new Date(Date.parse(now) + 15 * 60_000).toISOString(),
    }),
  );
});

it("prevents duplicate scheduling and retains entered data after a save failure", async () => {
  let rejectSave!: (error: Error) => void;
  const mutate = vi.fn().mockImplementation(
    () =>
      new Promise((_resolve, reject) => {
        rejectSave = reject;
      }),
  );
  render(
    <ScheduleReview
      patients={state.patients}
      mutate={mutate}
      busy={false}
      bare
      now={Date.parse(now)}
    />,
  );
  fireEvent.change(screen.getByLabelText("Review title"), {
    target: { value: "Check comfort" },
  });
  fireEvent.click(screen.getByRole("button", { name: "In 30 min" }));
  const submit = screen.getByRole("button", { name: "Schedule review" });
  fireEvent.click(submit);
  fireEvent.submit(submit.closest("form")!);
  expect(mutate).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("button", { name: "Scheduling..." })).toBeDisabled();
  rejectSave(new Error("Please retry: connection interrupted"));
  await screen.findByRole("alert");
  expect(screen.getByLabelText("Review title")).toHaveValue("Check comfort");
  expect(screen.getByRole("button", { name: "Schedule review" })).toBeEnabled();
});

it("protects unsaved completion notes when the task sheet is dismissed", () => {
  show();
  fireEvent.click(
    screen.getByRole("button", { name: "Complete Review comfort" }),
  );
  fireEvent.change(screen.getByLabelText("Note (optional)"), {
    target: { value: "Personally checked comfort" },
  });
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(confirm).toHaveBeenCalledOnce();
  expect(screen.getByLabelText("Note (optional)")).toHaveValue(
    "Personally checked comfort",
  );
  confirm.mockReturnValue(true);
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("keeps failed care documentation available for retry and blocks duplicate completion", async () => {
  let rejectSave!: (error: Error) => void;
  const mutate = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectSave = reject;
        }),
    )
    .mockResolvedValue(state);
  const close = vi.fn();
  render(
    <MemoryRouter>
      <TaskSheet
        task={task}
        round={round}
        rounds={[round]}
        state={state}
        mutate={mutate}
        busy={false}
        now={Date.parse(now)}
        mode="complete"
        onMode={vi.fn()}
        onClose={close}
      />
    </MemoryRouter>,
  );
  fireEvent.change(screen.getByLabelText("Note (optional)"), {
    target: { value: "Comfort assessed personally" },
  });
  fireEvent.click(screen.getByLabelText("I verified this care at the bedside"));
  const form = screen
    .getByRole("button", { name: "Confirm completion" })
    .getAttribute("form")!;
  fireEvent.submit(document.getElementById(form)!);
  fireEvent.submit(document.getElementById(form)!);
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(mutate).toHaveBeenCalledTimes(1);
  expect(close).not.toHaveBeenCalled();
  expect(screen.getByLabelText("Note (optional)")).toBeDisabled();
  rejectSave(new Error("Connection interrupted; retry saving"));
  const error = await screen.findByRole("alert");
  expect(error).toHaveFocus();
  expect(screen.getByLabelText("Note (optional)")).toHaveValue(
    "Comfort assessed personally",
  );
  fireEvent.click(screen.getByRole("button", { name: "Confirm completion" }));
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
  expect(mutate).toHaveBeenCalledTimes(2);
});
