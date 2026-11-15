import { describe, expect, it } from "vitest";
import { buildFeed, feedPatient, filterFeed } from "./monitoring-feed";
import type { Device, Patient, State } from "./types";

const NOW = Date.parse("2026-11-15T12:00:00Z");
const iso = (secondsAgo: number) => new Date(NOW - secondsAgo * 1000).toISOString();
const patient = (id: string, room: string, repositionPlan = true): Patient => ({
  id, name: `Patient ${id}`, room, unit: "ICU", summary: "", nurseId: "nurse-demo", repositionPlan,
});
const device = (id: string, patientId: string, bodyRegion: string, over: Partial<Device> = {}): Device => ({
  id, patientId, bodyRegion, connectionState: "CONNECTED", freshness: "FRESH", mode: "SIMULATED",
  calibrationStatus: "SIMULATED_REFERENCE", lastSeenAt: iso(5), lastSampledAt: iso(5), ...over,
});
const vital = (patientId: string, metric: string, value: number, unit: string, secondsAgo = 10, quality = "VALID") => ({
  id: `${patientId}-${metric}-${secondsAgo}`, patientId, metric, value, unit, observedAt: iso(secondsAgo),
  receivedAt: iso(secondsAgo), source: "SIMULATED_MONITOR", sourceEventId: `${patientId}-${metric}`, quality,
});
function baseState(): State {
  return {
    patients: [patient("a", "112"), patient("b", "108"), patient("c", "111")],
    tasks: [], charts: [], events: [], movements: [], repositioningPlans: [],
    vitals: [
      vital("a", "HEART_RATE", 88, "bpm"), vital("a", "SPO2", 97, "%"),
      vital("b", "HEART_RATE", 101, "bpm"), vital("b", "SPO2", 0, "%", 10, "SUSPECTED_ARTIFACT"),
    ],
    samples: [
      { id: "s1", sensorId: "ta", patientId: "a", bodyRegion: "UPPER_TORSO", rollDegrees: 30, capturedAt: iso(20), receivedAt: iso(20), quality: "SIMULATED_GOOD", mode: "SIMULATED" },
    ],
    devices: [
      device("ma", "a", "BEDSIDE_MONITOR"), device("ta", "a", "UPPER_TORSO"), device("pa", "a", "PELVIS"),
      device("mb", "b", "BEDSIDE_MONITOR"),
      device("mc", "c", "BEDSIDE_MONITOR", { connectionState: "DISCONNECTED" }),
    ],
    serverTime: new Date(NOW).toISOString(),
  };
}

describe("monitoring feed data", () => {
  it("shows only measurements the simulation produced, in clinical order", () => {
    const a = feedPatient(baseState(), baseState().patients[0], NOW);
    expect(a.vitals.map((v) => v.key)).toEqual(["HEART_RATE", "SPO2"]); // no invented RR / temp
    expect(a.vitals[0]).toMatchObject({ value: 88, unit: "bpm", state: "LIVE" });
    expect(a.posture).toEqual([
      expect.objectContaining({ key: "ROLL_UPPER_TORSO", value: 30, state: "LIVE" }),
      expect.objectContaining({ key: "ROLL_PELVIS", value: null, state: "UNAVAILABLE", stateText: "No data yet" }),
    ]);
    expect(a.attention).toBe("STABLE");
    expect(a.tone).toBe("stable");
  });
  it("flags signal problems, disconnected monitors and pending reviews from real data", () => {
    const s = baseState();
    const b = feedPatient(s, s.patients[1], NOW);
    expect(b.attention).toBe("ATTENTION");
    expect(b.tone).toBe("alert");
    expect(b.reasons).toContainEqual({ kind: "vital", text: "SpO₂: check signal" });
    const c = feedPatient(s, s.patients[2], NOW);
    expect(c.attention).toBe("OFFLINE");
    expect(c.tone).toBe("offline");
    expect(c.statusLabel).toBe("Monitor offline");
    expect(c.vitals).toEqual([]);
    expect(c.posture).toEqual([]); // no torso/pelvis devices: nothing shown
    s.movements.push({
      id: "m1", patientId: "a", classification: "COORDINATED_TURN_CANDIDATE", quality: "SIMULATED_GOOD",
      verificationStatus: "UNREVIEWED", reviewerId: null, reviewedAt: null, chestBefore: 0, pelvisBefore: 0,
      chestAfter: 30, pelvisAfter: 30, capturedAt: iso(30), sampleIds: [], reviewRequired: true,
    });
    expect(feedPatient(s, s.patients[0], NOW).reasons).toContainEqual({ kind: "review", text: "1 movement to review" });
  });
  it("marks disconnected sensors and monitors as unavailable instead of showing stale numbers", () => {
    const s = baseState();
    s.devices = s.devices!.map((d) => (d.id === "ma" || d.id === "ta" ? { ...d, connectionState: "DISCONNECTED" } : d));
    const a = feedPatient(s, s.patients[0], NOW);
    expect(a.vitals.every((v) => v.value === null && v.state === "UNAVAILABLE")).toBe(true);
    expect(a.posture[0]).toMatchObject({ value: null, stateText: "Disconnected" });
    expect(a.attention).toBe("OFFLINE");
  });
  it("orders most urgent first and filters", () => {
    const feed = buildFeed(baseState(), baseState().patients, NOW);
    expect(feed.map((f) => f.patient.id)).toEqual(["b", "c", "a"]);
    expect(filterFeed(feed, "ATTENTION").map((f) => f.patient.id)).toEqual(["b", "c"]);
    expect(filterFeed(feed, "STABLE").map((f) => f.patient.id)).toEqual(["a"]);
  });
});
