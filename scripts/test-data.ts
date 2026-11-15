import pg, { type PoolClient } from "pg";
import { fileURLToPath } from "node:url";
import { databaseConfig, databaseSchema } from "../server/db.js";

export function assertTestTarget() {
  const schema = databaseSchema(),
    config = databaseConfig();
  if (
    process.env.ACHILLEA_TEST_MODE !== "isolated" ||
    !/^achillea_test_[a-z0-9_]+$/.test(schema) ||
    !["127.0.0.1", "localhost"].includes(String(config.host))
  )
    throw new Error(
      "Test-data commands require ACHILLEA_TEST_MODE=isolated, loopback PostgreSQL and DB_SCHEMA=achillea_test_*; hosted/integration targets are refused",
    );
  return { schema, config };
}
export const fixtureTime = "2026-11-14T12:00:00.000Z";
const patientSpecs = [
  ["synthetic-ld-01", "Maya Rowan", "201", "L_AND_D", false],
  ["synthetic-ld-02", "Elena Vale", "202", "L_AND_D", false],
  ["synthetic-ld-03", "Iris Fern", "203", "L_AND_D", false],
  ["synthetic-icu-01", "Alex Linden", "401", "ICU", true],
  ["synthetic-icu-02", "Sam Brook", "402", "ICU", true],
  ["synthetic-icu-03", "Robin Ash", "403", "ICU", true],
] as const;
export async function seed(db: PoolClient) {
  assertTestTarget();
  await db.query(
    "INSERT INTO demo_metadata(id,started_at) VALUES('demo',$1) ON CONFLICT DO NOTHING",
    [fixtureTime],
  );
  for (const [
    index,
    [id, name, room, unit, reposition],
  ] of patientSpecs.entries()) {
    const enc = "encounter-" + id;
    await db.query(
      "INSERT INTO patients(id,name,room,unit,summary,nurse_id,reposition_plan,display_order,care_phase,scenario) VALUES($1,$2,$3,$4,'Isolated synthetic workflow fixture','nurse-demo',$5,$6,'SYNTHETIC','TEST') ON CONFLICT DO NOTHING",
      [id, name, room, unit, reposition, index],
    );
    await db.query(
      "INSERT INTO encounters(id,patient_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
      [enc, id],
    );
    await db.query(
      "INSERT INTO care_assignments VALUES($1,'nurse-demo') ON CONFLICT DO NOTHING",
      [enc],
    );
    for (const region of [
      "BEDSIDE_MONITOR",
      ...(reposition ? ["UPPER_TORSO", "PELVIS"] : []),
    ]) {
      const device = `${id}-${region}`;
      await db.query(
        "INSERT INTO devices(id,patient_id,encounter_id,body_region,connection_state,freshness,mode,calibration_status,last_seen_at,last_sampled_at,manual_override,update_interval_seconds,time_domain,simulation_scale) VALUES($1,$2,$3,$4,'CONNECTED','STALE','EXTERNAL_SIMULATION','SIMULATED_REFERENCE',$5,$5,true,15,'WALL_CLOCK',1) ON CONFLICT DO NOTHING",
        [device, id, enc, region, fixtureTime],
      );
      await db.query(
        "INSERT INTO device_assignments(device_id,encounter_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
        [device, enc],
      );
      if (region !== "BEDSIDE_MONITOR")
        await db.query(
          "INSERT INTO orientation_samples(id,sensor_id,patient_id,encounter_id,body_region,roll_degrees,captured_at,received_at,quality,mode) VALUES($1,$2,$3,$4,$5,35,$6,$6,'SIMULATED_GOOD','EXTERNAL_SIMULATION') ON CONFLICT DO NOTHING",
          ["sample-" + device, device, id, enc, region, fixtureTime],
        );
    }
    for (const [metric, value, units] of [
      ["HEART_RATE", 82, "bpm"],
      ["SPO2", 98, "%"],
      ["RESPIRATORY_RATE", 16, "breaths/min"],
    ] as const) {
      const vid = `vital-${id}-${metric}`;
      await db.query(
        "INSERT INTO vital_observations(id,patient_id,encounter_id,metric,value,unit,observed_at,received_at,source,source_event_id,source_id,quality) VALUES($1,$2,$3,$4,$5,$6,$7,$7,'EXTERNAL_SIMULATION',$1,$8,'VALID') ON CONFLICT DO NOTHING",
        [
          vid,
          id,
          enc,
          metric,
          value,
          units,
          fixtureTime,
          id + "-BEDSIDE_MONITOR",
        ],
      );
      await db.query(
        "INSERT INTO vital_observations(id,patient_id,encounter_id,metric,value,unit,observed_at,received_at,source,source_event_id,source_id,quality) VALUES($1,$2,$3,$4,$5,$6,$7,$7,'EXTERNAL_SIMULATION',$1,$8,'VALID') ON CONFLICT DO NOTHING",
        [
          vid + "-history",
          id,
          enc,
          metric,
          value - 1,
          units,
          "2026-11-14T11:59:00.000Z",
          id + "-BEDSIDE_MONITOR",
        ],
      );
    }
    for (let n = 1; n <= 2; n++) {
      const task = `task-${id}-${n}`;
      await db.query(
        "INSERT INTO care_tasks(id,patient_id,encounter_id,title,type,status,priority,source,due_at,verification_required,sort_order) VALUES($1,$2,$3,$4,$5,'OPEN','ROUTINE','SEEDED_CARE_PLAN',$6,$7,$8) ON CONFLICT DO NOTHING",
        [
          task,
          id,
          enc,
          reposition
            ? "Prescribed repositioning review"
            : "Review synthetic observations",
          reposition ? "REPOSITION" : "ASSESSMENT",
          n === 1 ? fixtureTime : "2099-01-01T12:00:00Z",
          reposition,
          n,
        ],
      );
    }
    if (reposition) {
      const mid = "movement-" + id;
      await db.query(
        "INSERT INTO movement_candidates(id,patient_id,encounter_id,classification,quality,verification_status,chest_sensor_id,pelvis_sensor_id,chest_before,pelvis_before,chest_after,pelvis_after,captured_at,received_at,confidence,review_required) VALUES($1,$2,$3,'COORDINATED_TURN_CANDIDATE','SIMULATED_GOOD','UNREVIEWED',$4,$5,0,0,35,35,$6,$6,0.9,true) ON CONFLICT DO NOTHING",
        [mid, id, enc, id + "-UPPER_TORSO", id + "-PELVIS", fixtureTime],
      );
      for (const [position, region] of ["UPPER_TORSO", "PELVIS"].entries())
        await db.query(
          "INSERT INTO movement_sample_links VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
          [mid, position, "sample-" + id + "-" + region],
        );
      await db.query(
        "INSERT INTO movement_reason_codes VALUES($1,0,'COORDINATED_MOVEMENT_REQUIRES_BEDSIDE_REVIEW') ON CONFLICT DO NOTHING",
        [mid],
      );
    }
    await db.query(
      "INSERT INTO activity_events(id,patient_id,encounter_id,type,source,details,occurred_at) VALUES($1,$2,$3,'fixture.created','ISOLATED_TEST','Deterministic synthetic fixture',$4) ON CONFLICT DO NOTHING",
      ["event-" + id, id, enc, fixtureTime],
    );
  }
  // An unassigned patient proves that ordinary API scopes cannot expose the full census.
  await db.query(
    "INSERT INTO patients(id,name,unit,nurse_id,reposition_plan) VALUES('test-unassigned','Not assigned','ICU',NULL,false) ON CONFLICT DO NOTHING",
  );
  await db.query(
    "INSERT INTO encounters(id,patient_id) VALUES('encounter-test-unassigned','test-unassigned') ON CONFLICT DO NOTHING",
  );
}
export async function cleanup(db: PoolClient) {
  assertTestTarget();
  // Clear only an explicitly isolated local test schema; never use TRUNCATE or drop production tables.
  const protectedRows = await db.query(
    "SELECT id FROM patients WHERE id NOT LIKE 'synthetic-%' AND id<>'test-unassigned' LIMIT 1",
  );
  if (protectedRows.rowCount)
    throw new Error(
      "Refusing cleanup: unexpected patient identities in test schema",
    );
  await db.query("SET LOCAL achillea.allow_reset='true'");
  for (const table of [
    "movement_consumptions",
    "chart_evidence_links",
    "movement_reviews",
    "task_transitions",
    "movement_sample_links",
    "movement_reason_codes",
    "raw_imu_samples",
    "ingestion_receipts",
    "simulation_streams",
    "simulation_sources",
    "chart_entries",
    "care_tasks",
    "movement_candidates",
    "orientation_samples",
    "vital_observations",
    "activity_events",
    "device_assignments",
    "devices",
    "care_assignments",
    "encounters",
    "patients",
    "demo_metadata",
  ])
    await db.query(`DELETE FROM ${table}`);
}
async function main() {
  const { schema, config } = assertTestTarget();
  const client = new pg.Client(config);
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SET LOCAL search_path TO "${schema}", pg_catalog`);
    if (process.argv[2] === "seed") await seed(client as unknown as PoolClient);
    else if (process.argv[2] === "cleanup")
      await cleanup(client as unknown as PoolClient);
    else throw new Error("Usage: npm run test:seed | test:cleanup");
    await client.query("COMMIT");
    console.log(`Isolated test ${process.argv[2]} completed in ${schema}`);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1])
  await main();
