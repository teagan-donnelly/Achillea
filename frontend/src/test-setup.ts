import "@testing-library/jest-dom/vitest";
import { beforeEach, vi } from "vitest";
// Existing clinical fixtures explicitly exercise a nurse's saved L&D preference.
// Fresh-session tests remove this preference before mounting the application.
beforeEach(() => {
  localStorage.setItem("achillea-selected-unit", "L_AND_D");
  window.scrollTo = vi.fn(); // jsdom has no layout/scroll implementation; route tests provide measured values.
});
