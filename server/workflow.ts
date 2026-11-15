import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { ApiError, input, requireRule } from "./errors.js";
import {
  dto,
  encounter,
  owner,
  type Chart,
  type Task,
  type Movement,
} from "./store.js";
export type Body = Record<string, unknown>;
function text(value: unknown, max: number, message: string): string {
  input(
    typeof value === "string" && value.trim().length > 0 && value.length <= max,
    message,
  );
  return value;
}
function optionalId(value: unknown): string | null {
  input(
    value == null ||
      (typeof value === "string" && value.length > 0 && value.length <= 200),
    "Invalid linked record ID",
  );
  return (value as string) || null;
}
export async function audit(
  db: PoolClient,
  patient: string,
  enc: string,
  type: string,
  details: string,
) {
  await db.query(
    "INSERT INTO activity_events(id,patient_id,encounter_id,type,source,details,occurred_at) VALUES($1,$2,$3,$4,'nurse-demo',$5,clock_timestamp())",
    [randomUUID(), patient, enc, type, details],
  );
}
async function linked(
  db: PoolClient,
  table:
    | "care_tasks"
    | "vital_observations"
    | "movement_candidates"
    | "chart_entries",
  id: string,
  enc: string,
) {
  const result = await db.query(
    `SELECT * FROM ${table} WHERE id=$1 AND encounter_id=$2`,
    [id, enc],
  );
  requireRule(
    result.rows.length === 1,
    "Linked evidence must belong to this active patient encounter",
  );
  return result.rows[0];
}
export async function draft(
  db: PoolClient,
  body: Body,
  existing?: string,
  amendment?: string,
): Promise<Chart> {
  const patient = text(body.patientId, 200, "Patient is required"),
    enc = await encounter(db, patient, true);
  const note = text(
    body.text,
    5000,
    "Observation required (maximum 5000 characters)",
  );
  const type = body.type ?? "OBSERVATION";
  input(
    typeof type === "string" &&
      ["OBSERVATION", "ASSESSMENT", "CARE_NOTE", "TASK_COMPLETION"].includes(
        type,
      ),
    "Unsupported chart type",
  );
  const task = optionalId(body.linkedTaskId),
    movement = optionalId(body.linkedMovementId);
  const links = body.linkedVitalIds ?? [];
  input(
    Array.isArray(links) &&
      links.length <= 100 &&
      links.every((v) => typeof v === "string"),
    "Invalid linked observations",
  );
  if (task) await linked(db, "care_tasks", task, enc);
  if (movement) await linked(db, "movement_candidates", movement, enc);
  for (const id of links) await linked(db, "vital_observations", id, enc);
  if (amendment) {
    const original = await linked(db, "chart_entries", amendment, enc);
    requireRule(
      original.status !== "DRAFT",
      "Only confirmed entries can be amended",
    );
  }
  if (existing) {
    const previous = await linked(db, "chart_entries", existing, enc);
    requireRule(
      previous.status === "DRAFT",
      "Confirmed entries are immutable; append an amendment",
    );
  }
  const id = existing || randomUUID();
  const provenance = `MANUAL_ENTRY${links.length ? " + SIMULATED_MONITOR (linked immutable observations)" : ""}${movement ? " + SIMULATED_SENSOR (observation, not verified care)" : ""}`;
  const values = [patient, type, note, task, movement, provenance, id, enc];
  let row;
  if (existing) {
    row = (
      await db.query(
        "UPDATE chart_entries SET patient_id=$1,type=$2,text=$3,linked_task_id=$4,linked_movement_id=$5,provenance=$6 WHERE id=$7 AND encounter_id=$8 RETURNING *",
        values,
      )
    ).rows[0];
    await db.query("DELETE FROM chart_evidence_links WHERE owner_id=$1", [id]);
  } else {
    row = (
      await db.query(
        "INSERT INTO chart_entries(patient_id,type,text,linked_task_id,linked_movement_id,provenance,id,encounter_id,nurse_id,status,amendment_of_id,authored_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'nurse-demo','DRAFT',$9,clock_timestamp()) RETURNING *",
        [...values, amendment || null],
      )
    ).rows[0];
  }
  for (const [index, vital] of links.entries())
    await db.query(
      "INSERT INTO chart_evidence_links(owner_id,position,value) VALUES($1,$2,$3)",
      [id, index, vital],
    );
  await audit(
    db,
    patient,
    enc,
    existing ? "chart.updated" : "chart.created",
    "Draft saved",
  );
  await audit(db, patient, enc, "chart.draft", "Draft saved");
  return { ...dto<Chart>(row), linkedVitalIds: links };
}
export async function confirm(db: PoolClient, id: string, body: Body) {
  const patient = await owner(db, "chart_entries", id),
    enc = await encounter(db, patient);
  const row = await linked(db, "chart_entries", id, enc);
  requireRule(row.status === "DRAFT", "Entry already confirmed");
  requireRule(body.verified === true, "Review and verify the entry first");
  await db.query(
    "UPDATE chart_entries SET status=CASE WHEN amendment_of_id IS NULL THEN 'CONFIRMED' ELSE 'AMENDED' END,confirmed_at=clock_timestamp() WHERE id=$1",
    [id],
  );
  await audit(
    db,
    patient,
    enc,
    "chart.confirmed",
    "Entry confirmed with provenance: " + row.provenance,
  );
  if (row.amendment_of_id)
    await audit(
      db,
      patient,
      enc,
      "chart.amended",
      "Append-only correction to entry " + row.amendment_of_id,
    );
}
export async function taskCommand(
  db: PoolClient,
  id: string,
  action: string,
  body: Body,
) {
  const patient = await owner(db, "care_tasks", id),
    enc = await encounter(db, patient);
  const t = dto<Task>(await linked(db, "care_tasks", id, enc)),
    before = t.status;
  requireRule(
    !["COMPLETED", "CANCELLED"].includes(t.status),
    "Terminal task cannot change",
  );
  switch (action) {
    case "acknowledge":
      t.status = "ACKNOWLEDGED";
      break;
    case "defer":
      t.deferReason = text(
        body.reason,
        1000,
        "Deferral reason required (maximum 1000 characters)",
      );
      t.status = "DEFERRED";
      t.dueAt = new Date(Date.now() + 1800000).toISOString();
      break;
    case "reorder":
      requireRule(
        t.priority === "ROUTINE" && Date.parse(t.dueAt) > Date.now() + 1800000,
        "Only routine future tasks may move",
      );
      input(
        Number.isSafeInteger(body.order) &&
          Math.abs(Number(body.order)) <= 2147483647,
        "Order is required",
      );
      t.order = Number(body.order);
      break;
    case "priority":
      input(
        typeof body.priority === "string" &&
          ["ROUTINE", "TIMELY", "HIGH"].includes(body.priority),
        "Invalid priority",
      );
      t.priority = body.priority;
      break;
    case "complete": {
      requireRule(body.verified === true, "Nurse verification is required");
      const movementId = optionalId(body.movementId);
      let movement: Movement | undefined;
      if (movementId) {
        movement = dto<Movement>(
          await linked(db, "movement_candidates", movementId, enc),
        );
        requireRule(
          (
            await db.query(
              "SELECT 1 FROM movement_consumptions WHERE movement_id=$1",
              [movementId],
            )
          ).rowCount === 0,
          "Movement was already used for completed care",
        );
        // Also respect historical chart links created before consumption-table adoption.
        requireRule(
          (
            await db.query(
              "SELECT 1 FROM chart_entries c JOIN care_tasks t ON t.id=c.linked_task_id WHERE c.linked_movement_id=$1 AND t.status='COMPLETED'",
              [movementId],
            )
          ).rowCount === 0,
          "Movement was already used for completed care",
        );
      }
      if (t.verificationRequired)
        requireRule(
          movement?.verificationStatus === "CONFIRMED_CARE",
          "Movement must be nurse-confirmed care for this patient",
        );
      const note =
        body.text == null
          ? t.title + " — verified by demo nurse"
          : text(body.text, 5000, "Completion note invalid");
      t.status = "COMPLETED";
      t.completedAt = new Date().toISOString();
      t.verifiedBy = "nurse-demo";
      if (movementId)
        await db.query(
          "INSERT INTO movement_consumptions(movement_id,task_id) VALUES($1,$2)",
          [movementId, id],
        );
      await db.query(
        "INSERT INTO chart_entries(id,patient_id,encounter_id,nurse_id,type,text,status,linked_task_id,linked_movement_id,authored_at,confirmed_at,provenance) VALUES($1,$2,$3,'nurse-demo','TASK_COMPLETION',$4,'CONFIRMED',$5,$6,clock_timestamp(),clock_timestamp(),'NURSE_VERIFIED_CARE')",
        [randomUUID(), patient, enc, note, id, movementId],
      );
      await audit(
        db,
        patient,
        enc,
        "chart.confirmed",
        "Verified task completion recorded",
      );
      break;
    }
    default:
      throw new ApiError(400, "Unknown task action");
  }
  await db.query(
    "UPDATE care_tasks SET status=$1,priority=$2,defer_reason=$3,due_at=$4,sort_order=$5,completed_at=$6,verified_by=$7 WHERE id=$8",
    [
      t.status,
      t.priority,
      t.deferReason,
      t.dueAt,
      t.order,
      t.completedAt,
      t.verifiedBy,
      id,
    ],
  );
  if (before !== t.status)
    await db.query(
      "INSERT INTO task_transitions(task_id,previous_status,status,changed_at) VALUES($1,$2,$3,clock_timestamp())",
      [id, before, t.status],
    );
  await audit(
    db,
    patient,
    enc,
    "task." + action,
    t.title + (typeof body.reason === "string" ? " · " + body.reason : ""),
  );
}
export async function review(db: PoolClient, id: string, body: Body) {
  const patient = await owner(db, "movement_candidates", id),
    enc = await encounter(db, patient);
  const m = await linked(db, "movement_candidates", id, enc);
  input(
    typeof body.status === "string" &&
      ["CONFIRMED_CARE", "NOT_CARE", "NEEDS_REVIEW"].includes(body.status),
    "Invalid review status",
  );
  requireRule(
    m.verification_status !== "CONFIRMED_CARE",
    "Care already confirmed",
  );
  input(
    body.text == null ||
      (typeof body.text === "string" && body.text.length <= 5000),
    "Review note too long",
  );
  if (body.status === "CONFIRMED_CARE") {
    requireRule(
      body.verified === true,
      "Verification and bedside observation required",
    );
    text(body.text, 5000, "Verification and bedside observation required");
  }
  // Classification, axes, provenance and timestamps belong to the simulator. Only review fields change.
  await db.query(
    "UPDATE movement_candidates SET verification_status=$1,reviewer_id='nurse-demo',reviewed_at=$2 WHERE id=$3",
    [body.status, new Date().toISOString(), id],
  );
  await db.query(
    "INSERT INTO movement_reviews(movement_id,status,reviewer_id,reviewed_at) VALUES($1,$2,'nurse-demo',clock_timestamp())",
    [id, body.status],
  );
  await audit(
    db,
    patient,
    enc,
    "movement.reviewed",
    `${id}: ${body.status} · ${body.text || ""}`,
  );
}
export async function schedule(db: PoolClient, body: Body) {
  const patient = text(body.patientId, 200, "Patient is required"),
    enc = await encounter(db, patient, true);
  const title = text(
    body.title,
    200,
    "Title required (maximum 200 characters)",
  );
  input(
    typeof body.dueAt === "string" && Number.isFinite(Date.parse(body.dueAt)),
    "Valid dueAt is required",
  );
  const priority = body.priority || "ROUTINE";
  input(
    typeof priority === "string" &&
      ["ROUTINE", "TIMELY", "HIGH"].includes(priority),
    "Invalid priority",
  );
  const result = await db.query(
    "INSERT INTO care_tasks(id,patient_id,encounter_id,title,type,status,priority,source,due_at,verification_required,sort_order) VALUES($1,$2,$3,$4,'REVIEW','OPEN',$5,'NURSE_SCHEDULED',$6,false,0) RETURNING *",
    [randomUUID(), patient, enc, title, priority, body.dueAt],
  );
  await audit(
    db,
    patient,
    enc,
    "task.created",
    "Nurse-scheduled review: " + title,
  );
  await db.query(
    "INSERT INTO task_transitions(task_id,status,changed_at) VALUES($1,'OPEN',clock_timestamp())",
    [result.rows[0].id],
  );
  return dto<Task>(result.rows[0]);
}
