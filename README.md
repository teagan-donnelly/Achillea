# Achillea

Care that moves with you. Achillea combines assigned-patient monitoring, bedside documentation, sensor review, activity history, and explainable rounds in a mobile-first nurse workflow.

**Hackathon simulation — not for clinical use.** All patients, measurements, devices, and care records are synthetic. No physical hardware, hospital/EHR, production authentication, or AI provider is connected. Movement detection never automatically verifies care.

## PostgreSQL and Vercel integration

The Tiger integration preserves the combined V3 clinical workflows and replaces production H2 persistence with PostgreSQL relational tables and Flyway migrations. External simulator ingestion stores raw evidence, derived orientation/movement results, and idempotent receipts without automatically confirming care.

Deployment is prepared for the **existing** Vercel project at https://frontend-one-alpha-45.vercel.app using a frontend service and Java 21 container backend. It has **not** been deployed. See [exact dashboard settings, secrets, deployment controls and limitations](docs/VERCEL_TIGER_DEPLOYMENT.md). Do not deploy or change production settings until owner confirmation. The integration branch disables automatic Git deployment under both old and new project roots.

## Install and run

Requires Java 21, Maven 3.6.3+, Node 22.12+ or 24+, and PostgreSQL. The backend requires an explicit PostgreSQL JDBC URL; there is no runtime H2 fallback. Existing H2 files are not deleted or automatically imported. See [Tiger setup](docs/backend/tiger-data-setup.md) for migrations and optional legacy import.

Terminal 1, repository root (PowerShell):

```powershell
mvn -f backend/pom.xml -Dachillea.build.directory=target/tiger verify
$env:SPRING_DATASOURCE_URL='jdbc:postgresql://HOST:PORT/tsdb?sslmode=verify-full&sslfactory=org.postgresql.ssl.DefaultJavaSSLFactory'
$env:SPRING_DATASOURCE_USERNAME='YOUR_DATABASE_USER'
.\backend\scripts\Start-Tiger.ps1 -Port 18084
```

The script prompts securely for the database password. For an approved empty disposable database only, add `-SeedIfEmpty`; ordinary startup preserves records and does not seed or reset. Database credentials remain server-side. Environment examples are documentation, not automatically loaded dotenv files.

Terminal 2, repository root:

```powershell
Set-Location frontend
npm.cmd ci
$env:API_PROXY_TARGET='http://127.0.0.1:18084'
npm.cmd run dev -- --port 15174 --strictPort
```

Open http://127.0.0.1:15174/; health is http://127.0.0.1:18084/api/health. Stop with Ctrl+C. On macOS/Linux use `npm` and export the corresponding environment variables before starting the packaged JAR. The default local API is unprotected and binds loopback; the Vercel profile requires secure demo sessions and TLS PostgreSQL. Never expose the unprotected local configuration publicly.

## Configuration

See [backend environment example](backend/.env.example) and the [Vercel variable table](docs/VERCEL_TIGER_DEPLOYMENT.md#backend-environment-variables). Defaults: schema `achillea`, pool max 5/min 1, demo mode enabled, seeding/reset/scheduler/simulator ingestion disabled. The Vercel profile uses pool max 3/min 0 and enforces reset/import/scheduler restrictions. `API_PROXY_TARGET` controls only Vite's development proxy; deployed browser calls use same-origin `/api`. Restart Vite after changing it.

## Demo

Fresh data contains **10 L&D and 7 ICU census patients**, with **three assigned to the demo nurse in each unit**, 51 scheduled/historical tasks overall, and timestamped synthetic histories. Ordinary nurse views show only assigned records. The explicitly labeled demo census API is separate.

1. Open Activity: view backend events and attention items. Open Patients to compare Maya Rowan, Elena Vale, and Iris Fern, their readings, source availability, and historical trends.
2. Open Maya, receive a simulated monitor reading, or use an externally configured simulator. Select Document care, enter an observation, optionally link measurements, Save draft, review and check verification, then Confirm entry. Append amendment preserves the original.
3. Switch Demo unit to ICU and open Alex Linden. In Demo controls, compare Chest-only movement with Coordinated turn candidate. Neither completes care.
4. Review candidate, enter a bedside verification note, verify and confirm the care observation. Explicitly Complete the prescribed task using that confirmed movement and nurse verification.
5. Use disconnect/reconnect controls to show unknown sensor data and unavailable monitor readings. Return to Rounds to see backend Now/Next/Later groups, priority reasons, acknowledgments, deferrals, and completed care. Activity shows the saved audit history.

V3 recording guidance and all five presets: [integration runbook](docs/INTEGRATION_V3.md). Original V2 guidance: [demo script](docs/DEMO_SCRIPT.md). No video is generated/uploaded automatically. This is a software simulation, not a claim of validated pressure relief, treatment recommendations, injury prevention, or clinical deployment readiness.

## Checks

```sh
mvn -f backend/pom.xml verify
cd frontend
npm test
npm run typecheck
npm run lint
npm run build
npm audit
```

The default frontend test command runs isolated unit/component tests. Real-server integration tests skip unless explicitly configured against a disposable database. For an isolated PostgreSQL-backed HTTP test server, first build with Maven, then run the test helper below. Do not run these tests against saved data. No browser verification is implied by jsdom tests. Production builds emit frontend/dist and the backend JAR. Deployment routing is defined in repository-root vercel.json.

Disposable real-HTTP checks (PowerShell, repository root; native embedded PostgreSQL is test-only):

```powershell
mvn -f backend/pom.xml -DincludeScope=test dependency:build-classpath -Dmdep.outputFile=target/test-classpath.txt
$cp='backend/target/test-classes;backend/target/classes;'+(Get-Content backend/target/test-classpath.txt -Raw).Trim()
java -cp $cp care.achillea.LocalIntegrationServer
```

This helper uses port 18089, a fresh PostgreSQL schema, enables reset only there, and exits after ten minutes. Ensure `backend/target/local-http.stop` does not exist before launch. In another terminal start Vite on 15175 with proxy target 18089. Then:

```powershell
Set-Location frontend
$env:ACHILLEA_INTEGRATION_URL='http://127.0.0.1:15175'
$env:ACHILLEA_ALLOW_DEMO_RESET='disposable-test-database'
npm.cmd test
```

## Repository guide and limitations

- `backend/`: clinical models, seeded assignments/census, monitor scheduler, sensor adapter, command validation, PostgreSQL relational persistence, Flyway migrations, simulator ingestion and backend tests.
- `frontend/`: mobile navigation, activity, patient monitoring/history, bedside charting, rounds, and UI/integration tests.
- `docs/backend/`: actual API additions, simulation semantics, and backend verification evidence.
- `docs/frontend/`: redesign notes and interaction guidance.
- `docs/INTEGRATION.md`: merge sources, compatibility fixes, current evidence and known gaps.

The fixed demo nurse and shared deployed demo password are not hospital identity or production clinical authorization. PostgreSQL provides durable shared state; the HTTP deployment uses external simulator ingestion rather than assuming a continuously running scheduler. History retention is bounded; saved chart provenance is preserved. Clinical/hardware validation, hospital approvals, secure access, patient matching, privacy review, mobile management, and approved EHR integration remain future work. See [safety and limitations](docs/SAFETY_AND_LIMITATIONS.md).
