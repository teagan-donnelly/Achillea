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

1. Start Achillea **with the fake monitor off**, on a fresh database:
   ```
   .\scripts\Start-HackathonBackend.ps1 -Deterministic -DatabaseName sim-demo
   ```
   Without `-Deterministic`, the backend's own simulated monitor keeps adding synthetic vitals to these patients, and the data is no longer one person's.
2. In this folder:
   ```
   npm install
   npm run dev
   ```
3. Open http://127.0.0.1:5180. The Simulation section should say *Linked to Achillea: 5 patients streaming*.
4. Open the Achillea UI next to it.

To reach a backend on another machine, set `ACHILLEA_API` in `.env.local` and run `npm run dev:lan`. The browser only calls same-origin `/api/...`, which Vite proxies to the backend (the backend sends no CORS headers).

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
