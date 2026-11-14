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
function open(path = "/") {
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

    it("retrieves expanded assignments and renders backend activity and monitoring history", async () => {
      open();
      await screen.findByRole("heading", { name: "Activity" });
      expect(
        screen.getAllByText(
          /Historical synthetic monitor observations received/,
        ).length,
      ).toBeGreaterThan(0);
      fireEvent.click(screen.getByRole("link", { name: "Patients" }));
      for (const name of ["Maya Rowan", "Elena Vale", "Iris Fern"])
        expect(
          await screen.findByRole("heading", { name }),
        ).toBeInTheDocument();
      expect(
        screen.queryByRole("heading", { name: "Alex Linden" }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("img", { name: /historical trend/ }),
      ).not.toBeInTheDocument();
      fireEvent.click(
        screen.getByRole("heading", { name: "Maya Rowan" }).closest("a")!,
      );
      expect(
        await screen.findByRole("img", { name: /Heart rate historical trend/ }),
      ).toBeInTheDocument();
      const state = await request<State>("/state");
      expect(state.patients).toHaveLength(6);
      expect(state.devices?.length).toBeGreaterThan(6);
    }, 30000);

    it("displays disconnected and stale monitor metadata and reconnects the correct patient", async () => {
      open("/patients/synthetic-ld-02");
      await screen.findByRole("heading", { name: "Elena Vale" });
      expect(screen.getByLabelText("Monitor availability")).toHaveTextContent(
        "disconnected",
      );
      expect(screen.getAllByText("Unavailable").length).toBe(3);
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
        expect(screen.getByLabelText("Monitor availability")).toHaveTextContent(
          "connected · fresh",
        ),
      );
      expect(
        (await request<State>("/state")).devices?.find(
          (d) => d.patientId === "synthetic-ld-02",
        )?.connectionState,
      ).toBe("CONNECTED");
      cleanup();
      open("/patients/synthetic-ld-03");
      await screen.findByRole("heading", { name: "Iris Fern" });
      expect(screen.getByLabelText("Monitor availability")).toHaveTextContent(
        "delayed · stale",
      );
      expect(screen.getAllByText(/Old reading/).length).toBeGreaterThan(0);
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
      const article = screen.getByText(note).closest("article")!;
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
      await screen.findByRole("heading", { name: "Activity" });
      fireEvent.change(screen.getByLabelText("Demo unit"), {
        target: { value: "ICU" },
      });
      fireEvent.click(screen.getByRole("link", { name: "Patients" }));
      const heading = await screen.findByRole("heading", {
        name: "Alex Linden",
      });
      fireEvent.click(heading.closest("a")!);
      await screen.findByRole("heading", { name: "Repositioning monitoring" });
      expect(screen.getByText("Source: torso-sim-01")).toBeInTheDocument();
      await demo("Chest-only movement");
      expect(
        (await request<State>("/state")).tasks.find((t) => t.id === "task-3")
          ?.status,
      ).toBe("OPEN");
      await demo("Coordinated turn candidate");
      const candidate = await screen.findByText("coordinated turn candidate");
      const article = candidate.closest("article")!;
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
      fireEvent.click(screen.getByRole("button", { name: "Care tasks" }));
      const task = document.getElementById("task-task-3")!;
      fireEvent.click(within(task).getByRole("button", { name: "Complete" }));
      fireEvent.change(
        screen.getByRole("combobox", {
          name: /Previously nurse-confirmed movement/,
        }),
        { target: { value: movement.id } },
      );
      fireEvent.click(
        screen.getByLabelText(
          "I verified this care at the bedside (synthetic demo).",
        ),
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
        await screen.findByRole("heading", { name: "Maya Rowan" }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("heading", { name: "Alex Linden" }),
      ).not.toBeInTheDocument();
    }, 30000);

    it("shows backend high priority and all task horizons, and persists nurse deferral", async () => {
      await request("/demo/scenarios/flagged?patientId=synthetic-ld-01", {});
      open("/rounds");
      await screen.findByRole("heading", { name: "Rounds" });
      expect(screen.getByRole("heading", { name: "Now" })).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: "Next" })).toBeInTheDocument();
      expect(
        screen.getByRole("heading", { name: "Later" }),
      ).toBeInTheDocument();
      expect(document.querySelector(".next-action")).toHaveTextContent(
        "Review latest synthetic reading",
      );
      const task = document.getElementById("task-task-1")!;
      fireEvent.click(within(task).getByRole("button", { name: "Defer" }));
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
      open("/patients/synthetic-ld-01");
      await screen.findByRole("heading", { name: "Maya Rowan" });
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
            .getByRole("heading", { name: "Heart rate" })
            .closest("article")!
            .querySelector(".reading");
          expect(reading).toHaveTextContent(String(latest.value));
        },
        { timeout: 8000 },
      );
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
      open("/patients/synthetic-ld-01");
      await screen.findByRole("heading", { name: "Maya Rowan" });
      const article = screen
        .getByRole("heading", { name: "Heart rate" })
        .closest("article")!;
      expect(within(article).getByText("Unavailable")).toBeInTheDocument();
      expect(article.querySelector(".reading")).not.toHaveTextContent("0");
    }, 30000);
  },
);
