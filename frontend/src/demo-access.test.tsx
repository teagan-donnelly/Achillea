import { afterEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { DemoAccess } from "./DemoAccess";
import { api } from "./api";
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("keeps the workspace hidden until explicit sign-in and never stores credentials", async () => {
  let authenticated = false;
  const fetch = vi.fn(async (_path: string, options: RequestInit) => {
    if (options.method === "POST") authenticated = true;
    return { ok: true, json: async () => ({ required: true, authenticated }) };
  });
  vi.stubGlobal("fetch", fetch);
  render(
    <DemoAccess>
      <h1>Protected workspace</h1>
    </DemoAccess>,
  );
  await screen.findByLabelText("Demo access password");
  expect(screen.queryByText("Protected workspace")).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Demo access password"), {
    target: { value: "test-only-user-entered-password" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Open synthetic demo" }));
  await screen.findByText("Protected workspace");
  expect(localStorage.getItem("password")).toBeNull();
  expect(sessionStorage.getItem("password")).toBeNull();
  expect(
    fetch.mock.calls.some(
      ([, options]) =>
        options.credentials === "same-origin" && options.method === "POST",
    ),
  ).toBe(true);
});
it("handles an expired session without exposing a secret in frontend configuration", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => ({ required: true, authenticated: true }),
    })),
  );
  render(
    <DemoAccess>
      <h1>Protected workspace</h1>
    </DemoAccess>,
  );
  await screen.findByText("Protected workspace");
  act(() => window.dispatchEvent(new Event("achillea:unauthorized")));
  expect(screen.queryByText("Protected workspace")).not.toBeInTheDocument();
  expect(screen.getByLabelText("Demo access password")).toHaveValue("");
});
it("keeps local development compatible when access protection is disabled", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => ({ required: false, authenticated: true }),
    })),
  );
  render(
    <DemoAccess>
      <h1>Local workspace</h1>
    </DemoAccess>,
  );
  await screen.findByText("Local workspace");
  expect(
    screen.queryByRole("button", { name: "Sign out" }),
  ).not.toBeInTheDocument();
});
it("requests sign-in again on an unauthorized API operation", async () => {
  const expired = vi.fn();
  window.addEventListener("achillea:unauthorized", expired);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: false,
      status: 401,
      json: async () => ({ message: "Sign in required" }),
    })),
  );
  await expect(api("/state")).rejects.toThrow("Sign in required");
  expect(expired).toHaveBeenCalledOnce();
  window.removeEventListener("achillea:unauthorized", expired);
});
