import type { Patient, State } from "./types";
export function repositioningStatus(
  state: State,
  patient: Patient,
  now: number,
) {
  const plan = state.repositioningPlans?.find(
    (p) => p.patientId === patient.id,
  );
  const due = plan
    ? plan.lastConfirmedCareAt
      ? Date.parse(plan.lastConfirmedCareAt) + plan.intervalMinutes * 60000
      : Date.parse(plan.initialDueAt)
    : NaN;
  const schedule =
    !patient.repositionPlan || !Number.isFinite(due)
      ? "UNKNOWN"
      : now > due
        ? "OVERDUE"
        : now >= due - (plan?.warningMinutes ?? 30) * 60000
          ? "DUE_SOON"
          : "ON_TRACK";
  const devices = (state.devices ?? []).filter(
    (d) => d.patientId === patient.id && d.bodyRegion !== "BEDSIDE_MONITOR",
  );
  const reporting =
    ["UPPER_TORSO", "PELVIS"].every((region) =>
      devices.some((d) => d.bodyRegion === region),
    ) &&
    devices.every(
      (d) =>
        d.connectionState === "CONNECTED" &&
        d.freshness === "FRESH" &&
        d.lastSampledAt &&
        Date.parse(d.lastSampledAt) >= now - 120000,
    );
  const movements = state.movements
    .filter((m) => m.patientId === patient.id)
    .sort((a, b) => Date.parse(a.capturedAt) - Date.parse(b.capturedAt));
  const latest = movements.at(-1);
  const pending = movements.filter((m) =>
    ["UNREVIEWED", "NEEDS_REVIEW"].includes(m.verificationStatus),
  ).length;
  const evidence = !reporting
    ? "Sensor unavailable; care cannot be inferred"
    : !latest
      ? "No movement history"
      : latest.quality !== "SIMULATED_GOOD"
        ? "Uncertain evidence"
        : latest.classification.startsWith("PARTIAL")
          ? "Chest/pelvic discrepancy"
          : pending
            ? "Movement awaiting nurse review"
            : "Evidence reviewed";
  return { plan, due, schedule, reporting, latest, pending, evidence };
}
export const scheduleLabel = (status: string) =>
  ({
    OVERDUE: "Overdue",
    DUE_SOON: "Due soon",
    ON_TRACK: "On track",
    UNKNOWN: "No active schedule",
  })[status] ?? status;
export function deadlineText(due: number, now: number) {
  if (!Number.isFinite(due)) return "No configured deadline";
  const minutes = Math.ceil(Math.abs(now - due) / 60000);
  return now > due ? `+${minutes} min overdue` : `Due in ${minutes} min`;
}
