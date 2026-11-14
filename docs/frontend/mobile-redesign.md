# Mobile redesign handoff

Branch: `feature/mobile-redesign`. Base: `874f2ee05a50c9e8c0b9078ef3535625fd5ddc3c`, matching main and origin/main when work began. Worktree: `../Achillea-mobile-redesign`. The original Achillea working directory was not edited. Frontend components and workflow tests from the existing UX-Update branch were reused selectively; no branch merge or backend changes were made.

## Delivered

- Activity defaults at `/`, with `/activity` preserved. Attention links open patient tasks, sensor review, or a specific saved draft. Outstanding work stays separate from timestamped history.
- Activity, Patients, Rounds bottom navigation on phones and sidebar on desktop. Horizontal gestures apply only to primary routes; vertical movement, inputs, charts, task forms, and patient details opt out. Ctrl+Alt+Left/Right inside the workspace provides keyboard shortcuts without replacing browser Alt+Left history navigation. Normal links remain available.
- Patient cards use real aggregate observations, observation-time sorting, units, provenance, freshness, and timestamped miniature histories. Unknown metrics retain their API names/units. Missing measurements are not rendered as valid values.
- A reading older than 15 minutes is labeled old. This display policy is not a device heartbeat or clinical threshold. API connectivity is shown separately from measurement age. Sensor availability is labeled as its last report rather than proof of current connectivity.
- Monitoring charts show up to 30 actual samples, timestamp-proportional spacing, gaps for invalid samples, and accessible summaries/expandable recorded values. Fewer than two valid samples produces an honest unavailable state. No trend endpoint is required.
- Patient overview, bedside charting, care tasks, sensor review, and a source-labeled history view. L&D retains its separate care context; repositioning stays conditional on the care plan.
- Rounds uses backend ordering and only populated Now/Next/Later sections. Sparse schedules create a compact queue, not empty columns. Acknowledgment, deferral, priority/reordering, verified completion, and completed history are retained.
- Botanical Clinical tokens, stronger contrast, pale clinical surfaces, restrained gold review accents, local bundled fonts, reduced-motion rules, safe-area navigation spacing.
- Temporary chart form values are retained per patient in session storage across navigation. Reload warns while work exists. Server draft saves, explicit confirmation, and append-only amendments retain existing API semantics. Changed fields require saving before confirmation; switching the chart being edited asks before replacing working text. Session storage is temporary, not durable clinical storage.

## Run and verify

Use Java 21 and start the unchanged backend separately. In this worktree's `frontend`, run `npm ci`, then `npm run dev`. Verify the port printed by Vite.

Baseline: 4 tests passed; lint passed; build passed. Redesigned suite: 24 tests passed across 4 files; lint and production build passed before final handoff review. Tests use jsdom/mocked APIs and include gestures, navigation, local notes, chart confirmation/amendments, deferral and verified repositioning, freshness, missing readings, trend gaps, sparse schedules, post-action Activity updates, and unit switching.

Browser/device verification remains outstanding. No browser screenshots or real phone swipe claims are made. A human should check 360, 390, 430, 768, and 1280 CSS pixel widths for overflow, focus visibility, bottom navigation clearance, and form usability. On a phone, swipe the primary screens in both directions, scroll diagonally/vertically, interact with chart details and forms, and verify no unwanted route changes. Verify history/back, direct patient links, reduced motion, the full ICU review chain, and live Spring/H2 writes.

## Suggested PR description

Make Activity the mobile shift hub and expose real monitor history, data freshness, focused charting, and a sparse-data-friendly rounds queue. Preserve the existing API and deterministic care verification rules; add persistent navigation and protected primary-route gestures.

Validation: frontend tests, lint, production build. Risks: true-device touch behavior, exact viewport rendering and live backend integration have not been verified; the 15-minute stale label is a presentation policy requiring product review.
