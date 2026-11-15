# Run Achillea + the bedside simulator locally

Three terminals: **backend**, **Achillea website**, **simulator**. The simulator streams five ICU patients into the backend, and the Achillea website updates live.

Requirements: Java 21, Maven 3.6.3+, Node 22.12+ or 24+. Run everything from the `Achillea` folder (PowerShell). The `-ExecutionPolicy Bypass` flag is needed because Windows blocks local scripts by default.

## One-time setup

```powershell
cd frontend; npm ci; cd ..
cd simulator; npm install; cd ..
```

## Terminal 1: backend (simulator-only data)

```powershell
mvn -f backend/pom.xml -DskipTests package
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/Start-HackathonBackend.ps1 -Simulator -DatabaseName sim-run1
```

- Wait for `Started Application`. Health check: http://127.0.0.1:18184/api/health
- `-Simulator` gives a database with **only the simulator's five patients** (no seeded data) and turns off the built-in fake monitor.
- **Use a new `-DatabaseName` for a clean slate** (`sim-run2`, `sim-run3`, …). The script warns if the name already exists.
- Stop the backend before rebuilding (`mvn ... package`); Windows locks the running jar.

## Terminal 2: Achillea website

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/Start-HackathonFrontend.ps1
```

Open **http://127.0.0.1:15274** and pick **ICU**. The badge next to "API connected" should say **Live**. (**Polling** means the live stream isn't connected; usually an old backend is running.)

## Terminal 3: simulator

```powershell
cd simulator
npm run dev
```

Open **http://127.0.0.1:5180**. The Simulation panel should say *"Linked to Achillea: 5 patients streaming"*. **Keep this tab open**: the data streams from the page.

## Using it

- **Time scale** (top bar of the simulator): Pause, 1×, 10×, 60×, 300×, 600×. Press **P** to pause or resume. Start at a given speed with http://127.0.0.1:5180/?speed=60.
- The simulator sends **one update per simulated minute** for all five patients. The website redraws at most once a second, so:
  - **60× or slower:** the website shows every simulated minute.
  - **300× (default):** each redraw covers about 5 simulated minutes.
- When a turn finishes in the simulator, Achillea shows a **"Review synthetic movement evidence at bedside"** task for that patient. The nurse's review appears back in the simulator under *Needs checking*.

| Patient | Room |
|---|---|
| Alex Linden (`synthetic-icu-01`) | 108 |
| Casey Birch (`synthetic-icu-04`) | 111 |
| Drew Elm (`synthetic-icu-05`) | 112 |
| Jamie Cedar (`synthetic-icu-06`) | 113 |
| Taylor Pine (`synthetic-icu-07`) | 114 |

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Build first: mvn -f backend/pom.xml verify` | The jar isn't built. Run the `mvn` line in Terminal 1. |
| `Unable to rename ... achillea-0.1.0.jar` during build | A backend is still running. Stop it (Ctrl+C), then build again. |
| Port already in use | That server is already running. Reuse it, or close its window first. |
| Simulator: `Failed to resolve import "three"` | Run `npm install` in `simulator/`. |
| Simulator shows "rejected" errors (404) | The backend wasn't started with `-Simulator`. |
| Website shows other / old patients | Database name reused. Start the backend with a new `-DatabaseName`. |
| Website badge says **Polling** | Restart the backend with the latest build (step 1). |
| Vitals say "Old reading" | The simulator tab is closed or the backend stopped. |

## More

- Simulator details: [simulator/README.md](simulator/README.md)
- Serve the demo on your own domain: [docs/PUBLIC_DOMAIN.md](docs/PUBLIC_DOMAIN.md)
- API reference: [docs/API.md](docs/API.md)

All patient data is synthetic or from the public MIMIC-IV demo. Not for clinical use.
