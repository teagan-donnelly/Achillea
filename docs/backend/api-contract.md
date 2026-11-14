# Clinical data branch: API contract

V3 additive endpoints and updated retention/simulation semantics are documented in the [V3 contract](v3-contract.md). This document retains the V2 baseline API details.

Base: `874f2ee05a50c9e8c0b9078ef3535625fd5ddc3c`. All original routes, string identifiers, numeric vital values, timestamp types, and frontend-consumed fields remain. No frontend or shared root files are changed. All data is synthetic; no physical hardware, EHR, real authentication, AI, or clinical validation is provided.

## Original contract inspected

The original frontend uses `/api/state` and `/api/rounds?unit=` with a three-second poll and immediate refresh after commands. It consumes patient `{id,name,room,unit,summary,nurseId,repositionPlan}`, rounds `{task,reason,rank}`, vital `{id,patientId,metric,value,unit,observedAt,receivedAt,source,sourceEventId,quality}`, movement fields and sample IDs, chart drafts/confirmed entries, and audit events. These fields retain their shapes. The original aggregate database remains a JPA-versioned JSON CLOB in persistent H2.

Original routes retained:

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health`, `/api/demo/context` | Status and fixed synthetic nurse persona |
| GET | `/api/state` | Assigned-patient aggregate; ascending observation/event chronology |
| GET | `/api/patients?unit=L_AND_D&query=` | Assigned patients, name/room/ID search |
| GET | `/api/patients/{id}` | Assigned patient |
| GET | `/api/patients/{id}/vitals?limit=100` | Newest observations first, limit clamped 1–500 |
| GET | `/api/patients/{id}/tasks`, `/chart`, `/orientation` | Assigned patient's care, chart, sensor data |
| GET | `/api/events?patientId=&type=&limit=100` | Assigned events, optional patient and type prefix, newest first |
| GET | `/api/rounds?unit=L_AND_D` | Active tasks ordered deterministically |
| POST | `/api/chart/drafts` | Create draft |
| PATCH | `/api/chart/drafts/{id}` | Edit draft only |
| POST | `/api/chart/drafts/{id}/confirm` | Explicit confirmation |
| POST | `/api/chart/{id}/amendments` | Append correction draft; confirm separately |
| POST | `/api/tasks/{id}/{action}` | acknowledge, defer, complete, reorder, priority |
| POST | `/api/movements/{id}/review` | Human review, separate from task completion |
| POST | `/api/demo/reset`, `/api/demo/scenarios/{key}` | Explicit reset/scenario triggers |
| POST | `/api/integrations/monitors/observations` | Local simulated observation ingestion with source-event idempotence |
| POST | `/api/rounds/explanation?unit=` | Deterministic text; no AI dependency |

## Additive fields

| Object | Added fields | Meaning |
|---|---|---|
| Patient | `carePhase`, `scenario` | Fictional care context; descriptive scenario, not a live clinical status |
| State | `devices`, `demoStartedAt`, `serverTime`, `monitorTick` | Device provenance and simulator metadata |
| Vital | `sourceId` | Stable simulated monitor association; nullable in legacy observations |
| Movement | `chestSensorId`, `pelvisSensorId`, `receivedAt`, `confidence` | Independent source IDs, receipt instant, illustrative heuristic quality; confidence null when unknown |
| Round | `horizon` | NOW, NEXT, LATER; old rank remains 0–3 |
| Orientation response | `devices` | Sensor connection, calibration, capture freshness |

Device example (illustrative timestamp):

```json
{"id":"monitor-synthetic-ld-01","patientId":"synthetic-ld-01","bodyRegion":"BEDSIDE_MONITOR","connectionState":"CONNECTED","freshness":"FRESH","mode":"SIMULATED","calibrationStatus":"SIMULATED_REFERENCE","lastSeenAt":"2026-11-14T14:00:00Z","lastSampledAt":"2026-11-14T13:59:59Z","manualOverride":false}
```

`observedAt`/sensor `capturedAt` is sample time. `receivedAt` is ingestion time. Device `lastSampledAt` and `lastSeenAt` preserve that distinction. Freshness is computed on every read using sample age (over 60 seconds = STALE), not merely receipt time. Disconnected and never-seen devices are DISCONNECTED and UNKNOWN respectively. DELAYED is a connection state and may also appear as a vital quality. No old measurement is restamped as current.

## Additive routes and filters

- `GET /api/demo/census?unit=L_AND_D`: explicitly labeled `SYNTHETIC_UNIT_CENSUS` response with patient summaries and summary counts. Ten L&D or seven ICU census patients; three assigned to `nurse-demo` per unit. It does not expose unassigned notes, measurements, tasks, or sensor samples. This endpoint is a dev/demo census view, not expanded nurse record access.
- `GET /api/patients/{id}/devices`: assigned patient's monitor and orientation devices.
- `GET /api/patients/{id}/vitals?metric=HEART_RATE&from=2026-11-14T13:00:00Z&to=2026-11-14T14:00:00Z&limit=100`: optional exact metric and inclusive ISO-instant range. Default behavior is unchanged. Empty results remain an array. Reversed/invalid times return 400.
- New scenario keys: `minor`, `monitor-disconnect`, `monitor-delay`, `monitor-reconnect`, `monitor-tick`.

Original scenario keys remain: vital, flagged, partial, coordinated, disconnect, reconnect, no-movement. Monitor scenarios accept optional `patientId`, defaulting to synthetic-ld-01. Sensor scenarios accept an assigned ICU patient; absent ID defaults to synthetic-icu-01. For compatibility with the original global controls, an assigned L&D ID on a sensor scenario still targets synthetic-icu-01. An unassigned or unknown ID is rejected. `monitor-tick` advances one simulator receipt cycle, not wall-clock time.

## Commands and integrity

Draft example:
```json
{"patientId":"synthetic-ld-01","type":"OBSERVATION","text":"Reviewed synthetic bedside observations.","linkedTaskId":null,"linkedVitalIds":[],"linkedMovementId":null}
```
Confirmation: `{"verified":true}`. Entry types used by the original frontend remain OBSERVATION, ASSESSMENT, CARE_NOTE; TASK_COMPLETION is also recognized. Notes max 5000 characters, up to 100 linked observations. All links must refer to the same assigned patient. Confirmed records are immutable; amendment edits preserve `amendmentOfId`, and confirmation appends a `chart.amended` event while keeping the original record intact.

Task commands retain their original bodies: `{}` for acknowledge, `{"reason":"Patient requested later review"}` for defer, `{"order":0}` for reorder, `{"priority":"HIGH"}` for priority, `{"verified":true,"movementId":"candidate-id"}` for verified positioning completion. Priority values ROUTINE/TIMELY/HIGH remain accepted. Completion produces chart + task + audit changes in a single persistent aggregate write. Terminal tasks cannot be reopened through these action endpoints. One movement cannot satisfy multiple verification-required task completions.

Movement review: `{"status":"CONFIRMED_CARE","verified":true,"text":"Verified synthetic bedside care"}`; alternatives NOT_CARE/NEEDS_REVIEW. Movement and chart confirmation do not automatically complete care tasks. Explicit bedside verification may confirm care despite uncertain sensor data, but never converts sensor quality to certainty.

Events distinguish chart.created/updated/draft/confirmed/amended, movement.detected/candidate/reviewed, task action changes, monitor arrivals, device transitions, and simulation triggers. Original chart.draft and movement.candidate event names remain available.

Validation failures now return 400 rather than allowing null-pointer errors; state/verification conflicts remain 409, missing or unassigned records 404, demo disabled 403. Handled errors retain `{code,message,timestamp,correlationId}`. Assignment checks cover nested chart/task/movement links as well as top-level patient lookup. No real authentication claim is made.
