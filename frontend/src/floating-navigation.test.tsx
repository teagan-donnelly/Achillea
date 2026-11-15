import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { useEffect } from "react";
import { PrimaryNavigation } from "./PrimaryNavigation";
import { SwipeNavigation } from "./SwipeNavigation";

const names = ["Home", "Patients", "Sensors", "Rounds"];
let centers = [44, 121, 205, 292],
  reduced = false,
  desktop = false;
let observer: () => void, mediaChanged: () => void;
const capture = new Set<number>();
function box(x: number, y: number, width: number, height: number) {
  return {
    x,
    y,
    left: x,
    top: y,
    right: x + width,
    bottom: y + height,
    width,
    height,
    toJSON: () => ({}),
  } as DOMRect;
}
class Pointer extends MouseEvent {
  pointerId: number;
  isPrimary: boolean;
  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 1;
    this.isPrimary = init.isPrimary ?? true;
  }
}
beforeEach(() => {
  centers = [44, 121, 205, 292];
  reduced = false;
  desktop = false;
  capture.clear();
  vi.stubGlobal("PointerEvent", Pointer);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        observer = callback;
      }
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      get matches() {
        return query.includes("reduced-motion") ? reduced : desktop;
      },
      media: query,
      addEventListener: (_type: string, callback: () => void) => {
        if (query.includes("reduced-motion")) mediaChanged = callback;
      },
      removeEventListener: vi.fn(),
    })),
  );
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      if (this.classList.contains("primary-navigation"))
        return box(10, 600, 340, 78);
      if (this.classList.contains("nav-icon")) {
        const name = this.closest("a")?.getAttribute("aria-label");
        return box(10 + centers[names.indexOf(name ?? "")] - 22, 608, 44, 44);
      }
      return box(0, 0, 0, 0);
    },
  );
  Object.defineProperty(HTMLElement.prototype, "setPointerCapture", {
    configurable: true,
    value: (id: number) => capture.add(id),
  });
  Object.defineProperty(HTMLElement.prototype, "hasPointerCapture", {
    configurable: true,
    value: (id: number) => capture.has(id),
  });
  Object.defineProperty(HTMLElement.prototype, "releasePointerCapture", {
    configurable: true,
    value: (id: number) => capture.delete(id),
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function Observe({ changed }: { changed: (path: string) => void }) {
  const location = useLocation(),
    navigate = useNavigate();
  useEffect(() => changed(location.pathname), [location.pathname, changed]);
  return (
    <>
      <output aria-label="Route">{location.pathname}</output>
      <button onClick={() => navigate("/sensors")}>External navigation</button>
    </>
  );
}
function setup(path = "/", wrapped = false) {
  const changed = vi.fn();
  render(
    <MemoryRouter initialEntries={[path]}>
      <div className="minimal-design">
        {wrapped ? (
          <SwipeNavigation>
            <PrimaryNavigation />
            <div data-testid="page">Page gesture area</div>
          </SwipeNavigation>
        ) : (
          <PrimaryNavigation />
        )}
        <Observe changed={changed} />
      </div>
    </MemoryRouter>,
  );
  changed.mockClear();
  const nav = screen.getByRole("navigation", { name: "Main navigation" });
  return {
    nav,
    changed,
    indicator: nav.querySelector(".nav-indicator") as HTMLElement,
  };
}
function pointer(
  nav: HTMLElement,
  type:
    | "pointerDown"
    | "pointerMove"
    | "pointerUp"
    | "pointerCancel"
    | "lostPointerCapture",
  x: number,
  pointerId = 1,
) {
  fireEvent[type](nav, {
    pointerId,
    isPrimary: true,
    button: 0,
    clientX: x + 10,
    clientY: 630,
  });
}
it("taps every route, aligns to measured icon centers, and supports rapid changes", () => {
  const { indicator, changed } = setup();
  for (const index of [1, 3, 2, 0, 2, 3]) {
    fireEvent.click(screen.getByRole("link", { name: names[index] }));
    expect(screen.getByRole("link", { name: names[index] })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(indicator.style.transform).toBe(
      `translate3d(${centers[index] - 22}px, 8px, 0)`,
    );
  }
  expect(changed.mock.calls.map((call) => call[0])).toEqual([
    "/patients",
    "/rounds",
    "/sensors",
    "/",
    "/sensors",
    "/rounds",
  ]);
});
it("moves continuously over multiple destinations but navigates exactly once on release", () => {
  const { nav, indicator, changed } = setup();
  const icon = screen
    .getByRole("link", { name: "Patients" })
    .querySelector(".nav-icon");
  const original = icon?.getBoundingClientRect().left;
  pointer(nav, "pointerDown", 44);
  expect(capture.has(1)).toBe(true);
  pointer(nav, "pointerMove", 160);
  expect(indicator.style.transform).toBe("translate3d(138px, 8px, 0)");
  expect(screen.getByRole("link", { name: "Patients" })).not.toHaveClass(
    "is-preview",
  );
  pointer(nav, "pointerMove", 121);
  expect(screen.getByRole("link", { name: "Patients" })).toHaveClass(
    "is-preview",
  );
  expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  pointer(nav, "pointerMove", 250);
  expect(changed).not.toHaveBeenCalled();
  expect(icon?.getBoundingClientRect().left).toBe(original);
  pointer(nav, "pointerUp", 280);
  expect(changed).toHaveBeenCalledTimes(1);
  expect(changed).toHaveBeenCalledWith("/rounds");
  fireEvent.click(screen.getByRole("link", { name: "Home" }), { detail: 1 });
  expect(changed).toHaveBeenCalledTimes(1);
});
it("clamps the indicator and uses the final release coordinate", () => {
  const { nav, indicator, changed } = setup();
  pointer(nav, "pointerDown", 44);
  pointer(nav, "pointerMove", -900);
  expect(indicator.style.transform).toBe("translate3d(22px, 8px, 0)");
  pointer(nav, "pointerMove", 900);
  expect(indicator.style.transform).toBe("translate3d(270px, 8px, 0)");
  pointer(nav, "pointerUp", 200);
  expect(changed).toHaveBeenCalledWith("/sensors");
});
it.each(["pointerCancel", "lostPointerCapture"] as const)(
  "restores the route without activating a tab after %s",
  (type) => {
    const { nav, indicator, changed } = setup("/patients");
    pointer(nav, "pointerDown", 121);
    pointer(nav, "pointerMove", 280);
    pointer(nav, type, 280);
    expect(indicator.style.transform).toBe("translate3d(99px, 8px, 0)");
    expect(changed).not.toHaveBeenCalled();
    pointer(nav, "pointerUp", 280);
    fireEvent.click(screen.getByRole("link", { name: "Rounds" }), {
      detail: 1,
    });
    expect(changed).not.toHaveBeenCalled();
  },
);
it("cancels interrupted or resized gestures and remeasures the new geometry", () => {
  const { nav, indicator, changed } = setup();
  pointer(nav, "pointerDown", 44);
  pointer(nav, "pointerMove", 280);
  centers = [50, 130, 210, 290];
  act(() => observer());
  expect(indicator.style.transform).toBe("translate3d(28px, 8px, 0)");
  pointer(nav, "pointerUp", 280);
  expect(changed).not.toHaveBeenCalled();
  pointer(nav, "pointerDown", 50);
  pointer(nav, "pointerMove", 210);
  fireEvent(window, new Event("blur"));
  expect(nav).toHaveAttribute("data-dragging", "false");
  expect(changed).not.toHaveBeenCalled();
});
it("keeps navigation drag/touch gestures out of page swipes", () => {
  const { nav, changed } = setup("/", true),
    home = screen.getByRole("link", { name: "Home" });
  fireEvent.touchStart(home, { touches: [{ clientX: 200, clientY: 100 }] });
  fireEvent.touchEnd(home, { changedTouches: [{ clientX: 50, clientY: 100 }] });
  expect(changed).not.toHaveBeenCalled();
  pointer(nav, "pointerDown", 44);
  pointer(nav, "pointerMove", 205);
  pointer(nav, "pointerUp", 205);
  expect(changed).toHaveBeenCalledTimes(1);
  const area = screen.getByTestId("page");
  fireEvent.touchStart(area, { touches: [{ clientX: 200, clientY: 100 }] });
  fireEvent.touchEnd(area, { changedTouches: [{ clientX: 50, clientY: 100 }] });
  expect(screen.getByLabelText("Route")).toHaveTextContent("/rounds");
});
it("supports named links, keyboard focus and live reduced-motion changes", () => {
  const { nav } = setup();
  const home = screen.getByRole("link", { name: "Home" });
  home.focus();
  fireEvent.keyDown(home, { key: "ArrowRight" });
  expect(screen.getByRole("link", { name: "Patients" })).toHaveFocus();
  fireEvent.keyDown(document.activeElement!, { key: "End" });
  expect(screen.getByRole("link", { name: "Rounds" })).toHaveFocus();
  fireEvent.click(document.activeElement!, { detail: 0 });
  expect(screen.getByRole("link", { name: "Rounds" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  reduced = true;
  act(() => mediaChanged());
  expect(nav).toHaveAttribute("data-reduced-motion", "true");
});
it("preserves desktop link navigation and ignores non-handle and secondary-pointer drags", () => {
  const { nav, changed } = setup();
  pointer(nav, "pointerDown", 121);
  pointer(nav, "pointerMove", 292);
  pointer(nav, "pointerUp", 292);
  expect(changed).not.toHaveBeenCalled();
  desktop = true;
  pointer(nav, "pointerDown", 44);
  expect(nav).toHaveAttribute("data-dragging", "false");
  fireEvent.click(screen.getByRole("link", { name: "Sensors" }));
  expect(changed).toHaveBeenCalledWith("/sensors");
});
it("reflects nested routes and interrupts a drag when another navigation changes the route", () => {
  const { nav, changed } = setup("/patients/p1");
  expect(screen.getByRole("link", { name: "Patients" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  pointer(nav, "pointerDown", 121);
  pointer(nav, "pointerMove", 292);
  fireEvent.click(screen.getByRole("button", { name: "External navigation" }));
  pointer(nav, "pointerUp", 292);
  expect(changed).toHaveBeenCalledTimes(1);
  expect(changed).toHaveBeenCalledWith("/sensors");
  expect(nav).toHaveAttribute("data-dragging", "false");
});
it("publishes the measured pill height for safe-area-aware content clearance", () => {
  const { nav } = setup();
  expect(
    (nav.closest(".minimal-design") as HTMLElement).style.getPropertyValue(
      "--measured-nav-height",
    ),
  ).toBe("78px");
});
it("taps the selected circle from patient detail and commits its parent list exactly once", () => {
  const { nav, changed } = setup("/patients/p1");
  pointer(nav, "pointerDown", 121);
  pointer(nav, "pointerUp", 121);
  expect(changed).toHaveBeenCalledTimes(1);
  expect(changed).toHaveBeenCalledWith("/patients");
  fireEvent.click(screen.getByRole("link", { name: "Patients" }), {
    detail: 1,
  });
  expect(changed).toHaveBeenCalledTimes(1);
  pointer(nav, "pointerDown", 205);
  pointer(nav, "pointerUp", 205);
  fireEvent.click(screen.getByRole("link", { name: "Sensors" }), { detail: 1 });
  expect(changed).toHaveBeenCalledWith("/sensors");
});
