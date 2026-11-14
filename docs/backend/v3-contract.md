# V3 additive clinical demo contract

All endpoints below require demo mode, use assigned patients only, and retain existing V2 response shapes. Timestamps are ISO-8601 UTC. Data and rules are synthetic; ordering expresses workflow timing, never medical urgency. No external credentials or hardware are required.

Implemented additive surfaces:

- `GET /api/activity/summary?unit=ICU&patientId=...`: routine measurements grouped by patient/source/15-minute receipt window, with exact measurement IDs and counts; non-routine measurements and raw events remain individually traceable.
- `GET /api/monitoring/updates?unit=ICU&since=...`: inclusive receipt-time deltas. Deduplicate IDs at the boundary. Missing `since` returns the assigned snapshot. Response includes server time, devices, measurements, orientation samples, and events. No truncation loses equal-time records.
- `GET /api/patients/{id}/sensor-history`: orientation evidence, movement review requirements, connectivity events, and associated charts.
- `POST /api/demo/scenarios/{key}`: existing keys plus `pelvic-only`, `sensor-delay`, `uncertain`, and `incomplete`.
- `POST /api/demo/tasks`: explicitly schedule a synthetic review; body has patientId, title, dueAt, and optional priority (default ROUTINE).
- `GET /api/demo/presets` and `POST /api/demo/presets/{key}?patientId=...`: deterministic non-destructive setup and a guided sequence of real API commands. Keys: routine-shift, device-event, repositioning, bedside-documentation, adaptive-rounds. Confirmation and completion remain explicit nurse commands.

Rounds add `reasonCodes`. Devices add `updateIntervalSeconds`. Movements add `reviewRequired` and `reviewReasonCodes`. Tasks add schedule/relationship metadata. Legacy snapshots receive additive defaults without reseeding.

Raw events and measurements are retained. Summary IDs derive from source and window, and never represent a claim of patient stability. This single-row educational store needs an archive strategy before long-running deployment.

## Activity response

An array of items (empty when there is no evidence in scope):

```json
{
  "id": "monitoring/synthetic-ld-01/monitor-synthetic-ld-01/1994208",
  "patientId": "synthetic-ld-01",
  "category": "MONITORING_SUMMARY",
  "type": "monitoring.summary",
  "sourceId": "monitor-synthetic-ld-01",
  "startedAt": "2026-11-14T14:00:00Z",
  "timestamp": "2026-11-14T14:00:30Z",
  "count": 2,
  "summary": "2 synthetic measurements received in this 15-minute window",
  "measurementIds": ["measurement-id-1", "measurement-id-2"],
  "sourceEventIds": ["source-event-1", "source-event-2"],
  "rawEventIds": []
}
```

Example identifiers/times are illustrative. `count` counts individual metric observations, not multi-metric device batches. `startedAt` and `timestamp` are the earliest/latest actual receipt times in a fixed UTC 900-second bucket, not a rolling window. The ID includes patient/source/bucket and is stable as the bucket fills. Existing items can change counts: replace a summary by ID rather than appending it on every poll. Do not sum repeated snapshots.

`measurementIds` resolve against `/api/monitoring/updates` (without since) or patient vital history. `sourceEventIds` identify originating observations, not necessarily raw activity Event IDs. Non-routine quality readings have category `MEASUREMENT`, one exact measurement ID, and the original quality. Routine `vital.received` raw activity events are omitted from this presentation only; `/api/events` and the updates endpoint retain them. Each other event has its raw Event ID in `rawEventIds`, with its exact details and timestamp. Categories are MONITORING_SUMMARY, MEASUREMENT, DEVICE_STATUS, TASK_ATTENTION, SENSOR_REVIEW, DOCUMENTATION, ACTIVITY. Event `type` remains the original granular type. Existing source fields remain unchanged.

For measurement items, sourceId is the original measurement sourceId (possibly null for older records); missing legacy sourceEventId produces an empty sourceEventIds array. For raw activity items sourceId echoes Event.source, the event producer/actor, not necessarily a device identifier. Technical event details include the relevant device ID.

## Incremental monitoring

```sh
curl 'http://127.0.0.1:18083/api/monitoring/updates?unit=ICU&since=2026-11-14T14:00:00Z'
```

Response fields: `serverTime` (injected UTC clock), `nextSince` (same snapshot boundary), `inclusive: true`, `measurements` (existing Vital objects sorted by receipt/id), `orientationSamples` (existing sample objects sorted by receipt/id), `devices` (current scoped snapshot), `events` (raw activity on/after boundary). No `since` means all retained evidence. Empty deltas have empty arrays, but devices always return the current snapshot. Future/invalid timestamps return 400. Unknown/unassigned patients return 404; unsupported units return 400. A patient in a different requested unit yields an empty scope. Null-patient global demo events may appear in either unit; they contain no patient evidence.

Poll about every three seconds, pass the previous `nextSince`, and deduplicate **each evidence collection by its own ID**. Inclusive boundaries intentionally replay equal-time events so arrivals within the same clock instant are not lost. There is no truncation/cursor that can drop a timestamp tie. For an explicit demo reset, discard client caches and fetch a fresh snapshot; this timestamp protocol does not detect a destructive reset automatically. Use `/activity/summary` separately for presentation. Large all-history responses and the single-row aggregate are demo-scale limitations.

Device `updateIntervalSeconds` is nominal: bedside monitors use 15/30/45 seconds by stable census order; orientation heartbeats use the scheduler cadence (15 seconds by default). Monitor connection-state changes can deliver immediately to expose a reconnect/delay transition; otherwise intervals gate receipt updates. `lastSeenAt` is last receipt, `lastSampledAt` is measurement/capture time. Delayed evidence is captured 90 seconds earlier and may arrive out of observation-time order. Freshness is UNKNOWN with no sample, DISCONNECTED when disconnected, STALE when sample age exceeds 60 seconds, otherwise FRESH. These are technical demonstration rules. Scheduler cadence controls how frequently a due device is visited. `reportedFreshness` tracks the last persisted freshness audit state; it is internal bookkeeping, not a measurement. Freshness changes emit `device.freshness` on the next command/tick. GET recomputes freshness without writing. Quality SUSPECTED_ARTIFACT occurs every 23rd eligible simulated cycle; it does not diagnose a patient or complete a task.

## Sensor evidence

`GET /api/patients/{id}/sensor-history` returns `patientId`, `orientationUnit: degrees`, `ruleVersion: SYNTHETIC_REGION_REVIEW_V1`, raw `samples`, region `devices`, `connectivityEvents` (including freshness changes), and `movements`. Each movement entry contains the original `movement` plus `charts` linked to that movement. Empty/missing history returns arrays, and region devices report UNKNOWN if no sample exists. Existing original fields retain their meanings: before/after roll angles are illustrative degrees wrapped into [-180,180); capturedAt is source time, receivedAt arrival time; sampleIds reference the exact stored region evidence. Classifications are illustrative pattern labels, never proof of pressure relief.

| Scenario key | Evidence | Review rule |
|---|---|---|
| coordinated | Both regions rotate 35 degrees | COORDINATED_MOVEMENT_REQUIRES_BEDSIDE_REVIEW |
| partial | Torso rotates 35 degrees, pelvis unchanged | REGION_ONLY_MOVEMENT |
| pelvic-only | Pelvis rotates 35 degrees, torso unchanged | REGION_ONLY_MOVEMENT |
| minor | Both rotate 4 degrees | No automatic review requirement |
| disconnect | Pelvis sample missing; classification UNKNOWN | INCOMPLETE_OR_UNCERTAIN_EVIDENCE |
| reconnect | Device connected; no inferred care | No automatic review requirement |
| sensor-delay | Coordinated capture arrives 90 seconds late | Coordinated + incomplete/uncertain evidence codes |
| uncertain | UNKNOWN; quality UNCERTAIN, illustrative confidence 0.35 | INCOMPLETE_OR_UNCERTAIN_EVIDENCE |
| incomplete | Torso sample only; quality INCOMPLETE, confidence null | INCOMPLETE_OR_UNCERTAIN_EVIDENCE |

`reviewRequired` says the deterministic evidence rule warrants review, **not** whether a review remains outstanding. Filter it together with `verificationStatus` UNREVIEWED/NEEDS_REVIEW. `reviewReasonCodes` lists the applicable rules; old persisted movements receive the same derived classification defaults without reseeding. Missing confidence stays null. Evidence quality is preserved on individual samples, and missing pelvic evidence is not fabricated. Delayed sample age remains distinct from receipt time.

An active SENSOR_REVIEW task is created for each qualifying movement; DEVICE_REVIEW tasks deduplicate by active device relationship. `relatedMovementId`/`relatedDeviceId` identify the evidence. Review tasks do not represent prescribed care. A review or reconnect never completes these tasks automatically. Nurses may explicitly acknowledge/defer/complete review tasks through existing task commands. Repositioning care separately requires a confirmed movement and explicit verified completion of the prescribed task. Reusing that movement for any second completed task returns 409.

New sensor scenario keys require an assigned reposition-plan patient and reject an L&D patient with 400, preserving unit isolation. Original V2 sensor keys retain their legacy global-control fallback to ICU01 when an L&D patient is selected; new frontend controls should always pass the actual assigned ICU patient explicitly.

## Rounds and explicit scheduling

```http
POST /api/demo/tasks
Content-Type: application/json

{"patientId":"synthetic-ld-01","title":"Synthetic workflow review","dueAt":"2026-11-14T14:15:00Z","priority":"ROUTINE"}
```

Returns an existing-shaped Task with source EXPLICIT_DEMO_SCHEDULE and type SCHEDULED_REVIEW. Only priority is optional; no existing request gains new required fields. Title must be nonblank, at most 200 characters. Only assigned patients and ROUTINE/TIMELY/HIGH priorities are accepted. Scheduling accepts past times intentionally for overdue demonstrations. No chart is created. IDs are generated UUIDs. New `scheduleState` is LATER/UPCOMING/DUE/OVERDUE when last reconciled; historical terminal tasks may have null. `task.schedule.*` audit events record state transitions once; time-driven transitions persist at the next scheduler tick. Initial due/overdue baselines are recorded when workflow reconciliation first runs.

Existing rounds retain task/reason/rank/horizon and add `reasonCodes`:

| Code | Meaning |
|---|---|
| EXPLICIT_HIGH_PRIORITY | Operator/nurse assigned HIGH |
| EXPLICIT_TIMELY_PRIORITY | Operator/nurse assigned TIMELY |
| SCHEDULED_DUE / SCHEDULED_OVERDUE | Due timestamp equals / precedes server time |
| DUE_WITHIN_30_MINUTES | Upcoming within 30 minutes |
| ROUTINE_SEQUENCE | Future task beyond 30 minutes |
| NURSE_ACKNOWLEDGED / NURSE_DEFERRED | Explicit task state |
| SENSOR_REVIEW_REQUIRED | Movement evidence relationship |
| TECHNICAL_DEVICE_REVIEW | Device evidence relationship |
| DEVICE_CONNECTION_REVIEW | Patient has a non-connected device |

Order is HIGH, due/overdue, upcoming, later; horizons NOW/NEXT/LATER match V2. Within a rank, TIMELY precedes ROUTINE, then later tasks use nurse order, then due time and ID break ties. Reasons describe scheduling and technical review, not medical risk. Completion/cancellation excludes a task; acknowledgment preserves its schedule; deferral requires a reason and moves dueAt 30 minutes forward. Care still requires explicit verification and produces the original nurse-authored completion chart.

## Presets and frontend integration

`GET /api/demo/presets` returns keys plus synthetic=true, automaticConfirmation=false, destructiveReset=false. `POST /api/demo/presets/{key}?patientId=...` returns `key`, `patientId`, `notice`, `beforeRounds`, `state`, `evidenceIds`, `steps`. Each step has title/method/path/body/captureAs; bind a captured response.id into later `${draftId}` / `${amendmentId}` paths. IDs/timestamps identify each new execution; they are intentionally unique. Values, actions, scheduling offsets, classification rules and guide order are deterministic. The preset does not reset existing data, and repeated calls append evidence/tasks. An ICU reposition-plan patient is mandatory for repositioning (default ICU01); others default LD01 and accept any assigned patient.

Routine-shift prepares a fixed 80 bpm observation and routine upcoming review. Device-event prepares a fixed observation then disconnects, returning steps for delayed arrival and reconnect. Repositioning prepares region evidence and a care task, then returns separate review and care-completion commands. Bedside-documentation supplies actual measurement IDs and returns draft/confirm/amend/confirm commands without writing a chart automatically. Adaptive-rounds returns beforeRounds and schedules later/+90-minute and newly-due tasks with reason codes, then explicit acknowledgment/deferral steps. Presets take one synchronous setup call; each guide step is a separate persisted command. A connection/process failure can leave partial setup; inspect history before retrying, since POSTs intentionally append and are not idempotent.

Frontend work for the integration agent: render summary categories rather than repetitive raw arrivals; link measurement IDs to source history; use reasonCodes for concise explanations; show sample-age separately from receipt age; display missing/disconnected regions without substituting zero as observed evidence; display reviewRequired plus verificationStatus and linked charts; expose optional new scenario controls and step-by-step preset guides with explicit nurse actions. Keep original APIs as fallback. Do not automatically execute confirmation bodies when a preset is selected. No frontend files were changed in this branch. See [runbook](v3-demo-runbook.md) for installation, recording and automated verification.
