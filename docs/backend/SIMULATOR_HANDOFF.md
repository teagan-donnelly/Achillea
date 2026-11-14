# Simulator teammate handoff

## What to change in your simulator

Keep the existing synthetic generator. Send its raw paired IMU output to **the existing Achillea Spring Boot backend**. Do not connect the simulator to Tiger Data, and do not replace Spring Boot. Achillea owns all classifications used in nurse tasks; your browser may retain clearly labeled illustrative visualizations, but must not assert completed nursing care or validated pressure relief.

The backend and database pipeline are implemented. The actual simulator repository was not available and was not changed. Units, source binding and timing below are the proposed integration contract; confirm your generator uses them before wiring it in.

## Required information from the operator

- Achillea backend base URL, usually `http://127.0.0.1:8080` during local development.
- A private development integration key, supplied out of band as `X-Simulation-Key`.
- A source ID such as `simulator-001` that the operator has bound to your synthetic encounter.
- Encounter ID such as `encounter-synthetic-icu-01`; expected patient ID `synthetic-icu-01`.

These are example seeded identities, not a hardcoded single-patient implementation. Add other bound encounters/sources without replacing the ingestion API. No database password belongs in your application. The shared integration key is only a development gate, not enterprise authentication. A browser must use an approved same-origin development proxy; wildcard CORS is intentionally not enabled.

## Send this envelope

`POST /api/integrations/simulation/v1/observations`, JSON with `X-Simulation-Key`:

```json
{
  "schemaVersion": 1,
  "encounterId": "encounter-synthetic-icu-01",
  "sourceId": "simulator-001",
  "runId": "new-uuid-per-simulation-reset",
  "timeScale": 60,
  "samples": [
    {
      "eventId": "stable-000001",
      "t": 1731614400.123,
      "chest": {"ax":0.012,"ay":0.507,"az":0.861,"gx":0.31,"gy":-0.12,"gz":0.05},
      "pelvis": {"ax":-0.004,"ay":0.069,"az":0.996,"gx":0.22,"gy":-0.18,"gz":0.02}
    }
  ]
}
```

The existing `{t,chest,pelvis}` packet can stay intact. Add the envelope and a stable `eventId`. Alternatively supply an ISO UTC `timestamp` instead of `t`. Never supply both. Acceleration is in g; gyro is degrees/second. Missing regions are null/absent, not six zero values. Explicit `chestConnected:false` or `pelvisConnected:false` records a disconnection. All supplied region axes must be finite and present.

Use one run ID for a continuous simulation; change it when simulated time resets. Declare the fixed speed (1..600) in `timeScale`; do not change speed inside a run. Different patients, sources and runs have separate durable filter state. Do not interleave different runs of the same encounter/source in one live display. Preserve event IDs and request content when retrying; a new UUID on every retry defeats deduplication.

Batch up to 250 packets and 256 KiB by default. For a nominal 50 packets/sec source, a one-second batch is a sensible starting point, not a measured hosted capacity guarantee. Queue only a bounded number of unsent batches on your side, surface failures, and use backoff for 503/transport errors. The backend either commits the full accepted batch or returns an error; it does not silently downsample/drop raw evidence.

## Read acknowledgments and processed results

The acknowledgment reports `patientId`, `encounterId`, `sourceId`, `runId`, accepted/duplicate counts, and one result per event with stable receipt/orientation IDs and optional movement ID. Assert the patient identity matches your selected synthetic patient. Replay of the same event returns DUPLICATE; conflicting content for an existing ID returns 409. Missing source bindings return 403. A timeout may follow a committed request, so retry unchanged IDs.

Poll:

```http
GET /api/integrations/simulation/v1/processed?encounterId=encounter-synthetic-icu-01&sourceId=simulator-001&after=0&limit=100
X-Simulation-Key: <private-development-key>
```

Render returned orientation angles, quality and optional movement classification/review state. Rows expose original axes and source, receipt and processing timestamps. Evidence projections use snake_case; the response envelope uses camelCase. Pass returned `nextAfter` into the next request. Deduplicate IDs on retries. A monotonic receipt sequence preserves equal receipt-time records. Read pages until `hasMore` is false; an exact full final page may require one empty request.

Source observation time drives the illustrative filter. Actual server receipt time drives incremental delivery/transport freshness. A 600x source may be far ahead of wall clock: do not infer stale/fresh from that simulated epoch yourself. Out-of-order evidence remains stored with quality/status and cannot rewind live classification. Sparse/gapped source samples re-anchor accelerometer roll instead of pretending high-rate gyro evidence exists.

The backend uses a versioned educational roll filter (98% gyro prediction, 2% acceleration correction for usable dt). It is not a validated 3D attitude or pressure model. Source uncertainty stays visible. A turn candidate is not confirmed care. Do not call chart-confirmation or task-completion endpoints automatically.

## First end-to-end check

Have the backend operator provision/bind the source, then run the supplied mock client from Achillea with the key exported in that client process:

```sh
python backend/scripts/simulator_client.py --base-url http://127.0.0.1:8080 --encounter encounter-synthetic-icu-01 --patient synthetic-icu-01 --source simulator-001
```

It sends two synthetic packets, verifies acknowledgment identity, repeats the exact batch to verify duplicate handling, and reads processed data. Then adapt your sender to the same envelope. For raw protocol details, limits and all error statuses see `docs/backend/simulator-integration.md`.

## Boundaries still requiring teammate confirmation

Verify axis convention and units, whether `t` is simulated or wall-clock time, how speed/reset changes are signaled, whether effective sample spacing grows under acceleration, and what network proxy the browser uses. Do not treat browser-generated risk/pressure values as backend clinical truth. If your real contract differs, reconcile it explicitly instead of silently relabeling units or times.
