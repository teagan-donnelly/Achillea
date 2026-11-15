import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AuthGate } from "./AuthGate";
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("opens the workspace without login or sign-out controls when auth is disabled", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue({
        ok: true,
        json: async () => ({ authenticated: true, authEnabled: false }),
      }),
  );
  render(
    <AuthGate>
      <h1>Demo workspace</h1>
    </AuthGate>,
  );
  expect(
    await screen.findByRole("heading", { name: "Demo workspace" }),
  ).toBeInTheDocument();
  expect(screen.queryByLabelText("Demo password")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Sign out" }),
  ).not.toBeInTheDocument();
});
it("keeps the workspace hidden until an explicit successful login", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ authenticated: false }),
    })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ authenticated: true }),
    });
  vi.stubGlobal("fetch", fetcher);
  render(
    <AuthGate>
      <h1>Private workspace</h1>
    </AuthGate>,
  );
  await screen.findByRole("heading", { name: "Open your demo shift" });
  expect(screen.queryByText("Private workspace")).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Demo password"), {
    target: { value: "test-password" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
  expect(
    await screen.findByRole("heading", { name: "Private workspace" }),
  ).toBeInTheDocument();
  expect(fetcher.mock.calls[1][1].headers["X-Achillea-Request"]).toBe("1");
});
it("shows failed login without exposing the workspace", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ authenticated: false }),
      })
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ message: "Invalid demo password" }),
      }),
  );
  render(
    <AuthGate>
      <h1>Private workspace</h1>
    </AuthGate>,
  );
  await screen.findByRole("heading", { name: "Open your demo shift" });
  fireEvent.change(screen.getByLabelText("Demo password"), {
    target: { value: "wrong" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Invalid demo password",
  );
  expect(screen.queryByText("Private workspace")).not.toBeInTheDocument();
});
