# Achillea v2 integration

## Sources and branch safety

Created `integration/achillea-v2` from clean, synchronized main/origin/main at `874f2ee05a50c9e8c0b9078ef3535625fd5ddc3c`. Merged `origin/feature/clinical-data` at `e18b416c83c7f9cf70a114e9d1cf1a8f9a71b9f2`, then `origin/feature/mobile-redesign` at `720c8a1925c74a5ff08dc163f5e7e78fab138c32`, with two non-fast-forward merges. No merge conflicts occurred. No merge into main, feature-branch rewrite, or feature-branch deletion was performed.

## Compatibility fixes

- Frontend types now describe the backend's additive device, sample, patient context, movement provenance/confidence, and rounds horizon fields; optional fields retain compatibility with older snapshots and test fixtures.
- Patient cards and patient detail use explicit monitor connection/freshness, rather than treating an old VALID observation as evidence of a connected device. Disconnected/missing/unknown current readings do not render a numeric current measurement. Recorded history remains visible with source/time labels.
- Backend stale markers and sample ages are honored. Delayed measurements are labeled; sample and receipt times stay distinct. A disconnected patient's monitor can be reconnected from that patient's workspace.
- Sensor panels read the newest independent region samples and source-device states. A disconnected pelvis remains unknown even when chest samples arrive. Candidate confidence is explicitly an illustrative simulation heuristic, not clinical certainty.
- Monitoring activity includes backend device events; it no longer filters out disconnection/reconnection history. Existing event and draft flows remain intact.
- Rounds uses backend horizons and order, including the next action on patient cards. A previously used confirmed movement is excluded from a new verified-care completion choice, matching the backend's safeguard.
- Poll responses from a previously selected unit cannot overwrite the current unit's rounds. Unit switching clears old search/task views, and out-of-order responses are ignored after a newer response is applied.
- Vite's optional API_PROXY_TARGET permits isolated integration testing; the default remains localhost:8080. No API URL or existing backend request/response field was removed.

No visual redesign was introduced by integration; both branches' workflows and mobile navigation are preserved. Browser automation was not used because the environment previously blocked it. Real browser rendering, visual mobile/desktop layout, hardware behavior and deployment hosting remain unverified by this pass.

## Reproduce real-server React integration tests safely

Prerequisites: built backend JAR, installed frontend dependencies, Java 21, Node 22.12+ or 24+. These tests perform a reset before each test. **Only use the disposable in-memory backend below. Never point them at a saved demo database you want to keep.**

Terminal 1, from backend:

```sh
java -jar target/achillea-0.1.0.jar --server.port=18082 --spring.datasource.url=jdbc:h2:mem:achillea-integration --app.monitor.enabled=false
```

Terminal 2, from frontend, PowerShell:

```powershell
$env:API_PROXY_TARGET='http://127.0.0.1:18082'
npm.cmd run dev -- --port 15173 --strictPort
```

Terminal 3, from frontend, PowerShell:

```powershell
$env:ACHILLEA_INTEGRATION_URL='http://127.0.0.1:15173'
$env:ACHILLEA_ALLOW_DEMO_RESET='disposable-test-database'
npm.cmd test
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run build
npm.cmd audit
```

macOS/Linux equivalents for terminals 2 and 3:

```sh
API_PROXY_TARGET=http://127.0.0.1:18082 npm run dev -- --port 15173 --strictPort
# In another terminal:
ACHILLEA_INTEGRATION_URL=http://127.0.0.1:15173 ACHILLEA_ALLOW_DEMO_RESET=disposable-test-database npm test
```

The live suite uses React Testing Library/jsdom with **actual HTTP responses through Vite's proxy to Spring Boot**. It does not mock the backend, automate a browser, or verify CSS layout. The opt-in safety guard requires a loopback URL and explicit disposable-reset acknowledgment. Seven scenarios cover expanded assignments/events/history; stale/disconnected/reconnected sources; chart save/confirm/amend with vital links; ICU movement/review/verified completion and unit switching; authoritative rounds/deferral; polling of new server observations; and missing-value handling.

Stop test servers with Ctrl+C. The in-memory database is discarded at process exit; no existing H2 file was reset. Return API_PROXY_TARGET to its default or open a new terminal for ordinary startup. Existing file-database restart coverage remains in backend RestartPersistenceTest and backend verification evidence.

## Verification results

| Check | Result |
|---|---|
| Backend `mvn -f backend/pom.xml verify` | 33 passed, zero failures/errors/skips; packaged Spring Boot JAR |
| Frontend `npm test` with live environment enabled | 34 passed, zero failures/skips: 27 isolated unit/component tests + 7 real-HTTP React integration tests |
| Frontend `npm run typecheck` | Passed |
| Frontend `npm run lint` | Passed with zero warnings |
| Frontend `npm run build` | Passed; Vite production assets and local font files emitted |
| `npm audit` | Zero vulnerabilities |
| `git diff --check` | Passed |

Existing installed dependencies matched the unchanged lockfile and were reused; no package version upgrade was introduced by integration. Default `npm test` without the opt-in live environment runs 27 tests and deliberately skips seven network tests.

Direct HTTP requests through `http://127.0.0.1:15173/api` verified health UP, six nurse assignments, ten L&D and seven ICU census patients, and a frontend document response of HTTP 200. After restarting only the disposable in-memory server with its actual scheduler enabled at a one-second test cadence, monitorTick advanced from 21 to 24 and a new heart-rate observation ID arrived through the proxy. Source remained SIMULATED_MONITOR with device monitor-synthetic-ld-01 and distinct sample/receipt timestamps. The normal default cadence remains 15 seconds.

The first live run passed five of six tests; the remaining test attempted to press a disabled scenario button before the previous save/refresh finished. The test now waits for actionable controls before clicking, and all workflows passed. Type errors in the new test harness were corrected before final checks. Browser/visual testing remains unverified; HTTP/jsdom evidence is not described as a browser test. Existing user databases were never reset.

The exact Maven executable/cache command used in this environment is in docs/backend/verification.md. No backend source changed after that merged suite passed, so it was not unnecessarily rerun for frontend-only compatibility fixes. Test servers were stopped after verification; see README for ordinary combined startup.
