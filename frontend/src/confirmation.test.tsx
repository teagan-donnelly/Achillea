import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { PatientView } from "./PatientView";
import { TaskList } from "./TaskList";
import type { Chart, State, Round } from "./types";
const chart: Chart = {
  id: "c1",
  patientId: "p1",
  nurseId: "nurse-demo",
  type: "OBSERVATION",
  text: "Synthetic saved observation",
  status: "DRAFT",
  linkedTaskId: null,
  linkedMovementId: null,
  linkedVitalIds: [],
  authoredAt: "2026-11-14T12:00:00Z",
  confirmedAt: null,
  amendmentOfId: null,
  provenance: "Nurse-entered",
};
const state: State = {
  patients: [
    {
      id: "p1",
      name: "Demo Patient",
      room: "201",
      unit: "ICU",
      summary: "Synthetic care",
      nurseId: "nurse-demo",
      repositionPlan: true,
    },
  ],
  tasks: [],
  vitals: [],
  movements: [],
  charts: [chart],
  events: [],
};
const round: Round = {
  rank: 1,
  reason: "Past scheduled due time",
  task: {
    id: "t1",
    patientId: "p1",
    title: "Repositioning review",
    type: "REPOSITION_REVIEW",
    status: "OPEN",
    priority: "ROUTINE",
    source: "CARE_PLAN",
    dueAt: "2026-11-14T12:00:00Z",
    verificationRequired: true,
    deferReason: null,
    order: 1,
    completedAt: null,
    verifiedBy: null,
  },
};
afterEach(() => {
  cleanup();
  sessionStorage.clear();
});
function patient(data: State, mutate = vi.fn().mockResolvedValue(chart)) {
  render(
    <MemoryRouter initialEntries={["/patients/p1?section=chart"]}>
      <Routes>
        <Route
          path="/patients/:id"
          element={
            <PatientView
              state={data}
              rounds={[]}
              unit="ICU"
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
it("requires explicit review and saving changed metadata before chart confirmation", async () => {
  const mutate = patient(state);
  fireEvent.click(screen.getByRole("button", { name: "Edit draft" }));
  expect(screen.getByRole("button", { name: "Confirm entry" })).toBeDisabled();
  fireEvent.click(
    screen.getByLabelText(
      "I reviewed the saved entry, patient identity, and provenance.",
    ),
  );
  expect(screen.getByRole("button", { name: "Confirm entry" })).toBeEnabled();
  fireEvent.change(screen.getByLabelText("Entry type"), {
    target: { value: "ASSESSMENT" },
  });
  expect(screen.getByRole("button", { name: "Confirm entry" })).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Entry type"), {
    target: { value: "OBSERVATION" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
  await waitFor(() =>
    expect(mutate).toHaveBeenCalledWith(
      "/chart/drafts/c1",
      expect.objectContaining({ type: "OBSERVATION" }),
      "PATCH",
    ),
  );
  fireEvent.click(
    screen.getByLabelText(
      "I reviewed the saved entry, patient identity, and provenance.",
    ),
  );
  fireEvent.click(screen.getByRole("button", { name: "Confirm entry" }));
  await waitFor(() =>
    expect(mutate).toHaveBeenCalledWith("/chart/drafts/c1/confirm", {
      verified: true,
    }),
  );
  expect(sessionStorage.getItem("achillea-note-p1")).toBeNull();
});
it("appends an amendment through the existing endpoint without changing the original", async () => {
  const mutate = vi.fn().mockResolvedValue({
    ...chart,
    id: "c2",
    text: "Synthetic correction",
    amendmentOfId: "c1",
  });
  patient({ ...state, charts: [{ ...chart, status: "CONFIRMED" }] }, mutate);
  fireEvent.click(screen.getByRole("button", { name: "Append amendment" }));
  fireEvent.change(
    screen.getByPlaceholderText("Enter your synthetic bedside observation"),
    { target: { value: "Synthetic correction" } },
  );
  fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
  await waitFor(() =>
    expect(mutate).toHaveBeenCalledWith(
      "/chart/c1/amendments",
      expect.objectContaining({
        text: "Synthetic correction",
        patientId: "p1",
      }),
      "POST",
    ),
  );
  expect(screen.getByText("Synthetic saved observation")).toBeInTheDocument();
});
it("requires nurse-confirmed movement and bedside verification to complete repositioning", async () => {
  const mutate = vi.fn().mockResolvedValue(state);
  const data = {
    ...state,
    movements: [
      {
        id: "m1",
        patientId: "p1",
        classification: "COORDINATED_TURN_CANDIDATE",
        quality: "SIMULATED_GOOD",
        verificationStatus: "CONFIRMED_CARE",
        reviewerId: "nurse-demo",
        reviewedAt: "2026-11-14T12:00:00Z",
        chestBefore: 0,
        pelvisBefore: 0,
        chestAfter: 35,
        pelvisAfter: 35,
        capturedAt: "2026-11-14T12:00:00Z",
        sampleIds: [],
      },
    ],
  };
  render(
    <MemoryRouter>
      <TaskList state={data} rounds={[round]} mutate={mutate} busy={false} />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Complete" }));
  expect(
    screen.getByRole("button", { name: "Confirm completion" }),
  ).toBeDisabled();
  fireEvent.click(
    screen.getByLabelText(
      "I verified this care at the bedside (synthetic demo).",
    ),
  );
  expect(
    screen.getByRole("button", { name: "Confirm completion" }),
  ).toBeDisabled();
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "m1" } });
  fireEvent.click(screen.getByRole("button", { name: "Confirm completion" }));
  await waitFor(() =>
    expect(mutate).toHaveBeenCalledWith("/tasks/t1/complete", {
      verified: true,
      movementId: "m1",
    }),
  );
});
it("shows disconnected pelvic sensor and keeps movement review explicit", async () => {
  const mutate = vi.fn().mockResolvedValue(state);
  patient(
    {
      ...state,
      movements: [
        {
          id: "m1",
          patientId: "p1",
          classification: "UNKNOWN",
          quality: "PELVIS_DISCONNECTED",
          verificationStatus: "UNREVIEWED",
          reviewerId: null,
          reviewedAt: null,
          chestBefore: 0,
          pelvisBefore: 0,
          chestAfter: 35,
          pelvisAfter: 0,
          capturedAt: "2026-11-14T12:00:00Z",
          sampleIds: ["torso1"],
        },
      ],
    },
    mutate,
  );
  fireEvent.click(screen.getByRole("button", { name: "Repositioning" }));
  fireEvent.click(screen.getByRole("button", { name: /^Sensor monitoring/ }));
  expect(screen.getByText("Unknown / disconnected")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Review candidate" }));
  expect(
    screen.getByRole("button", { name: "Confirm care observation" }),
  ).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Bedside verification note"), {
    target: { value: "Personally verified synthetic care" },
  });
  fireEvent.click(
    screen.getByLabelText(
      "I verified actual care, beyond the sensor observation.",
    ),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Confirm care observation" }),
  );
  await waitFor(() =>
    expect(mutate).toHaveBeenCalledWith("/movements/m1/review", {
      status: "CONFIRMED_CARE",
      verified: true,
      text: "Personally verified synthetic care",
    }),
  );
});
