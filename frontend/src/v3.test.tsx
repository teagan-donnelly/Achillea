import { fixturePayload } from "./test-api-fixture";
import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { EventTimeline, groupReceipts } from "./EventTimeline";
import { PatientCard } from "./WorkspaceViews";
import App from "./App";
import type { Event, State, Round, Vital } from "./types";
const patient = {
  id: "p1",
  name: "Synthetic Patient",
  room: "201",
  unit: "L_AND_D",
  summary: "Bedside observation",
  nurseId: "nurse-demo",
  repositionPlan: false,
};
const state: State = {
  patients: [patient],
  tasks: [],
  vitals: [],
  movements: [],
  charts: [],
  events: [],
};
const event: Event = {
  id: "e1",
  patientId: "p1",
  type: "vital.received",
  source: "SIMULATED_MONITOR",
  details: "Synthetic monitor receipt",
  timestamp: "2026-11-14T12:02:00Z",
};
const rounds: Round[] = [
  {
    rank: 1,
    reason: "Past scheduled due time",
    task: {
      id: "t1",
      patientId: "p1",
      title: "Bedside assessment",
      type: "ASSESSMENT",
      status: "OPEN",
      priority: "ROUTINE",
      source: "CARE_PLAN",
      dueAt: new Date().toISOString(),
      verificationRequired: false,
      deferReason: null,
      order: 1,
      completedAt: null,
      verifiedBy: null,
    },
  },
];
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  sessionStorage.clear();
});
it("groups matching receipts without dropping history or absorbing workflow events", () => {
  const events = [
    event,
    { ...event, id: "e2", timestamp: "2026-11-14T12:01:00Z" },
    {
      ...event,
      id: "task",
      type: "task.complete",
      details: "Nurse-confirmed task completion",
      timestamp: "2026-11-14T12:00:30Z",
    },
    { ...event, id: "e3", timestamp: "2026-11-14T12:00:00Z" },
  ];
  const groups = groupReceipts(events);
  expect(groups.map((g) => g.events.length)).toEqual([2, 1, 1]);
  expect(groups.flatMap((g) => g.events).map((e) => e.id)).toEqual([
    "e1",
    "e2",
    "task",
    "e3",
  ]);
  expect(new Set(groups.map((g) => g.key)).size).toBe(groups.length);
});
it("does not combine patients, sources, receipt descriptions, or time windows", () => {
  const events = [
    event,
    { ...event, id: "e2", patientId: "p2" },
    { ...event, id: "e3", source: "ANOTHER_MONITOR" },
    { ...event, id: "e4", details: "Different receipt description" },
    { ...event, id: "e5", timestamp: "2026-11-14T11:59:00Z" },
  ];
  expect(groupReceipts(events)).toHaveLength(5);
});
it("lets the nurse expand grouped receipts or disable grouping", () => {
  render(
    <MemoryRouter>
      <EventTimeline
        events={[
          event,
          { ...event, id: "e2", timestamp: "2026-11-14T12:01:00Z" },
        ]}
        patients={[patient]}
      />
    </MemoryRouter>,
  );
  expect(screen.getByText("2 monitor receipts")).toBeInTheDocument();
  const summary = screen.getByText("2 monitor receipts").closest("summary")!;
  const details = summary.closest("details")!;
  expect(details.open).toBe(false);
  fireEvent.click(summary);
  expect(details.open).toBe(true);
  expect(screen.getAllByText("Synthetic monitor receipt")).toHaveLength(2);
  fireEvent.click(screen.getByLabelText(/Group repeated monitor receipts/));
  expect(screen.queryByText("2 monitor receipts")).not.toBeInTheDocument();
  expect(screen.getAllByText("Synthetic monitor receipt")).toHaveLength(2);
});
it("keeps the assignment card graph-free and limits selected measurements", () => {
  const vitals: Vital[] = [
    "HEART_RATE",
    "SPO2",
    "TEMPERATURE",
    "RESPIRATORY_RATE",
  ].map((metric, i) => ({
    id: `v${i}`,
    patientId: "p1",
    metric,
    value: 80 + i,
    unit: "test-unit",
    observedAt: new Date().toISOString(),
    receivedAt: new Date().toISOString(),
    source: "SIMULATED_MONITOR",
    sourceEventId: `s${i}`,
    quality: "VALID",
  }));
  const { container } = render(
    <MemoryRouter>
      <PatientCard
        patient={patient}
        state={{ ...state, vitals }}
        rounds={rounds}
      />
    </MemoryRouter>,
  );
  expect(
    screen.queryByRole("img", { name: /historical trend/ }),
  ).not.toBeInTheDocument();
  expect(container.querySelectorAll(".compact-vitals>div")).toHaveLength(3);
  expect(screen.getByText("1 more measurements in record")).toBeInTheDocument();
  expect(screen.getByText(/1 open \/ 1 need review/)).toBeInTheDocument();
});
it("opens a focused task from Rounds and returns to that schedule", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => ({
      ok: true,
      json: async () =>
        fixturePayload(url, { ...state, tasks: [rounds[0].task] }, rounds),
    })),
  );
  render(
    <MemoryRouter initialEntries={["/rounds"]}>
      <App />
    </MemoryRouter>,
  );
  fireEvent.click(
    await screen.findByRole("button", { name: /^Bedside assessment,/ }),
  );
  fireEvent.click(
    screen.getByRole("link", { name: /^Open bedside workspace/ }),
  );
  expect(
    screen.getByRole("heading", { name: "Synthetic Patient" }),
  ).toBeInTheDocument();
  // Patients redesign: ?section=tasks opens the Summary tab with Care tasks expanded.
  expect(screen.getByRole("tab", { name: "Summary" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  expect(screen.getByRole("button", { name: /^Care tasks/ })).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  fireEvent.click(screen.getByRole("link", { name: "Back to Tasks" }));
  expect(screen.getByRole("heading", { name: "Tasks" })).toBeInTheDocument();
});
it("opens monitoring from Activity and switches between actual recorded trends", async () => {
  const vitals: Vital[] = ["HEART_RATE", "SPO2"].flatMap((metric, i) =>
    [0, 1].map((j) => ({
      id: `v${i}-${j}`,
      patientId: "p1",
      metric,
      value: 80 + i + j,
      unit: i ? "%" : "bpm",
      observedAt: new Date(Date.now() - j * 60000).toISOString(),
      receivedAt: new Date().toISOString(),
      source: "SIMULATED_MONITOR",
      sourceEventId: `s${i}-${j}`,
      quality: "VALID",
    })),
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => ({
      ok: true,
      json: async () =>
        fixturePayload(url, { ...state, vitals, events: [event] }),
    })),
  );
  // /activity is now the Handoff tab; open the patient's vitals as if from that tab.
  render(
    <MemoryRouter
      initialEntries={[{ pathname: "/patients/p1", search: "?section=vitals", state: { from: "/activity" } }]}
    >
      <App />
    </MemoryRouter>,
  );
  // Patients redesign: ?section=vitals opens Trends, one swipeable card per recorded metric.
  expect(await screen.findByRole("tab", { name: "Trends" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  expect(
    screen.getByRole("article", { name: "Heart rate trend" }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("article", { name: "Oxygen saturation trend" }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("article", { name: /Temperature trend/ }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("link", { name: "Back to Handoff" }));
  await waitFor(() =>
    expect(
      screen.getByRole("heading", { name: "Handoff" }),
    ).toBeInTheDocument(),
  );
});
