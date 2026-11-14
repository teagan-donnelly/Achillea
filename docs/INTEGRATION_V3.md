# Achillea V3 integration

`integration/achillea-v3` combines backend `e880f0244ae0d956b461094a817b22ebe61da7e2` and frontend `80d569c87f79c5f02dccebd15d13b18ee9c96788`, both based on V2 `af2d7d4b7b8c5de2d1a20932e37450b31833e74b`. Both branches merged without conflicts. Integration fixes belong only to this branch; main, integration/achillea-v2, and both feature branches remain untouched.

## Exact Windows startup

Requires Java 21, Maven 3.6.3+, and Node 22.12+ or 24+. First installation needs Maven Central/npm access. No AI keys, hospital systems, or physical devices are required.

Terminal 1, from repository root:

```powershell
git switch integration/achillea-v3
$env:JAVA_HOME = 'C:\Program Files\Eclipse Adoptium\jdk-21.0.8.9-hotspot'
$maven = 'C:\Users\teaga\.m2\wrapper\dists\apache-maven-3.6.3-bin\1iopthnavndlasol9gbrbg6bf2\apache-maven-3.6.3\bin\mvn.cmd'
& $maven '-Dmaven.repo.local=C:\Users\teaga\.m2\repository' '-Dachillea.build.directory=target/v3-integration' -f backend/pom.xml verify
Set-Location backend
& "$env:JAVA_HOME\bin\java.exe" -jar target/v3-integration/achillea-0.1.0.jar --server.port=18084 --spring.datasource.url=jdbc:h2:file:./data/achillea-v3-demo
```

If Maven is on PATH, `mvn -f backend/pom.xml -Dachillea.build.directory=target/v3-integration verify` is equivalent. The separate build output avoids the Windows file lock on an older running JAR. Stop the V3 server before rebuilding its own JAR, or choose another build directory; do not stop unrelated servers.

Terminal 2, from repository root:

```powershell
Set-Location frontend
npm.cmd ci
$env:API_PROXY_TARGET = 'http://127.0.0.1:18084'
npm.cmd run dev -- --port 15174 --strictPort
```

Open **http://127.0.0.1:15174/**. Health: http://127.0.0.1:18084/api/health. The frontend's same-origin `/api` requests proxy to 18084. Both bind loopback. StrictPort prevents silently opening a different frontend. A phone on another device cannot reach this loopback-only setup. Stop a server with Ctrl+C in its terminal.

The verification session leaves these same ports running with a **disposable in-memory** database and automatic monitoring enabled, instead of opening the file database above. If the application is already available, open the link directly. That temporary state disappears when its backend stops. The startup command above selects a separate persistent V3 database for subsequent use.

## Configuration and safe initialization

Backend environment variables remain DATABASE_URL, APP_DEMO_MODE, MONITOR_SIMULATION_ENABLED, MONITOR_CADENCE_MS and MONITOR_INITIAL_DELAY_MS. Defaults: file H2 at ./data/achillea, demo enabled, scheduler enabled, cadence/start delay 15000 ms. Export variables in the launching shell; there is no dotenv loader. CLI flags above override defaults. Vite reads API_PROXY_TARGET when it starts; restart Vite if the target changes.

Always launch the backend from backend so a relative database path resolves consistently. `./data/achillea-v3-demo` separates V3 from existing demo files. An absent database automatically seeds 10 L&D/7 ICU census patients, with three assigned patients per unit; ordinary nurse APIs show only assigned records. Existing database contents are preserved on restart and are never automatically reseeded. Back up a persistent H2 database while its server is stopped before any deliberate destructive reset.

For verification and controlled recordings use this **alternative** backend command, replacing the startup command above:

```powershell
Set-Location backend
& 'C:\Program Files\Eclipse Adoptium\jdk-21.0.8.9-hotspot\bin\java.exe' -jar target/v3-integration/achillea-0.1.0.jar --server.port=18084 --spring.datasource.url=jdbc:h2:mem:achillea-v3-integration --app.monitor.enabled=false
```

Do not run both alternatives on the same port. Use the existing Reset synthetic demo control only when you intend to discard that selected database's charts, drafts, tasks and history. The control asks for confirmation. Presets **never** reset records. Live tests reset only the explicitly selected disposable backend. Do not point live tests at a saved demo database.

## What is connected

- Activity consumes `/api/activity/summary?unit=...` directly. Backend counts are not grouped again. Source disclosures link actual measurement/event IDs and values; Show original event history switches to the retained raw timeline. Filters preserve task, sensor, device and documentation events.
- Polling runs every three seconds. `/api/workspace?unit=...` supplies lightweight assigned workflow metadata; `/api/monitoring/updates?unit=...&since=...` supplies receipt-time deltas. Inclusive ties deduplicate by ID. Histories are sorted by source time, devices use current backend metadata, and summaries replace prior snapshots. Explicit reset or changed demoStartedAt clears evidence caches. Unit changes clear state and use a generation guard, including L&D→ICU→L&D races, so older responses cannot replace the new unit.
- The new workspace endpoint is additive: it returns the existing State shape scoped to the selected unit, with vitals/samples/events empty because those travel through the delta endpoint. Patient/task/chart/movement/device metadata and reset/server timestamps remain. Unsupported/missing unit returns 400; disabled demo returns 403. Existing `/state` remains unchanged.
- ICU sensor views fetch patient `/sensor-history` and expose actual torso/pelvis samples, source/receipt times, quality, connectivity gaps, review codes and linked charts. All movement reviews remain accessible. A confirmed movement review and a documented care completion have separate timestamps; missing region samples are not fabricated as orientation zero. Existing review and task-completion forms remain explicit.
- Rounds uses backend ordering, explanations and reasonCodes. Schedule a synthetic review posts `/api/demo/tasks` with assigned patient, title, UTC-converted local due time and explicit workflow priority. Task mutations refresh Rounds and Activity together.
- Demo studio fetches `/api/demo/presets`, starts the selected preset, and follows its exact returned steps. Read steps display actual inspected evidence. Nurse text/reason fields require input; verification steps require an explicit checkbox and button. Draft/amendment IDs bind into subsequent requests. Selecting a preset does not execute its nurse steps. Closing/reopening the panel retains the current guide; unit switch/reset clears it. Reloading the page loses the in-memory guide but preserves backend records. Do not blindly restart an interrupted preset: POST setup appends new evidence/tasks.

No dependencies were upgraded. New styles extend the existing mobile visual system and provide wrapping and scrollable evidence tables. Original branch documentation is preserved in docs/backend and docs/frontend.

## Five presets and two-minute recording

Open Demo controls (desktop sidebar or mobile flask control). All controls are labeled educational simulation tools. The first assigned patient in the selected unit is the target; Patient repositioning requires ICU. Press each preset **once**. The guide shows the backend's ordered steps; Run this step performs only that displayed step. Read-step results appear under Inspected evidence. Open bedside workspace lets you inspect the full patient record without losing the guide; reopen Demo controls to continue.

1. **Routine shift — 20 seconds:** Select Labor & delivery, start Routine shift. Run the three read steps to show assigned patients, grouped observations and Now/Next/Later rounds. Open the bedside workspace to view real recorded trends. No clinical stability interpretation is generated.
2. **Device event — 20 seconds:** Start Device event. Its setup records observations then disconnects the monitor. Run metadata inspection, simulate delayed connection, receive delayed evidence, inspect its timestamps/freshness, then reconnect. A technical review remains for explicit nurse action; reconnection never proves care.
3. **Patient repositioning — 35 seconds:** Switch to ICU, open Demo controls and start Patient repositioning. Inspect independent region evidence. For review, enter a synthetic bedside observation, check explicit verification, and Run this step. For the separate care-completion step, enter a completion note and explicitly verify again. Inspect linked documentation. Open bedside workspace → Sensors to show history, review state and separately documented care completion. Movement never completes care automatically.
4. **Bedside documentation — 30 seconds:** Switch to Labor & delivery and start Bedside documentation. Enter your own synthetic note and create the draft. Explicitly check and confirm it on the next step. Enter an addendum to create the amendment, then explicitly confirm that amendment. The original note stays immutable; inspect Activity/Chart to show both.
5. **Adaptive rounds — 15 seconds:** Start Adaptive rounds. Inspect the changed sequence, acknowledge the newly due task, then enter a reason to defer it. Inspect again, or close the panel and open Rounds. Reason disclosures show schedule/priority/technical codes, never medical urgency scores.

The 120-second allocation is narration guidance, not a timer dependency or a validated timed usability result. Disable the scheduler for repeatable recordings; use New monitor reading or preset steps to advance evidence deliberately. For a continuous feed use the normal backend startup (scheduler enabled). A complete fresh recording can be prepared by resetting **only the disposable database** explicitly; saved persistent data needs no reset to run presets.

Backend-only scripted alternative: see backend/scripts/Invoke-ClinicalDemo.ps1 and docs/backend/v3-demo-runbook.md. `-ExecuteSteps` explicitly opts into scripted synthetic nurse actions. The frontend itself never silently runs the sequence.

## Verification

Start the disposable backend and Vite proxy above, then in a third PowerShell terminal at repository root:

```powershell
$env:JAVA_HOME = 'C:\Program Files\Eclipse Adoptium\jdk-21.0.8.9-hotspot'
$maven = 'C:\Users\teaga\.m2\wrapper\dists\apache-maven-3.6.3-bin\1iopthnavndlasol9gbrbg6bf2\apache-maven-3.6.3\bin\mvn.cmd'
# A separate output lets the already-running integration JAR remain open.
& $maven '-Dmaven.repo.local=C:\Users\teaga\.m2\repository' '-Dachillea.build.directory=target/v3-check' -f backend/pom.xml verify
Set-Location frontend
$env:ACHILLEA_INTEGRATION_URL = 'http://127.0.0.1:15174'
$env:ACHILLEA_ALLOW_DEMO_RESET = 'disposable-test-database'
npm.cmd test
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run build
npm.cmd audit
Remove-Item Env:ACHILLEA_INTEGRATION_URL
Remove-Item Env:ACHILLEA_ALLOW_DEMO_RESET
```

Without the two ACHILLEA variables, the live suite skips and only isolated component/unit tests run. Live tests use real HTTP through Vite plus React/jsdom, not browser automation. Loopback and the exact disposable opt-in token are required before they reset data.

Verified on 2026-11-14: Maven verify/JAR packaging **44 tests passed**, including file-backed restart persistence and legacy compatibility; full frontend suite **47 passed, zero skipped** (38 component/unit tests plus nine live tests); TypeScript, ESLint, production build passed; npm audit reported zero vulnerabilities. Live cases cover expanded assignments, both unit directions, summary/raw history, mounted-view incremental updates, missing/stale/disconnected data, sensor history/review and separate completion, chart draft/confirmation/amendment, task actions, explicit review scheduling/reason codes and all five preset guides. Unit tests additionally cover equal-time deduplication, reset cache invalidation, and delayed-response unit races. Mechanical design detector reported no findings for the integration controls. A final direct-HTTP check of the running application returned page/health 200/UP, confirmed three ICU assignments in the lightweight workspace, and observed the automatic monitor advance from tick 1 to tick 3 with six new L&D measurements and no manual scenario trigger.

## Remaining limits

No browser automation, rendered viewport, real-phone gesture, screen-reader, or real-device visual verification was performed; jsdom does not establish mobile layout correctness. Physical wearables/monitors, pressure-offloading validation, EHR integration and hospital authentication are simulated or absent. The application is an educational prototype. Raw history grows without archiving/pagination; very long-lived demos may become slow. Timestamp polling assumes normal server clock progression and cannot independently detect an external reset with an identical demoStartedAt. Preset setup/steps are separate writes and are intentionally not idempotent. Existing V2 global sensor controls retain their documented ICU fallback; new sensor keys require the correct assigned ICU patient.
