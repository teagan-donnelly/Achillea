import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import App from "./App";
import type { Chart } from "./types";
declare const process: { env: Record<string, string | undefined> };
const base = process.env.ACHILLEA_INTEGRATION_URL;
const networkFetch = globalThis.fetch.bind(globalThis);
let cookie = "";
describe.skipIf(!base)(
  "React + Vite + Vercel handler + isolated PostgreSQL",
  () => {
    beforeAll(async () => {
      if (
        !base ||
        !["127.0.0.1", "localhost"].includes(new URL(base).hostname) ||
        process.env.ACHILLEA_TEST_MODE !== "isolated"
      )
        throw new Error(
          "Live tests require the disposable npm run test:db runner",
        );
      const response = await networkFetch(base + "/api/auth/session", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Achillea-Request": "1",
        },
        body: JSON.stringify({ password: process.env.APP_ACCESS_PASSWORD }),
      });
      expect(response.status).toBe(200);
      cookie = response.headers.get("set-cookie")!.split(";")[0];
    });
    afterEach(() => {
      cleanup();
      vi.unstubAllGlobals();
      sessionStorage.clear();
    });
    function open(path = "/") {
      vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) =>
        networkFetch(new URL(String(input), base), {
          ...init,
          headers: { ...init?.headers, cookie },
        }),
      );
      render(
        <MemoryRouter initialEntries={[path]}>
          <App />
        </MemoryRouter>,
      );
    }
    it("renders assigned patients and source histories through the real API", async () => {
      open("/patients");
      expect(
        await screen.findByRole("heading", { name: "Maya Rowan" }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("heading", { name: "Not assigned" }),
      ).not.toBeInTheDocument();
      fireEvent.click(
        screen.getByRole("heading", { name: "Maya Rowan" }).closest("a")!,
      );
      expect(
        await screen.findByRole("img", { name: /Heart rate historical trend/ }),
      ).toBeInTheDocument();
      expect(
        screen.queryByText("Monitor simulation controls"),
      ).not.toBeInTheDocument();
    });
    it("saves and explicitly confirms chart drafts without automatic care", async () => {
      open("/patients/synthetic-ld-01");
      await screen.findByRole("heading", { name: "Maya Rowan" });
      fireEvent.click(screen.getByRole("button", { name: "Document care" }));
      fireEvent.change(
        screen.getByPlaceholderText("Enter your synthetic bedside observation"),
        { target: { value: "Vercel HTTP bedside proof" } },
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
      await waitFor(async () => {
        const response = await networkFetch(
          base + "/api/patients/synthetic-ld-01/chart",
          { headers: { cookie } },
        );
        const charts = (await response.json()) as Chart[];
        expect(
          charts.some(
            (c) =>
              c.text === "Vercel HTTP bedside proof" &&
              c.status === "CONFIRMED",
          ),
        ).toBe(true);
      });
    });
    it("switches units and renders stored independent-region evidence", async () => {
      open("/patients");
      await screen.findByRole("heading", { name: "Maya Rowan" });
      fireEvent.change(screen.getByLabelText("Demo unit"), {
        target: { value: "ICU" },
      });
      fireEvent.click(screen.getByRole("link", { name: "Patients" }));
      const alex = await screen.findByRole("heading", { name: "Alex Linden" });
      fireEvent.click(alex.closest("a")!);
      expect(
        await screen.findByRole("heading", {
          name: "Repositioning monitoring",
        }),
      ).toBeInTheDocument();
      expect(
        await screen.findByText("coordinated turn candidate"),
      ).toBeInTheDocument();
    });
    it("serves SPA deep links and keeps unknown API routes as JSON errors", async () => {
      const page = await networkFetch(base + "/patients/synthetic-ld-01");
      expect(page.status).toBe(200);
      expect(page.headers.get("content-type")).toContain("text/html");
      const api = await networkFetch(base + "/api/unknown", {
        headers: { cookie },
      });
      expect(api.status).toBe(404);
      expect(api.headers.get("content-type")).toContain("application/json");
    });
  },
);
