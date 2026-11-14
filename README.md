# Achillea

Care that moves with you. Achillea combines assigned-patient monitoring, bedside documentation, sensor review, activity history, and explainable rounds in a mobile-first nurse workflow.

**Hackathon simulation — not for clinical use.** All patients, measurements, devices, and care records are synthetic. No physical hardware, hospital/EHR, production authentication, or AI provider is connected. Movement detection never automatically verifies care.

## Combined application

`integration/achillea-v2` combines `feature/clinical-data` (`e18b416`) and `feature/mobile-redesign` (`720c8a1`), both based on `874f2ee`. Main and the feature branches remain separate. React/TypeScript/Vite uses typed REST calls and three-second polling through a same-origin proxy; Spring Boot/Java 21 persists a versioned demo aggregate in file-backed H2. Monitor and independent chest/pelvis adapters supply simulated observations.

## Install and run

Prerequisites: **Java 21**, **Maven 3.6.3+**, and **Node 22.12+ or 24+** (verified with Node 24). First installation requires access to Maven Central/npm; the demo requires no external credentials afterward.

From the repository root, use two terminals. The commands work in PowerShell and macOS/Linux shells (use `npm.cmd` on Windows if PowerShell blocks npm.ps1).

Terminal 1:

```sh
git switch integration/achillea-v2
mvn -f backend/pom.xml verify
cd backend
java -jar target/achillea-0.1.0.jar --spring.datasource.url=jdbc:h2:file:./data/achillea-v2-demo
```

Terminal 2, starting at the repository root:

```sh
cd frontend
npm ci
npm run dev -- --port 5173 --strictPort
```

Open **http://127.0.0.1:5173/**. Backend health is http://127.0.0.1:8080/api/health. Wait for Spring Boot to start before opening the app. The frontend displays an actionable connection error if the API is unavailable. Stop each server with Ctrl+C.

The explicit `achillea-v2-demo` database above separates this combined demo from the original default `backend/data/achillea`. It persists between restarts. Existing files are preserved; no startup command erases data. An absent database is seeded automatically. Existing older datasets need an **explicit** reset to opt into the expanded data. Reset permanently discards records in that selected *synthetic demo database*; use it only after saving any demo work you want to keep.

If Maven is installed outside PATH on this development machine, see the exact PowerShell executable/cache commands in [backend integration notes](docs/backend/integration-notes.md). If ports are occupied, stop your earlier instance or select different ports and set API_PROXY_TARGET as described below. StrictPort prevents opening the wrong frontend silently.

## Configuration

Export environment variables in the terminal that starts the relevant server; `.env.example` is documentation, not an automatic dotenv loader.

| Variable | Default | Purpose |
|---|---|---|
| APP_DEMO_MODE | true | Enables synthetic record/command APIs; false also disables monitor scheduler |
| DATABASE_URL | jdbc:h2:file:./data/achillea | Backend H2 URL; launch from backend for a consistent relative path |
| MONITOR_SIMULATION_ENABLED | true | Periodic simulated monitor arrivals; false keeps manual scenario controls |
| MONITOR_CADENCE_MS | 15000 | Positive delay between monitor cycles |
| MONITOR_INITIAL_DELAY_MS | 15000 | Delay before first cycle |
| API_PROXY_TARGET | http://127.0.0.1:8080 | Backend target for the frontend Vite dev server; restart Vite after changing |

Example custom proxy in PowerShell: `$env:API_PROXY_TARGET='http://127.0.0.1:18082'`. In macOS/Linux: `export API_PROXY_TARGET=http://127.0.0.1:18082`. Both servers bind loopback; true-phone network deployment is not configured.

## Demo

Fresh data contains **10 L&D and 7 ICU census patients**, with **three assigned to the demo nurse in each unit**, 51 scheduled/historical tasks overall, and timestamped synthetic histories. Ordinary nurse views show only assigned records. The explicitly labeled demo census API is separate.

1. Open Activity: view backend events and attention items. Open Patients to compare Maya Rowan, Elena Vale, and Iris Fern, their readings, source availability, and historical trends.
2. Open Maya, receive a simulated monitor reading, or wait for the periodic feed. Select Document care, enter an observation, optionally link measurements, Save draft, review and check verification, then Confirm entry. Append amendment preserves the original.
3. Switch Demo unit to ICU and open Alex Linden. In Demo controls, compare Chest-only movement with Coordinated turn candidate. Neither completes care.
4. Review candidate, enter a bedside verification note, verify and confirm the care observation. Explicitly Complete the prescribed task using that confirmed movement and nurse verification.
5. Use disconnect/reconnect controls to show unknown sensor data and unavailable monitor readings. Return to Rounds to see backend Now/Next/Later groups, priority reasons, acknowledgments, deferrals, and completed care. Activity shows the saved audit history.

Full recording guidance: [demo script](docs/DEMO_SCRIPT.md). No video is generated/uploaded automatically. This is a software simulation, not a claim of validated pressure relief, treatment recommendations, injury prevention, or clinical deployment readiness.

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

The default frontend test command runs isolated unit/component tests. Real-server integration tests skip unless explicitly configured against a disposable database. See [integration verification and test instructions](docs/INTEGRATION.md) to run the full suite through the real Vite proxy safely. No browser verification is implied by jsdom tests. Production build emits frontend/dist and the backend JAR; frontend hosting/API routing for deployment remains separate from the documented development server.

## Repository guide and limitations

- `backend/`: clinical models, seeded assignments/census, monitor scheduler, sensor adapter, command validation, H2 persistence and backend tests.
- `frontend/`: mobile navigation, activity, patient monitoring/history, bedside charting, rounds, and UI/integration tests.
- `docs/backend/`: actual API additions, simulation semantics, and backend verification evidence.
- `docs/frontend/`: redesign notes and interaction guidance.
- `docs/INTEGRATION.md`: merge sources, compatibility fixes, current evidence and known gaps.

The fixed demo nurse is not secure production authentication. File H2 and aggregate polling support one local demo backend, not multi-hospital deployment. History retention is bounded; saved chart provenance is preserved. Clinical/hardware validation, hospital approvals, secure access, patient matching, privacy review, mobile management, and approved EHR integration remain future work. See [safety and limitations](docs/SAFETY_AND_LIMITATIONS.md).
