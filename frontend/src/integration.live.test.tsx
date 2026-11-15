declare const process: { env: Record<string, string | undefined> };
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import App from "./App";
import type { Chart, State } from "./types";

// This is actual HTTP plus React/jsdom integration, not browser automation or mocked server responses.
const base = process.env.ACHILLEA_INTEGRATION_URL;
const networkFetch = globalThis.fetch.bind(globalThis);
async function request<T>(path: string, body?: unknown): Promise<T> {
  const response = await networkFetch(new URL(`/api${path}`, base!), {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok)
    throw new Error(`${response.status}: ${await response.text()}`);
  return response.json() as Promise<T>;
}
function open(path = "/activity") {
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}
async function demo(label: string) {
  fireEvent.click(screen.getByRole("button", { name: "Demo controls" }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: label })).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole("button", { name: label }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: label })).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
}

describe.skipIf(!base)(
  "Combined frontend, Vite proxy, and real Spring API",
  () => {
    beforeEach(async () => {
      const target = new URL(base!);
      if (
        !["127.0.0.1", "localhost"].includes(target.hostname) ||
        target.protocol !== "http:" ||
        process.env.ACHILLEA_ALLOW_DEMO_RESET !== "disposable-test-database"
      )
        throw new Error(
          "Live tests require an explicitly disposable loopback database; see docs/INTEGRATION.md",
        );
      await request("/demo/reset", {});
      sessionStorage.clear();
      vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) =>
        networkFetch(new URL(String(input), base!), init),
      );
    });
    afterEach(() => {
      cleanup();
      vi.unstubAllGlobals();
      sessionStorage.clear();
    });

    it("opens fresh ICU, explicitly loads the full repositioning demo and confirms documented care", async () => {
      localStorage.removeItem("achillea-selected-unit");
      const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
      try {
        open("/repositioning");
        await screen.findByRole("heading", {
          name: "Repositioning Command Center",
        });
        expect(screen.getByLabelText("Demo unit")).toHaveValue("ICU");
        fireEvent.click(
          screen.getByRole("button", { name: "Load repositioning demo" }),
        );
        await screen.findByRole("heading", { name: "Needs attention (2)" });
        expect(
          screen.getByRole("heading", { name: "Upcoming turns (1)" }),
        ).toBeInTheDocument();
        expect(screen.getByText("On-track patients (1)")).toBeInTheDocument();
        const staged = await request<State>("/state");
        expect(staged.patients.filter((p) => p.unit === "ICU")).toHaveLength(4);
        const originalCharts = staged.charts.length;
        fireEvent.click(screen.getByRole("link", { name: /Alex Linden/ }));
        await screen.findByRole("heading", { name: "Alex Linden" });
        fireEvent.click(
          screen.getByRole("button", { name: /^Repositioning,/ }),
        );
        fireEvent.change(screen.getByLabelText("Bedside observation"), {
          target: {
            value:
              "Personally verified the prescribed synthetic turn and comfort.",
          },
        });
        fireEvent.click(screen.getByRole("checkbox"));
        fireEvent.click(
          screen.getByRole("button", { name: "Confirm & document" }),
        );
        await waitFor(() =>
          expect(
            screen.queryByRole("button", { name: "Confirm & document" }),
          ).not.toBeInTheDocument(),
        );
        const saved = await request<State>("/state");
        expect(saved.charts).toHaveLength(originalCharts + 1);
        expect(
          saved.repositioningPlans?.find(
            (p) => p.patientId === "synthetic-icu-01",
          )?.lastConfirmedCareAt,
        ).toBeTruthy();
        expect(
          saved.events.some((e) => e.type === "repositioning.confirmed"),
        ).toBe(true);
        fireEvent.click(screen.getByRole("link", { name: "Monitoring" }));
        await screen.findByRole("heading", { name: "Monitoring" });
        expect(
          saved.repositioningPlans?.find(
            (p) => p.patientId === "synthetic-icu-01",
          )?.lastConfirmedCareAt,
        ).toBeTruthy();
      } finally {
        confirm.mockRestore();
      }
    }, 30000);

    it("retrieves expanded assignments and renders backend activity and monitoring history", async () => {
      open();
      await screen.findByRole("heading", { name: "Handoff" });
      const events = await request<{ type: string; source: string }[]>(
        "/events?patientId=synthetic-ld-01&limit=300",
      );
      expect(events.length).toBeGreaterThan(0);
      expect(events.every((e) => Boolean(e.source))).toBe(true);
      fireEvent.click(screen.getByRole("link", { name: "Patients" }));
      for (const name of ["Maya Rowan", "Elena Vale", "Iris Fern"])
        expect(
          await screen.findByRole("link", { name: new RegExp(name) }),
        ).toBeInTheDocument();
      expect(
        screen.queryByRole("link", { name: /Alex Linden/ }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("img", { name: /historical trend/ }),
      ).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("link", { name: /Maya Rowan/ }));
      fireEvent.click(screen.getByRole("tab", { name: "Trends" }));
      expect(
        await screen.findByRole("img", { name: /Heart rate from/ }),
      ).toBeInTheDocument();
      const state = await request<State>("/state");
      expect(state.patients).toHaveLength(6);
      expect(state.devices?.length).toBeGreaterThan(6);
    }, 30000);

    it("displays disconnected and stale monitor metadata and reconnects the correct patient", async () => {
      open("/patients/synthetic-ld-02?section=sensors");
      await screen.findByRole("heading", { name: "Elena Vale" });
      expect(screen.getByText("Offline")).toBeInTheDocument();
      expect(
        screen
          .getByRole("link", { name: /^Vitals, open monitoring/ })
          .querySelectorAll("b"),
      ).toHaveLength(3);
      expect(
        [
          ...screen
            .getByRole("link", { name: /^Vitals, open monitoring/ })
            .querySelectorAll("b"),
        ].every((b) => b.textContent === "\u2013"),
      ).toBe(true);
      fireEvent.click(screen.getByText("Monitor simulation controls"));
      expect(
        screen.getByRole("button", {
          name: "Receive simulated monitor reading",
        }),
      ).toBeDisabled();
      fireEvent.click(
        screen.getByRole("button", { name: "Reconnect simulated monitor" }),
      );
      await waitFor(() =>
        expect(screen.getByText("Connected")).toBeInTheDocument(),
      );
      expect(
        (await request<State>("/state")).devices?.find(
          (d) => d.patientId === "synthetic-ld-02",
        )?.connectionState,
      ).toBe("CONNECTED");
      cleanup();
      open("/patients/synthetic-ld-03?section=sensors");
      await screen.findByRole("heading", { name: "Iris Fern" });
      expect(screen.getByText("Delayed")).toBeInTheDocument();
      expect(
        screen
          .getByRole("link", { name: /^Vitals, open monitoring/ })
          .querySelectorAll(".is-old").length,
      ).toBeGreaterThan(0);
    }, 30000);

    it("saves, confirms, and amends real bedside documentation with vital provenance", async () => {
      open("/patients/synthetic-ld-01");
      await screen.findByRole("heading", { name: "Maya Rowan" });
      fireEvent.click(screen.getByRole("button", { name: "Document care" }));
      const note = "Integration proof: synthetic bedside assessment";
      fireEvent.change(
        screen.getByPlaceholderText("Enter your synthetic bedside observation"),
        { target: { value: note } },
      );
      fireEvent.click(
        screen.getByLabelText(
          "Include latest simulated observations in saved draft",
        ),
      );
      fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
      await screen.findByRole("heading", { name: "Review saved draft" });
      fireEvent.click(
        screen.getByLabelText(
          "I reviewed the saved entry, patient identity, and provenance.",
        ),
      );
      await waitFor(() =>
        expect(
          screen.getByRole("button", { name: "Confirm entry" }),
        ).toBeEnabled(),
      );
      fireEvent.click(screen.getByRole("button", { name: "Confirm entry" }));
      await waitFor(() =>
        expect(
          screen.queryByRole("button", { name: "Confirm entry" }),
        ).not.toBeInTheDocument(),
      );
      const original = (
        await request<Chart[]>("/patients/synthetic-ld-01/chart")
      ).find((c) => c.text === note)!;
      expect(original.status).toBe("CONFIRMED");
      expect(original.linkedVitalIds).toHaveLength(3);
      const article = screen.getByText(note).closest("li")!;
      fireEvent.click(
        within(article).getByRole("button", { name: "Append amendment" }),
      );
      fireEvent.change(
        screen.getByPlaceholderText("Enter your synthetic bedside observation"),
        { target: { value: "Integration proof: append-only correction" } },
      );
      fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
      await screen.findByRole("heading", { name: "Review saved draft" });
      fireEvent.click(
        screen.getByLabelText(
          "I reviewed the saved entry, patient identity, and provenance.",
        ),
      );
      await waitFor(() =>
        expect(
          screen.getByRole("button", { name: "Confirm entry" }),
        ).toBeEnabled(),
      );
      fireEvent.click(screen.getByRole("button", { name: "Confirm entry" }));
      await waitFor(async () =>
        expect(
          (await request<Chart[]>("/patients/synthetic-ld-01/chart")).find(
            (c) => c.amendmentOfId === original.id,
          )?.status,
        ).toBe("AMENDED"),
      );
      expect(
        (await request<Chart[]>("/patients/synthetic-ld-01/chart")).find(
          (c) => c.id === original.id,
        )?.text,
      ).toBe(note);
    }, 30000);

    it("switches to ICU, reviews independent sensor events, and explicitly completes verified care", async () => {
      open();
      await screen.findByRole("heading", { name: "Handoff" });
      fireEvent.change(screen.getByLabelText("Demo unit"), {
        target: { value: "ICU" },
      });
      fireEvent.click(screen.getByRole("link", { name: "Patients" }));
      const heading = await screen.findByRole("link", {
        name: /Alex Linden/,
      });
      fireEvent.click(heading);
      fireEvent.click(
        screen.getByRole("button", { name: /Sensor monitoring/ }),
      );
      await screen.findByRole("heading", { name: "Repositioning monitoring" });
      expect(
        (await request<State>("/state")).devices?.some(
          (d) => d.id === "torso-sim-01",
        ),
      ).toBe(true);
      await demo("Chest-only movement");
      expect(
        (await request<State>("/state")).tasks.find((t) => t.id === "task-3")
          ?.status,
      ).toBe("OPEN");
      await demo("Coordinated turn candidate");
      const candidate = await screen.findByText("Coordinated turn candidate", {
        selector: "strong",
      });
      const article = candidate.closest("li")!;
      const state = await request<State>("/state");
      const movement = state.movements
        .filter((m) => m.patientId === "synthetic-icu-01")
        .at(-1)!;
      expect(movement.verificationStatus).toBe("UNREVIEWED");
      fireEvent.click(
        within(article).getByRole("button", { name: "Review candidate" }),
      );
      fireEvent.change(
        screen.getByPlaceholderText(
          "Describe the care you personally verified",
        ),
        { target: { value: "Synthetic care verified at bedside" } },
      );
      fireEvent.click(
        screen.getByLabelText(
          "I verified actual care, beyond the sensor observation.",
        ),
      );
      fireEvent.click(
        screen.getByRole("button", { name: "Confirm care observation" }),
      );
      await waitFor(async () =>
        expect(
          (await request<State>("/state")).movements.find(
            (m) => m.id === movement.id,
          )?.verificationStatus,
        ).toBe("CONFIRMED_CARE"),
      );
      await waitFor(() =>
        expect(
          within(article).queryByRole("button", { name: "Review candidate" }),
        ).not.toBeInTheDocument(),
      );
      fireEvent.click(screen.getByRole("link", { name: "Tasks" }));
      const task = document.getElementById("task-task-3")!;
      fireEvent.click(within(task).getByRole("button", { name: /^Complete/ }));
      fireEvent.change(
        screen.getByRole("combobox", {
          name: /Previously nurse-confirmed movement/,
        }),
        { target: { value: movement.id } },
      );
      fireEvent.click(
        screen.getByLabelText("I verified this care at the bedside"),
      );
      fireEvent.click(
        screen.getByRole("button", { name: "Confirm completion" }),
      );
      await waitFor(async () =>
        expect(
          (await request<State>("/state")).tasks.find((t) => t.id === "task-3")
            ?.status,
        ).toBe("COMPLETED"),
      );
      await demo("Disconnect pelvis sensor");
      cleanup();
      open("/patients/synthetic-icu-01");
      await screen.findByRole("heading", { name: "Alex Linden" });
      fireEvent.click(
        screen.getByRole("button", { name: /Sensor monitoring/ }),
      );
      expect(
        await screen.findByText("Unknown / disconnected"),
      ).toBeInTheDocument();
      await demo("Coordinated turn candidate");
      expect(
        (await request<State>("/state")).movements
          .filter((m) => m.patientId === "synthetic-icu-01")
          .at(-1)?.classification,
      ).toBe("UNKNOWN");
      await demo("Reconnect sensor");
      await waitFor(() =>
        expect(
          screen.queryByText("Unknown / disconnected"),
        ).not.toBeInTheDocument(),
      );
      fireEvent.change(screen.getByLabelText("Demo unit"), {
        target: { value: "L_AND_D" },
      });
      fireEvent.click(screen.getByRole("link", { name: "Patients" }));
      expect(
        await screen.findByRole("link", { name: /Maya Rowan/ }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("link", { name: /Alex Linden/ }),
      ).not.toBeInTheDocument();
    }, 30000);

    it("shows backend high priority and all task horizons, and persists nurse deferral", async () => {
      await request("/demo/scenarios/flagged?patientId=synthetic-ld-01", {});
      open("/rounds");
      await screen.findByRole("heading", { name: "Tasks" });
      expect(
        screen.getByRole("heading", { name: /^Overdue/ }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("heading", { name: /^Due Now/ }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("heading", { name: /^Upcoming/ }),
      ).toBeInTheDocument();
      expect(
        screen.getAllByRole("img", { name: "High priority" }).length,
      ).toBeGreaterThan(0);
      const task = document.getElementById("task-task-1")!;
      fireEvent.click(within(task).getByRole("button", { name: /^Complete/ }));
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
      fireEvent.click(screen.getByRole("button", { name: "Defer" }));
      fireEvent.change(screen.getByLabelText("Reason for deferral"), {
        target: { value: "Integration proof: patient requested later review" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Save deferral" }));
      await waitFor(async () =>
        expect(
          (await request<State>("/state")).tasks.find((t) => t.id === "task-1")
            ?.status,
        ).toBe("DEFERRED"),
      );
    }, 30000);

    it("polls new backend observations into the mounted patient view", async () => {
      open("/monitoring/synthetic-ld-01");
      await screen.findByRole("article", { name: "Heart rate" });
      const initial = await request<State>("/state");
      const before = initial.vitals
        .filter(
          (v) => v.patientId === "synthetic-ld-01" && v.metric === "HEART_RATE",
        )
        .at(-1)!;
      const updated = await request<State>(
        "/demo/scenarios/vital?patientId=synthetic-ld-01",
        {},
      );
      const latest = updated.vitals
        .filter(
          (v) => v.patientId === "synthetic-ld-01" && v.metric === "HEART_RATE",
        )
        .at(-1)!;
      expect(latest.id).not.toBe(before.id);
      expect(latest.value).not.toBe(before.value);
      await waitFor(
        () => {
          const reading = screen
            .getByRole("article", { name: "Heart rate" })
            .querySelector(".md-metric-value");
          expect(reading).toHaveTextContent(String(latest.value));
        },
        { timeout: 8000 },
      );
    }, 30000);

    it("runs all five guided presets through explicit frontend actions", async () => {
      open();
      await screen.findByRole("heading", { name: "Handoff" });
      for (const [key, label] of [
        ["routine-shift", "Routine shift"],
        ["device-event", "Device event"],
        ["repositioning", "Patient repositioning"],
        ["bedside-documentation", "Bedside documentation"],
        ["adaptive-rounds", "Adaptive rounds"],
      ]) {
        const unit = key === "repositioning" ? "ICU" : "L_AND_D";
        if (
          (screen.getByLabelText("Demo unit") as HTMLSelectElement).value !==
          unit
        ) {
          fireEvent.change(screen.getByLabelText("Demo unit"), {
            target: { value: unit },
          });
          await screen.findByRole("heading", {
            name: /^(Handoff|Monitoring|Repositioning Command Center)$/,
          });
        }
        fireEvent.click(screen.getByRole("button", { name: "Demo controls" }));
        const before = await request<State>("/state");
        fireEvent.click(await screen.findByRole("button", { name: label }));
        await screen.findByRole("heading", { name: label });
        await screen.findByRole("button", { name: "Run this step" });
        expect((await request<State>("/state")).charts).toHaveLength(
          before.charts.length,
        );
        const count = document.querySelectorAll(".preset-guide li").length;
        for (let index = 0; index < count; index++) {
          const note = screen.queryByLabelText("Synthetic bedside note");
          const reason = screen.queryByLabelText("Deferral reason");
          const verify = screen.queryByLabelText(
            "I explicitly verify this synthetic nursing action.",
          );
          if (note)
            fireEvent.change(note, {
              target: { value: `Live V3 ${key} nurse action ${index}` },
            });
          if (reason)
            fireEvent.change(reason, {
              target: {
                value:
                  "Synthetic current bedside task before this scheduled review",
              },
            });
          if (verify) fireEvent.click(verify);
          const run = screen.getByRole("button", { name: "Run this step" });
          await waitFor(() => expect(run).toBeEnabled());
          fireEvent.click(run);
          await waitFor(
            () =>
              expect(
                [...document.querySelectorAll(".preset-guide li")].filter(
                  (li) => li.textContent?.includes("completed"),
                ),
              ).toHaveLength(index + 1),
            { timeout: 10000 },
          );
        }
        expect(screen.getByText(/Demonstration complete/)).toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "Close" }));
      }
      const final = await request<State>("/state");
      expect(final.tasks.find((t) => t.id === "task-3")?.status).toBe(
        "COMPLETED",
      );
      expect(
        final.charts.some(
          (c) =>
            c.status === "AMENDED" &&
            c.text.includes("Live V3 bedside-documentation"),
        ),
      ).toBe(true);
      const history = await request<{ movements: { charts: Chart[] }[] }>(
        "/patients/synthetic-icu-01/sensor-history",
      );
      expect(
        history.movements.some((entry) =>
          entry.charts.some((c) => c.type === "TASK_COMPLETION"),
        ),
      ).toBe(true);
    }, 60000);

    it("schedules an actual review and renders backend priority reason codes", async () => {
      open("/rounds");
      await screen.findByRole("heading", { name: "Tasks" });
      fireEvent.click(
        screen.getByRole("button", { name: "Schedule a review" }),
      );
      fireEvent.change(screen.getByLabelText("Assigned patient"), {
        target: { value: "synthetic-ld-01" },
      });
      fireEvent.change(screen.getByLabelText("Review title"), {
        target: { value: "Live V3 explicit workflow review" },
      });
      fireEvent.change(screen.getByLabelText("Review time (local)"), {
        target: { value: "2026-01-01T12:00" },
      });
      fireEvent.change(screen.getByLabelText("Workflow priority"), {
        target: { value: "TIMELY" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Schedule review" }));
      await screen.findByRole("button", {
        name: /^Live V3 explicit workflow review,/,
      });
      const rounds = await request<
        { task: { title: string }; horizon: string; reasonCodes: string[] }[]
      >("/rounds?unit=L_AND_D");
      const scheduled = rounds.find(
        (r) => r.task.title === "Live V3 explicit workflow review",
      )!;
      expect(scheduled.horizon).toBe("NOW");
      expect(scheduled.reasonCodes).toContain("SCHEDULED_OVERDUE");
      expect(scheduled.reasonCodes).toContain("EXPLICIT_TIMELY_PRIORITY");
      expect(
        screen.getAllByRole("img", { name: "Timely priority" }).length,
      ).toBeGreaterThan(0);
    }, 30000);

    it("never renders a numeric missing sample as an available current measurement", async () => {
      await request("/integrations/monitors/observations", {
        sourceEventId: "integration-missing",
        patientId: "synthetic-ld-01",
        metric: "HEART_RATE",
        value: 0,
        unit: "bpm",
        observedAt: new Date().toISOString(),
        quality: "MISSING",
      });
      open("/monitoring/synthetic-ld-01");
      const article = await screen.findByRole("article", {
        name: "Heart rate",
      });
      expect(article.querySelector(".md-metric-value")).toHaveTextContent(
        "\u2014",
      );
      expect(article.querySelector(".md-metric-value")).not.toHaveTextContent(
        "0",
      );
    }, 30000);
  },
);
