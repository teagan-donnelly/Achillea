# Frontend integration notes

No Java, DTOs, backend tests, H2 files, root configuration, or shared documentation were changed.

## Current API requirements

`GET /api/state` retains patients, tasks, vitals, movements, charts, and events arrays; `GET /api/rounds?unit=...` retains task/reason/rank. Existing mutation URLs and payloads are preserved. Three-second polling and immediate post-write refresh remain. Historical charts are derived from the current vitals array, not frontend-generated measurements. Enriching those existing arrays is enough to improve the UI after merging feature/clinical-data.

## Optional enhancements for the backend owner

- More historical observations with valid `observedAt`, `receivedAt`, quality, units, and source; ordered delivery is not required for vital charts.
- Additional timestamped events with stable IDs and assigned patient IDs. Unknown event types still render as workflow events. Existing chart/task/movement/vital prefixes receive contextual destinations and category filtering.
- More care tasks at different due times, with authoritative reason/rank. Empty time groups remain honest; no future task is fabricated.
- Explicit device connectivity/heartbeat and expected sampling interval would be needed before displaying a claim of current connected monitoring. Today the UI distinguishes API connection, observation freshness, and the latest simulated sensor report.
- If introducing a separate trend endpoint or nested trend field, publish the exact contract first. This frontend makes no speculative calls and ignores unrelated additive properties safely. Missing history remains unavailable.
- Publish orientation labels/uncertainty/region connectivity if added; current degrees remain source observations and never prove pressure relief or completed care.

Recommended common base for the backend work is `874f2ee05a50c9e8c0b9078ef3535625fd5ddc3c`. Backend and frontend branches must be merged deliberately by the repository owner; this branch does not merge main or teammate work.

## Existing limitations

One fixed demo nurse, no production authentication, file H2, aggregate polling, no physical sensor ingestion, no SSE/WebSocket, and synthetic data only. No Tiger Data, Typesense, Gemini, or clinical risk scoring integration was introduced. Public hosting would require deployment/API routing and access-control work outside frontend ownership. For true-phone access the current localhost-only development bind would need an explicitly approved network/proxy setup; no shared configuration was changed here.
