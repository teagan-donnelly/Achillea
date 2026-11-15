# Actual API
Base URL: `http://127.0.0.1:8080/api`. Vite forwards `/api` from port 5173. All record endpoints require local demo mode. Persona is fixed to `nurse-demo`; patient operations check its seeded assignments. This is not production authentication.

## Reads
- `GET /health`: status, version, synthetic flag.
- `GET /demo/context`: nurse name/ID, demoMode, synthetic flag.
- `GET /state`: typed aggregate `patients, tasks, vitals, samples, movements, charts, events` (all demo nurse assignments).
- `GET /patients?unit=L_AND_D&query=`: assigned patients matching name, room, ID. Unit `ICU` is the expansion scenario.
- `GET /patients/{id}`: assigned patient summary.
- `GET /patients/{id}/vitals?limit=100`: observations newest first, limit clamped 1–500.
- `GET /patients/{id}/tasks`, `GET /patients/{id}/chart`: patient's tasks/entries.
- `GET /patients/{id}/orientation`: simulated samples and candidates.
- `GET /rounds?unit=L_AND_D`: `{task, reason, rank}[]`; completed/cancelled tasks excluded.
- `GET /events?patientId=&type=&limit=100`: newest first; optional prefix type filter, limit clamped 1–500.

## Commands
- `POST /chart/drafts`, `PATCH /chart/drafts/{id}`: `{patientId,type,text,linkedTaskId:null,linkedVitalIds:[],linkedMovementId:null}`. Text required, max 5000. Task/vital links must belong to patient. Editing confirmed entries conflicts.
- `POST /chart/drafts/{id}/confirm`: `{verified:true}`. Confirmation is explicit and immutable.
- `POST /chart/{id}/amendments`: same draft schema; appends a draft linked by amendmentOfId. Confirm separately. Original entry remains intact.
- `POST /tasks/{id}/acknowledge`: `{}`.
- `POST /tasks/{id}/defer`: `{reason:"Patient requested later review"}`. Reason required; moves due time 30 minutes ahead.
- `POST /tasks/{id}/complete`: `{verified:true,movementId:null,text:"Optional verified-care note"}`. Repositioning requires a nurse-confirmed movement for that patient. Creates a confirmed linked chart record atomically.
- `POST /tasks/{id}/priority`: `{priority:"HIGH"}`; accepted values ROUTINE, TIMELY, HIGH.
- `POST /tasks/{id}/reorder`: `{order:0}`; only routine future tasks outside the next 30 minutes are eligible.
- `POST /movements/{id}/review`: `{status:"CONFIRMED_CARE",verified:true,text:"Observed synthetic care"}`. Other statuses: NOT_CARE, NEEDS_REVIEW. Review alone does not complete the task.
- `POST /demo/reset`: `{}`. Clears demo data and restores relative-time baseline.
- `POST /demo/scenarios/{key}?patientId=synthetic-ld-01`: `{}`. Keys: vital, flagged, partial, coordinated, no-movement, disconnect, reconnect. Vital keys use selected patient; sensor keys always target synthetic-icu-01.
- `POST /rounds/explanation?unit=L_AND_D`: `{}`. Always deterministic; no provider credentials.
- `POST /integrations/monitors/observations`: demo-only local simulated ingestion; `{sourceEventId:"demo-1",patientId:"synthetic-ld-01",metric:"HEART_RATE",value:81,unit:"bpm",observedAt:"2026-11-14T12:00:00Z",quality:"VALID"}`. Server stamps receivedAt/source. Duplicate event IDs return original; incompatible reuse conflicts. Supported metrics/units: HEART_RATE/bpm, SPO2/%, TEMPERATURE/°C, RESPIRATORY_RATE/breaths/min. Quality: VALID, SUSPECTED_ARTIFACT, MISSING, UNKNOWN.

- `POST /integrations/sensors/posture`: free-form roll for both regions in one frame; `{sourceEventId:"sim-1",patientId:"synthetic-icu-01",upperTorsoDegrees:30,pelvisDegrees:24.5,capturedAt:"2026-11-14T12:00:00Z",quality:"SIMULATED_GOOD"}`. Either angle may be null (not both). Angles −180…180. Returns stored samples (IDs `<sourceEventId>-UPPER_TORSO`/`-PELVIS`). Quality: SIMULATED_GOOD (default), DELAYED, UNCERTAIN, INCOMPLETE. Disconnected sensor: 409.
- `POST /integrations/sensors/orientation`: one region; `{sourceEventId,patientId,bodyRegion:"UPPER_TORSO"|"PELVIS",rollDegrees,capturedAt,quality?}`.
- `POST /integrations/sensors/movements`: free-form movement candidate; `{sourceEventId,patientId,upperTorsoBefore?,upperTorsoAfter,pelvisBefore?,pelvisAfter?,capturedAt,quality?,confidence?}`. Missing "before" angles default to the previous movement's "after" (else latest sample, else 0). Classified by per-region change ≥15°: COORDINATED_TURN_CANDIDATE, PARTIAL_TORSO_MOVEMENT, PARTIAL_PELVIC_MOVEMENT, SMALL_ADJUSTMENT; null pelvisAfter → UNKNOWN/PELVIS_DISCONNECTED. Creates a sensor-review task when review is required; never completes care.
- `GET /patients/{id}/posture`: latest sample per region, body sensors, latest movement.
- All sensor writes are idempotent per sourceEventId (same ID with different data: 409).

Mutations return the updated aggregate except draft and observation writes, which return the record. Poll `/state` and `/rounds` every three seconds; mutations trigger an immediate refresh. SSE/WebSocket and physical sensor gateway ingestion are not implemented. Storage: one H2 table per record type (`backend/src/main/resources/schema.sql`); legacy single-JSON databases are imported automatically on first open.

Errors use `{code,message,timestamp,correlationId}` for handled state/input failures. Missing assigned record: 404; disabled demo: 403; invalid JSON or observation input: 400; state/verification/link conflict: 409. No secrets or narrative logging is intentionally configured.
