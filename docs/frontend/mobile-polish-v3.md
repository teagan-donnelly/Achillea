# Achillea V3 mobile polish

## Branch and scope

Branch: `feature/mobile-polish`, based on `origin/integration/achillea-v2` at `af2d7d4b7b8c5de2d1a20932e37450b31833e74b`. Implemented in the separate `Achillea-mobile-polish` worktree to isolate parallel backend work. The original Achillea directory is unchanged. Only `frontend/**` and this frontend documentation are owned by this change. No main/integration merge was performed.

The supplied brief ends at the patient-detail measurement requirement “Last observation time”; the implementation addresses the supplied sections without assuming missing instructions.

## Experience changes

- Activity retains the default route, primary swipes, labeled bottom navigation, desktop navigation, unit selection and synthetic-data disclaimer. A compact shift overview precedes attention items. Four review links are shown initially with an explicit control to reveal all; no server history is deleted.
- Repeat `vital.received` events with identical patient/source/description in the same ten-minute window are folded into expandable receipt groups. Task, chart, device and review events break a grouping run. Original descriptions, timestamps and patient/source labels remain inside every group. A checkbox restores the ungrouped timeline. Grouping is a presentation choice, not a claim that a measurement is clinically routine or valid.
- Patient assignment cards show identity/context, review/task counts, at most three actual latest metrics, source/time/freshness, compact backend device availability, next care and a patient-workspace action. Metric selection prioritizes heart rate, oxygen saturation, respiratory rate, then temperature when those exist. Other available measurements remain in the record. No list-card graphs or fabricated values.
- Patient details have a concise care summary and one-action charting. Monitoring presents latest measurements plus one selectable historical chart with recorded-value disclosure. The existing quality/gap/freshness behavior remains. Full task forms live in the Care tasks view. ICU has a Sensors destination; L&D does not. Monitor simulation buttons are retained in a separate disclosure.
- Opening a patient from Activity or Rounds carries that section as return context; direct patient URLs default to the assignment list. Existing per-patient session draft retention, saved-draft review, confirmation and amendments remain. Section query changes also select the appropriate patient view.
- Rounds adds a Now/Next/Later schedule strip with actual counts and first-in-sequence due times. Anchors lead to occupied schedule groups or honest empty summaries. Backend ordering, horizons/reasons and task actions are unchanged.
- V3 styling is isolated in `frontend/src/v3.css`: compact desktop sidebar, stronger text/data hierarchy, smaller repetitive surfaces, a clear shift band, consistent schedule markers, phone-safe controls and reduced-motion support. No new packages were added.

## Run

From this worktree's `frontend`, run `npm ci`, then `npm run dev`. Start the existing Java 21 backend separately. Use Vite's printed localhost address. The original Achillea folder does not automatically display this branch's changes.

## Verification

Baseline: 27 tests passed, 7 opt-in live tests skipped; lint and build passed. V3 adds six tests for grouping preservation/boundaries, expanded and ungrouped history, graph-free compact cards, contextual return navigation, and selectable true-data trends. Final verification: 33 tests passed, 7 opt-in live tests skipped; lint and production build passed.

The existing live test script is updated for graph-free assignment cards, expanded simulation controls, focused care-task completion and measurement labels. It remains opt-in through `ACHILLEA_INTEGRATION_URL` and was not run against a shared backend; these tests reset synthetic records.

Unverified: actual phone swipes, browser rendering at 360/390/430/768/1280 CSS pixels, browser-native back/forward and screen-reader operation, and live API writes for this V3 revision. jsdom does not verify visual layout. Human review should check those widths, diagonal/vertical scrolling, chart interaction, keyboard focus, reduced motion, source status, chart draft retention, confirmation/amendments, and the ICU movement-to-care verification chain.

## Backend integration

No new endpoint, database field or backend enhancement is required. Existing optional device metadata is retained; absent metadata uses observation-age/quality and unavailable-state fallbacks. Additional observations/events/task schedules improve the current views automatically. More than three metrics are intentionally shown only in the patient record. Authoritative device heartbeat intervals and structured event severity would allow more precise future summaries; none are inferred here. Grouping uses only current event fields.

## Suggested PR description

Polish the integrated V2 mobile workspace by reducing assignment-card height, folding repeat monitor receipts without losing history, presenting selectable patient trends and a coherent rounds schedule, and returning focused patient flows to their entry section. Preserve API contracts, device metadata, clinical confirmations and draft retention.

Validate with frontend lint, tests and production build. Human phone and live-backend checks remain required; no main/integration merge is included.
