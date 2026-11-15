import { afterEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { PatientView } from "./PatientView";
import {
  RepositioningDetail,
  RepositioningHome,
  SensorMonitoring,
} from "./RepositioningViews";
import { repositioningStatus } from "./repositioning";
import type { State } from "./types";
const stamp = "2026-11-14T18:00:00Z",
  now = Date.parse(stamp);
function fixture(): State {
  return {
    serverTime: stamp,
    patients: [
      {
        id: "icu",
        name: "Synthetic Turn Patient",
        room: "108",
        unit: "ICU",
        summary: "Fictional care plan",
        nurseId: "nurse-demo",
        repositionPlan: true,
      },
    ],
    repositioningPlans: [
      {
        patientId: "icu",
        intervalMinutes: 120,
        warningMinutes: 30,
        initialDueAt: "2026-11-14T17:18:00Z",
        lastConfirmedCareAt: null,
      },
    ],
    tasks: [],
    vitals: [],
    charts: [],
    events: [],
    devices: ["UPPER_TORSO", "PELVIS"].map((region) => ({
      id: region,
      patientId: "icu",
      bodyRegion: region,
      connectionState: "CONNECTED",
      freshness: "FRESH",
      mode: "SIMULATED",
      calibrationStatus: "SIMULATED_REFERENCE",
      lastSeenAt: stamp,
      lastSampledAt: stamp,
    })),
    movements: [
      {
        id: "movement",
        patientId: "icu",
        classification: "COORDINATED_TURN_CANDIDATE",
        quality: "SIMULATED_GOOD",
        verificationStatus: "UNREVIEWED",
        reviewerId: null,
        reviewedAt: null,
        chestBefore: 0,
        pelvisBefore: 0,
        chestAfter: 35,
        pelvisAfter: 35,
        capturedAt: stamp,
        sampleIds: [],
      },
    ],
  };
}
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it("groups existing patient workflows into three primary sections without losing documentation or history", () => {
  const s = fixture();
  render(
    <MemoryRouter initialEntries={["/patients/icu?section=repositioning"]}>
      <Routes>
        <Route
          path="/patients/:id"
          element={
            <PatientView
              state={s}
              rounds={[]}
              unit="ICU"
              mutate={vi.fn()}
              busy={false}
            />
          }
        />
      </Routes>
    </MemoryRouter>,
  );
  expect(
    document.querySelectorAll(".patient-primary-tabs button"),
  ).toHaveLength(3);
  fireEvent.click(screen.getByRole("button", { name: "Care" }));
  expect(screen.getByRole("button", { name: /Pending tasks/ })).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  fireEvent.click(screen.getByRole("button", { name: /Care & documentation/ }));
  expect(
    screen.getByPlaceholderText("Enter your synthetic bedside observation"),
  ).toBeVisible();
  fireEvent.click(
    screen.getByRole("button", { name: /Original event history/ }),
  );
  expect(
    screen.getByRole("heading", { name: "Patient history" }),
  ).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Vitals" }));
  expect(screen.getByRole("button", { name: "Vitals" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});
it("plots timestamped sensor points with explicit uncertainty and keeps disconnected evidence distinct", () => {
  const s = fixture();
  s.samples = [
    {
      id: "sample-a",
      patientId: "icu",
      sensorId: "UPPER_TORSO",
      bodyRegion: "UPPER_TORSO",
      rollDegrees: 35,
      capturedAt: stamp,
      receivedAt: stamp,
      quality: "SIMULATED_GOOD",
      mode: "SIMULATED",
    },
    {
      id: "sample-b",
      patientId: "icu",
      sensorId: "PELVIS",
      bodyRegion: "PELVIS",
      rollDegrees: 12,
      capturedAt: stamp,
      receivedAt: stamp,
      quality: "UNCERTAIN",
      mode: "SIMULATED",
    },
  ];
  s.devices![1].connectionState = "DISCONNECTED";
  render(
    <MemoryRouter>
      <RepositioningDetail
        state={s}
        patient={s.patients[0]}
        mutate={vi.fn()}
        busy={false}
      />
    </MemoryRouter>,
  );
  fireEvent.click(
    screen.getByRole("button", { name: /Review & document turn/ }),
  );
  expect(
    screen.getByRole("img", { name: /2 discrete sensor samples/ }),
  ).toBeInTheDocument();
  expect(
    screen.getByText(/faded points have uncertain quality/),
  ).toBeInTheDocument();
  expect(document.querySelector(".region-unavailable")).not.toBeNull();
});
it("keeps care deadlines separate from connection and movement evidence", () => {
  const s = fixture(),
    p = s.patients[0];
  expect(repositioningStatus(s, p, now).schedule).toBe("OVERDUE");
  expect(repositioningStatus(s, p, now).pending).toBe(1);
  s.devices![0].connectionState = "DISCONNECTED";
  expect(repositioningStatus(s, p, now).schedule).toBe("OVERDUE");
  expect(repositioningStatus(s, p, now).reporting).toBe(false);
  s.repositioningPlans = [];
  expect(repositioningStatus(s, p, now).schedule).toBe("UNKNOWN");
});
it("calculates warning boundaries and confirmed schedule from an injected time", () => {
  const s = fixture(),
    p = s.patients[0];
  s.repositioningPlans![0].initialDueAt = new Date(now + 3600000).toISOString();
  expect(repositioningStatus(s, p, now).schedule).toBe("ON_TRACK");
  expect(repositioningStatus(s, p, now + 1800000).schedule).toBe("DUE_SOON");
  expect(repositioningStatus(s, p, now + 3600001).schedule).toBe("OVERDUE");
  s.repositioningPlans![0].lastConfirmedCareAt = stamp;
  expect(repositioningStatus(s, p, now).due).toBe(now + 7200000);
});
it("renders real queues, home counts, deep links and an updating overdue timer", () => {
  vi.useFakeTimers();
  const s = fixture();
  render(
    <MemoryRouter>
      <RepositioningHome state={s} patients={s.patients} label="ICU" />
    </MemoryRouter>,
  );
  expect(
    screen.getByRole("heading", { name: "Needs attention (1)" }),
  ).toBeInTheDocument();
  expect(screen.getByText("+42 min overdue")).toBeInTheDocument();
  expect(
    screen.getByRole("link", { name: /Synthetic Turn Patient/ }),
  ).toHaveAttribute("href", "/patients/icu?section=repositioning");
  act(() => vi.advanceTimersByTime(60000));
  expect(screen.getByText("+43 min overdue")).toBeInTheDocument();
});
it("never counts unavailable on-track evidence as compliant and filters sensor cards", () => {
  const s = fixture();
  s.repositioningPlans![0].initialDueAt = new Date(now + 7200000).toISOString();
  s.devices![0].connectionState = "DISCONNECTED";
  render(
    <MemoryRouter>
      <SensorMonitoring state={s} patients={s.patients} />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole("button", { name: "On track (0)" }));
  expect(
    screen.getByText("No patients match this sensor filter."),
  ).toBeInTheDocument();
  fireEvent.click(
    screen.getByRole("button", { name: "Sensor unavailable (1)" }),
  );
  expect(
    screen.getByRole("heading", { name: "Synthetic Turn Patient" }),
  ).toBeInTheDocument();
});
it("requires explicit verification and keeps the review open after a server error", async () => {
  const s = fixture(),
    mutate = vi.fn().mockRejectedValue(new Error("Server did not save"));
  render(
    <MemoryRouter>
      <RepositioningDetail
        state={s}
        patient={s.patients[0]}
        mutate={mutate}
        busy={false}
      />
    </MemoryRouter>,
  );
  fireEvent.click(
    screen.getByRole("button", { name: /Review & document turn/ }),
  );
  const submit = screen.getByRole("button", { name: "Confirm & document" });
  expect(submit).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Bedside observation"), {
    target: { value: "Verified prescribed care" },
  });
  expect(submit).toBeDisabled();
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(submit);
  await screen.findByRole("alert");
  expect(screen.getByText("Server did not save")).toBeInTheDocument();
  expect(s.repositioningPlans![0].lastConfirmedCareAt).toBeNull();
  expect(mutate).toHaveBeenCalledWith(
    "/patients/icu/repositioning/confirm",
    expect.objectContaining({ verified: true, movementId: "movement" }),
  );
});
it("saves non-care reviews without pretending the schedule was satisfied", async () => {
  const s = fixture(),
    mutate = vi.fn().mockResolvedValue(s);
  render(
    <MemoryRouter>
      <RepositioningDetail
        state={s}
        patient={s.patients[0]}
        mutate={mutate}
        busy={false}
      />
    </MemoryRouter>,
  );
  fireEvent.click(
    screen.getByRole("button", { name: /Review & document turn/ }),
  );
  fireEvent.change(screen.getByLabelText("Nurse review"), {
    target: { value: "NOT_CARE" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save nurse review" }));
  await waitFor(() =>
    expect(mutate).toHaveBeenCalledWith(
      "/movements/movement/review",
      expect.objectContaining({ status: "NOT_CARE", verified: false }),
    ),
  );
  expect(repositioningStatus(s, s.patients[0], now).schedule).toBe("OVERDUE");
});
