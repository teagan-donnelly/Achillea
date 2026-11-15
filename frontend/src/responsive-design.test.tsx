import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TimelineRail, type TimelineRecord } from "./TimelineRail";
import { PatientTimeline } from "./PatientTimeline";
import { ActivityHome } from "./WorkspaceViews";
import { fixturePayload } from "./test-api-fixture";
import App from "./App";
import type { ActivityItem, State } from "./types";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  sessionStorage.clear();
});
const state: State = {
  serverTime: "2026-11-14T18:00:00Z",
  patients: [
    {
      id: "p1",
      name: "Fixture Nurse Patient",
      room: "201",
      unit: "L_AND_D",
      summary: "Synthetic observation",
      nurseId: "nurse-demo",
      repositionPlan: false,
    },
    {
      id: "p2",
      name: "Other Unit Fixture",
      room: "108",
      unit: "ICU",
      summary: "Synthetic ICU observation",
      nurseId: "nurse-demo",
      repositionPlan: false,
    },
  ],
  charts: [],
  tasks: [],
  movements: [],
  vitals: [],
  events: [
    {
      id: "d1",
      patientId: "p1",
      type: "device.disconnected",
      source: "SIMULATOR",
      details: "Disconnected fixture source",
      timestamp: "2026-11-14T17:00:00Z",
    },
    {
      id: "c1",
      patientId: "p1",
      type: "chart.confirmed",
      source: "MANUAL_ENTRY",
      details: "Explicitly confirmed fixture chart",
      timestamp: "2026-11-14T17:30:00Z",
    },
  ],
};
const records: TimelineRecord[] = [
  {
    id: "r1",
    at: "2026-11-14T17:00:00Z",
    category: "Monitoring",
    title: "Observation one",
    detail: "Actual source record",
    source: "SIMULATOR",
  },
  {
    id: "r2",
    at: "2026-11-14T17:30:00Z",
    category: "Monitoring",
    title: "Observation two",
    detail: "Actual second record",
    source: "SIMULATOR",
  },
  {
    id: "r3",
    at: "2026-11-14T17:45:00Z",
    category: "Documentation",
    title: "Explicit documentation",
    detail: "Saved source record",
    source: "MANUAL_ENTRY",
  },
];
function item(
  id: string,
  category: string,
  type: string,
  summary: string,
): ActivityItem {
  return {
    id,
    patientId: "p1",
    category,
    type,
    sourceId: "fixture-source",
    startedAt: "2026-11-14T17:00:00Z",
    timestamp: "2026-11-14T17:30:00Z",
    count: 1,
    summary,
    measurementIds: [],
    sourceEventIds: [],
    rawEventIds: [],
  };
}

it("groups real rail records by hour/category and selects the latest underlying record", () => {
  const select = vi.fn();
  render(
    <TimelineRail
      records={records.slice().reverse()}
      selectedId="r2"
      onSelect={select}
    />,
  );
  const monitoring = screen.getByRole("button", {
    name: /Monitoring, .*2 source records/,
  });
  expect(monitoring).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(monitoring);
  expect(select).toHaveBeenCalledWith("r2");
  expect(screen.getAllByRole("button")).toHaveLength(2);
});
it("limits the compact rail while preserving full source data outside it", () => {
  const many = Array.from({ length: 12 }, (_, i) => ({
    ...records[0],
    id: "r" + i,
    at: new Date(
      Date.parse("2026-11-14T00:00:00Z") + i * 3600000,
    ).toISOString(),
  }));
  render(
    <TimelineRail
      records={many.slice().reverse()}
      selectedId=""
      onSelect={() => {}}
    />,
  );
  expect(screen.getAllByRole("button")).toHaveLength(6);
  expect(many).toHaveLength(12);
});
it("opens full history, inspects a real event, and clears selection when its category is filtered out", () => {
  render(<PatientTimeline state={state} patientId="p1" />);
  expect(
    screen.queryByRole("combobox", { name: "Filter patient timeline" }),
  ).not.toBeInTheDocument();
  fireEvent.click(
    screen.getByRole("button", { name: /Device, .*source records/ }),
  );
  expect(screen.getByRole("status")).toHaveTextContent(
    "Disconnected fixture source",
  );
  fireEvent.click(screen.getByRole("button", { name: "View all" }));
  expect(screen.getByRole("button", { name: "Compact view" })).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  fireEvent.change(screen.getByLabelText("Filter patient timeline"), {
    target: { value: "Documentation" },
  });
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: /Device, .*source records/ }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Compact view" }));
  expect(
    screen.queryByRole("combobox", { name: "Filter patient timeline" }),
  ).not.toBeInTheDocument();
});
it("connects the mockup's activity pills to real backend summaries", () => {
  render(
    <MemoryRouter>
      <ActivityHome
        state={state}
        patients={[state.patients[0]]}
        rounds={[]}
        label="Labor & delivery"
        summaries={[
          item(
            "m1",
            "MEASUREMENT",
            "vital.received",
            "Monitoring fixture receipt",
          ),
          item(
            "c1",
            "DOCUMENTATION",
            "chart.confirmed",
            "Confirmed fixture note",
          ),
        ]}
      />
    </MemoryRouter>,
  );
  expect(
    screen.getByText("Shift activity & patient updates"),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Care" }));
  expect(screen.getByRole("button", { name: "Care" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(screen.getByText("Confirmed fixture note")).toBeInTheDocument();
  expect(
    screen.queryByText("Monitoring fixture receipt"),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "All" }));
  expect(screen.getByText("Monitoring fixture receipt")).toBeInTheDocument();
});
it("switches patient-unit pills through existing APIs while retaining the Patients route", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => ({
      ok: true,
      json: async () => fixturePayload(url, state, []),
    })),
  );
  render(
    <MemoryRouter initialEntries={["/patients"]}>
      <App />
    </MemoryRouter>,
  );
  await screen.findByRole("heading", { name: "Fixture Nurse Patient" });
  expect(screen.getByRole("button", { name: "L&D (1)" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  fireEvent.click(screen.getByRole("button", { name: "ICU" }));
  await screen.findByRole("heading", { name: "Other Unit Fixture" });
  expect(screen.getByRole("heading", { name: "Patients" })).toBeInTheDocument();
  expect(
    screen.queryByRole("heading", { name: "Fixture Nurse Patient" }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "ICU (1)" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  fireEvent.click(screen.getByRole("button", { name: "L&D" }));
  await waitFor(() =>
    expect(
      screen.getByRole("heading", { name: "Fixture Nurse Patient" }),
    ).toBeInTheDocument(),
  );
});
