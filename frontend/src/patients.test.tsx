import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { Link, MemoryRouter, Route, Routes } from "react-router-dom";
import { PatientsDirectory } from "./PatientsDirectory";
import { PatientTrends } from "./patient-trends";
import { PatientSummary } from "./patient-summary";
import { PatientTimelineFeed, buildTimeline } from "./patient-timeline";
import type { ScreenProps } from "./app-context";
import type { Event, State } from "./types";

const at = "2026-11-15T12:00:00Z";
const patient = {
  id: "p1",
  name: "Maya Rowan",
  room: "201",
  unit: "L_AND_D",
  summary: "",
  nurseId: "nurse-demo",
  repositionPlan: false,
};
const state: State = {
  patients: [patient],
  charts: [],
  tasks: [],
  events: [],
  movements: [],
  vitals: [],
  serverTime: at,
};
const reply = (body: unknown) =>
  ({ ok: true, json: async () => body }) as Response;
afterEach(() => {
  cleanup();
  sessionStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("retains the patient search and directory scroll when returning from a record", async () => {
  const scroll = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  const props: ScreenProps = {
    state,
    patients: [patient],
    rounds: [],
    activity: [],
    unit: "L_AND_D",
    label: "Labor & delivery",
    mutate: vi.fn(),
    busy: false,
    refresh: vi.fn(),
    selectUnit: vi.fn(),
  };
  render(
    <MemoryRouter initialEntries={["/patients"]}>
      <Routes>
        <Route path="/patients" element={<PatientsDirectory {...props} />} />
        <Route
          path="/patients/:id"
          element={<Link to="/patients">Back to patients</Link>}
        />
      </Routes>
    </MemoryRouter>,
  );
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "201" } });
  vi.stubGlobal("scrollY", 420);
  fireEvent.scroll(window);
  fireEvent.click(screen.getByRole("link", { name: /Maya Rowan/ }));
  fireEvent.click(screen.getByRole("link", { name: "Back to patients" }));
  expect(screen.getByRole("searchbox")).toHaveValue("201");
  await waitFor(() =>
    expect(scroll).toHaveBeenCalledWith({ top: 420, behavior: "instant" }),
  );
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "p1" } });
  expect(screen.getByRole("link", { name: /Maya Rowan/ })).toBeVisible();
});

it("requests the full persisted stay and weights the average by actual reading counts", async () => {
  const fetch = vi.fn<(path: string) => Promise<Response>>(async () =>
    reply({
      patientId: "p1",
      metric: "HEART_RATE",
      unit: "bpm",
      from: "2026-10-01T00:00:00Z",
      to: at,
      bucketMinutes: 60,
      firstObservedAt: "2026-10-01T00:00:00Z",
      lastObservedAt: at,
      totalReadings: 10,
      points: [
        { t: "2026-11-15T10:00:00Z", value: 100, min: 100, max: 100, count: 9 },
        { t: "2026-11-15T11:00:00Z", value: 50, min: 50, max: 50, count: 1 },
      ],
    }),
  );
  vi.stubGlobal("fetch", fetch);
  render(
    <PatientTrends
      state={{
        ...state,
        vitals: [
          {
            id: "v1",
            patientId: "p1",
            metric: "HEART_RATE",
            value: 80,
            unit: "bpm",
            observedAt: at,
            receivedAt: at,
            source: "MONITOR",
            sourceEventId: "source",
            quality: "VALID",
          },
        ],
      }}
      patient={patient}
      now={Date.parse(at)}
    />,
  );
  expect(await screen.findByText("95", { selector: "strong" })).toBeVisible();
  expect(screen.getByText("Average")).toBeVisible();
  fireEvent.click(screen.getByRole("tab", { name: "Full stay" }));
  await waitFor(() =>
    expect(
      fetch.mock.calls.some(
        ([path]) =>
          new URL(String(path), "http://localhost").searchParams.get(
            "fullStay",
          ) === "true",
      ),
    ).toBe(true),
  );
  const path = String(fetch.mock.calls.at(-1)?.[0]);
  const params = new URL(path, "http://localhost").searchParams;
  expect(params.has("from")).toBe(false);
  expect(params.has("bucketMinutes")).toBe(false);
  expect(await screen.findByText(/Stored measurements since/)).toBeVisible();
});

it("loads earlier persisted events using timestamp and ID cursors, including quiet receipt pages", async () => {
  const receipts: Event[] = Array.from({ length: 500 }, (_, index) => ({
    id: `receipt-${String(500 - index).padStart(4, "0")}`,
    patientId: "p1",
    type: "vital.received",
    source: "MONITOR",
    details: "Receipt",
    timestamp: at,
  }));
  const older: Event = {
    id: "older",
    patientId: "p1",
    type: "care.plan.changed",
    source: "SYSTEM",
    details: "Care schedule updated",
    timestamp: "2026-11-01T10:00:00Z",
  };
  const fetch = vi.fn(async (path: string) =>
    reply(path.includes("before=") ? [older] : receipts),
  );
  vi.stubGlobal("fetch", fetch);
  render(
    <PatientTimelineFeed
      state={state}
      patient={patient}
      now={Date.parse(at)}
    />,
  );
  fireEvent.click(await screen.findByRole("button", { name: "Show earlier" }));
  expect(await screen.findByText("Care schedule updated")).toBeVisible();
  const params = new URL(fetch.mock.calls.at(-1)![0], "http://localhost")
    .searchParams;
  expect(params.get("before")).toBe(at);
  expect(params.get("beforeId")).toBe(receipts.at(-1)!.id);
  expect(screen.getByText("System · SYSTEM")).toBeVisible();
});

it("resolves recorded task IDs into nurse-readable event titles", () => {
  const id = "11111111-1111-1111-1111-111111111111";
  const items = buildTimeline(
    {
      ...state,
      tasks: [
        {
          id,
          patientId: "p1",
          title: "Bedside assessment",
          status: "OPEN",
          type: "ASSESSMENT",
          priority: "ROUTINE",
          source: "CARE_PLAN",
          dueAt: at,
          verificationRequired: true,
          deferReason: null,
          order: 1,
          completedAt: null,
          verifiedBy: null,
        },
      ],
    },
    "p1",
    [
      {
        id: "event",
        patientId: "p1",
        type: "task.created",
        source: "SYSTEM",
        details: `${id}: due ${at}`,
        timestamp: at,
      },
    ],
  );
  expect(items[0]?.title).toBe("Bedside assessment added");
});

it("labels stale, delayed and disconnected summary measurements visibly and with observation times", () => {
  vi.spyOn(Date, "now").mockReturnValue(Date.parse(at));
  const vital = {
    id: "v1",
    patientId: "p1",
    metric: "HEART_RATE",
    value: 80,
    unit: "bpm",
    observedAt: "2026-11-15T10:00:00Z",
    receivedAt: at,
    source: "MONITOR",
    sourceEventId: "source",
    quality: "VALID",
  };
  const props = {
    patient,
    rounds: [],
    mutate: vi.fn(),
    busy: false,
    now: Date.parse(at),
    focus: null,
  };
  const view = render(
    <MemoryRouter>
      <PatientSummary {...props} state={{ ...state, vitals: [vital] }} />
    </MemoryRouter>,
  );
  expect(screen.getByText("Old reading")).toBeVisible();
  const stale = screen.getByRole("img", {
    name: /Heart rate, 80 bpm, Old reading, observed/,
  });
  expect(stale).toBeVisible();
  expect(stale).toHaveAttribute(
    "aria-label",
    expect.stringContaining(
      new Date(vital.observedAt).toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit",
      }),
    ),
  );
  expect(
    screen.getByRole("link", {
      name: /Vitals, open monitoring.*Old reading.*observed/,
    }),
  ).toBeVisible();
  view.rerender(
    <MemoryRouter>
      <PatientSummary
        {...props}
        state={{
          ...state,
          vitals: [{ ...vital, quality: "DELAYED", observedAt: at }],
        }}
      />
    </MemoryRouter>,
  );
  expect(screen.getByText("Delayed reading")).toBeVisible();
  expect(screen.queryByText("Old reading")).not.toBeInTheDocument();
  view.rerender(
    <MemoryRouter>
      <PatientSummary
        {...props}
        state={{ ...state, vitals: [{ ...vital, quality: "DISCONNECTED" }] }}
      />
    </MemoryRouter>,
  );
  expect(screen.getByText("Disconnected")).toBeVisible();
  expect(
    screen.getByRole("img", {
      name: /Heart rate, value unavailable, Disconnected, observed/,
    }),
  ).toBeVisible();
  expect(screen.queryByText("80", { selector: "b" })).not.toBeInTheDocument();
});
