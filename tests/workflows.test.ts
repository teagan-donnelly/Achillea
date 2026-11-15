import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import type { ApiRequest, ApiResponse } from "../server/http.js";
import type { PoolClient } from "pg";
import handler from "../api/index.js";
import { getPool, closePool, transaction } from "../server/db.js";
import { seed, cleanup, fixtureTime } from "../scripts/test-data.js";
import type { State, Chart, Task } from "../server/store.js";

const isolated = process.env.ACHILLEA_TEST_MODE === "isolated";
describe.skipIf(!isolated)(
  "real HTTP Vercel handler + isolated native PostgreSQL",
  () => {
    let server: Server, base: string, cookie: string;
    const patient = "synthetic-icu-01",
      movement = "movement-" + patient,
      task = "task-" + patient + "-1";
    async function request(
      path: string,
      body?: unknown,
      method = body === undefined ? "GET" : "POST",
      auth = true,
    ) {
      return fetch(base + "/api" + path, {
        method,
        headers: {
          "Content-Type": "application/json",
          "X-Achillea-Request": "1",
          ...(auth ? { cookie } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    }
    async function ok<T>(
      path: string,
      body?: unknown,
      method?: string,
    ): Promise<T> {
      const res = await request(path, body, method);
      if (res.status !== 200)
        throw new Error(`${res.status} ${await res.text()}`);
      return res.json() as Promise<T>;
    }
    async function sql<T>(fn: (db: PoolClient) => Promise<T>, write = false) {
      return transaction(fn, write);
    }
    beforeAll(async () => {
      server = createServer(async (req, res) => {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(chunk);
        const r = req as ApiRequest;
        r.body = chunks.length ? Buffer.concat(chunks).toString() : undefined;
        const s = res as ApiResponse;
        s.status = (code: number) => {
          res.statusCode = code;
          return s;
        };
        s.json = (value: unknown) => {
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(value));
          return s;
        };
        await handler(r, s);
      });
      await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
      const addr = server.address();
      if (!addr || typeof addr === "string") throw new Error("No HTTP port");
      base = `http://127.0.0.1:${addr.port}`;
      const res = await request(
        "/auth/session",
        { password: process.env.APP_ACCESS_PASSWORD },
        "POST",
        false,
      );
      expect(res.status).toBe(200);
      cookie = res.headers.get("set-cookie")!.split(";")[0];
    });
    beforeEach(async () => {
      await sql(async (db) => {
        await cleanup(db);
        await seed(db);
      }, true);
    });
    afterAll(async () => {
      await new Promise<void>((done) => server.close(() => done()));
      await closePool();
    });
    it("scopes assignments and keeps ICU and L&D workflows distinct", async () => {
      const all = await ok<State>("/state");
      expect(all.patients).toHaveLength(6);
      expect(all.patients.some((p) => p.id === "test-unassigned")).toBe(false);
      const ld = await ok<State>("/workspace?unit=L_AND_D");
      expect(ld.patients).toHaveLength(3);
      expect(ld.vitals).toEqual([]);
      expect(ld.samples).toEqual([]);
      expect(ld.patients.every((p) => !p.repositionPlan)).toBe(true);
      expect((await request("/patients/test-unassigned")).status).toBe(404);
      expect((await request("/workspace?unit=BAD")).status).toBe(400);
    });
    it("requires a session for every clinical route and keeps API errors JSON", async () => {
      expect((await request("/state", undefined, "GET", false)).status).toBe(
        401,
      );
      expect((await request("/health", undefined, "GET", false)).status).toBe(
        200,
      );
      const missing = await request("/missing");
      expect(missing.status).toBe(404);
      expect(missing.headers.get("content-type")).toContain("application/json");
    });
    it("removes ingestion, sensor generation and reset without changing stored evidence", async () => {
      const before = await sql(
        async (db) =>
          (await db.query("SELECT count(*) FROM vital_observations")).rows[0]
            .count,
      );
      for (const path of [
        "/integrations/simulation/v1/observations",
        "/integrations/monitors/observations",
        "/demo/scenarios/coordinated",
        "/demo/reset",
        "/demo/presets/repositioning",
      ])
        expect((await request(path, {})).status).toBe(410);
      expect(
        await sql(
          async (db) =>
            (await db.query("SELECT count(*) FROM vital_observations")).rows[0]
              .count,
        ),
      ).toBe(before);
    });
    it("validates history timestamps, metrics and bounded limits", async () => {
      const readings = await ok<{ metric: string }[]>(
        "/patients/" + patient + "/vitals?metric=HEART_RATE&limit=1",
      );
      expect(readings).toHaveLength(1);
      expect(readings[0].metric).toBe("HEART_RATE");
      expect(
        (await request("/patients/" + patient + "/vitals?from=no")).status,
      ).toBe(400);
      expect(
        (await request("/patients/" + patient + "/vitals?limit=NaN")).status,
      ).toBe(400);
      expect(
        (
          await request(
            "/patients/" +
              patient +
              "/vitals?from=2026-12-01T00:00:00Z&to=2026-01-01T00:00:00Z",
          )
        ).status,
      ).toBe(400);
    });
    it("keeps inclusive timestamp ties and source provenance in monitoring deltas", async () => {
      const page = await ok<{
        measurements: { id: string; sourceId: string }[];
        inclusive: boolean;
      }>(
        "/monitoring/updates?unit=L_AND_D&since=" +
          encodeURIComponent(fixtureTime),
      );
      expect(page.inclusive).toBe(true);
      expect(page.measurements).toHaveLength(9);
      expect(new Set(page.measurements.map((v) => v.id)).size).toBe(9);
      expect(page.measurements.every((v) => !!v.sourceId)).toBe(true);
      expect(
        (await request("/monitoring/updates?since=2099-01-01T00:00:00Z"))
          .status,
      ).toBe(400);
    });
    it("reads externally stored orientation, original classifications and stale device status", async () => {
      const s = await ok<State>("/state");
      expect(s.devices?.every((d) => d.freshness === "STALE")).toBe(true);
      const history = await ok<{
        samples: unknown[];
        movements: { movement: { classification: string } }[];
      }>("/patients/" + patient + "/sensor-history");
      expect(history.samples).toHaveLength(2);
      expect(history.movements[0].movement.classification).toBe(
        "COORDINATED_TURN_CANDIDATE",
      );
    });
    it("saves drafts, requires explicit confirmation, and appends immutable amendments", async () => {
      const c = await ok<Chart>("/chart/drafts", {
        patientId: patient,
        text: "Bedside observation",
        linkedVitalIds: ["vital-" + patient + "-HEART_RATE"],
      });
      expect(c.status).toBe("DRAFT");
      expect(
        (await request("/chart/drafts/" + c.id + "/confirm", {})).status,
      ).toBe(409);
      await ok("/chart/drafts/" + c.id + "/confirm", { verified: true });
      expect(
        (
          await request(
            "/chart/drafts/" + c.id,
            { patientId: patient, text: "Overwrite" },
            "PATCH",
          )
        ).status,
      ).toBe(409);
      const amendment = await ok<Chart>("/chart/" + c.id + "/amendments", {
        patientId: patient,
        text: "Correction",
      });
      await ok(
        "/chart/drafts/" + amendment.id,
        { patientId: patient, text: "Updated correction" },
        "PATCH",
      );
      await ok("/chart/drafts/" + amendment.id + "/confirm", {
        verified: true,
      });
      const charts = await ok<Chart[]>("/patients/" + patient + "/chart");
      expect(charts.find((x) => x.id === c.id)?.text).toBe(
        "Bedside observation",
      );
      expect(charts.find((x) => x.id === amendment.id)).toMatchObject({
        status: "AMENDED",
        amendmentOfId: c.id,
        text: "Updated correction",
      });
    });
    it("rejects evidence and amendments from other patients with no partial write", async () => {
      expect(
        (
          await request("/chart/drafts", {
            patientId: patient,
            text: "Wrong patient",
            linkedVitalIds: ["vital-synthetic-icu-02-HEART_RATE"],
          })
        ).status,
      ).toBe(409);
      expect(
        await sql(
          async (db) =>
            (await db.query("SELECT count(*) FROM chart_entries")).rows[0]
              .count,
        ),
      ).toBe("0");
      expect(
        (
          await request("/chart/drafts", {
            patientId: patient,
            text: "Wrong movement",
            linkedMovementId: "movement-synthetic-icu-02",
          })
        ).status,
      ).toBe(409);
    });
    it("does not turn evidence into care; explicit nurse review is required", async () => {
      expect(
        (
          await request("/tasks/" + task + "/complete", {
            verified: true,
            movementId: movement,
          })
        ).status,
      ).toBe(409);
      expect(
        (
          await request("/movements/" + movement + "/review", {
            status: "CONFIRMED_CARE",
            verified: true,
          })
        ).status,
      ).toBe(400);
      await ok("/movements/" + movement + "/review", {
        status: "CONFIRMED_CARE",
        verified: true,
        text: "Verified actual bedside care",
      });
      const s = await ok<State>("/state");
      expect(s.tasks.find((t) => t.id === task)?.status).toBe("OPEN");
      expect(s.charts).toHaveLength(0);
    });
    it("atomically completes tasks with chart/audit/consumption and prevents concurrent reuse", async () => {
      await ok("/movements/" + movement + "/review", {
        status: "CONFIRMED_CARE",
        verified: true,
        text: "Verified bedside",
      });
      const responses = await Promise.all([
        request("/tasks/" + task + "/complete", {
          verified: true,
          movementId: movement,
        }),
        request("/tasks/task-" + patient + "-2/complete", {
          verified: true,
          movementId: movement,
        }),
      ]);
      expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
      const result = await sql(async (db) => ({
        charts: (
          await db.query(
            "SELECT * FROM chart_entries WHERE type='TASK_COMPLETION'",
          )
        ).rows,
        uses: (await db.query("SELECT * FROM movement_consumptions")).rows,
        events: (
          await db.query(
            "SELECT * FROM activity_events WHERE type='task.complete'",
          )
        ).rows,
      }));
      expect(result.charts).toHaveLength(1);
      expect(result.uses).toHaveLength(1);
      expect(result.events).toHaveLength(1);
    });
    it("preserves classifications and original sensor evidence during nurse review", async () => {
      const before = await sql(
        async (db) =>
          (
            await db.query(
              "SELECT classification,quality,captured_at,chest_after,pelvis_after FROM movement_candidates WHERE id=$1",
              [movement],
            )
          ).rows[0],
      );
      await ok("/movements/" + movement + "/review", {
        status: "NEEDS_REVIEW",
        text: "Verify at bedside",
      });
      const after = await sql(
        async (db) =>
          (
            await db.query(
              "SELECT classification,quality,captured_at,chest_after,pelvis_after FROM movement_candidates WHERE id=$1",
              [movement],
            )
          ).rows[0],
      );
      expect(after).toEqual(before);
      expect(
        await sql(
          async (db) =>
            (await db.query("SELECT count(*) FROM movement_reviews")).rows[0]
              .count,
        ),
      ).toBe("1");
    });
    it("requires reasons for deferrals and deterministically orders explicit priority", async () => {
      expect((await request("/tasks/" + task + "/defer", {})).status).toBe(400);
      await ok("/tasks/" + task + "/defer", {
        reason: "Patient requested later review",
      });
      const created = await ok<Task>("/demo/tasks", {
        patientId: patient,
        title: "Explicit attention",
        dueAt: "2099-01-01T00:00:00Z",
        priority: "HIGH",
      });
      const r =
        await ok<{ task: Task; reasonCodes: string[] }[]>("/rounds?unit=ICU");
      expect(r[0].task.id).toBe(created.id);
      expect(r[0].reasonCodes).toContain("EXPLICIT_HIGH_PRIORITY");
      expect(
        (await request("/tasks/" + created.id + "/reorder", { order: 0 }))
          .status,
      ).toBe(409);
    });
    it("persists charts and review records across connection-pool restart", async () => {
      const c = await ok<Chart>("/chart/drafts", {
        patientId: patient,
        text: "Persistence proof",
      });
      await closePool();
      expect(
        (await ok<Chart[]>("/patients/" + patient + "/chart")).find(
          (x) => x.id === c.id,
        )?.text,
      ).toBe("Persistence proof");
      expect(getPool()).toBeDefined();
    });
    it("supports idempotent isolated seed and cleanup without schema mutation", async () => {
      const tables = await sql(
        async (db) =>
          (
            await db.query(
              "SELECT table_name FROM information_schema.tables WHERE table_schema=current_schema() ORDER BY table_name",
            )
          ).rows,
      );
      await sql(seed, true);
      expect((await ok<State>("/state")).patients).toHaveLength(6);
      await sql(cleanup, true);
      await sql(cleanup, true);
      expect((await ok<State>("/state")).patients).toHaveLength(0);
      expect(
        await sql(
          async (db) =>
            (
              await db.query(
                "SELECT table_name FROM information_schema.tables WHERE table_schema=current_schema() ORDER BY table_name",
              )
            ).rows,
        ),
      ).toEqual(tables);
    });
    it("rejects oversized and malformed request bodies and foreign-origin writes", async () => {
      expect(
        (
          await request("/chart/drafts", {
            patientId: patient,
            text: "x".repeat(40000),
          })
        ).status,
      ).toBe(413);
      const bad = await fetch(base + "/api/chart/drafts", {
        method: "POST",
        headers: {
          cookie,
          "Content-Type": "application/json",
          "X-Achillea-Request": "1",
        },
        body: "{",
      });
      expect(bad.status).toBe(400);
      const csrf = await fetch(base + "/api/chart/drafts", {
        method: "POST",
        headers: {
          cookie,
          origin: "https://evil.example",
          "X-Achillea-Request": "1",
        },
        body: "{}",
      });
      expect(csrf.status).toBe(403);
    });
    it("routes rewritten Vercel API requests without turning unknown APIs into SPA pages", async () => {
      const s = await ok<State>("/index?route=workspace&unit=ICU");
      expect(s.patients).toHaveLength(3);
      expect((await request("/index?route=missing")).status).toBe(404);
    });
  },
);
