import { describe, expect, it } from "vitest";
import { __test } from "./MonitoringDetail";
import type { Event, Patient, State } from "./types";

const { buildEvents, segments, niceDomain, timeTicks } = __test;
const T0 = Date.parse("2026-11-15T00:00:00Z");
const iso = (minutes: number) => new Date(T0 + minutes * 60000).toISOString();
const point = (minutes: number, value = 100) => ({ t: iso(minutes), value, min: value, max: value, count: 1 });

const patient: Patient = {
  id: "p1",
  name: "Test Patient",
  room: "101",
  unit: "ICU",
  summary: "",
  nurseId: "nurse-demo",
  repositionPlan: true,
};
const ev = (id: string, minutes: number, type: string, source = "SIMULATED_MONITOR", details = ""): Event => ({
  id,
  patientId: "p1",
  type,
  source,
  details,
  timestamp: iso(minutes),
});
const state = (events: Event[]): State =>
  ({
    patients: [patient],
    tasks: [],
    vitals: [],
    movements: [
      {
        id: "m1",
        patientId: "p1",
        classification: "FULL_TURN",
        quality: "SIMULATED_GOOD",
        verificationStatus: "UNREVIEWED",
        reviewerId: null,
        reviewedAt: null,
        chestBefore: 0,
        pelvisBefore: 0,
        chestAfter: 30,
        pelvisAfter: 30,
        capturedAt: iso(70),
        sampleIds: [],
      },
    ],
    charts: [],
    events,
    devices: [
      {
        id: "torso-1",
        patientId: "p1",
        bodyRegion: "UPPER_TORSO",
        connectionState: "DISCONNECTED",
        freshness: "STALE",
        mode: "SIMULATED",
        calibrationStatus: "",
        lastSeenAt: null,
        lastSampledAt: null,
      },
    ],
  }) as State;

describe("monitoring detail helpers", () => {
  it("splits a series at missing buckets so charts draw gaps, never interpolate", () => {
    const runs = segments([point(0), point(15), point(30), point(90), point(105)], 15 * 60000);
    expect(runs.map((r) => r.length)).toEqual([3, 2]);
  });

  it("keeps a minimum y span so flat readings are not exaggerated", () => {
    const d = niceDomain(113, 113, 20);
    expect(d.hi - d.lo).toBeGreaterThanOrEqual(20);
    expect(d.lo).toBeLessThanOrEqual(113);
    expect(d.hi).toBeGreaterThanOrEqual(113);
  });

  it("adapts tick density to the range", () => {
    const now = T0 + 24 * 3600000;
    const six = timeTicks(now - 6 * 3600000, now, 1);
    const day = timeTicks(now - 24 * 3600000, now, 6);
    expect(six.length).toBeGreaterThanOrEqual(4);
    expect(day.length).toBeLessThanOrEqual(4);
  });

  it("lists only notable events: device changes, turns and nurse confirmations", () => {
    const events = buildEvents(
      state([
        ev("a", 10, "vital.received"),
        ev("b", 10.25, "vital.received"),
        ev("e", 50, "device.disconnected", "SIMULATOR", "torso-1 · DISCONNECTED · simulated"),
        ev("f", 55, "task.schedule.overdue", "SIMULATOR", "x: Pressure area skin check - OVERDUE"),
        ev("g", 80, "repositioning.confirmed", "nurse-demo", "Next configured turn deadline"),
      ]),
      patient,
      [],
      T0,
      T0 + 24 * 3600000,
    );
    expect(events.map((e) => e.title)).toEqual(["Turn confirmed by nurse", "Turn detected", "Torso sensor disconnected"]);
  });
});
