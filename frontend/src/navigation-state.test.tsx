import { afterEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { Link, MemoryRouter, Route, Routes } from "react-router-dom";
import App from "./App";
import { RouteScroll } from "./RouteScroll";
import { fixturePayload } from "./test-api-fixture";
import type { State } from "./types";
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  sessionStorage.clear();
});
function fixture(): State {
  const now = new Date().toISOString();
  return {
    serverTime: now,
    patients: [
      {
        id: "p1",
        name: "Synthetic bedside patient",
        room: "108",
        unit: "ICU",
        summary: "Synthetic review",
        nurseId: "nurse-demo",
        repositionPlan: true,
      },
    ],
    tasks: [],
    vitals: [],
    events: [],
    charts: [],
    repositioningPlans: [
      {
        patientId: "p1",
        intervalMinutes: 120,
        warningMinutes: 30,
        initialDueAt: new Date(Date.now() + 7200000).toISOString(),
        lastConfirmedCareAt: null,
      },
    ],
    movements: [
      {
        id: "m1",
        patientId: "p1",
        classification: "COORDINATED_TURN_CANDIDATE",
        quality: "SIMULATED_GOOD",
        verificationStatus: "UNREVIEWED",
        reviewerId: null,
        reviewedAt: null,
        chestBefore: 0,
        pelvisBefore: 0,
        chestAfter: 35,
        pelvisAfter: 35,
        capturedAt: now,
        sampleIds: [],
      },
    ],
    devices: ["UPPER_TORSO", "PELVIS"].map((bodyRegion) => ({
      id: bodyRegion,
      bodyRegion,
      patientId: "p1",
      connectionState: "CONNECTED",
      freshness: "FRESH",
      mode: "SIMULATED",
      calibrationStatus: "SIMULATED_REFERENCE",
      lastSeenAt: now,
      lastSampledAt: now,
    })),
  };
}
function setup(path: string, data: State) {
  localStorage.setItem("achillea-selected-unit", "ICU");
  const fetch = vi.fn(async (url: string) => ({
    ok: true,
    json: async () => fixturePayload(url, data),
  }));
  vi.stubGlobal("fetch", fetch);
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
  return fetch;
}
it("retains sensor filters on return while refreshing current device data", async () => {
  const data = fixture(),
    fetch = setup("/sensors", data);
  await screen.findByRole("heading", { name: "Sensor Monitoring" });
  fireEvent.click(
    screen.getByRole("button", { name: "Sensor unavailable (0)" }),
  );
  fireEvent.click(screen.getByRole("link", { name: "Patients" }));
  await screen.findByRole("heading", { name: "Patients" });
  data.devices![1].connectionState = "DISCONNECTED";
  const before = fetch.mock.calls.length;
  fireEvent.click(screen.getByRole("link", { name: "Sensors" }));
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Sensor unavailable (1)" }),
    ).toHaveAttribute("aria-pressed", "true"),
  );
  expect(
    screen.getByRole("heading", { name: "Synthetic bedside patient" }),
  ).toBeInTheDocument();
  expect(fetch.mock.calls.length).toBeGreaterThan(before);
});
it("retains patient section and draft review text without carrying a care verification across navigation", async () => {
  const fetch = setup("/patients/p1?section=repositioning", fixture());
  await screen.findByRole("heading", { name: "Synthetic bedside patient" });
  fireEvent.click(
    screen.getByRole("button", { name: /Review & document turn/ }),
  );
  fireEvent.change(screen.getByLabelText("Bedside observation"), {
    target: { value: "Unsubmitted bedside review" },
  });
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("link", { name: "Rounds" }));
  await screen.findByRole("heading", { name: "Rounds" });
  fireEvent.click(screen.getByRole("link", { name: "Patients" }));
  fireEvent.click(
    (
      await screen.findByRole("heading", { name: "Synthetic bedside patient" })
    ).closest("a")!,
  );
  expect(screen.getByRole("button", { name: "Repositioning" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(screen.getByLabelText("Bedside observation")).toHaveValue(
    "Unsubmitted bedside review",
  );
  expect(screen.getByRole("checkbox")).not.toBeChecked();
  expect(
    screen.getByRole("button", { name: "Confirm & document" }),
  ).toBeDisabled();
  expect(fetch.mock.calls.every(([path]) => !path.includes("/confirm"))).toBe(
    true,
  );
});
it("retains Home expansion and unsubmitted rounds scheduling inputs", async () => {
  setup("/", fixture());
  await screen.findByRole("heading", { name: "Repositioning Command Center" });
  const details = screen.getByText("On-track patients (1)").closest("details")!;
  details.open = true;
  fireEvent(details, new Event("toggle"));
  fireEvent.click(screen.getByRole("link", { name: "Rounds" }));
  const schedule = (
    await screen.findByText("Schedule a synthetic review")
  ).closest("details")!;
  schedule.open = true;
  fireEvent(schedule, new Event("toggle"));
  fireEvent.change(screen.getByLabelText("Review title"), {
    target: { value: "Retained review schedule" },
  });
  fireEvent.click(screen.getByRole("link", { name: "Home" }));
  expect(
    screen.getByText("On-track patients (1)").closest("details"),
  ).toHaveAttribute("open");
  fireEvent.click(screen.getByRole("link", { name: "Rounds" }));
  expect(screen.getByLabelText("Review title")).toHaveValue(
    "Retained review schedule",
  );
  expect(
    screen.getByText("Schedule a synthetic review").closest("details"),
  ).toHaveAttribute("open");
});
it("restores each route's measured scroll position instead of retaining the previous page offset", () => {
  let y = 0;
  const frames: (() => void)[] = [];
  vi.spyOn(window, "scrollY", "get").mockImplementation(() => y);
  vi.stubGlobal("requestAnimationFrame", (cb: () => void) => {
    frames.push(cb);
    return frames.length;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  const scroll = vi
    .spyOn(window, "scrollTo")
    .mockImplementation((options: ScrollToOptions | number) => {
      if (typeof options === "object") y = options.top ?? 0;
    });
  render(
    <MemoryRouter>
      <RouteScroll unit="ICU" ready />
      <Link to="/">Home</Link>
      <Link to="/patients">Patients</Link>
      <Routes>
        <Route path="/" element={<h1>Home page</h1>} />
        <Route path="/patients" element={<h1>Patient page</h1>} />
      </Routes>
    </MemoryRouter>,
  );
  function flush() {
    act(() => {
      frames.splice(0).forEach((fn) => fn());
    });
  }
  flush();
  y = 600;
  fireEvent.scroll(window);
  fireEvent.click(screen.getByRole("link", { name: "Patients" }));
  flush();
  expect(y).toBe(0);
  y = 120;
  fireEvent.scroll(window);
  fireEvent.click(screen.getByRole("link", { name: "Home" }));
  flush();
  expect(scroll).toHaveBeenLastCalledWith({
    left: 0,
    top: 600,
    behavior: "instant",
  });
});
