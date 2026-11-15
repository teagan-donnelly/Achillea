# Historical Spring implementation

These are preserved reference files, not part of the Vercel application. `spring-boot/` contains the previous Java/Maven backend, scheduler, simulation ingestion/filtering, tests and helper scripts. `frontend/` retains the former Spring-specific live tests and standalone lockfile; `README.spring.md` retains the previous runbook.

Use the unchanged `feature/tiger-simulation` branch at `697ad60d6e11dc3d6b21ad2f3c22c934d57305a4` to run that complete implementation with its original paths. Do not run its seed, reset, ingestion or migration helpers against the Vercel application's integration database.

Historical SQL migrations were deliberately left at `backend/src/main/resources/db/migration/`, unchanged. Active code is `api/`, `server/` and the existing `frontend/`. The unused `frontend/src/DemoPresets.tsx` and its component fixtures are retained for historical regression reference; the deployed application does not import or offer that simulation controller.
