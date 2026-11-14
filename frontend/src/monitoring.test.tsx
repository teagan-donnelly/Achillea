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
import { PatientCard } from "./WorkspaceViews";
import { Trend, latestReadings, readingState } from "./Monitoring";
import { RoundsView } from "./RoundsView";
import App from "./App";
import type { State, Round, Vital } from "./types";
const vital: Vital = {
  id: "v1",
  patientId: "p1",
  metric: "HEART_RATE",
  value: 82,
  unit: "bpm",
  observedAt: new Date().toISOString(),
  receivedAt: new Date().toISOString(),
  source: "SIMULATED_MONITOR",
  sourceEventId: "s1",
  quality: "VALID",
};
const state: State = {
  patients: [
    {
      id: "p1",
      name: "Test Patient",
      room: "201",
      unit: "L_AND_D",
      summary: "Synthetic care context",
      nurseId: "nurse-demo",
      repositionPlan: false,
    },
  ],
  tasks: [],
  vitals: [],
  charts: [],
  events: [],
  movements: [],
};
const round: Round = {
  rank: 1,
  reason: "Past scheduled due time",
  task: {
    id: "t1",
    patientId: "p1",
    title: "Review observations",
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
};
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  sessionStorage.clear();
});
it("labels an eleven-hour-old reading as old and keeps its source visible", () => {
  const old = {
    ...vital,
    observedAt: new Date(Date.now() - 11 * 3600000).toISOString(),
  };
  render(
    <MemoryRouter>
      <PatientCard
        patient={state.patients[0]}
        state={{ ...state, vitals: [old] }}
        rounds={[]}
      />
    </MemoryRouter>,
  );
  expect(screen.getByText(/Old reading - 11 hr/)).toBeInTheDocument();
  expect(screen.getByText("Simulated monitor")).toBeInTheDocument();
  expect(screen.getByText("82")).toBeInTheDocument();
});
it("does not display a missing or disconnected measurement as valid", () => {
  expect(readingState({ ...vital, quality: "MISSING" })).toBe("Unavailable");
  expect(readingState({ ...vital, quality: "DEVICE_DISCONNECTED" })).toBe(
    "Disconnected",
  );
  render(
    <MemoryRouter>
      <PatientCard
        patient={state.patients[0]}
        state={{ ...state, vitals: [{ ...vital, quality: "MISSING" }] }}
        rounds={[]}
      />
    </MemoryRouter>,
  );
  expect(screen.getByText("Unavailable")).toBeInTheDocument();
  expect(screen.queryByText("82")).not.toBeInTheDocument();
});
it("chooses the latest observed measurement even if input arrives out of order", () => {
  const older = { ...vital, id: "old", observedAt: "2020-01-01T00:00:00Z" };
  expect(latestReadings([vital, older])[0].id).toBe("v1");
});
it("renders true history and does not bridge missing samples", () => {
  const readings = [
    { ...vital, observedAt: "2026-11-14T12:00:00Z" },
    {
      ...vital,
      id: "v2",
      quality: "MISSING",
      observedAt: "2026-11-14T12:01:00Z",
    },
    { ...vital, id: "v3", value: 86, observedAt: "2026-11-14T12:02:00Z" },
  ];
  const { container } = render(<Trend readings={readings} />);
  expect(
    screen.getByRole("img", { name: /2 valid readings, 82 to 86 bpm/ }),
  ).toBeInTheDocument();
  expect(container.querySelectorAll("polyline")).toHaveLength(2);
  expect(container.querySelectorAll("circle")).toHaveLength(2);
});
it("shows an honest trend unavailable state when history is insufficient", () => {
  render(<Trend readings={[vital]} />);
  expect(screen.getByText(/Trend unavailable/)).toBeInTheDocument();
  expect(screen.queryByRole("img")).not.toBeInTheDocument();
});
it("uses a sparse task queue without empty Next and Later board columns", () => {
  render(
    <MemoryRouter>
      <RoundsView
        rounds={[round]}
        state={state}
        mutate={vi.fn()}
        busy={false}
        label="Labor & delivery"
      />
    </MemoryRouter>,
  );
  expect(screen.getByRole("heading", { name: "Now" })).toBeInTheDocument();
  expect(
    screen.queryByRole("heading", { name: "Next" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("heading", { name: "Later" }),
  ).not.toBeInTheDocument();
  expect(screen.getByText("Next: no scheduled tasks")).toBeInTheDocument();
});
it("refreshes task state and Activity after an acknowledged API response", async () => {
  let data = { ...state, tasks: [round.task] },
    updatedRound = round;
  const fetch = vi.fn(async (url: string, options?: RequestInit) => {
    if (url.endsWith("/acknowledge") && options?.method === "POST") {
      updatedRound = {
        ...round,
        task: { ...round.task, status: "ACKNOWLEDGED" },
      };
      data = {
        ...data,
        tasks: [updatedRound.task],
        events: [
          {
            id: "e1",
            patientId: "p1",
            type: "task.acknowledge",
            details: "Task acknowledged at bedside",
            source: "nurse-demo",
            timestamp: new Date().toISOString(),
          },
        ],
      };
    }
    return {
      ok: true,
      json: async () => fixturePayload(url, data, [updatedRound]),
    };
  });
  vi.stubGlobal("fetch", fetch);
  render(
    <MemoryRouter initialEntries={["/rounds"]}>
      <App />
    </MemoryRouter>,
  );
  await screen.findByRole("button", { name: "Acknowledge" });
  fireEvent.click(screen.getByRole("button", { name: "Acknowledge" }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Acknowledge" })).toBeDisabled(),
  );
  fireEvent.click(screen.getByRole("link", { name: "Activity" }));
  expect(
    await screen.findByText("Task acknowledged at bedside"),
  ).toBeInTheDocument();
  expect(
    fetch.mock.calls.some(
      ([url, options]) =>
        url === "/api/tasks/t1/acknowledge" && options?.method === "POST",
    ),
  ).toBe(true);
});
it("keeps ICU workflows separate when switching units", async () => {
  const icu = {
    ...state.patients[0],
    id: "p2",
    name: "ICU Patient",
    unit: "ICU",
    repositionPlan: true,
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => ({
      ok: true,
      json: async () =>
        fixturePayload(url, { ...state, patients: [...state.patients, icu] }),
    })),
  );
  render(
    <MemoryRouter>
      <App />
    </MemoryRouter>,
  );
  await screen.findByRole("heading", { name: "Activity" });
  fireEvent.change(screen.getByLabelText("Demo unit"), {
    target: { value: "ICU" },
  });
  fireEvent.click(screen.getByRole("link", { name: "Patients" }));
  expect(
    await screen.findByRole("heading", { name: "ICU Patient" }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("heading", { name: "Test Patient" }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("link", { name: /Open patient overview/ }));
  expect(
    screen.getByRole("heading", { name: "Repositioning monitoring" }),
  ).toBeInTheDocument();
  expect(
    screen.getByText(/Orientation observations do not confirm/),
  ).toBeInTheDocument();
});
