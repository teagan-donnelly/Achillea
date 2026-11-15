# Recovered V3 hackathon demo

Branch `demo/achillea-hackathon` starts directly at verified V3 commit `31d30da69f2dad1ab0fdb210db0bbb2a22ab42e8`. No Tiger changes were merged or cherry-picked. React/TypeScript, Java 21 Spring Boot, persistent H2, all V3 APIs, and the five existing presets are retained. No clinical feature or visual redesign was needed.

## This machine

Isolated worktree: `C:\Users\teaga\Projects\Achillea\.demo-worktrees\achillea-hackathon`. The original checkout remains on the Tiger branch, including its uncommitted documentation edits. Main and existing databases were not changed.

Local app: **http://127.0.0.1:15274/**. Backend health: http://127.0.0.1:18184/api/health. No login/password is required by recovered V3.

The recovery session uses a new, disposable file database `.demo-runtime/data/verification-20261114.mv.db`. Live tests explicitly reset **only this database**. It is separate from all pre-existing H2 files. Launchers reuse a selected database without deleting it; choose another `-DatabaseName` for a fresh seeded demonstration. Never run the live tests against saved presentation records.

The current tunnel URL is recorded in ignored `.demo-runtime/tunnel.log`; it changes when the tunnel restarts. Keep the backend, frontend and tunnel processes running and the laptop awake. Closing them makes the URL unavailable. The URL is public and permits demo writes, so share only with judges/teammates and stop the tunnel after the demonstration. Quick Tunnel does not provide account-based access restriction here; no Cloudflare account or Access policy was provisioned. All records must remain synthetic.

## Exact installation and startup (PowerShell)

From the isolated worktree root, install/build once:

```powershell
Set-Location C:\Users\teaga\Projects\Achillea\.demo-worktrees\achillea-hackathon
$env:JAVA_HOME='C:\Program Files\Eclipse Adoptium\jdk-21.0.8.9-hotspot'
$maven='C:\Users\teaga\.m2\wrapper\dists\apache-maven-3.6.3-bin\1iopthnavndlasol9gbrbg6bf2\apache-maven-3.6.3\bin\mvn.cmd'
& $maven '-Dmaven.repo.local=C:\Users\teaga\.m2\repository' -f backend/pom.xml verify
Push-Location frontend
npm.cmd ci
Pop-Location
```

On another machine, Java 21, Maven 3.6.3+, Node 22.12+ or 24+ are required; use `mvn` if installed on PATH. The hard-coded paths above describe this computer only. No database credentials, cloud secrets, Docker or external database are needed. The examples below use a process-only PowerShell execution-policy override because this machine blocks script files; they do not change global policy.

Terminal 1 (same worktree root):

```powershell
$env:JAVA_HOME='C:\Program Files\Eclipse Adoptium\jdk-21.0.8.9-hotspot'
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/Start-HackathonBackend.ps1 -DatabaseName hackathon-demo
```

This enables simulated monitoring every 15 seconds. Add `-Deterministic` to disable the scheduler for repeatable recording; the manual monitor controls and presets still work. The script explicitly chooses H2 and demo mode, overriding inherited database/demo settings. Both servers bind loopback; the backend is exposed only through Vite's same-origin API proxy.

Terminal 2, localhost only:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/Start-HackathonFrontend.ps1
```

Open http://127.0.0.1:15274/. Stop each server with Ctrl+C in its terminal. Do not start a second instance on an occupied port. H2 persists charts/tasks across restarts. To rebuild the JAR, stop this backend first to avoid Windows file locking. Reset synthetic demo permanently removes records from the selected database and requires an explicit UI confirmation; it is unnecessary for normal startup.

## Temporary phone URL

Download the official executable once (or use an already installed `cloudflared`):

```powershell
New-Item -ItemType Directory -Force .demo-runtime | Out-Null
curl.exe -fL https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe -o .demo-runtime/cloudflared.exe
```

Terminal 3:

```powershell
.\.demo-runtime\cloudflared.exe tunnel --url http://127.0.0.1:15274 --no-autoupdate --protocol http2
```

Copy the generated `https://...trycloudflare.com` URL. Stop only the frontend in Terminal 2 and restart it with that exact URL:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/Start-HackathonFrontend.ps1 -PublicUrl https://YOUR-GENERATED-HOST.trycloudflare.com
```

Vite allows this exact hostname, retains its default localhost/IP access and filesystem restrictions, and uses secure WebSockets on port 443. It does not enable wildcard hosts or wildcard CORS. Phone API requests stay on the same HTTPS URL and proxy to local port 18184; no backend URL or secret is embedded in React. Browser routes such as `/rounds` retain SPA fallback. Cloudflare Quick Tunnels are temporary and have no uptime guarantee. References: [Cloudflare Quick Tunnels](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/), [Vite host restrictions](https://v6.vite.dev/config/server-options).

Test on a phone using cellular data: load Activity, switch units, open a patient, inspect trends, execute a manual simulated event, and confirm the UI refreshes. External HTTP/WSS success alone is not a phone/browser usability test.

## Reproducible connected two-minute walkthrough

Use a fresh database name and `-Deterministic` for predictable narration; scheduler-enabled mode is an alternative for continuous monitoring. Open Demo controls and run each displayed step explicitly. Presets append evidence and are not idempotent; start each once rather than repeatedly clicking it.

1. **0:00–0:20 — Activity and assigned patient.** Start in L&D. Show grouped source-backed Activity, open Patients, then Maya Rowan and her recorded monitor history. Use New monitor reading to show a simulated arrival; it is software-generated.
2. **0:20–0:40 — Event creates a review.** In Demo controls, start Device event once. Run its metadata/delay/reading/reconnection steps. Show the technical review task and source timestamps. Reconnection does not confirm care.
3. **0:40–1:20 — Sensor review and explicit care.** Switch to ICU, open Alex Linden, and start Patient repositioning. Inspect independent chest/pelvis evidence. Enter a synthetic bedside observation, explicitly check verification, and run the review step. Enter a completion note and explicitly verify the separate task-completion step. Show Sensors, Activity and Rounds reflecting the review/documented completion. Sensor movement alone never marks care complete.
4. **1:20–1:45 — Append-only charting.** Switch to L&D. Start Bedside documentation; enter a note, save, explicitly confirm, append an amendment and confirm it. Show the unchanged original plus linked amendment.
5. **1:45–2:00 — Explainable rounds.** Start Adaptive rounds, inspect Now/Next/Later and reason codes, acknowledge the due task, then supply a reason to defer. Routine shift is the fifth available preset for showing census/Activity/rounds without a clinical action.

Times are narration guidance, not a measured usability claim. If phone/tunnel access fails, use localhost, set deterministic mode, and record the same sequence with Windows Snipping Tool's screen recording or an already installed recorder. Keep clinical simulation labels visible; do not narrate physical-device or clinical-validation claims. A laptop recording requires no internet after dependencies are installed.

## Verification commands and results

Backend: `mvn -f backend/pom.xml verify` — **44 tests passed**, including original restart-persistence tests, and executable JAR packaging passed.

For real-HTTP frontend checks, first launch a **separate fresh disposable database**, e.g. backend launcher `-DatabaseName test-only-new-name -Deterministic`, using ports 18184/15274 with no other demo instance on them. Then, in `frontend`:

```powershell
$env:ACHILLEA_INTEGRATION_URL='http://127.0.0.1:15274'
$env:ACHILLEA_ALLOW_DEMO_RESET='disposable-test-database'
npm.cmd test
Remove-Item Env:ACHILLEA_INTEGRATION_URL
Remove-Item Env:ACHILLEA_ALLOW_DEMO_RESET
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run build
npm.cmd audit
```

Recovered V3 results on 2026-11-14: **47 frontend tests passed, zero skipped**, including nine React/jsdom + actual HTTP integration tests. They cover assigned patients, Activity/history, monitoring reaching mounted React views, chart draft/confirmation/amendment, independent sensor events/reviews and separate care completion, disconnected states, unit switching, rounds/task scheduling, and all five preset guides. TypeScript, lint and frontend production build passed. Locked dependency installation reported zero npm vulnerabilities.

An additional recovery check created and explicitly confirmed a synthetic chart and its amendment, stopped Spring, restarted against the same dedicated H2 file, and verified the original chart ID, confirmed status and text persisted. Scheduled monitoring was then re-enabled.

The external tunnel returned HTTP 200 for the homepage, bedside and rounds browser routes, health, Activity and monitoring APIs. The external secure WebSocket handshake returned Vite's connected message. A direct request with an unrelated Host returned 403. The user confirmed the tunnel opens/works in a computer browser. Real-phone behavior and rendered mobile layouts remain unverified.

## Limitations

This restores a synthetic hackathon prototype, not a clinical deployment. Wearables/monitors and clinical actions are simulated; there is no EHR or hospital identity integration. Public Quick Tunnel has no authentication in this setup, exposes development assets and permits synthetic demo changes. Share briefly and stop afterward; keep all credentials and real records out of this worktree. Polling runs every three seconds and scheduler arrivals every fifteen seconds. Long histories can slow the app. Laptop sleep, closed servers, lost network or tunnel restart breaks public access. Localhost remains the fallback. No Tiger, PostgreSQL, Flyway, Vercel Services, hosted Java work or unrelated dependencies were added to this branch.
