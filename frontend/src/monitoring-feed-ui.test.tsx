import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { MonitoringFeed } from "./MonitoringFeed";
import type { Device, Patient, State, Vital } from "./types";

const NOW = Date.parse("2026-11-15T12:00:00Z");
const observedAt = new Date(NOW - 10_000).toISOString();
const patient: Patient = {
  id: "p1",
  name: "Alex Linden",
  room: "108",
  unit: "ICU",
  summary: "",
  nurseId: "nurse-demo",
  repositionPlan: false,
};
const monitor: Device = {
  id: "monitor-p1",
  patientId: patient.id,
  bodyRegion: "BEDSIDE_MONITOR",
  connectionState: "CONNECTED",
  freshness: "FRESH",
  mode: "SIMULATED",
  calibrationStatus: "SIMULATED_REFERENCE",
  lastSeenAt: observedAt,
  lastSampledAt: observedAt,
};
const heartRate: Vital = {
  id: "v1",
  patientId: patient.id,
  metric: "HEART_RATE",
  value: 88,
  unit: "bpm",
  observedAt,
  receivedAt: observedAt,
  source: "SIMULATED_MONITOR",
  sourceEventId: "sample-1",
  quality: "VALID",
};
function fixture(
  device: Partial<Device> = {},
  reading: Partial<Vital> = {},
): State {
  return {
    patients: [patient],
    devices: [{ ...monitor, ...device }],
    vitals: [{ ...heartRate, ...reading }],
    tasks: [],
    charts: [],
    movements: [],
    events: [],
    samples: [],
    serverTime: new Date(NOW).toISOString(),
  };
}
function open(state: State) {
  render(
    <MemoryRouter>
      <MonitoringFeed state={state} patients={state.patients} />
    </MemoryRouter>,
  );
  return within(screen.getByRole("list", { name: "Patients" }));
}

beforeEach(() => vi.spyOn(Date, "now").mockReturnValue(NOW));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Monitoring feed visible measurement provenance", () => {
  it.each([
    ["stale", { freshness: "STALE" }, {}, "Old reading", true],
    ["delayed", { connectionState: "DELAYED" }, {}, "Delayed reading", true],
    [
      "disconnected",
      { connectionState: "DISCONNECTED" },
      {},
      "Disconnected",
      false,
    ],
    ["missing", {}, { quality: "MISSING" }, "Unavailable", false],
  ] as const)(
    "labels %s observations on the card without relying on a hover tooltip",
    (_name, device, reading, label, showRecordedValue) => {
      const feed = open(fixture(device, reading));
      const card = feed.getByRole("link", { name: /Room 108, Alex Linden/ });
      expect(within(card).getByText(label)).toBeVisible();
      if (showRecordedValue) expect(card).toHaveTextContent(/88\s*bpm/);
      else {
        expect(card).not.toHaveTextContent(/88\s*bpm/);
        expect(card).toHaveTextContent("\u2014");
      }
    },
  );

  it("shows actual room labels and filters the patient cards through labeled controls", () => {
    const state = fixture();
    state.patients.push({
      ...patient,
      id: "p2",
      name: "Robin Ash",
      room: "215",
    });
    state.devices!.push({
      ...monitor,
      id: "monitor-p2",
      patientId: "p2",
      connectionState: "DISCONNECTED",
    });
    state.vitals.push({ ...heartRate, id: "v2", patientId: "p2" });
    const feed = open(state);
    const rooms = within(screen.getByRole("navigation", { name: "Rooms" }));
    expect(rooms.getByText("Room 108")).toBeVisible();
    expect(rooms.getByText("Room 215")).toBeVisible();
    const filters = within(
      screen.getByRole("group", { name: "Filter patients" }),
    );
    expect(filters.getByRole("button", { name: "All" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(feed.getAllByRole("link")).toHaveLength(2);
    fireEvent.click(filters.getByRole("button", { name: "Needs Attention" }));
    expect(
      filters.getByRole("button", { name: "Needs Attention" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      feed.queryByRole("link", { name: /Alex Linden/ }),
    ).not.toBeInTheDocument();
    expect(feed.getByRole("link", { name: /Robin Ash/ })).toBeVisible();
    fireEvent.click(filters.getByRole("button", { name: "Stable" }));
    expect(feed.getByRole("link", { name: /Alex Linden/ })).toBeVisible();
    expect(
      feed.queryByRole("link", { name: /Robin Ash/ }),
    ).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "1 patient needs attention" }),
    );
    expect(
      filters.getByRole("button", { name: "Needs Attention" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(feed.getByRole("link", { name: /Robin Ash/ })).toBeVisible();
  });
});
