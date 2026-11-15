import type { PoolClient } from "pg";
import type {
  State,
  Patient,
  Task,
  Chart,
  Movement,
  Device,
  Vital,
  OrientationSample,
  Event,
} from "../frontend/src/types.js";
import { ApiError, input } from "./errors.js";

export type {
  State,
  Patient,
  Task,
  Chart,
  Movement,
  Device,
  Vital,
  OrientationSample,
  Event,
};
export type Row = Record<string, unknown>;
export function dto<T>(row: Row): T {
  const result: Row = {};
  for (const [column, raw] of Object.entries(row)) {
    if (["encounter_id", "display_order"].includes(column)) continue;
    const key =
      column === "sort_order"
        ? "order"
        : column === "occurred_at"
          ? "timestamp"
          : column.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
    result[key] = raw instanceof Date ? raw.toISOString() : raw;
  }
  return result as T;
}
export function unit(value?: string) {
  if (value !== undefined)
    input(["ICU", "L_AND_D"].includes(value), "Unknown unit");
}
export async function encounter(
  db: PoolClient,
  patientId: string,
  lock = false,
): Promise<string> {
  const result = await db.query<{ id: string }>(
    `SELECT e.id FROM encounters e JOIN patients p ON p.id=e.patient_id JOIN care_assignments a ON a.encounter_id=e.id AND a.nurse_id='nurse-demo' WHERE e.patient_id=$1 AND e.active AND e.synthetic AND p.nurse_id='nurse-demo' ${lock ? "FOR UPDATE OF e" : ""}`,
    [patientId],
  );
  if (!result.rows.length)
    throw new ApiError(404, "Assigned active synthetic patient not found");
  return result.rows[0].id;
}
const owned = ["care_tasks", "chart_entries", "movement_candidates"] as const;
export async function owner(
  db: PoolClient,
  table: (typeof owned)[number],
  id: string,
): Promise<string> {
  if (!owned.includes(table)) throw new Error("Unsupported ownership table");
  const result = await db.query<{ patient_id: string; encounter_id: string }>(
    `SELECT patient_id,encounter_id FROM ${table} WHERE id=$1`,
    [id],
  );
  if (!result.rows.length) throw new ApiError(404, "Record not found");
  const current = await encounter(db, result.rows[0].patient_id, true);
  if (current !== result.rows[0].encounter_id)
    throw new ApiError(404, "Record belongs to an inactive encounter");
  return result.rows[0].patient_id;
}
export interface Scope {
  patientId?: string;
  unit?: string;
  history?: boolean;
  since?: string;
  evidenceOnly?: boolean;
  summary?: boolean;
}
export async function load(db: PoolClient, scope: Scope = {}): Promise<State> {
  unit(scope.unit);
  if (scope.patientId) await encounter(db, scope.patientId);
  const where = `e.active AND e.synthetic AND p.nurse_id='nurse-demo' AND EXISTS(SELECT 1 FROM care_assignments a WHERE a.encounter_id=e.id AND a.nurse_id='nurse-demo') AND ($1::text IS NULL OR p.id=$1) AND ($2::text IS NULL OR p.unit=$2)`;
  const args = [scope.patientId || null, scope.unit || null];
  const patients = (
    await db.query(
      `SELECT p.* FROM patients p JOIN encounters e ON e.patient_id=p.id WHERE ${where} ORDER BY p.display_order,p.id`,
      args,
    )
  ).rows.map(dto<Patient>);
  const state: State = {
    patients,
    tasks: [],
    vitals: [],
    samples: [],
    movements: [],
    charts: [],
    devices: [],
    events: [],
    serverTime: new Date().toISOString(),
    demoStartedAt: null,
    monitorTick: 0,
  };
  const query = async <T>(
    table: string,
    time?: string,
    order = "x.id",
  ): Promise<T[]> => {
    const result = await db.query(
      `SELECT x.* FROM ${table} x JOIN encounters e ON e.id=x.encounter_id JOIN patients p ON p.id=e.patient_id WHERE ${where}${time ? ` AND ($3::timestamptz IS NULL OR x.${time}>=$3)` : ""} ORDER BY ${order}`,
      time ? [...args, scope.since || null] : args,
    );
    return result.rows.map(dto<T>);
  };
  state.devices = (await query<Device & { timeDomain: string }>("devices")).map(
    (d) => {
      const time =
        d.timeDomain === "SIMULATION" ? d.lastSeenAt : d.lastSampledAt;
      return {
        ...d,
        freshness:
          d.connectionState === "DISCONNECTED"
            ? "DISCONNECTED"
            : d.connectionState !== "CONNECTED" || !time
              ? "UNKNOWN"
              : Date.parse(time) < Date.now() - 60000
                ? "STALE"
                : "FRESH",
      };
    },
  );
  if (!scope.evidenceOnly) {
    state.tasks = await query<Task>(
      "care_tasks",
      undefined,
      "x.sort_order,x.due_at,x.id",
    );
    state.tasks.forEach((t) => {
      t.scheduleState =
        Date.parse(t.dueAt) < Date.now()
          ? "OVERDUE"
          : Date.parse(t.dueAt) <= Date.now()
            ? "DUE"
            : Date.parse(t.dueAt) <= Date.now() + 1800000
              ? "UPCOMING"
              : "LATER";
    });
    state.movements = await query<Movement>(
      "movement_candidates",
      undefined,
      "x.captured_at,x.id",
    );
    state.charts = await query<Chart>(
      "chart_entries",
      undefined,
      "x.authored_at,x.id",
    );
    for (const [table, records, field] of [
      ["movement_sample_links", state.movements, "sampleIds"],
      ["movement_reason_codes", state.movements, "reviewReasonCodes"],
      ["chart_evidence_links", state.charts, "linkedVitalIds"],
    ] as const) {
      const ids = records.map((r) => r.id);
      const links = ids.length
        ? (
            await db.query(
              `SELECT owner_id,value FROM ${table} WHERE owner_id=ANY($1::text[]) ORDER BY owner_id,position`,
              [ids],
            )
          ).rows
        : [];
      for (const record of records)
        (record as unknown as Row)[field] = links
          .filter((link) => link.owner_id === record.id)
          .map((link) => link.value);
    }
  }
  if (scope.history !== false) {
    state.vitals = await query<Vital>(
      "vital_observations",
      "received_at",
      "x.observed_at,x.id",
    );
    if (!scope.summary)
      state.samples = await query<OrientationSample>(
        "orientation_samples",
        "received_at",
        "x.captured_at,x.id",
      );
    state.events = await query<Event>(
      "activity_events",
      "occurred_at",
      "x.occurred_at,x.id",
    );
  }
  const metadata = await db.query(
    "SELECT started_at,monitor_tick FROM demo_metadata WHERE id='demo'",
  );
  if (metadata.rows.length) {
    state.demoStartedAt = metadata.rows[0].started_at.toISOString();
    state.monitorTick = Number(metadata.rows[0].monitor_tick);
  }
  return state;
}
