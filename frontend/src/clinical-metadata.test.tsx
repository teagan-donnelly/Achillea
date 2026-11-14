import { afterEach, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readingState } from "./Monitoring";
import { ActivityHome, PatientCard } from "./WorkspaceViews";
import type { Device, State, Vital } from "./types";
const vital: Vital = {
  id: "v1",
  patientId: "p1",
  metric: "HEART_RATE",
  value: 81,
  unit: "bpm",
  observedAt: new Date().toISOString(),
  receivedAt: new Date().toISOString(),
  source: "SIMULATED_MONITOR",
  sourceEventId: "v1",
  quality: "VALID",
};
const device: Device = {
  id: "monitor-p1",
  patientId: "p1",
  bodyRegion: "BEDSIDE_MONITOR",
  connectionState: "CONNECTED",
  freshness: "FRESH",
  mode: "SIMULATED",
  calibrationStatus: "SIMULATED_REFERENCE",
  lastSeenAt: vital.receivedAt,
  lastSampledAt: vital.observedAt,
};
const state: State = {
  patients: [
    {
      id: "p1",
      name: "Synthetic nurse assignment",
      room: "201",
      unit: "L_AND_D",
      summary: "Synthetic context",
      nurseId: "nurse-demo",
      repositionPlan: false,
    },
  ],
  tasks: [],
  vitals: [vital],
  movements: [],
  charts: [],
  events: [],
  devices: [device],
};
afterEach(cleanup);
it("uses backend disconnection even when the last measured value has valid quality", () => {
  render(
    <MemoryRouter>
      <PatientCard
        patient={state.patients[0]}
        state={{
          ...state,
          devices: [
            {
              ...device,
              connectionState: "DISCONNECTED",
              freshness: "DISCONNECTED",
            },
          ],
        }}
        rounds={[]}
      />
    </MemoryRouter>,
  );
  expect(screen.getByLabelText("Monitor availability")).toHaveTextContent(
    "disconnected",
  );
  expect(screen.getByText("Unavailable")).toBeInTheDocument();
  expect(screen.queryByText("81")).not.toBeInTheDocument();
});
it("honors backend stale, delayed, and unknown states with recent receipts", () => {
  expect(readingState(vital, { ...device, freshness: "STALE" })).toBe(
    "Old reading",
  );
  expect(readingState(vital, { ...device, connectionState: "DELAYED" })).toBe(
    "Delayed reading",
  );
  expect(readingState(vital, { ...device, freshness: "UNKNOWN" })).toBe(
    "Signal unavailable",
  );
  expect(readingState({ ...vital, quality: "MISSING" }, device)).toBe(
    "Unavailable",
  );
});
it("includes real device events in the Monitoring activity filter", () => {
  render(
    <MemoryRouter>
      <ActivityHome
        state={{
          ...state,
          events: [
            {
              id: "e1",
              patientId: "p1",
              type: "device.disconnected",
              source: "SIMULATOR",
              details: "Persisted monitor disconnect proof",
              timestamp: new Date().toISOString(),
            },
          ],
        }}
        patients={state.patients}
        rounds={[]}
        label="Labor & delivery"
      />
    </MemoryRouter>,
  );
  fireEvent.change(screen.getByLabelText("Filter activity category"), {
    target: { value: "monitoring" },
  });
  expect(
    screen.getByText("Persisted monitor disconnect proof"),
  ).toBeInTheDocument();
});
