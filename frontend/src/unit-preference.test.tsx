import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import App from "./App";
import { initialUnit, saveUnit } from "./unit-preference";
import { fixturePayload } from "./test-api-fixture";
import type { State } from "./types";
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
const state: State = {
  patients: ["ICU", "L_AND_D"].map((unit, i) => ({
    id: unit,
    name: unit + " synthetic patient",
    room: String(100 + i),
    unit,
    summary: "Synthetic",
    nurseId: "nurse-demo",
    repositionPlan: unit === "ICU",
  })),
  tasks: [],
  vitals: [],
  events: [],
  charts: [],
  movements: [],
};
function mount(path = "/") {
  const fetch = vi.fn(async (url: string) => ({
    ok: true,
    json: async () => fixturePayload(url, state),
  }));
  vi.stubGlobal("fetch", fetch);
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
  return fetch;
}
it("defaults a fresh session to ICU without silently loading or resetting data", async () => {
  localStorage.clear();
  const fetch = mount();
  await screen.findByRole("heading", { name: "Repositioning Command Center" });
  expect(screen.getByLabelText("Demo unit")).toHaveValue("ICU");
  expect(
    fetch.mock.calls.some(([url]) => url === "/api/workspace?unit=ICU"),
  ).toBe(true);
  expect(
    fetch.mock.calls.some(
      ([url]) =>
        url.includes("/demo/reset") || url.includes("/demo/repositioning"),
    ),
  ).toBe(false);
  const load = screen.getAllByRole("button", {
    name: "Load repositioning demo",
  })[0];
  vi.spyOn(window, "confirm").mockReturnValue(false);
  fireEvent.click(load);
  expect(
    fetch.mock.calls.some(([url]) => url.includes("/demo/repositioning")),
  ).toBe(false);
  expect(
    screen.getByText(/Synthetic-data educational demo/),
  ).toBeInTheDocument();
});
it("retains a valid explicitly saved unit and ignores invalid storage", () => {
  saveUnit("L_AND_D");
  expect(initialUnit()).toBe("L_AND_D");
  localStorage.setItem("achillea-selected-unit", "invalid");
  expect(initialUnit()).toBe("ICU");
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("Storage blocked");
  });
  expect(initialUnit()).toBe("ICU");
});
it.each(["/", "/patients", "/sensors", "/rounds"])(
  "switches units in place and persists the choice on %s",
  async (path) => {
    localStorage.clear();
    mount(path);
    await waitFor(() => expect(document.querySelector("main h1")).not.toBeNull());
    fireEvent.change(screen.getByLabelText("Demo unit"), {
      target: { value: "L_AND_D" },
    });
    await waitFor(() =>
      expect(screen.getByLabelText("Demo unit")).toHaveValue("L_AND_D"),
    );
    await waitFor(() =>
      expect(
        screen.queryByText("Connecting to your demo shift…"),
      ).not.toBeInTheDocument(),
    );
    expect(initialUnit()).toBe("L_AND_D");
    const title =
      path === "/"
        ? "Repositioning Command Center"
        : path === "/patients"
          ? "Patients"
          : path === "/sensors"
            ? "Sensor Monitoring"
            : "Rounds";
    expect(
      await screen.findByRole("heading", { name: title }),
    ).toBeInTheDocument();
  },
);
