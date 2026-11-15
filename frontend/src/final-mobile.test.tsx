import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { PatientTimeline } from "./PatientTimeline";
import { PatientView } from "./PatientView";
import { BackendActivity, activityRuns } from "./BackendActivity";
import { RoundsView } from "./RoundsView";
import { SwipeNavigation } from "./SwipeNavigation";
import type { State, ActivityItem, Round } from "./types";

const state: State = {
  serverTime: "2026-11-14T18:00:00Z",
  patients: [
    {
      id: "p1",
      name: "Maya Rowan",
      room: "201",
      unit: "L_AND_D",
      summary: "Synthetic observation",
      nurseId: "nurse-demo",
      repositionPlan: false,
    },
  ],
  charts: [],
  tasks: [],
  movements: [],
  vitals: [
    {
      id: "v1",
      patientId: "p1",
      metric: "HEART_RATE",
      value: 82,
      unit: "bpm",
      observedAt: "2026-11-14T17:00:00Z",
      receivedAt: "2026-11-14T17:01:00Z",
      source: "SIMULATED_MONITOR",
      sourceEventId: "sv1",
      quality: "VALID",
    },
  ],
  events: [
    {
      id: "e1",
      patientId: "p1",
      type: "device.disconnected",
      source: "SIMULATOR",
      details: "Synthetic monitor disconnected",
      timestamp: "2026-11-14T17:30:00Z",
    },
    {
      id: "old",
      patientId: "p1",
      type: "chart.confirmed",
      source: "MANUAL",
      details: "Outside selected day",
      timestamp: "2026-11-12T18:00:00Z",
    },
    {
      id: "other",
      patientId: "p2",
      type: "device.disconnected",
      source: "SIMULATOR",
      details: "Other patient event",
      timestamp: "2026-11-14T17:30:00Z",
    },
  ],
};
const round: Round = {
  rank: 1,
  reason: "Past scheduled due time",
  horizon: "NOW",
  reasonCodes: ["SCHEDULED_OVERDUE"],
  task: {
    id: "t1",
    patientId: "p1",
    title: "Bedside review",
    type: "ASSESSMENT",
    status: "OPEN",
    priority: "ROUTINE",
    source: "SEEDED_CARE_PLAN",
    dueAt: "2026-11-14T17:00:00Z",
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
function patient(data = state, rounds: Round[] = []) {
  const mutate = vi.fn().mockResolvedValue({ id: "saved-draft" });
  render(
    <MemoryRouter initialEntries={["/patients/p1"]}>
      <Routes>
        <Route
          path="/patients/:id"
          element={
            <PatientView
              state={data}
              rounds={rounds}
              unit={data.patients[0].unit}
              mutate={mutate}
              busy={false}
            />
          }
        />
      </Routes>
    </MemoryRouter>,
  );
  return mutate;
}
function item(id: string, category: string): ActivityItem {
  return {
    id,
    patientId: "p1",
    category,
    type: "vital.received",
    sourceId: "monitor",
    startedAt: "2026-11-14T17:00:00Z",
    timestamp: "2026-11-14T17:30:00Z",
    count: 3,
    summary: "Summary " + id,
    measurementIds: ["v1"],
    sourceEventIds: [],
    rawEventIds: [],
  };
}

describe("Bedside mobile redesign", () => {
  it("shows actual timestamped patient records within the last day and expands source details", () => {
    render(<PatientTimeline state={state} patientId="p1" />);
    expect(
      screen.getByText("Last 24 hours · 2 source records"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Outside selected day")).not.toBeInTheDocument();
    expect(screen.queryByText("Other patient event")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "View all" }));
    fireEvent.change(screen.getByLabelText("Filter patient timeline"), {
      target: { value: "Device" },
    });
    const summary = screen.getByText("Device", { selector: "summary span" });
    fireEvent.click(summary);
    expect(summary.closest("details")).toHaveAttribute("open");
    expect(screen.getByText("Synthetic monitor disconnected")).toBeVisible();
    expect(screen.queryByText("Heart rate")).not.toBeInTheDocument();
    expect(screen.queryByText(/Medication/)).not.toBeInTheDocument();
  });
  it("selects a four-hour window and restores the full day", () => {
    render(<PatientTimeline state={state} patientId="p1" />);
    fireEvent.click(screen.getByRole("button", { name: "View all" }));
    const window = screen.getByRole("button", { name: /From .*: 2 records/ });
    fireEvent.click(window);
    expect(window).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Show all 24 hours" }));
    expect(window).toHaveAttribute("aria-pressed", "false");
  });
  it("shows missing history honestly and handles an empty day", () => {
    const missing = {
      ...state,
      events: [],
      vitals: [{ ...state.vitals[0], quality: "MISSING", value: NaN }],
    };
    const { rerender } = render(
      <PatientTimeline state={missing} patientId="p1" />,
    );
    expect(screen.getByText(/Unavailable bpm/)).toBeInTheDocument();
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
    rerender(
      <PatientTimeline
        state={{ ...state, events: [], vitals: [] }}
        patientId="p1"
      />,
    );
    expect(
      screen.getByText("No recorded activity in this time range."),
    ).toBeInTheDocument();
  });
  it("opens care sections without saving or confirming care automatically", () => {
    const mutate = patient();
    fireEvent.click(screen.getByRole("button", { name: "Care" }));
    const doc = screen.getByRole("button", { name: /Care & documentation/ });
    expect(doc).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(doc);
    expect(doc).toHaveAttribute("aria-expanded", "true");
    const narrative = screen.getByPlaceholderText(
      "Enter your synthetic bedside observation",
    );
    fireEvent.change(narrative, {
      target: { value: "Synthetic bedside observation" },
    });
    expect(mutate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    expect(mutate).toHaveBeenCalledWith(
      "/chart/drafts",
      expect.objectContaining({
        patientId: "p1",
        text: "Synthetic bedside observation",
      }),
      "POST",
    );
    expect(mutate).toHaveBeenCalledTimes(1);
  });
  it("exposes pending-task summaries and existing task actions", () => {
    patient({ ...state, tasks: [round.task] }, [round]);
    fireEvent.click(screen.getByRole("button", { name: "Care" }));
    const tasks = screen.getByRole("button", { name: /Pending tasks/ });
    expect(tasks).toHaveTextContent("1 open tasks - 1 require review");
    expect(tasks).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "Acknowledge" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Complete" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Defer" })).toBeVisible();
  });
  it("keeps simulated ICU region sources and the nursing review warning visible", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          samples: [],
          devices: [],
          connectivityEvents: [],
          movements: [],
          orientationUnit: "degrees",
          ruleVersion: "demo",
        }),
      }),
    );
    patient({
      ...state,
      patients: [{ ...state.patients[0], unit: "ICU", repositionPlan: true }],
    });
    expect(
      screen.getByRole("button", { name: /Sensor monitoring/ }),
    ).toHaveTextContent("simulated chest & pelvis");
    fireEvent.click(screen.getByRole("button", { name: /Sensor monitoring/ }));
    expect(screen.getByText("Upper torso")).toBeVisible();
    expect(
      screen.getAllByText("Pelvis").some((el) => el.textContent === "Pelvis"),
    ).toBe(true);
    expect(
      screen.getByText(/Orientation observations do not confirm/),
    ).toBeVisible();
    await screen.findByText(/Independent upper-torso/);
    fireEvent.click(screen.getByRole("button", { name: /Sensor monitoring/ }));
    expect(
      screen.getByRole("button", { name: /Sensor monitoring/ }),
    ).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(screen.getByRole("button", { name: "Care" }));
    fireEvent.click(
      screen.getByRole("button", { name: /Original event history/ }),
    );
    expect(
      screen.getByRole("region", { name: "24-hour patient activity" }),
    ).toBeVisible();
  });
  it("folds consecutive backend monitoring windows without hiding exceptions or reordering source data", () => {
    const items = [
      item("a", "MONITORING_SUMMARY"),
      item("b", "MONITORING_SUMMARY"),
      item("c", "DEVICE_STATUS"),
      item("d", "MONITORING_SUMMARY"),
    ];
    expect(activityRuns(items).map((run) => run.map((i) => i.id))).toEqual([
      ["a", "b"],
      ["c"],
      ["d"],
    ]);
    render(
      <MemoryRouter>
        <BackendActivity
          items={items}
          events={state.events}
          patients={state.patients}
          state={state}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText("Summary c")).toBeVisible();
    expect(screen.getByText("Summary a")).not.toBeVisible();
    fireEvent.click(
      screen.getByText("Monitoring receipts - 6 measurements across 2 windows"),
    );
    expect(screen.getByText("Summary a")).toBeVisible();
    fireEvent.click(
      screen
        .getByText("Summary a")
        .closest("article")!
        .querySelector("summary")!,
    );
    expect(
      within(screen.getByText("Summary a").closest("article")!).getByText(
        /heart rate: 82 bpm/,
      ),
    ).toBeVisible();
    expect(items.map((i) => i.id)).toEqual(["a", "b", "c", "d"]);
  });
  it("preserves rounds ordering and explicit deferral submission", () => {
    const mutate = vi.fn().mockResolvedValue({});
    render(
      <MemoryRouter>
        <RoundsView
          state={{ ...state, tasks: [round.task] }}
          rounds={[round]}
          mutate={mutate}
          busy={false}
          label="Labor & delivery"
        />
      </MemoryRouter>,
    );
    const now = document.getElementById("schedule-now")!;
    fireEvent.click(within(now).getByRole("button", { name: "Defer" }));
    fireEvent.change(screen.getByLabelText("Reason for deferral"), {
      target: { value: "Synthetic patient requested later review" },
    });
    expect(mutate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Save deferral" }));
    expect(mutate).toHaveBeenCalledWith("/tasks/t1/defer", {
      reason: "Synthetic patient requested later review",
    });
  });
  it("does not run keyboard page navigation while editing a form", () => {
    function Location() {
      return <output>{useLocation().pathname}</output>;
    }
    render(
      <MemoryRouter>
        <SwipeNavigation>
          <form>
            <input aria-label="Nurse note" />
          </form>
          <Location />
        </SwipeNavigation>
      </MemoryRouter>,
    );
    fireEvent.keyDown(screen.getByLabelText("Nurse note"), {
      key: "ArrowRight",
      ctrlKey: true,
      altKey: true,
    });
    expect(screen.getByRole("status")).toHaveTextContent("/");
  });
});
