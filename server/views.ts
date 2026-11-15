import type { State, Task } from "./store.js";
import type { Round, ActivityItem } from "../frontend/src/types.js";

export function rounds(state: State, unit: string, now = Date.now()): Round[] {
  const ids = new Set(
    state.patients.filter((p) => p.unit === unit).map((p) => p.id),
  );
  return state.tasks
    .filter(
      (t) =>
        ids.has(t.patientId) && !["COMPLETED", "CANCELLED"].includes(t.status),
    )
    .map((t) => {
      const due = Date.parse(t.dueAt),
        rank =
          t.priority === "HIGH"
            ? 0
            : due <= now
              ? 1
              : due <= now + 1800000
                ? 2
                : 3;
      const codes: string[] = [];
      if (t.priority === "HIGH") codes.push("EXPLICIT_HIGH_PRIORITY");
      codes.push(
        due <= now
          ? due === now
            ? "SCHEDULED_DUE"
            : "SCHEDULED_OVERDUE"
          : due <= now + 1800000
            ? "DUE_WITHIN_30_MINUTES"
            : "ROUTINE_SEQUENCE",
      );
      if (t.priority === "TIMELY") codes.push("EXPLICIT_TIMELY_PRIORITY");
      if (t.status === "DEFERRED") codes.push("NURSE_DEFERRED");
      if (t.status === "ACKNOWLEDGED") codes.push("NURSE_ACKNOWLEDGED");
      if (t.relatedMovementId) codes.push("SENSOR_REVIEW_REQUIRED");
      if (t.relatedDeviceId) codes.push("TECHNICAL_DEVICE_REVIEW");
      const disconnected = state.devices?.some(
        (d) => d.patientId === t.patientId && d.connectionState !== "CONNECTED",
      );
      if (disconnected) codes.push("DEVICE_CONNECTION_REVIEW");
      let reason = [
        "Explicit high priority (configured demo rule)",
        "Past scheduled due time",
        "Due within 30 minutes",
        "Routine · nurse-selected sequence",
      ][rank];
      if (disconnected)
        reason +=
          " · device connection awaiting review; no clinical urgency inferred";
      if (t.status === "DEFERRED")
        reason += ` · deferred by nurse: ${t.deferReason}`;
      return {
        task: t,
        rank,
        reason,
        reasonCodes: codes,
        horizon:
          rank <= 1
            ? ("NOW" as const)
            : rank === 2
              ? ("NEXT" as const)
              : ("LATER" as const),
      };
    })
    .sort(
      (a, b) =>
        a.rank - b.rank ||
        timely(a.task) - timely(b.task) ||
        (a.rank === 3 ? a.task.order - b.task.order : 0) ||
        Date.parse(a.task.dueAt) - Date.parse(b.task.dueAt) ||
        a.task.id.localeCompare(b.task.id),
    );
}
function timely(t: Task) {
  return t.priority === "TIMELY" ? 0 : 1;
}
export function activity(state: State): ActivityItem[] {
  const result: ActivityItem[] = [],
    groups = new Map<string, typeof state.vitals>();
  for (const v of state.vitals) {
    if (v.quality === "VALID") {
      const key = `${v.patientId}/${v.sourceId}/${Math.floor(Date.parse(v.receivedAt) / 900000)}`;
      const group = groups.get(key) || [];
      group.push(v);
      groups.set(key, group);
    } else
      result.push({
        id: v.id,
        patientId: v.patientId,
        category: "MEASUREMENT",
        type: "measurement.quality",
        sourceId: v.sourceId || null,
        startedAt: v.observedAt,
        timestamp: v.receivedAt,
        count: 1,
        summary: `${v.metric}: ${v.quality} (synthetic)`,
        measurementIds: [v.id],
        sourceEventIds: v.sourceEventId ? [v.sourceEventId] : [],
        rawEventIds: [],
      });
  }
  for (const [key, values] of groups) {
    const times = values.map((v) => v.receivedAt).sort();
    result.push({
      id: "monitoring/" + key,
      patientId: values[0].patientId,
      category: "MONITORING_SUMMARY",
      type: "monitoring.summary",
      sourceId: values[0].sourceId || null,
      startedAt: times[0],
      timestamp: times[times.length - 1],
      count: values.length,
      summary: `${values.length} synthetic measurements received in this 15-minute window`,
      measurementIds: values.map((v) => v.id),
      sourceEventIds: values.map((v) => v.sourceEventId).filter(Boolean),
      rawEventIds: [],
    });
  }
  for (const e of state.events) {
    if (e.type === "vital.received") continue;
    const category = e.type.startsWith("device.")
      ? "DEVICE_STATUS"
      : e.type.startsWith("task.")
        ? "TASK_ATTENTION"
        : e.type.startsWith("movement.")
          ? "SENSOR_REVIEW"
          : e.type.startsWith("chart.")
            ? "DOCUMENTATION"
            : "ACTIVITY";
    result.push({
      id: e.id,
      patientId: e.patientId,
      category,
      type: e.type,
      sourceId: e.source,
      startedAt: e.timestamp,
      timestamp: e.timestamp,
      count: 1,
      summary: e.details,
      measurementIds: [],
      sourceEventIds: [],
      rawEventIds: [e.id],
    });
  }
  return result.sort(
    (a, b) =>
      Date.parse(b.timestamp) - Date.parse(a.timestamp) ||
      a.id.localeCompare(b.id),
  );
}
