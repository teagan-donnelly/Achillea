import { afterEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { loadWorkspace } from "./workspace-feed";
import { fixturePayload } from "./test-api-fixture";
import { BackendActivity } from "./BackendActivity";
import App from "./App";
import type { ActivityItem, MonitoringUpdates, State, Vital } from "./types";

const stamp = "2026-11-14T14:00:00Z";
const patient = {
  id: "p1",
  name: "Synthetic LD",
  room: "201",
  unit: "L_AND_D",
  summary: "Synthetic context",
  nurseId: "nurse-demo",
  repositionPlan: false,
};
const state: State = {
  patients: [patient],
  tasks: [],
  vitals: [],
  samples: [],
  devices: [],
  movements: [],
  events: [],
  charts: [],
  demoStartedAt: stamp,
};
const vital: Vital = {
  id: "v1",
  patientId: "p1",
  metric: "HEART_RATE",
  value: 80,
  unit: "bpm",
  observedAt: stamp,
  receivedAt: stamp,
  source: "SIMULATED_MONITOR",
  sourceEventId: "s1",
  quality: "VALID",
  sourceId: "monitor-p1",
};
const reply = (body: unknown) =>
  ({ ok: true, json: async () => structuredClone(body) }) as Response;
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

it("uses receipt deltas, deduplicates equal-time evidence and replaces summary snapshots", async () => {
  let phase = 0;
  const fetch = vi.fn(async (input: string) => {
    if (input.includes("/workspace")) return reply(state);
    if (input.includes("/rounds")) return reply([]);
    if (input.includes("/activity/summary"))
      return reply([{ id: "summary-1", count: phase + 1 }]);
    const updates: MonitoringUpdates = {
      serverTime: stamp,
      nextSince: stamp,
      inclusive: true,
      measurements: phase
        ? [vital, { ...vital, id: "v2", sourceEventId: "s2", value: 83 }]
        : [vital],
      orientationSamples: [],
      devices: [],
      events: [],
    };
    return reply(updates);
  });
  vi.stubGlobal("fetch", fetch);
  const first = await loadWorkspace("L_AND_D");
  phase++;
  const second = await loadWorkspace("L_AND_D", first);
  expect(second.state.vitals.map((v) => v.id)).toEqual(["v1", "v2"]);
  expect(second.activity).toHaveLength(1);
  expect(second.activity[0].count).toBe(2);
  expect(
    fetch.mock.calls.some(([path]) =>
      path.includes("since=2026-11-14T14%3A00%3A00Z"),
    ),
  ).toBe(true);
});

it("starts a fresh evidence cache after a reset generation or unit change", async () => {
  let current = state;
  const fetch = vi.fn(async (path: string) =>
    reply(fixturePayload(path, current)),
  );
  vi.stubGlobal("fetch", fetch);
  const first = await loadWorkspace("L_AND_D");
  first.state.vitals = [vital];
  current = { ...state, demoStartedAt: "2026-11-14T15:00:00Z" };
  const reset = await loadWorkspace("L_AND_D", first);
  expect(reset.state.vitals).toEqual([]);
  expect(
    fetch.mock.calls
      .filter(([path]) => path.includes("/monitoring/updates"))
      .at(-1)![0],
  ).not.toContain("since=");
  await loadWorkspace("ICU", reset);
  expect(
    fetch.mock.calls
      .filter(([path]) => path.includes("/monitoring/updates"))
      .at(-1)![0],
  ).not.toContain("since=");
});

it("renders backend counts once and preserves original device and documentation events", () => {
  const event = {
    id: "e1",
    patientId: "p1",
    type: "device.disconnected",
    source: "SIMULATOR",
    details: "Technical disconnect recorded",
    timestamp: stamp,
  };
  const items: ActivityItem[] = [
    {
      id: "summary-1",
      patientId: "p1",
      category: "MONITORING_SUMMARY",
      type: "monitoring.summary",
      sourceId: "monitor-p1",
      startedAt: stamp,
      timestamp: stamp,
      count: 1,
      summary: "1 synthetic measurement received",
      measurementIds: ["v1"],
      sourceEventIds: ["s1"],
      rawEventIds: [],
    },
    {
      id: "e1",
      patientId: "p1",
      category: "DEVICE_STATUS",
      type: event.type,
      sourceId: event.source,
      startedAt: stamp,
      timestamp: stamp,
      count: 1,
      summary: event.details,
      measurementIds: [],
      sourceEventIds: [],
      rawEventIds: ["e1"],
    },
  ];
  render(
    <MemoryRouter>
      <BackendActivity
        state={{ ...state, vitals: [vital] }}
        items={items}
        events={[event]}
        patients={[patient]}
      />
    </MemoryRouter>,
  );
  expect(screen.getAllByText("1 synthetic measurement received")).toHaveLength(
    1,
  );
  expect(screen.getByText("Technical disconnect recorded")).toBeInTheDocument();
  expect(screen.queryByText(/monitor receipts/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByLabelText("Show original event history"));
  expect(screen.getByText("Technical disconnect recorded")).toBeInTheDocument();
  expect(
    screen.queryByText("1 synthetic measurement received"),
  ).not.toBeInTheDocument();
});

it("explains external evidence ownership without offering generation or reset", async () => {
  const fetcher = vi.fn(async (path: string) =>
    reply(fixturePayload(path, state)),
  );
  vi.stubGlobal("fetch", fetcher);
  render(
    <MemoryRouter>
      <App />
    </MemoryRouter>,
  );
  await screen.findByRole("heading", { name: "Activity" });
  fireEvent.click(screen.getByRole("button", { name: "Demo information" }));
  expect(
    screen.getByText(
      /Observations, orientation and device status come from the external simulator/,
    ),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("button", {
      name: /Reset synthetic|Run this step|New monitor reading/,
    }),
  ).not.toBeInTheDocument();
  expect(
    fetcher.mock.calls.some(([path]) =>
      /demo\/(presets|scenarios|reset)/.test(path),
    ),
  ).toBe(false);
});

it("ignores an older L&D response even after switching ICU and back to L&D", async () => {
  let resolveOld!: (response: Response) => void;
  let ldCalls = 0;
  const icu = {
    ...patient,
    id: "p2",
    name: "Synthetic ICU",
    unit: "ICU",
    repositionPlan: true,
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string) => {
      if (path === "/api/workspace?unit=L_AND_D" && ++ldCalls === 1)
        return new Promise<Response>((resolve) => {
          resolveOld = resolve;
        });
      return reply(
        fixturePayload(path, { ...state, patients: [patient, icu] }),
      );
    }),
  );
  render(
    <MemoryRouter>
      <App />
    </MemoryRouter>,
  );
  await waitFor(() => expect(resolveOld).toBeDefined());
  fireEvent.change(screen.getByLabelText("Demo unit"), {
    target: { value: "ICU" },
  });
  await screen.findByRole("heading", { name: "Activity" });
  fireEvent.change(screen.getByLabelText("Demo unit"), {
    target: { value: "L_AND_D" },
  });
  await screen.findByRole("heading", { name: "Activity" });
  fireEvent.click(screen.getByRole("link", { name: "Patients" }));
  await screen.findByRole("heading", { name: "Synthetic LD" });
  await act(async () => {
    resolveOld(
      reply({
        ...state,
        patients: [{ ...patient, name: "Late obsolete patient" }],
      }),
    );
  });
  expect(
    screen.getByRole("heading", { name: "Synthetic LD" }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("heading", { name: "Late obsolete patient" }),
  ).not.toBeInTheDocument();
});
