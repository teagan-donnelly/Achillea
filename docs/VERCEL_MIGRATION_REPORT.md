# Vercel migration report

## Branch preservation

The clean source branch was `feature/tiger-simulation`, local and remote HEAD `697ad60d6e11dc3d6b21ad2f3c22c934d57305a4`. `feature/vercel-tiger` was created directly from that commit and pushed before implementation. No reset, stash, force-push, original-branch modification or merge into main was performed. The preexisting local brainstorming document remains preserved and locally ignored.

## Implementation

Session-password enforcement is now temporarily opt-in via `APP_AUTH_ENABLED=true`. With the default disabled setting, the workspace opens directly and API requests need no password/cookie or session secret. Existing same-origin, assignment, transaction and explicit-care checks remain active. Enabled-session behavior is retained and tested for later restoration.

The existing React/Vite frontend now calls TypeScript Node Vercel Functions in the same repository/deployment. `api/index.ts` dispatches the existing patient, history, device, rounds, activity and nursing command paths. `server/` contains TLS-verified PostgreSQL pooling, assignment-scoped SQL, presentation logic, transactions, workflow validation and demo session authentication. `vercel.json`, a root npm workspace/lockfile and Node-only development adapter provide deployment and local operation without a persistent production Node server, Java, Maven, Spring or Next.js.

Preserved functions include chart drafts, explicit confirmations, linked amendments, task acknowledgment/deferral/priority/reordering/completion, movement review and single-use evidence. Encounter row locks coordinate concurrent workflow requests; existing database unique constraints and chart/evidence guards remain authoritative. Confirmation does not follow from sensor movement automatically. Review only updates nurse-owned review columns, not simulator classification or raw evidence.

The old backend, its tests, scheduler, sensor adapter, ingestion pipeline and helper scripts remain available on the preserved Spring branch. The subsequent cleanup removed their redundant local archive, the former standalone frontend lockfile, Spring-specific live tests, unused preset UI/types/styles and obsolete runbooks from the Vercel branch. Current tests target the TypeScript handler; the old preset test is replaced with a check that the UI offers no generation/reset controls. Current entry points are README.md, VERCEL_TIGER.md and SIMULATOR_STORAGE_HANDOFF.md.

Generation controls, monitor updates, ingestion, filtering/classification, preset execution and reset are removed from the deployed application. Removed endpoints return 410. The UI displays externally stored data, and its former simulation panel now explains ownership. No external simulator repository was changed.

## Schema and records

No Tiger database connection, DDL, reset, migration, seeding or cleanup was executed during this TypeScript migration. Current live credentials were unavailable; the older password shared in chat was not reused. Existing Tiger records were therefore not touched by this work, but their current contents were not independently re-audited.

V1/V2 migration files remain at their original paths, byte-for-byte identical to the preserved branch. No production schema, table, column, constraint, index, key, hypertable or Timescale configuration was changed. The TypeScript runtime executes no DDL and has no startup seed/reset path. Test-only bootstrap applies unchanged migrations to a newly created disposable local PostgreSQL cluster and isolated `achillea_test_*` schema. It never creates a replacement application schema on Tiger.

## Executed checks

| Verification | Result |
|---|---|
| Node API/security/PostgreSQL tests | 27 passed |
| Frontend component + actual HTTP integration tests | 45 passed, including 4 live tests |
| Root/API and frontend TypeScript checks | Passed |
| Frontend ESLint | Passed |
| React/Vite production build | Passed |
| npm audit after compatible dependency patches | Zero vulnerabilities |
| Migration byte comparison against original branch | Identical |
| Live Tiger connection using TypeScript | Not executed; current credentials unavailable |
| Actual external simulator direct writer | Not available; not modified or tested |
| Vercel-hosted deployment, routing and login | Not executed; project/deployment access unavailable |
| Real browser/mobile device | Not executed; UI integration uses React/jsdom plus real HTTP |

The database suite ran on native PostgreSQL 14.22, not an in-memory SQL substitute. It exercises patient/unit/assignment scoping, server-side TLS settings, session forgery/rotation, CSRF, malformed/oversized inputs, history filters, inclusive delta ties, source timestamps, device freshness, stored sensor evidence, draft/confirmation/amendment behavior, cross-patient link rejection, concurrent movement consumption, review ownership, scheduling, deterministic rounds, persistence across pool restart and idempotent isolated seeding/cleanup. The live React suite covers assigned lists and actual historical trends, draft confirmation, unit switching/independent-region evidence, and SPA/API route separation through the local Vite/function adapter.

Synthetic fixtures contain six assigned patients across L&D and ICU plus an unassigned control patient. They are deterministic and confined to disposable local PostgreSQL. Test utilities refuse normal application schemas and hosted database hosts. No production/integration patient fixture was inserted. Temporary test files are retained for inspection and test services stop at completion.

## Deployment and remaining operator actions

Deploy from the repository root with Node 24 and the provided Vercel configuration. Configure `DATABASE_URL` (or the compatible `SPRING_DATASOURCE_URL`), database username/password, `APP_ACCESS_PASSWORD` and a distinct `APP_SESSION_SECRET` privately in Vercel. Select the existing `achillea` schema. Do not run historical reset/migration scripts. See [the exact guide](VERCEL_TIGER.md) and [external writer contract](backend/SIMULATOR_STORAGE_HANDOFF.md).

Preview deployment and direct-writer compatibility still need an operator with the current credentials and the simulator implementation. Local tests establish the migrated implementation's behavior, not live hosted performance or clinical validity. Initial compatibility/history snapshots can still grow large. One fixed demo nurse and shared-password sessions remain educational access controls, not enterprise hospital authentication. Typesense remains deferred.

The pre-commit scan reviewed all candidate files for live credentials, tokens, private keys and credential-bearing URLs. No live secret was identified; flagged literal credentials were verified as isolated test fixtures. The previously exposed Tiger password was absent from candidate files and reachable Git history. `.env*`, credential files, database/build outputs, `.vercel` and coverage remain excluded. No secret should be supplied through a `VITE_*` setting.
