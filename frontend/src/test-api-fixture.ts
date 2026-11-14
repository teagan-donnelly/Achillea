import type { Round, State } from "./types";

/** Route-aware synthetic responses for existing component fixtures, not production data. */
export function fixturePayload(
  url: string,
  original: State,
  rounds: Round[] = [],
) {
  const parsed = new URL(url, "http://localhost"),
    unit = parsed.searchParams.get("unit");
  const patients = original.patients.filter((p) => !unit || p.unit === unit);
  const ids = new Set(patients.map((p) => p.id));
  const state = {
    ...original,
    patients,
    tasks: original.tasks.filter((t) => ids.has(t.patientId)),
    charts: original.charts.filter((c) => ids.has(c.patientId)),
    vitals: original.vitals.filter((v) => ids.has(v.patientId)),
    movements: original.movements.filter((m) => ids.has(m.patientId)),
    events: original.events.filter((e) => !e.patientId || ids.has(e.patientId)),
    devices: original.devices?.filter((d) => ids.has(d.patientId)),
    samples: original.samples?.filter((s) => ids.has(s.patientId)),
  };
  if (parsed.pathname.includes("/rounds"))
    return rounds.filter((r) => ids.has(r.task.patientId));
  if (parsed.pathname.includes("/monitoring/updates"))
    return {
      serverTime: new Date().toISOString(),
      nextSince: new Date().toISOString(),
      inclusive: true,
      measurements: state.vitals,
      devices: state.devices ?? [],
      orientationSamples: state.samples ?? [],
      events: state.events,
    };
  if (parsed.pathname.includes("/activity/summary"))
    return state.events.map((e) => ({
      id: e.id,
      patientId: e.patientId,
      type: e.type,
      category: e.type.startsWith("task") ? "TASK_ATTENTION" : "ACTIVITY",
      sourceId: e.source,
      startedAt: e.timestamp,
      timestamp: e.timestamp,
      count: 1,
      summary: e.details,
      measurementIds: [],
      sourceEventIds: [],
      rawEventIds: [e.id],
    }));
  if (parsed.pathname.endsWith("/demo/presets"))
    return {
      keys: [
        "routine-shift",
        "device-event",
        "repositioning",
        "bedside-documentation",
        "adaptive-rounds",
      ],
    };
  if (parsed.pathname.endsWith("/sensor-history"))
    return {
      patientId: parsed.pathname.split("/")[3],
      orientationUnit: "degrees",
      ruleVersion: "TEST",
      samples: state.samples ?? [],
      devices: state.devices ?? [],
      connectivityEvents: [],
      movements: state.movements.map((movement) => ({ movement, charts: [] })),
    };
  return state;
}
