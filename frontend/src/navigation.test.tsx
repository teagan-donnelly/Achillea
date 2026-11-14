import { afterEach, describe, it, expect, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { Link, MemoryRouter, useLocation } from "react-router-dom";
import App from "./App";
import { SwipeNavigation } from "./SwipeNavigation";
import { ActivityHome, PatientCard } from "./WorkspaceViews";
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
  vitals: [],
  movements: [],
  charts: [],
  events: [],
};
const rounds: Round[] = [
  {
    rank: 1,
    reason: "Past scheduled due time",
    task: {
      id: "t1",
      patientId: "p1",
      title: "Bedside review",
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
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  sessionStorage.clear();
});
function Location() {
  return <output aria-label="Current route">{useLocation().pathname}</output>;
}
function setup(path = "/") {
  render(
    <MemoryRouter initialEntries={[path]}>
      <SwipeNavigation>
        <div data-testid="gesture">Workspace</div>
        <input aria-label="Control" />
        <div data-no-swipe data-testid="protected">
          Chart
        </div>
        <Link to="/rounds">Rounds</Link>
      </SwipeNavigation>
      <Location />
    </MemoryRouter>,
  );
}
function swipe(target: HTMLElement, dx: number, dy = 0) {
  fireEvent.touchStart(target, { touches: [{ clientX: 180, clientY: 100 }] });
  fireEvent.touchMove(target, {
    touches: [{ clientX: 180 + dx, clientY: 100 + dy }],
  });
  fireEvent.touchEnd(target, {
    changedTouches: [{ clientX: 180 + dx, clientY: 100 + dy }],
  });
}
describe("Mobile navigation", () => {
  it("swipes forward and back, without wrapping at either edge", () => {
    setup();
    const area = screen.getByTestId("gesture");
    swipe(area, 100);
    expect(screen.getByLabelText("Current route")).toHaveTextContent("/");
    swipe(area, -100);
    expect(screen.getByLabelText("Current route")).toHaveTextContent(
      "/patients",
    );
    swipe(area, -100);
    expect(screen.getByLabelText("Current route")).toHaveTextContent("/rounds");
    swipe(area, -100);
    expect(screen.getByLabelText("Current route")).toHaveTextContent("/rounds");
    swipe(area, 100);
    expect(screen.getByLabelText("Current route")).toHaveTextContent(
      "/patients",
    );
  });
  it("ignores vertical scrolling, short drags, controls, and chart content", () => {
    setup();
    swipe(screen.getByTestId("gesture"), -100, 80);
    swipe(screen.getByTestId("gesture"), -30);
    swipe(screen.getByLabelText("Control"), -100);
    swipe(screen.getByTestId("protected"), -100);
    expect(screen.getByLabelText("Current route").textContent).toBe("/");
  });
  it("supports direct links and keyboard shortcuts", () => {
    setup();
    fireEvent.keyDown(screen.getByTestId("gesture"), {
      key: "ArrowRight",
      altKey: true,
      ctrlKey: true,
    });
    expect(screen.getByLabelText("Current route")).toHaveTextContent(
      "/patients",
    );
    fireEvent.click(screen.getByRole("link", { name: "Rounds" }));
    expect(screen.getByLabelText("Current route")).toHaveTextContent("/rounds");
  });
  it("does not swipe out of patient detail", () => {
    setup("/patients/p1");
    swipe(screen.getByTestId("gesture"), -100);
    expect(screen.getByLabelText("Current route")).toHaveTextContent(
      "/patients/p1",
    );
  });
  it("lands on Activity and provides exactly three main destinations", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => ({
        ok: true,
        json: async () => (url.includes("/rounds") ? rounds : state),
      })),
    );
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );
    await screen.findByRole("heading", { name: "Activity" });
    expect(
      screen
        .getByRole("navigation", { name: "Main navigation" })
        .querySelectorAll("a"),
    ).toHaveLength(3);
    fireEvent.click(screen.getByRole("link", { name: "Rounds" }));
    expect(screen.getByRole("heading", { name: "Now" })).toBeInTheDocument();
    expect(
      screen.getAllByText(/Past scheduled due time/).length,
    ).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("link", { name: "Patients" }));
    expect(
      screen.getByRole("heading", { name: "Your patients" }),
    ).toBeInTheDocument();
  });
});
describe("Clinical information hierarchy", () => {
  it("separates outstanding work from history and filters real event types", () => {
    const data = {
      ...state,
      events: [
        {
          id: "e1",
          patientId: "p1",
          type: "vital.received",
          details: "Monitor reading received",
          source: "SIMULATED_MONITOR",
          timestamp: "2026-11-14T12:00:00Z",
        },
        {
          id: "e2",
          patientId: "p1",
          type: "chart.confirmed",
          details: "Observation confirmed",
          source: "nurse-demo",
          timestamp: "2026-11-14T12:01:00Z",
        },
      ],
    };
    render(
      <MemoryRouter>
        <ActivityHome
          state={data}
          patients={state.patients}
          rounds={rounds}
          label="Labor & delivery"
        />
      </MemoryRouter>,
    );
    expect(
      screen.getByRole("link", { name: /Bedside review/ }),
    ).toHaveAttribute("href", "/patients/p1?section=tasks#task-t1");
    fireEvent.change(screen.getByLabelText("Filter activity category"), {
      target: { value: "documentation" },
    });
    expect(
      screen.queryByText("Monitor reading received"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Observation confirmed")).toBeInTheDocument();
  });
  it("does not invent absent measurements", () => {
    render(
      <MemoryRouter>
        <PatientCard
          state={state}
          patient={state.patients[0]}
          rounds={rounds}
        />
      </MemoryRouter>,
    );
    expect(
      screen.getByText("No monitor readings available"),
    ).toBeInTheDocument();
    expect(screen.queryByText("bpm")).not.toBeInTheDocument();
  });
  it("retains a bedside narrative through navigation and restores it only for that patient", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => ({
        ok: true,
        json: async () => (url.includes("/rounds") ? rounds : state),
      })),
    );
    render(
      <MemoryRouter initialEntries={["/patients/p1"]}>
        <App />
      </MemoryRouter>,
    );
    await screen.findByRole("heading", { name: "Maya Rowan" });
    fireEvent.click(screen.getByRole("button", { name: "Chart" }));
    fireEvent.change(
      screen.getByPlaceholderText("Enter your synthetic bedside observation"),
      { target: { value: "Unconfirmed bedside note" } },
    );
    await waitFor(() =>
      expect(sessionStorage.getItem("achillea-note-p1")).toContain(
        "Unconfirmed bedside note",
      ),
    );
    fireEvent.click(screen.getByRole("link", { name: "Patients" }));
    fireEvent.click(
      screen.getByRole("link", { name: /Open patient overview/ }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Chart" }));
    expect(
      screen.getByPlaceholderText("Enter your synthetic bedside observation"),
    ).toHaveValue("Unconfirmed bedside note");
  });
});
