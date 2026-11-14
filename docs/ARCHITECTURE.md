# Architecture
```mermaid
flowchart LR
  React[React mobile nurse UI] -->|typed REST / 3 second polling| Vite[Vite API proxy]
  Vite --> Controller[Spring REST controller]
  Controller --> Care[Transactional care service]
  Care --> Sim[SensorAdapter simulator]
  Care --> JPA[JPA versioned demo aggregate]
  JPA --> H2[(File H2)]
```

React Router owns navigation. A typed fetch client reports errors and refreshes the authoritative state after writes; background polling reconnects automatically. Note form state remains local while observations refresh. No UI-only clinical state mutations exist.

The backend owns assignments, task transitions, rounds ranking, draft/confirmed state, provenance, sensor candidates, and audit events. Nurse identity is the fixed local demo persona `nurse-demo`. Each patient read or mutation validates the assignment. UI unit switching models separate L&D and ICU deployments, not a real simultaneous cross-unit assignment. `/api/state` is an aggregate endpoint exposing all this demo persona's synthetic assignments; the UI restricts each unit view.

Implementation choice: to keep reset and linked task/chart writes atomic in the small hackathon dataset, JPA stores a versioned JSON demo aggregate in a single H2 CLOB. This keeps the requested stack and durable database, but is intentionally not a normalized production clinical database. Commands use a service transaction and optimistic row version. One local backend process is supported. Separate indexed entity tables, migrations, pagination across the aggregate endpoint, and real authenticated sessions remain production work.

UUIDs identify newly created observations and events; seeded patients/tasks have stable IDs. Seed due times are relative to reset time. Demo scenarios use no background timer, making the recording sequence repeatable. Database survives backend restart; reset intentionally recreates synthetic records and clears notes. UTC instants are displayed in the browser's local timezone.

Clinical provenance has three distinct layers: simulated source observation, derived movement candidate (prototype heuristic), and nurse-confirmed care. Confirming a movement never completes its task. Task completion with verified movement and chart creation occur in one transaction. Chart confirmation alone never completes a task. Corrections append new linked entries.

`APP_DEMO_MODE=false` rejects all demo data/command endpoints; health and context remain readable. The backend binds loopback, and Vite proxies same-origin API requests. There is no production authentication, EHR, external gateway, or AI dependency. API errors include status, message, UTC timestamp, and correlation ID. Transport failure leaves the loaded UI and unsaved narrative available, with Retry connection.

## Mobile nursing workspace

Activity is the default route (`/`); `/activity` remains a supported alias. The three main destinations are Activity, Patients, and Rounds. On phones the navigation stays at the bottom with safe-area padding; larger screens retain a compact sidebar. `SwipeNavigation` changes only primary routes after a predominantly horizontal drag of at least 70 CSS pixels. Vertical movement cancels the gesture; controls, patient detail, task forms, and horizontal reading histories opt out. Links and keyboard navigation remain available (Alt + left/right inside the workspace).

`WorkspaceViews` derives attention items, patient measurements, and timeline filters from the authoritative aggregate. Rounds uses backend ranks directly: ranks 0/1 are Now, rank 2 is Next, rank 3 is Later. These groups indicate workflow timing and explicit nurse priority, not clinical triage. Blood pressure is not exposed by the existing monitor contract and is not fabricated.

Unconfirmed bedside chart form values are retained per patient in browser-tab session storage, including unsaved text and saved draft IDs. Navigating back restores the working note; reload/close prompts when a working note exists. Saving still writes through the existing draft API, and confirmation remains explicit. Metadata or source-selection changes require saving again before confirmation. Confirming removes the local working copy; demo reset clears local working copies. Browser-tab retention is temporary and is not a substitute for saving a server draft. Confirmed records and amendments retain their existing append-only backend behavior.

Frontend verification: `npm test` covers primary-route gestures, vertical-scroll and control exclusions, direct and keyboard navigation, activity filters, note restoration, chart confirmation/amendments, deferral, movement review, and verified repositioning completion. Tests use jsdom and mocked API responses; they do not establish real device responsiveness or live Spring/H2 integration. Real browser/device checks at 360, 390, 430, 768, and 1280 CSS pixels remain manual validation work.
