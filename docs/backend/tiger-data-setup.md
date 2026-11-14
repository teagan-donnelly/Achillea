# Tiger Data / PostgreSQL migration

## Status and scope

The existing Spring Boot application now uses PostgreSQL JDBC and Flyway; H2 is not a runtime dependency. `Store.payload` is removed from production. API model classes remain view/command DTOs, not persistence blobs. `RelationalStore` maps typed columns and evidence link tables through JDBC. JSON is used only for API serialization and in-memory change comparisons, not database record storage. Typesense is deliberately absent.

The original tracked project baseline is main `31d30da`; work is on `feature/tiger-simulation`. The preexisting untracked brainstorming document is preserved and is not part of this implementation. Existing H2 files were not opened, altered or reset. Existing user servers were not stopped.

## Configure and start

Requires Java 21 and Maven. Export variables in the backend process; Spring does not automatically load `backend/.env.example`. Standard `SPRING_DATASOURCE_URL`, `SPRING_DATASOURCE_USERNAME`, and `SPRING_DATASOURCE_PASSWORD` are supported. `DATABASE_URL` remains an explicit JDBC URL alias only; no H2 fallback exists. Missing/non-PostgreSQL URL fails with an actionable startup error.

Example PowerShell (replace placeholders, do not commit secrets):

```powershell
$env:SPRING_DATASOURCE_URL='jdbc:postgresql://HOST:PORT/tsdb?sslmode=verify-full&sslfactory=org.postgresql.ssl.DefaultJavaSSLFactory'
$env:SPRING_DATASOURCE_USERNAME='YOUR_ROLE'
$secret=Read-Host 'Database password' -AsSecureString
$secretPtr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
try {$env:SPRING_DATASOURCE_PASSWORD=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($secretPtr)} finally {[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($secretPtr)}
$env:APP_SEED_SYNTHETIC_DATA='true'  # inserts only if the target has no patients
$env:APP_ALLOW_DEMO_RESET='false'
$env:MONITOR_SIMULATION_ENABLED='false'
mvn -f backend/pom.xml '-Dachillea.build.directory=target/tiger' verify
Set-Location backend
java -jar target/tiger/achillea-0.1.0.jar
```

The default schema is `achillea`, configurable through `DB_SCHEMA`; Flyway creates it and the runtime connection selects it. Runtime and migration roles need access to that schema. Default Hikari limits are max 5/min idle 1, acquisition timeout 10 seconds; `DB_POOL_MAX`, `DB_POOL_MIN`, and `DB_CONNECTION_TIMEOUT_MS` override them. TLS defaults to `verify-full`; Java's default trust store can be selected with the JDBC `DefaultJavaSSLFactory` above. If the service requires a private CA, configure its actual trust root; do not disable verification to hide certificate errors. Local native-PostgreSQL tests explicitly disable TLS only for their disposable loopback databases.

A single privileged development account is supported. For separate roles, use standard `SPRING_FLYWAY_URL`, `SPRING_FLYWAY_USER`, `SPRING_FLYWAY_PASSWORD`; grant runtime schema USAGE, required table DML, sequence USAGE, and function execution as appropriate. Grant TRUNCATE only to a disposable demo role if reset is intentionally enabled. Flyway clean is disabled. Hibernate schema mutation is disabled.

`GET /api/health` queries the database and identifies PostgreSQL. `/actuator/health/readiness` includes database readiness. Neither is a replacement for deployment authentication. Both servers remain loopback-bound by default. No CORS wildcard was introduced.

## Schema and transactions

V1 creates departments, nurses, patients, encounters, care_assignments, devices/device_assignments, care_tasks/task_transitions, vital_observations, orientation_samples, movement_candidates/sample links/reason codes/reviews/consumptions, chart_entries/evidence links, activity_events, and demo_metadata. V2 adds source bindings, simulation streams, ingestion receipts, and raw IMU samples. Fields use typed columns, timestamps and FKs; no aggregate JSON/CLOB table is created.

One active encounter per patient is supported. Seed IDs map to `encounter-{patientId}`. Existing DTO patient IDs remain unchanged. Routine task/chart/ingestion commands acquire the active encounter's database row lock, so concurrent backend processes cannot bypass evidence checks. A unique movement-consumption record is a second database-level barrier against double use. Confirmed-chart update/delete protection and same-encounter evidence constraints are enforced in PostgreSQL. Linked changes commit together. SQL integrity conflicts become structured HTTP 409 responses.

The ordinary PostgreSQL tables deliberately preserve globally unique evidence IDs and exact FKs. No Timescale extension or hypertable-specific feature is assumed. Converting high-volume tables later requires a reviewed partition/unique-key/reference design; a plain URL switch or `create_hypertable` on today's global-ID PKs is not sufficient. No retention/downsampling job deletes raw evidence.

`RelationalStore` emits only inserts/changed-record updates, not full snapshot rewrites. Patient commands materialize the relevant patient scope; source IMU batches use direct bounded SQL with one metadata scope per batch. Workspace reads exclude history, delta reads filter by receipt time in SQL, and vital history applies metric/time/limit in SQL. The legacy `/state` response still intentionally materializes the assigned compatibility snapshot. Demo presets/reset/internal ticks can touch the full synthetic dataset. Activity summaries are currently computed in Java from unit-scoped rows. Initial historical snapshots and long-lived compatibility responses can still be large; these are not production-scale claims.

## Initialization versus import versus reset

- **Fresh schema:** Flyway creates tables without clinical records. `APP_SEED_SYNTHETIC_DATA=true` initializes the preserved synthetic scenarios only when no patients exist. Advisory locking prevents two startup seeders racing. Ordinary restart never overwrites populated records.
- **Existing H2 data:** no automatic destructive conversion occurs. Stop the old H2 server, copy its files as a backup, then run the standalone read-only exporter with an H2 driver available separately: `java -cp PATH_TO_H2_JAR backend/scripts/ExportLegacyH2.java ABSOLUTE_DB_BASE NEW_OUTPUT_JSON`. The base omits `.mv.db`. Supply `LEGACY_IMPORT_FILE` to the new backend only when importing into an empty PostgreSQL schema. Import rejects existing target patients and invalid/dangling evidence; it does not silently invent missing observations. This optional H2 exporter is not linked into the application runtime.
- **Explicit reset:** requires both demo mode and `APP_ALLOW_DEMO_RESET=true`. It deliberately clears the selected synthetic dataset and raw streams/receipts, then recreates demo records. Source bindings to still-existing encounters are retained. Default reset is disabled, including on Tiger Cloud. Do not enable it on a database that contains records you intend to keep.

Tests have a test-only legacy JSON fixture adapter to exercise the previous legacy-state cases; it is not packaged in the application. A formerly dangling-evidence fixture was made relationally consistent rather than weakening production FKs. PostgreSQL timestamps normalize to microsecond resolution; monitor replay checks normalize input accordingly. Raw IMU rows additionally preserve the accepted source timestamp text.

## Verification

The original 44-test H2 baseline was run before the migration. The same workflow behaviors are now exercised on native embedded PostgreSQL, not H2. Twelve additional tests cover schema/FKs, raw and processed timestamps, duplicates/conflict rollback, patient/run isolation, missing/out-of-order samples, malformed inputs/batch limits, credential/body guards/readiness, concurrent movement consumption, tied timestamps, disconnects, injected write failures and concurrent replay. All 56 backend tests passed. Final test/package and hosted verification evidence is recorded in [the implementation report](tiger-migration-report.md).

A real Tiger Cloud PostgreSQL 18 connection was verified using certificate/hostname verification and encrypted TLS. V1 and V2 were applied to the new dedicated `achillea` schema after read-only inspection found no application tables. No reset was performed. The Boot-managed Flyway version emitted a PostgreSQL-18 newer-than-tested warning (its advertised tested version is 17); it successfully applied both migrations. This compatibility warning is recorded rather than hidden. No Timescale-specific feature was tested or claimed.

## Limits

Synthetic data only, fixed demo nurse, no EHR, hospital authentication or physical-device validation. Core routines remain an incremental migration of existing rules, not a claim of limitless concurrency. One active encounter per patient and the existing frontend compatibility model remain. Raw IMU processing is an explicitly versioned illustrative roll heuristic; external browser algorithms are not accepted as authoritative care decisions. Hosted load capacity, hardware accuracy, browser rendering and a teammate's actual simulator are not established by local regression or mock-client tests.
