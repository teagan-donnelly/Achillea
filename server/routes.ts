import type { PoolClient } from "pg";
import { transaction } from "./db.js";
import { ApiError, boundedInt, input, timestamp } from "./errors.js";
import { load, dto, encounter, unit, type Vital } from "./store.js";
import { activity, rounds } from "./views.js";
import {
  draft,
  confirm,
  taskCommand,
  review,
  schedule,
  type Body,
} from "./workflow.js";

export async function dispatch(
  method: string,
  url: URL,
  body: Body = {},
): Promise<unknown> {
  const path = decodeURIComponent(url.pathname).replace(/\/$/, ""),
    q = url.searchParams;
  if (
    path.startsWith("/api/integrations/") ||
    path.startsWith("/api/demo/scenarios/") ||
    path.startsWith("/api/demo/presets/") ||
    path === "/api/demo/reset"
  )
    throw new ApiError(
      410,
      "Simulation ingestion, generation and reset are removed; the external simulator owns evidence",
    );
  if (method === "GET" && path === "/api/demo/context")
    return {
      demoMode: true,
      nurseId: "nurse-demo",
      nurseName: "Jordan Ellis, RN",
      synthetic: true,
      simulationControls: false,
      evidenceOwner: "EXTERNAL_SIMULATOR",
    };
  if (method === "GET" && path === "/api/demo/presets")
    return {
      keys: [],
      synthetic: true,
      automaticConfirmation: false,
      destructiveReset: false,
    };
  if (method === "GET" && path === "/api/health")
    return transaction(async (db) => {
      await db.query("SELECT 1");
      return {
        status: "UP",
        version: "0.2.0",
        synthetic: true,
        database: "PostgreSQL",
      };
    });
  const selectedUnit = q.get("unit") || undefined,
    patientId = q.get("patientId") || undefined;
  unit(selectedUnit);
  const scope = { unit: selectedUnit, patientId };
  if (method === "GET")
    return transaction(async (db) => {
      if (path === "/api/state") return load(db);
      if (path === "/api/workspace") {
        input(selectedUnit, "unit is required");
        return load(db, { ...scope, history: false });
      }
      if (path === "/api/patients") {
        const s = await load(db, {
            unit: selectedUnit || "L_AND_D",
            history: false,
          }),
          query = (q.get("query") || "").toLowerCase();
        return s.patients.filter((p) =>
          (p.name + p.room + p.id).toLowerCase().includes(query),
        );
      }
      if (path === "/api/rounds")
        return rounds(
          await load(db, { unit: selectedUnit || "L_AND_D", history: false }),
          selectedUnit || "L_AND_D",
        );
      if (path === "/api/activity/summary")
        return activity(
          await load(db, { ...scope, evidenceOnly: true, summary: true }),
        );
      if (path === "/api/events") {
        const s = await load(db, {
          ...scope,
          evidenceOnly: true,
          summary: true,
        });
        return s.events
          .filter((e) => e.type.startsWith(q.get("type") || ""))
          .sort(
            (a, b) =>
              Date.parse(b.timestamp) - Date.parse(a.timestamp) ||
              a.id.localeCompare(b.id),
          )
          .slice(0, boundedInt(q.get("limit"), 100, 500));
      }
      if (path === "/api/monitoring/updates") {
        const since = timestamp(q.get("since"), "since");
        input(
          !since || Date.parse(since) <= Date.now(),
          "since cannot be in the future",
        );
        const s = await load(db, { ...scope, since, evidenceOnly: true });
        const order = (
          a: { receivedAt: string; id: string },
          b: { receivedAt: string; id: string },
        ) =>
          Date.parse(a.receivedAt) - Date.parse(b.receivedAt) ||
          a.id.localeCompare(b.id);
        return {
          serverTime: s.serverTime,
          nextSince: s.serverTime,
          inclusive: true,
          measurements: s.vitals.sort(order),
          orientationSamples: s.samples?.sort(order),
          devices: s.devices,
          events: s.events,
        };
      }
      const match = path.match(
        /^\/api\/patients\/([^/]+)(?:\/(vitals|tasks|chart|orientation|devices|sensor-history))?$/,
      );
      if (match) {
        const [, id, section] = match;
        if (section === "vitals") return vitalHistory(db, id, q);
        const s = await load(db, {
          patientId: id,
          history: ["orientation", "sensor-history"].includes(section),
        });
        if (!section) return s.patients[0];
        if (section === "tasks") return s.tasks;
        if (section === "chart") return s.charts;
        if (section === "devices") return s.devices;
        const devices = s.devices?.filter(
          (d) => d.bodyRegion !== "BEDSIDE_MONITOR",
        );
        if (section === "orientation")
          return {
            samples: s.samples,
            movements: s.movements,
            devices,
            mode: "SIMULATED",
          };
        return {
          patientId: id,
          orientationUnit: "degrees",
          ruleVersion: "EXTERNAL_STORED_EVIDENCE",
          samples: s.samples,
          devices,
          connectivityEvents: s.events.filter(
            (e) =>
              e.type.startsWith("device.") &&
              devices?.some((d) => e.details.includes(d.id)),
          ),
          movements: s.movements.map((movement) => ({
            movement,
            charts: s.charts.filter((c) => c.linkedMovementId === movement.id),
          })),
        };
      }
      throw new ApiError(404, "API route not found");
    });
  if (method === "POST" && path === "/api/rounds/explanation")
    return transaction(async (db) => ({
      source: "DETERMINISTIC",
      summary:
        "Explicit high priority, then overdue, due within 30 minutes, then nurse-ordered routine tasks.",
      rounds: rounds(
        await load(db, { unit: selectedUnit || "L_AND_D", history: false }),
        selectedUnit || "L_AND_D",
      ),
    }));
  return transaction(async (db) => {
    if (method === "POST" && path === "/api/chart/drafts")
      return draft(db, body);
    let match = path.match(/^\/api\/chart\/drafts\/([^/]+)$/);
    if (method === "PATCH" && match) return draft(db, body, match[1]);
    match = path.match(/^\/api\/chart\/drafts\/([^/]+)\/confirm$/);
    if (method === "POST" && match) {
      await confirm(db, match[1], body);
      return load(db);
    }
    match = path.match(/^\/api\/chart\/([^/]+)\/amendments$/);
    if (method === "POST" && match) return draft(db, body, undefined, match[1]);
    match = path.match(/^\/api\/tasks\/([^/]+)\/([^/]+)$/);
    if (method === "POST" && match) {
      await taskCommand(db, match[1], match[2], body);
      return load(db);
    }
    match = path.match(/^\/api\/movements\/([^/]+)\/review$/);
    if (method === "POST" && match) {
      await review(db, match[1], body);
      return load(db);
    }
    if (method === "POST" && path === "/api/demo/tasks")
      return schedule(db, body);
    throw new ApiError(404, "API route not found");
  }, true);
}
async function vitalHistory(db: PoolClient, id: string, q: URLSearchParams) {
  const enc = await encounter(db, id),
    from = timestamp(q.get("from"), "from"),
    to = timestamp(q.get("to"), "to");
  input(!from || !to || from <= to, "History start must precede end");
  return (
    await db.query(
      "SELECT * FROM vital_observations WHERE encounter_id=$1 AND ($2::text IS NULL OR metric=$2) AND ($3::timestamptz IS NULL OR observed_at>=$3) AND ($4::timestamptz IS NULL OR observed_at<=$4) ORDER BY observed_at DESC,id LIMIT $5",
      [
        enc,
        q.get("metric"),
        from || null,
        to || null,
        boundedInt(q.get("limit"), 100, 500),
      ],
    )
  ).rows.map(dto<Vital>);
}
