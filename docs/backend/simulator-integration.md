# External simulator integration contract (v1)

## Connection and access

Use the existing Spring Boot server, not a new backend or a direct database connection. All paths below require demo mode, `SIMULATION_INGESTION_ENABLED=true`, and `X-Simulation-Key` equal to a secret `SIMULATION_API_KEY` (at least 24 characters). No credentials are hardcoded. Missing/wrong integration keys return 401; disabled integration returns 403.

An operator must bind a source to an assigned active synthetic encounter: `SIMULATION_BINDINGS=simulator-001=encounter-synthetic-icu-01`, or multiple comma-separated `source=encounter` pairs. Startup applies bindings after any explicit empty-database seed. There is no unauthenticated source-registration endpoint. This is development integration authorization, not hospital identity management; a shared development key grants access to the configured bindings. Keep it private. CORS is not unrestricted: a browser simulator should use a same-origin development proxy; do not put database credentials in it.

## POST /api/integrations/simulation/v1/observations

```json
{
  "schemaVersion": 1,
  "encounterId": "encounter-synthetic-icu-01",
  "sourceId": "simulator-001",
  "runId": "session-2026-11-14-a",
  "timeScale": 600,
  "samples": [
    {
      "eventId": "sample-000001",
      "timestamp": "2026-11-14T21:45:00Z",
      "chest": {"ax":0,"ay":0,"az":1,"gx":0,"gy":0,"gz":0},
      "pelvis": {"ax":0,"ay":0,"az":1,"gx":0,"gy":0,"gz":0}
    }
  ]
}
```

Each sample accepts **either** `timestamp` (an ISO instant) **or** `t` (Unix seconds, including fractions), not both. This permits wrapping the teammate's existing `{t,chest,pelvis}` packets without replacing their generator. Add stable event IDs and the envelope. Identifiers contain 1-120 letters/digits or `_.:-`. Acceleration is in **g**; angular velocity is **degrees/second**. All six axes of a supplied region must be finite and present. Contract bounds are +/-32 g and +/-4000 degrees/second; these are input bounds, not clinical thresholds. Unknown risk/pressure scores are not used for workflow decisions.

Missing region objects are not valid zero vectors and create no fake region sample. Optional `chestConnected:false` / `pelvisConnected:false` explicitly record disconnection. If both regions are absent, at least one explicit disconnection is required. Region identity is derived from the bound source/encounter and is independent across patients. The current contract does not accept arbitrary caller-controlled device reassignment.

Defaults: 1-250 paired packets per batch; 262144 bytes per request, including chunked bodies. `SIMULATION_MAX_BATCH` and `SIMULATION_MAX_BYTES` configure limits. About 50 packets per second can be sent as one batch per second; actual hosted throughput must be measured. Requests run synchronously in bounded transactions, with lock/statement timeouts; there is no silent queue, automatic dropping, retention or downsampling.

### Acknowledgment

```json
{
  "schemaVersion":1,
  "encounterId":"encounter-synthetic-icu-01",
  "patientId":"synthetic-icu-01",
  "sourceId":"simulator-001",
  "runId":"session-2026-11-14-a",
  "accepted":1,
  "duplicates":0,
  "results":[{
    "eventId":"sample-000001",
    "receiptId":"stable-receipt-uuid",
    "status":"PROCESSED",
    "movementId":null,
    "orientationIds":["orientation-stable-region-id"]
  }]
}
```

IDs above are illustrative, not literal records. A complete valid pair yields two orientation IDs. Status is PROCESSED, TIMESTAMP_TIE, OUT_OF_ORDER, or DUPLICATE. Replaying an identical event under the same encounter/source/run returns its original receipt/evidence IDs and no duplicate task, event, or observation. Reusing an event ID with different content returns 409. The whole batch rolls back on validation, integrity or conflict failure, including earlier new packets in that request. Client retries must preserve the envelope and packet IDs/content.

## Clocks and processing

- **Source simulation time:** drives filter dt, movement thresholds and the two-simulated-second candidate interval. It may be ahead of or behind wall time at 1x-600x acceleration. It remains in captured/observed timestamps and raw source text.
- **Server receipt time:** drives incremental delivery and external-device transport freshness. It is not substituted for elapsed simulation time in the filter.
- **Processing time:** stored separately on raw rows/receipts.

A new simulation reset must use a new `runId`; IDs may repeat across runs. Each encounter/source/run has independent durable roll, anchor and timestamp state. Do not interleave different runs of the same source/encounter for a single live display; device status reports the latest accepted active traffic, while run filter state remains separate. Backend restart reloads state from PostgreSQL. Out-of-order packets are retained and marked OUT_OF_ORDER but do not rewind the processing state or create retroactive movements. Distinct event IDs at an equal timestamp remain traceable; they do not integrate a nonpositive gyro dt. A repeated batch is not a reset.

The backend is authoritative for Achillea classifications. `COMPLEMENTARY_ROLL_V1` derives accelerometer roll from atan2(ay,az), integrates gx using simulated dt, and blends 98% prediction with 2% accelerometer correction. The first sample or a gap over one simulated second re-establishes the accelerometer reference; this is not physical calibration. Acceleration magnitude outside 0.5-1.5 g marks uncertainty. Roll is illustrative, not a full 3D attitude solution or validated pressure/position model.

Both regions need prior valid baselines before a candidate can be emitted. Significant changes use a 30-degree illustrative threshold; independent regions produce coordinated, torso-only, pelvis-only or unknown/incomplete classifications. Smaller changes are preserved in raw/derived orientation histories. No movement confirms care. Nurse review, prescribed task verification and linked documentation remain separate server commands. Do not use simulator browser classifications or risk/pressure scores as authoritative nursing conclusions.

## GET /api/integrations/simulation/v1/processed

Parameters: `encounterId`, `sourceId`, `after` (receipt sequence cursor, default 0), `limit` (1-500, default 100). Same integration header required.

Response includes encounter/patient/source identity, `timeDomain:SIMULATION`, `filterVersion`, `items`, `nextAfter`, and `hasMore`. Each item includes receipt ID, run/event IDs, source/receipt/processing timestamps, processing status, optional movement ID and classification/review status, and region orientation IDs/angles/quality with original axis values and source-time text. Field names inside SQL evidence projections use snake_case. Advance `after=nextAfter`; deduplicate stable IDs if retrying pages. Ordering uses a monotonic receipt sequence rather than timestamp-only offsets, so receipt-time ties remain accessible.

Existing `/api/patients/{id}/orientation`, `/sensor-history`, `/vitals` and `/api/monitoring/updates` remain available under their existing demo restrictions. Ordinary frontend deltas retain inclusive receipt-time boundaries and ID deduplication. The integration-specific endpoint is the bounded source-scoped option for the external display. Missing historical region evidence must remain unknown even if a candidate contains older last-known values.

## Errors and retries

- 400: malformed JSON/schema/identity syntax/timestamps/axes/batch limits.
- 401: missing/incorrect development integration key.
- 403: integration/demo disabled or source not bound to the encounter.
- 404: no assigned active synthetic encounter.
- 409: reused event ID with different content, evidence conflict or invalid workflow transition.
- 413: request exceeds the byte limit.
- 503 with Retry-After: database unavailable/busy; retry unchanged event IDs with bounded backoff.

Errors contain code, message, timestamp and correlationId. Never log secrets or substitute invalid values. Keep failed client batches for retry; do not invent a successful acknowledgment. A network timeout can occur after a committed batch, so retrying must use the same IDs.

## Example

From the repository root with the configured backend running and `SIMULATION_API_KEY` exported in the client process:

```sh
python backend/scripts/simulator_client.py --encounter encounter-synthetic-icu-01 --patient synthetic-icu-01 --source simulator-001
```

The standard-library client sends a baseline and turn candidate, verifies identity, repeats the exact request to prove deduplication, and retrieves processed receipts. It does not confirm care. A fresh run ID is generated for each invocation. This is a mock source contract test; the teammate's actual simulator has not been modified or verified.
