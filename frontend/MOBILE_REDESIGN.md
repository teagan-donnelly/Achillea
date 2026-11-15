# Final mobile frontend handoff

Branch: `feature/final-mobile-ui`, based on recovered V3 demo commit `a2bd6cf`. Frontend production changes only; no Spring APIs, database schemas, task rules, chart confirmation logic, dependencies or authentication changes. The active demo worktree, its services, H2 file and Cloudflare tunnel were not changed.

## Implemented

- Forest-green patient identification surface, real latest measurements, source/freshness labels and a compact recorded trend. Missing values remain unavailable, not fabricated.
- Interactive rolling 24-hour patient timeline, grouped by real event category. Six selectable four-hour windows contain actual hourly record counts. Category disclosures preserve access to every included source record; recorded measurements and receipt events are explicitly separate records. No medication/order/handoff feature or unsupported measurement was invented.
- Accessible expandable task, sensor, charting and original-history sections. Existing save, confirm, amend, review and completion handlers remain intact. Sensor review and care completion remain distinct explicit nurse actions.
- Activity retains backend task order and reason text. Consecutive monitoring-summary windows fold together without moving exception events or regrouping the backend's measurements. Original event history and source disclosures remain available.
- Compact patient cards, refined Now/Next/Later schedule, prominent ICU region status, mobile bottom navigation and safe-area spacing. Horizontal swipe navigation remains; forms, editable fields, evidence scrollers and dialogs cannot initiate page swipes. Keyboard navigation also stays within an active form.
- Forest/sage/off-white styling with restrained terracotta, self-hosted existing DM Sans, visible focus, reduced-motion support, and no new libraries or generated decorative graphs.

## Preview without disturbing the demo

Worktree: `C:\Users\teaga\Projects\Achillea\.demo-worktrees\final-mobile-ui`.

Preview: **http://127.0.0.1:15374/**. Isolated backend: **http://127.0.0.1:18284/api/health**. These processes were started separately from the active demo. Open the preview directly if running; do not start duplicate processes on occupied ports.

If stopped, Terminal 1 from this worktree can reuse the already-built, unchanged V3 JAR read-only:

```powershell
Set-Location C:\Users\teaga\Projects\Achillea\.demo-worktrees\final-mobile-ui
& 'C:\Program Files\Eclipse Adoptium\jdk-21.0.8.9-hotspot\bin\java.exe' -jar ../achillea-hackathon/backend/target/achillea-0.1.0.jar --server.port=18284 --spring.datasource.url=jdbc:h2:mem:final-mobile-ui --app.monitor.enabled=false
```

This is a fresh disposable in-memory database; it never opens the active demo's H2 file. On another machine, build this worktree's unchanged backend using Java 21 and `mvn -f backend/pom.xml package`, then use `backend/target/achillea-0.1.0.jar` in the command above.

Terminal 2 from this worktree:

```powershell
Set-Location frontend
npm.cmd ci
$env:API_PROXY_TARGET='http://127.0.0.1:18284'
Remove-Item Env:DEMO_PUBLIC_URL -ErrorAction SilentlyContinue
npm.cmd run dev -- --port 15374 --strictPort
```

Use the five existing demo presets/manual controls for deterministic evidence. To demonstrate automatic simulation, start this isolated backend with `--app.monitor.enabled=true`; leave the active demo processes alone. No new tunnel was created for this redesign.

## Verification

From `frontend`, with the isolated backend and Vite running:

```powershell
$env:ACHILLEA_INTEGRATION_URL='http://127.0.0.1:15374'
$env:ACHILLEA_ALLOW_DEMO_RESET='disposable-test-database'
npm.cmd test
Remove-Item Env:ACHILLEA_INTEGRATION_URL
Remove-Item Env:ACHILLEA_ALLOW_DEMO_RESET
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run build
```

The live suite resets only the explicitly selected disposable test backend. Never point it to ports 18184/15274, the active tunnel, or any saved demonstration database.

All **56 frontend tests passed**, including nine existing real-HTTP React/jsdom integration cases and nine new redesign cases. Coverage includes chart confirmation/amendment, movement reviews and separate task completion, monitoring reaching React, priority/deferral/scheduling, all five preset guides, unit switching, navigation/swipes, timeline filtering/time windows, source grouping, empty/missing values, accordion actions and keyboard form protection. TypeScript, ESLint and production build passed. The mechanical design detector reported no findings. Independent source review found a possible 320px graph overflow; horizontal scrolling is now contained within the graph with 44px controls retained. The reviewer scored that finding resolved at source-review scope. Four declared text/background pairs were checked mathematically at 5.64:1 or higher; this does not establish a complete rendered WCAG audit.

Browser automation was not retried after its earlier policy restriction. No screenshots, rendered viewport audit, mobile-device verification, or visual-fidelity claim is provided. The reference image mentioned by the user was not exposed in the message or accessible attachment files; the implementation follows the full written forest-green/sage brief. Layout and fidelity need human review at 320px, 375–430px, tablet and desktop. Legacy CSS is retained and overridden by the new stylesheet to preserve existing workflows; revisit consolidation after the hackathon rather than combining it with this change.

## Safe integration after human review

No merge is performed by this task. First compare this branch with `demo/achillea-hackathon`; only frontend sources and design/handoff documentation should differ. Review the isolated preview and the unverified viewports. When ready, schedule the demo frontend restart rather than interrupting a presentation. Confirm the demo worktree is clean, save its current commit, and merge `feature/final-mobile-ui` into the demo branch with `--ff-only` if it has not advanced. If it has advanced, stop and review the intervening changes rather than forcing a reset. The backend and H2 file need no migration or reset. Restart only the demo frontend after the approved merge, preserving its existing API proxy and exact tunnel hostname. Validate charting, sensor review and unit switching before reusing the public link. Keep main and Tiger unchanged.
