# Floating navigation preview

Branch: `feature/floating-nav-polish`, based on verified sensor-first commit `cd3f4e8`. Frontend and design documentation only; backend source, APIs, database schemas, clinical algorithms and persistence are unchanged. Existing demo worktrees, servers and tunnels remain independent.

## Interaction

The same four named links serve mobile and desktop. Below 1024px, Home / Patients / Sensors / Rounds sit in a white floating pill. The forest circle moves; the icons remain in their measured positions. Tap a destination to navigate. Start a drag inside the selected circle, move horizontally across any number of icons, and release to commit the nearest destination once. No intermediate route changes occur. Icons turn white only when covered by the circle. Pointer cancellation, lost capture, resize, hidden document, window blur and an external route change cancel the gesture safely.

The pill uses pointer capture, localized touch-action rules and `data-no-swipe`. Page gestures outside it keep the original swipe navigation. Link labels and `aria-current` remain available. Tab/Enter activate normal links; Left/Right/Home/End move keyboard focus. Reduced motion removes the settling transition. At 1024px and above the pill styling and circle disappear; the same links form the existing compact sidebar.

Mobile positioning includes the bottom safe-area inset. The track's measured height feeds the workspace's bottom padding, leaving space for the entire pill plus its gap. Geometry, resize behavior and this measurement contract are tested with jsdom; actual browser layout/overlap cannot be certified without visual verification.

Local interaction preferences retain sensor/activity filters, Home expansion, patient sections/selected trends, unsubmitted review text and movement selection, task reasons and schedule inputs. Verification checkboxes are deliberately not retained across leaving and returning. Existing chart drafts still use their original per-patient browser storage. Route scrolling is remembered by unit/path. Clinical data is never cached in the preferences map: returning to a route refreshes existing backend APIs, and normal monitoring polling continues. No navigation handler submits a nursing action.

The restrained theme softens shadows, removes redundant nested treatments, keeps urgency visible on Home, groups chest/pelvic sensor summaries, and retains the three patient sections and all Rounds actions. Existing unit selection, history, care documentation, amendments, demo controls and five presets remain available.

## Isolated startup

Use this worktree, not an older running demo. Java 21, Node and the existing locked dependencies are required. The preview frontend is http://127.0.0.1:15674/ and its backend is 18584. No public tunnel was created.

Terminal 1, from this worktree (current machine can reuse the previously verified backend JAR read-only):

```powershell
New-Item -ItemType Directory -Force .demo-runtime | Out-Null
java -jar ../sensor-first-achillea/backend/target-integration/achillea-0.1.0.jar --server.port=18584 --spring.datasource.url=jdbc:h2:file:./.demo-runtime/floating-nav-preview --app.monitor.enabled=true
```

For a standalone checkout without that JAR, run `mvn -f backend/pom.xml package` first and use `backend/target/achillea-0.1.0.jar` instead. This builds unchanged backend source in the isolated checkout.

Terminal 2:

```powershell
cd frontend
npm ci
$env:API_PROXY_TARGET='http://127.0.0.1:18584'
npm run dev -- --port 15674 --strictPort
```

Keep both new processes running. Existing demos on 15274/15374/15474 and their backends/tunnels are not replaced. Open the new preview, select ICU if a different unit was explicitly saved, and use **Load repositioning demo** with its existing confirmation to stage synthetic evidence. Nothing loads or resets automatically. Physical hardware is not integrated by this change.

## Verification

```powershell
cd frontend
npm test
npm run typecheck
npm run lint
npm run build
npm audit
```

Real-API integration tests must target an explicitly disposable isolated database with monitoring disabled. They reset synthetic records between cases. The implementation verification used backend 18584 with `.demo-runtime/floating-nav-verification` and a proxy on 15674 before starting the presentation preview with a different database file. Never point these tests at saved presentation data or an existing public tunnel.

```powershell
$env:ACHILLEA_INTEGRATION_URL='http://127.0.0.1:15674'
$env:ACHILLEA_ALLOW_DEMO_RESET='disposable-test-database'
npm test
Remove-Item Env:ACHILLEA_INTEGRATION_URL
Remove-Item Env:ACHILLEA_ALLOW_DEMO_RESET
```

All 92 frontend tests passed, including ten real API integration workflows and sixteen targeted pointer/state cases. TypeScript, lint, production build and dependency audit passed with zero reported vulnerabilities. Backend source did not change and its tests were not rerun for this frontend-only branch. Browser automation remained prohibited: actual iPhone dragging, animation smoothness, rendered contrast and the 320/375/390/430/tablet/1440 viewport matrix remain unverified. Tests with mocked geometry do not substitute for those checks.

## Safe integration

Review this branch against current `main` in an isolated integration checkout. Confirm the diff contains no backend changes. Merge there, install locked dependencies, and repeat frontend and disposable live-API checks before promoting. Back up any presentation database with its own JVM stopped before future changes involving it. Do not reset records, replace either older demo, switch a running worktree, or merge into main automatically. Existing deployment/tunnel configuration is unchanged; new hosting or phone tunnels require a separate explicit action.
