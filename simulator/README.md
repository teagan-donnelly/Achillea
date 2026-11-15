# Bedside simulator for Achillea

A 3D bedside simulator that streams five ICU patients into the Achillea backend through its REST API, and reads back the nurse's review of each detected turn.

Each patient is one of the backend's own ICU records, mapped to a **different real person** from the MIMIC-IV Clinical Database Demo (PhysioNet, ODbL). Every value shown or sent for a patient comes from that one person's charted 12-hour shift.

| Achillea patient | Room | MIMIC-IV ICU stay | Source unit |
|---|---|---|---|
| `synthetic-icu-01` Alex Linden | 108 | 38197705 | Trauma SICU |
| `synthetic-icu-04` Casey Birch | 111 | 36753294 | CCU |
| `synthetic-icu-05` Drew Elm | 112 | 33987268 | MICU |
| `synthetic-icu-06` Jamie Cedar | 113 | 39880770 | Trauma SICU |
| `synthetic-icu-07` Taylor Pine | 114 | 32506122 | CVICU |

ICU 02 and 03 are left alone because the backend seeds them with monitor-disconnected and delayed scenarios.

## Run it

1. Start Achillea in **simulator mode** (from the repository root, after `mvn -f backend/pom.xml verify`):
   ```
   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/Start-HackathonBackend.ps1 -Simulator -DatabaseName sim-demo
   ```
   `-Simulator` does three things:
   - **Simulator-only data** (`app.demo.seed=simulator`): a new database contains only these five patients and their monitor, torso and pelvis devices. There are no seeded vitals, sensor samples, movements, tasks, charts or events, and no L&D or other ICU patients. Everything Achillea shows comes from this simulator. This applies when a database is first created, or reset from the UI, so use a **new `-DatabaseName`** (the script warns if the name already exists).
   - **No built-in fake monitor**, which would otherwise add synthetic vitals so the data is no longer one person's.
   - **ICU 04-07 assigned to the demo nurse** (`app.demo.assign-patients`), which also fixes older databases where they were census-only and rejected with 404.
2. In this folder:
   ```
   npm install
   npm run dev
   ```
3. Open http://127.0.0.1:5180. The Simulation section should say *Linked to Achillea: 5 patients streaming*.
4. Open the Achillea UI next to it.

To reach a backend on another machine, set `ACHILLEA_API` in `.env.local` and run `npm run dev:lan`. The browser only calls same-origin `/api/...`, which Vite proxies to the backend (the backend sends no CORS headers).

## Time scale

The shift clock and speed buttons sit in the top bar, next to the title, and in the Simulation panel: **Pause, 1×, 10×, 60×, 300×, 600×** (simulated seconds per real second; default 300×, so a 12-hour shift plays in about 2.4 minutes). Press **P** to pause or resume. Open with `?speed=60` to start at a given speed; otherwise the last choice is remembered.

**Achillea updates once per simulated minute.** Every simulated minute the simulator sends one batch (`POST /api/integrations/batch`) with every patient's vitals and posture plus any turns that finished, and the backend stores it in one transaction and pushes one live update. At 60× that is one update a second; at 300×, five a second. A 15 s real-time heartbeat keeps monitors fresh at 1× and while paused (current values repeat). Readings are stamped with the real current time, so Achillea shows them as live.

Only one batch is in flight at a time. Measured on a laptop, a batch takes about 20 ms early in the shift and about 200 ms by the end of 12 simulated hours (the backend re-reads all stored data per write). 300× keeps up for the whole shift; at 600×, minutes start merging into the next update in the second half instead of queueing.

## How it works

- **Patients list** (left panel): all five patients on one shared shift clock, with time since last moved, heart rate, SpO2 and the most urgent flag. Click a patient to open them in the 3D view.
- **Selected patient:** the full sensor simulation (chest and pelvis IMUs, load per pressure site, checks).
- **Other four patients:** replay their charted positions and vitals in the background.

Sent to Achillea, stamped with the real current time:

| What | Endpoint | Rate |
|---|---|---|
| Heart rate (bpm), SpO2 (%), respiratory rate (breaths/min), temperature (°C, converted from charted °F) | `POST /api/integrations/monitors/observations` | Every 5 s per patient |
| Upper-torso and pelvis roll | `POST /api/integrations/sensors/posture` | 2 s (selected), 3 s (others) |
| A finished turn | `POST /api/integrations/sensors/movements` | Once per turn |

Read back: `GET /api/patients/{id}/orientation` every 3 s. Each patient's turns awaiting nurse review appear in the patients list. The nurse's decision appears under *Needs checking*.

Rules followed:
- Every `sourceEventId` includes a run ID, so restarts never collide.
- No patients are created, and `/api/demo/reset` is never called.
- No `/api/demo/scenarios/*` calls: in this backend `disconnect`/`reconnect` also create scripted movements, and `monitor-reconnect` adds a synthetic vital.
- When Alex Linden's pelvis patch stops reporting (simulated, 13:34 to 13:47), `pelvisDegrees` is sent as `null`, never 0. A turn in that window is classified `UNKNOWN`.
- During Alex's simulated SpO2 probe dropout, SpO2 is sent with quality `MISSING`.

The scripted sensor scenario (Alex Linden, 16:15: torso turns, pelvis stays flat) and the simulated device events are the only parts not taken from the chart.

## Files

- `index.html`: the simulator. The 3D body (Mixamo X Bot) loads from `./Xbot.glb` if present, otherwise from the identical copy in the three.js examples on jsDelivr.
- `vite.config.js`: dev server and `/api` proxy (`ACHILLEA_API`, default `http://127.0.0.1:18184`)
