import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { HandoffStructured, nurseSnapshot, priorityText, type HandoffContext } from "./handoff-context";
import { EMPTY_SECTIONS } from "./handoff-types";

const alert = {
  id: "alert:HR_SUSTAINED_RISE:p2:R1:L0",
  patientId: "p2",
  patientName: "Robin Ash",
  room: "109",
  rule: "HR_SUSTAINED_RISE",
  title: "Heart rate sustained rise — review at bedside",
  details: "Heart rate rose from a baseline of 84 bpm to 104, 112, 116 bpm",
  detectedAt: "2026-11-15T10:00:00Z",
  source: "SYNTHETIC_FIXTURE",
  evidence: [{ id: "v1", metric: "HEART_RATE", value: 116, unit: "bpm", observedAt: "2026-11-15T10:00:00Z", recordedMinute: 300, source: "SYNTHETIC_FIXTURE" }],
  state: "ACKNOWLEDGED" as const,
  acknowledged: true,
  followUpChartIds: [],
  documentationGap: true,
  carriedForward: false,
  resolvedAt: null,
};

const ctx: HandoffContext = {
  patientId: "p2",
  generatedAt: "2026-11-15T10:05:00Z",
  snapshot: [
    { key: "admission", label: "Admission reason", value: "Postoperative observation", source: "Patient record" },
    { key: "allergies", label: "Allergies and reactions", value: null, source: null },
    { key: "codeStatus", label: "Code status", value: null, source: null },
  ],
  activity: {
    latestVitals: [{ id: "v1", metric: "HEART_RATE", value: 116, unit: "bpm", observedAt: "2026-11-15T10:00:00Z", recordedMinute: 300, source: "SYNTHETIC_FIXTURE", quality: "VALID" }],
    monitor: { connectionState: "CONNECTED", freshness: "FRESH", mode: "SYNTHETIC_FIXTURE" },
    replay: {} as never,
    alerts: [alert],
    assessments: [],
    care: [],
    medications: [],
    movement: { lastSensorMovement: null, lastConfirmedRepositioning: null, openRepositioningTasks: 0, sensors: [] },
    timeline: [],
  },
  priorities: {
    prompt: [{ id: "p-a", title: "Documentation gap: Heart rate sustained rise — review at bedside", detail: "Acknowledged with no linked follow-up documentation.", sourceType: "alert", sourceId: alert.id, timestamp: "2026-11-15T10:00:00Z", status: "ACKNOWLEDGED", responsible: "nurse-demo", dueAt: null, kind: "DOCUMENTATION_GAP" }],
    upcoming: [],
    routine: [],
  },
  counts: { requiresReview: 1, outstandingTasks: 1, unverified: 0, documentationGaps: 1 },
};

describe("structured handoff", () => {
  it("shows source-linked gap, not-documented fields and an incomplete checklist", () => {
    render(
      <MemoryRouter>
        <HandoffStructured ctx={ctx} draft={EMPTY_SECTIONS} setDraft={() => {}} editable={false} onChanged={() => {}} />
      </MemoryRouter>,
    );
    expect(screen.getAllByText(/Documentation gap: Heart rate sustained rise/).length).toBeGreaterThan(0);
    // allergies, code status, and last confirmed repositioning
    expect(screen.getAllByText("Not documented").length).toBe(3);
    expect(screen.getByText(/checklist items open/)).toBeInTheDocument();
    const source = screen.getAllByRole("link", { name: "Open source" })[0];
    expect(source).toHaveAttribute("href", "/monitoring/p2");
    expect(screen.getByText(/Synthetic fixture replay/)).toBeInTheDocument();
  });

  it("fills priorities from the record and stores nurse snapshot entries", () => {
    const setDraft = vi.fn();
    render(
      <MemoryRouter>
        <HandoffStructured ctx={ctx} draft={EMPTY_SECTIONS} setDraft={setDraft} editable onChanged={() => {}} />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Fill priorities from record" }));
    expect(setDraft.mock.calls[0][0].nextShiftPriorities).toBe(priorityText(ctx));
    const input = screen.getByRole("textbox", { name: "Code status" });
    fireEvent.change(input, { target: { value: "Full code" } });
    fireEvent.blur(input);
    const saved = setDraft.mock.calls.at(-1)![0];
    expect(nurseSnapshot(saved, "Code status")).toBe("Full code");
  });
});

import { buildReport, reportSections, type ReportContext } from "./handoff-report";

describe("generated shift report", () => {
  const rc: ReportContext = {
    ...ctx,
    trends: [{ metric: "HEART_RATE", unit: "bpm", first: 84, firstAt: "2026-11-15T09:00:00Z", latest: 116, latestAt: "2026-11-15T10:00:00Z", latestId: "v1", min: 82, max: 119, count: 11, points: [84, 90, 116] }],
    coverage: { readings: 40, from: "2026-11-15T09:00:00Z", to: "2026-11-15T10:05:00Z", percent: 88, lastReadingAt: "2026-11-15T10:00:00Z", gaps: [{ from: "2026-11-15T09:30:00Z", to: "2026-11-15T09:38:00Z", seconds: 480, open: false }] },
    missing: [{ kind: "DOCUMENTATION", title: "No follow-up note for alert", detail: alert.title, sourceType: "alert", sourceId: alert.id, action: "DOCUMENT" }],
  };
  it("connects trends, alerts, coverage gaps and priorities into SBAR and the saved sections", () => {
    const r = buildReport(rc, EMPTY_SECTIONS, "Robin Ash", "109");
    expect(r.changes[0]).toMatch(/Heart rate 84 bpm → 116 bpm/);
    expect(r.assessment.join(" ")).toMatch(/acknowledged, no follow-up note/);
    expect(r.assessment.join(" ")).toMatch(/covered 88% of the shift with 1 gap/);
    expect(r.background.join(" ")).toMatch(/Not documented: allergies and reactions, code status/);
    const s = reportSections(r, { ...EMPTY_SECTIONS, additionalObservations: "Code status: Full code" });
    expect(s.outstandingFollowUp).toMatch(/No follow-up note for alert/);
    expect(s.nextShiftPriorities).toMatch(/Prompt: Documentation gap/);
    expect(s.additionalObservations).toBe("Code status: Full code");
  });
});

describe("fill only from recorded data", () => {
  it("offers nothing to fill when the record is empty and never writes filler text", async () => {
    const { hasRecorded, buildReport: build, reportSections: sections } = await import("./handoff-report");
    const empty: ReportContext = {
      ...ctx,
      trends: [],
      activity: { ...ctx.activity, alerts: [], latestVitals: [] },
      priorities: { prompt: [], upcoming: [], routine: [] },
      missing: [],
    };
    expect(hasRecorded(empty)).toBe(false);
    const draft = { ...EMPTY_SECTIONS, currentConcerns: "Nurse wrote this" };
    const s = sections(build(empty, draft, "Robin Ash", "109"), draft);
    expect(s.currentConcerns).toBe("Nurse wrote this");
    expect(s.nextShiftPriorities).toBe("");
    expect(s.interventionsAndResponse).toBe("");
  });
});
