# Achillea

Floating-navigation frontend preview: [startup, interactions, verification and safe integration](docs/FLOATING_NAV_POLISH.md).

Sensor-first preview: see [isolated startup, two-minute demo and verification](docs/SENSOR_FIRST_DEMO.md). Home prioritizes configured repositioning deadlines; movement evidence requires explicit nurse verification and documentation.

**Recovered hackathon demo:** use [the recovery startup, phone tunnel and two-minute walkthrough](docs/HACKATHON_RECOVERY.md). This branch is based directly on verified pre-Tiger V3; the instructions below describe the original V3 setup.

Care that moves with you. Achillea combines assigned-patient monitoring, bedside documentation, sensor review, activity history, and explainable rounds in a mobile-first nurse workflow.

**Hackathon simulation — not for clinical use.** All patients, measurements, devices, and care records are synthetic. No physical hardware, hospital/EHR, production authentication, or AI provider is connected. Movement detection never automatically verifies care.

## Combined application

`integration/achillea-v3` combines backend `feature/clinical-demo` (`e880f02`) and frontend `feature/mobile-polish` (`80d569c`), both based on V2 `af2d7d4`. It connects backend activity summaries, incremental monitoring, sensor history, rounds reason codes, review scheduling, and five guided demo presets to the mobile interface. Main and V2 are unchanged.

## Install and run

Requires Java 21, Maven 3.6.3+, and Node 22.12+ or 24+. See the [V3 integration runbook](docs/INTEGRATION_V3.md) for the exact installed Windows Maven/Java paths, disposable test configuration, verification results, and two-minute demonstration.

Terminal 1, from repository root (PowerShell):

```powershell
git switch integration/achillea-v3
mvn -f backend/pom.xml -Dachillea.build.directory=target/v3-integration verify
Set-Location backend
java -jar target/v3-integration/achillea-0.1.0.jar --server.port=18084 --spring.datasource.url=jdbc:h2:file:./data/achillea-v3-demo
```

Terminal 2, from repository root:

```powershell
Set-Location frontend
npm.cmd ci
$env:API_PROXY_TARGET = 'http://127.0.0.1:18084'
npm.cmd run dev -- --port 15174 --strictPort
```

Open **http://127.0.0.1:15174/**. Backend health: http://127.0.0.1:18084/api/health. If the verified demo is already running on these ports, open the link directly. Stop a server with Ctrl+C before starting another instance on its port. On macOS/Linux use npm and export API_PROXY_TARGET=http://127.0.0.1:18084.

The named V3 file database preserves existing demo files and persists between restarts. An absent database automatically seeds the expanded synthetic census. No startup/preset automatically resets saved data. Reset synthetic demo asks for confirmation and permanently discards the selected database's records. Live tests must use the separate disposable database described in the runbook.

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

V3 recording guidance and all five presets: [integration runbook](docs/INTEGRATION_V3.md). Original V2 guidance: [demo script](docs/DEMO_SCRIPT.md). No video is generated/uploaded automatically. This is a software simulation, not a claim of validated pressure relief, treatment recommendations, injury prevention, or clinical deployment readiness.

## Sample data and simulator input

With the backend running, seed 30 minutes of synthetic vitals, posture and one movement for three ICU patients (Alex Linden, Robin Ash, Sam Alder):

```powershell
node scripts/seed-sample-data.mjs          # add --live to keep streaming every 5 s
```

Set `ACHILLEA_API` (default `http://127.0.0.1:18184/api`) for another backend. External simulators send free-form body angles to `POST /api/integrations/sensors/posture` and turns to `POST /api/integrations/sensors/movements`; see [the API](docs/API.md). The H2 database stores one table per record type (`backend/src/main/resources/schema.sql`); older single-document databases are imported automatically.

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
