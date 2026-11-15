import { afterEach, describe, it, expect, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  cleanup,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { PatientView } from "./PatientView";
import { TaskList } from "./TaskList";
import { api } from "./api";
import type { State, Round } from "./types";
const state: State = {
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
  tasks: [],
  vitals: [
    {
      id: "v1",
      patientId: "p1",
      metric: "HEART_RATE",
      value: 80,
      unit: "bpm",
      observedAt: "2026-11-14T12:00:00Z",
      receivedAt: "2026-11-14T12:00:01Z",
      source: "SIMULATED_MONITOR",
      sourceEventId: "source-1",
      quality: "VALID",
    },
  ],
  movements: [],
  charts: [],
  events: [],
};
afterEach(() => {
  cleanup();
  sessionStorage.clear();
  vi.unstubAllGlobals();
});
describe("Bedside workflows", () => {
  it("shows assigned identity, measured source, timestamps, and units", () => {
    render(
      <MemoryRouter initialEntries={["/patients/p1"]}>
        <Routes>
          <Route
            path="/patients/:id"
            element={
              <PatientView
                state={state}
                rounds={[]}
                unit="L_AND_D"
                mutate={vi.fn()}
                busy={false}
              />
            }
          />
        </Routes>
      </MemoryRouter>,
    );
    expect(
      screen.getByRole("heading", { name: "Maya Rowan" }),
    ).toBeInTheDocument();
    expect(screen.getByText("bpm")).toBeInTheDocument();
    expect(screen.getByText(/SIMULATED_MONITOR/)).toBeInTheDocument();
    expect(screen.getByText(/Observed .*received/)).toBeInTheDocument();
    expect(
      screen.queryByText("Repositioning monitoring"),
    ).not.toBeInTheDocument();
  });
  it("saves an actual draft through the mutation client", async () => {
    const mutate = vi.fn().mockResolvedValue({ id: "draft-1" });
    render(
      <MemoryRouter initialEntries={["/patients/p1"]}>
        <Routes>
          <Route
            path="/patients/:id"
            element={
              <PatientView
                state={state}
                rounds={[]}
                unit="L_AND_D"
                mutate={mutate}
                busy={false}
              />
            }
          />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Chart" }));
    fireEvent.change(
      screen.getByPlaceholderText("Enter your synthetic bedside observation"),
      { target: { value: "Synthetic bedside review" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() =>
      expect(mutate).toHaveBeenCalledWith(
        "/chart/drafts",
        expect.objectContaining({
          patientId: "p1",
          text: "Synthetic bedside review",
        }),
        "POST",
      ),
    );
  });
  it("requires a deferral reason and sends it to backend", async () => {
    const mutate = vi.fn().mockResolvedValue(state);
    const rounds: Round[] = [
      {
        rank: 1,
        reason: "Past scheduled due time",
        task: {
          id: "t1",
          patientId: "p1",
          title: "Review care",
          type: "ASSESSMENT",
          status: "OPEN",
          priority: "ROUTINE",
          source: "SEEDED_CARE_PLAN",
          dueAt: "2026-11-14T12:00:00Z",
          verificationRequired: false,
          deferReason: null,
          order: 1,
          completedAt: null,
          verifiedBy: null,
        },
      },
    ];
    render(
      <MemoryRouter>
        <TaskList state={state} rounds={rounds} mutate={mutate} busy={false} />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByText("Defer"));
    expect(screen.getByText("Save deferral")).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Reason for deferral"), {
      target: { value: "Patient requested later review" },
    });
    fireEvent.click(screen.getByText("Save deferral"));
    await waitFor(() =>
      expect(mutate).toHaveBeenCalledWith("/tasks/t1/defer", {
        reason: "Patient requested later review",
      }),
    );
  });
  it("provides actionable server errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ message: "Deferral reason is required" }),
      }),
    );
    await expect(api("/tasks/t1/defer", {})).rejects.toThrow(
      "Deferral reason is required",
    );
  });
});
