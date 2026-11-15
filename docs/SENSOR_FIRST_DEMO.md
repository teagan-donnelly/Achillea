# Sensor-first Achillea

All records and phone-app telemetry are synthetic. Physical sensors are a separate prototype; this branch contains no verified hardware-to-phone integration.

## Isolated startup (PowerShell)

Use the `feature/sensor-first-achillea` worktree, not either running demo directory. Java 21, Maven and Node are required. No Tiger Data, PostgreSQL or hosted services are used.

Terminal 1, from the worktree:

```powershell
cd backend
mvn test package
cd ..
New-Item -ItemType Directory -Force .demo-runtime | Out-Null
java -jar backend/target/achillea-0.1.0.jar --server.port=18384 --spring.datasource.url=jdbc:h2:file:./.demo-runtime/sensor-first-preview --app.monitor.enabled=true
```

Terminal 2, from the worktree:

```powershell
cd frontend
npm ci
$env:API_PROXY_TARGET='http://127.0.0.1:18384'
npm run dev -- --port 15474 --strictPort
```

Open http://127.0.0.1:15474/. Both processes must remain running. The existing frontends on 15274/15374, backends on 18184/18284, databases and two tunnels are independent and unchanged. This new preview has no public tunnel.

The completed preview uses `.demo-runtime/sensor-first-preview` with simulation enabled. The verification run used `.demo-runtime/sensor-first-verification` with its scheduler disabled; manual demo events and monitor-tick still work there. Never reuse a database currently opened by another JVM. To replay from scratch, stop only this new JVM and choose a new database filename. Never reset an existing presentation database without checking its saved records. On Windows, stop only this preview JVM before rebuilding its JAR to avoid a packaging file lock.

## Two-minute judge walkthrough

1. Open Demo controls, choose **Stage repositioning demo**, and accept the explicit synthetic-schedule staging prompt. ICU opens automatically. A fresh database has one overdue patient, one due in 15 minutes and one later deadline. Staging preserves previous confirmed care and charts, so repeat demonstrations should use a fresh disposable database if identical initial counts matter.
2. Home shows actual individualized deadlines and separate evidence exceptions. Open the overdue patient. The forest patient header and **Repositioning** section show chest/pelvis placement, recorded roll values, signal times and the initial scheduled deadline. These are simulated readings, not physical hardware telemetry or validated anatomical orientation.
3. In Demo controls choose **Coordinated turn candidate**. No care is completed and the care deadline does not advance. Reviewable sensor evidence/tasks appear. Open **Review & document turn** to compare timestamped discrete chest/pelvic events and uncertainty labels.
4. Select the new movement. Enter a bedside observation, explicitly check the verification statement and choose **Confirm & document**. The server atomically persists nurse-confirmed care, a confirmed chart, audit events, the next deadline and the corresponding task transitions. Home moves the patient out of the overdue queue after the server responds.
5. Open Rounds to show the next turn deadline alongside other retained clinical priorities. Open Activity history and patient Chart/History to show the immutable documentation. Append an amendment through the existing Chart workflow. Sensors shows unit-wide status and real filters. Demonstrate **Disconnect pelvis sensor** to show an unknown evidence state; disconnection never proves no care occurred.

The five existing guided presets remain in Demo controls. They retain their original explicit review/task workflows. This new staging action reuses the existing simulator and task aggregate and never automatically confirms care.

## Domain and compatibility

Each persisted plan has patient ID, configured interval, warning window, initial deadline, and last nurse-confirmed care when available. The synthetic intervals differ (90/120/180 minutes); none is a universal medical recommendation. Before any confirmation, use the explicit initial deadline, not an invented historical care event. Thereafter `nextDueAt = lastConfirmedCareAt + interval`. Strictly after the deadline is overdue; at the deadline or within the preceding warning window is due soon; earlier is on track. Missing plans/deadlines are unknown. Durations use a controllable backend Clock and a client clock anchored to server time; client timers clean up on unmount.

Connection/freshness, incomplete evidence, regional discrepancies and pending nurse reviews are distinct from schedule status. Both chest and pelvic devices must report fresh timestamps to count a patient as on track in the Home/Sensors summaries. An overdue deadline still appears overdue with unavailable evidence, accompanied by an explicit uncertainty label. Roll angles are actual synthetic observations; the app does not infer supine/left/right from incomplete readings or draw fabricated waveforms.

The additive API field `repositioningPlans` is persisted in the H2 `repositioning_plans` table after integration with main's relational store. Plan rows use the patient ID as their stable key and participate in the same transaction as charts, tasks and events. Legacy JSON imports preserve plan deadlines, confirmation IDs and care timestamps; the original STORE payload is left unchanged. When importing an existing H2 file, retain its original database username/password explicitly through Spring datasource configuration. Verify on a copy before using any saved presentation data. Additive APIs:

- `GET /api/repositioning?unit=ICU` returns clock-derived statuses sorted by deadline then patient ID.
- `POST /api/patients/{id}/repositioning/confirm` requires `movementId`, `text` and `verified:true`. It rejects other-patient/previously confirmed evidence, evidence older than the last confirmation, missing plans and invalid observations. A failed response does not advance the UI schedule.
- `POST /api/demo/repositioning` explicitly stages synthetic schedules, reuses simulator heartbeats and applies existing task rules, preserving confirmed records.

Old endpoints and deep links remain. `/activity` is the original activity view. Primary navigation is Home / Patients / Sensors / Rounds, with touch swipe and keyboard shortcuts. New queue links use `?section=repositioning`; old chart/tasks/vitals/sensors links still work. Original movement reviews remain available; the legacy task-completion workflow advances the plan when prescribed repositioning is actually documented. New combined confirmation creates the next turn task using existing rounds semantics; it does not change the rounds ranking engine or unrelated clinical priorities. Home's deadline queue is a separate scheduled-care view, not a medical urgency score.

## Verification

```powershell
cd backend
mvn test package
cd ../frontend
npm test
npm run typecheck
npm run lint
npm run build
npm audit
```

Run all real HTTP/React-jsdom integration tests only against the new explicitly disposable database (these reset it):

```powershell
$env:ACHILLEA_INTEGRATION_URL='http://127.0.0.1:15474'
$env:ACHILLEA_ALLOW_DEMO_RESET='disposable-test-database'
npm test
Remove-Item Env:ACHILLEA_INTEGRATION_URL
Remove-Item Env:ACHILLEA_ALLOW_DEMO_RESET
```

From worktree root, on a fresh disposable instance:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ./scripts/Verify-SensorFirst.ps1 -DisposableDatabase
```

The script explicitly confirms synthetic care as a test action and prints a persisted chart ID. Stop and restart only the 18384 JVM with the same disposable database URL; `GET /api/patients/{id}/chart` must still contain that ID and `/api/repositioning?unit=ICU` its next deadline. Manual HTTP tests and React/jsdom tests are not browser verification. Automated browser use remains prohibited: image fidelity, actual iPhone rendering and the full viewport matrix remain unverified. Existing responsive tokens, 768/1024 breakpoints, safe-area navigation and focus/reduced-motion styles are preserved and extended.

## Safe integration

Recorded verification for this branch: 48 backend tests passed; 67 frontend tests passed including all nine real-HTTP React/jsdom integration cases and six new sensor-first interaction/domain cases. TypeScript, ESLint, production build and npm audit passed (zero reported vulnerabilities). Direct API verification passed for simulated movement without schedule advancement, explicit confirmation, persisted chart/audit, next deadline and duplicate rejection. The confirmed chart and plan survived an actual restart of only backend 18384. Both existing public tunnel health endpoints returned HTTP 200 afterward. The mechanical design detector returned no findings. The independent visual finishing review returned `recapture` because real mobile/desktop captures are absent; visual fidelity and the viewport matrix remain unverified and no browser restriction was bypassed.

Integration with `origin/main` commit `47307d7`: no Git conflicts. The storage compatibility fix adds relational plan persistence and tests for care/deadline persistence across a full application restart and migration from legacy JSON. The combined backend suite passed 57 tests, followed by a passing three-case persistence suite including the added legacy migration test (58 distinct backend tests). All 67 frontend tests passed against a separate merged backend on 18484 through a temporary Vite proxy on 15574. Lint and the TypeScript production build passed. Existing running previews and all their databases were not restarted or migrated during this merge; they continue using their previously built backend JARs. Temporary integration servers are stopped after verification. Rebuild/restart the sensor-first preview only when ready to run the combined backend.

Review this branch against `feature/final-mobile-ui` first. Back up any target H2 file with its JVM stopped. Validate the additive state on a copied disposable database, then merge only into an integration branch and repeat tests. Do not merge into or restart either active demo until explicitly authorized. Keep both existing feature/demo branches and tunnels intact. Do not connect real patient data. A future hardware adapter must ingest timestamped sensor ID, patient ID, body region, roll angle, captured/received times, quality and connection state; authentication, validation and hardware behavior require separate integration testing before any hardware claim.
