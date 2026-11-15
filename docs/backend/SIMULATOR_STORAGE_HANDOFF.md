# External simulator: direct Tiger writer handoff

This supersedes `SIMULATOR_HANDOFF.md` for the `feature/vercel-tiger` application only. The preserved Spring branch still has its former HTTP ingestion contract; the Vercel application deliberately does not.

Your simulator independently validates, processes and writes synthetic observations into the **existing** Tiger schema. Achillea reads the persisted results through its Vercel API. No external simulator repository was modified, and a direct-writer implementation has not been tested here.

Preserve all existing tables, columns, constraints, indexes, global IDs, encounter relationships and migration history. No schema change is required by Achillea's TypeScript reader. Do not create a replacement schema, reset tables, overwrite old evidence or modify nursing work.

## Existing relational contract

- Resolve the existing `patients` and active synthetic `encounters`. Achillea shows a patient only if `patients.nurse_id='nurse-demo'` and a matching `care_assignments` row exists. Patient and encounter identity are distinct. Do not hardcode a single patient in the writer.
- Use the existing assigned `devices`/`device_assignments` and valid region identities. Nurse task/chart commands lock the active `encounters` row; a writer that updates shared movement/device records should use the same encounter lock order for cooperation.
- Store scalar vital readings in `vital_observations`, with immutable ID, source/event identity, metric/unit, quality, original observation time and actual receipt time. The unique monitor-event identity is global for non-null `source_event_id`; scope your IDs appropriately.
- Store region observations in `orientation_samples`; `movement_candidates` reference their exact IDs through ordered `movement_sample_links`. Persist classification, quality, review requirement and ordered `movement_reason_codes` yourself. Achillea does not recalculate these. Preserve an existing movement's nurse review fields; never upsert them back to UNREVIEWED.
- If using the existing raw pipeline tables, maintain `simulation_sources`, per-source/encounter/run `simulation_streams`, unique `ingestion_receipts`, and two-region `raw_imu_samples` relationships transactionally. Their FKs and identities remain unchanged; do not bypass constraints or invent replacements.
- Preserve raw source time independently of receipt/processing time. For accelerated streams, use `devices.time_domain='SIMULATION'` with actual transport `last_seen_at`; Achillea uses that receipt clock for freshness, while displaying original source/capture times. Missing/disconnected regions stay unknown, not numeric zero evidence.
- Incremental UI delivery filters `vital_observations.received_at`, `orientation_samples.received_at` and `activity_events.occurred_at` inclusively, deduplicating stable IDs. Do not backdate new receipt/audit timestamps behind already delivered cursors. Keep transactions short; commit related evidence together. A high-volume writer needs its own measured batching/backpressure policy.
- Device connectivity, roll/position classification and simulation-generated activity are writer-owned. Nurse-authored tasks, charts, confirmations, amendments, review history and movement consumption are Achillea-owned. A turn candidate must not become confirmed care or completed nursing work automatically.

Consult the unchanged V1/V2 migrations under `backend/src/main/resources/db/migration/` for exact column names and FKs. The direct writer needs its own private least-privilege database credentials; do not put the application's session secret or database password in browser-delivered JavaScript. A browser-only simulator needs a private server-side writer within its own architecture. Achillea does not provide that writer.

## Integration check before sharing a demo

Use a separately approved synthetic patient/encounter and private credentials. Verify a new persisted observation appears through `/api/patients/{id}/vitals`, new region evidence appears in `/orientation` and `/sensor-history`, and source/receipt times and disconnected states remain distinct. Confirm repeated source IDs do not duplicate evidence. Verify the UI refreshes incrementally without a reset. Review and complete care only through explicit nurse actions in Achillea.

The schema and existing records were not changed by this migration. Final axis conventions, classifier version, pressure/risk visualizations, writer roles, batching and retry behavior require coordination with the external simulator team. These are educational synthetic values, not validated clinical assessments.
