# Historical migrations only

The active application uses Vercel Functions in `api/` and `server/`. No Java/Maven backend is required on this branch. The earlier implementation is archived in `legacy/spring-boot/` and preserved unchanged on `feature/tiger-simulation`.

`src/main/resources/db/migration/V1__relational_workflows.sql` and `V2__external_simulation.sql` are unchanged historical references for the already initialized Tiger schema. The deployed application never executes them. Only the disposable local test runner applies copies to a fresh, isolated test database. See `docs/VERCEL_TIGER.md`.
