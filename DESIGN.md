# Achillea design direction

The current interface follows the user's Apple / Instagram / Fitbit direction: a distinctive calm bedside workspace with quick information access and low-friction, explicitly verified documentation. This supersedes the earlier forest-green dashboard/mockup specification.

## Visual identity

- White canvas, forest-green actions (#237A4B), pale mint selection (#E3F3E8), quiet surfaces (#F7FAF7), fine borders (#E8EEE9).
- Fraunces is reserved for the Achillea wordmark. Clinical content uses the system sans-serif stack for fast scanning.
- Dark primary text (#111111); supporting text uses #667085. Do not fade meaningful timestamps, provenance or instructions below readable contrast.
- Consistent 16px phone gutters, 8/12/16/24px spacing, restrained elevation, 18-24px panels and rounded controls. Avoid turning every line into a card.
- The shared masthead provides brand identity. Patient headers prioritize the patient's name and room, clear back navigation and relevant actions.

## Nurse workflows

- Recognizable destinations: Patients, Tasks, Monitoring, Handoff and Settings. Keep the floating navigation and visible destination labels.
- Monitoring combines room stories, labeled filters and readable measurement cards. Room number and patient identity remain visible. Patient record and documentation are directly reachable from monitoring detail.
- Patients supports search and retained navigation context. Summary, Timeline, Trends and Records progressively reveal the same patient record.
- Tasks is a care queue, not a statistics dashboard. Show the real due time, priority, patient and care context. Keep actions close to that context.
- Put bedside narrative entry before optional documentation metadata. Make save/review actions accessible without scrolling a long form back to its beginning.
- Handoff keeps outstanding original care visible and separates live context, nursing notes and saved history. Provide search, section navigation and clear saved/unsaved feedback.
- Settings exposes working controls only. The demo identity is not a connected production account.

## Clinical integrity

- Use persisted API records and stable patient/task IDs. Never invent observations, admission details, medications, clinical urgency or AI-authored notes.
- Movement detection is evidence, not verified care. Preserve explicit bedside verification, documentation review and handoff acknowledgment.
- Show source, observation time, missing/delayed/stale states and history coverage honestly. Do not interpolate across missing chart buckets or present averages as current readings.
- Shortcuts may save a draft or focus an action; they must not silently confirm clinical documentation or complete care.

## Interaction and responsive behavior

- Primary actions have at least 44px touch targets. Inputs use 16px text to avoid mobile keyboard zoom. Support keyboard focus and reduced motion.
- Modal sheets have a stable heading, scrollable body and reachable actions. The portal's display-contents theme host preserves component styling while the background is inert; do not remove that ancestry without rescoping sheet CSS.
- Preserve local unsaved work on errors; clearly distinguish a browser-retained draft from a successful backend save.
- Contain horizontal scrolling to charts/measurement carousels. Keep ordinary forms, lists and navigation within the viewport.
- Check 320/375/390/430px phones, 768px tablets and desktop. Test long names, open forms, keyboard navigation and real saves, not only empty pages.
- Use isolated synthetic data for walkthroughs. The user has requested agents to run through the site; rendered browser inspection is part of the current validation scope.

Implementation sources: frontend/src/ui.tsx, ui.css, tabbar.css and the scoped patient/task/handoff/monitoring styles. Existing backend verification and persisted workflow rules remain authoritative.
