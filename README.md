# Achillea

Care that moves with you. A React/Vite nursing workflow demo with TypeScript Vercel Functions and an existing Tiger Data PostgreSQL database. Synthetic data only; not for clinical use.

This is the `feature/vercel-tiger` architecture. The complete Spring Boot implementation is preserved on [`feature/tiger-simulation`](https://github.com/teagan-donnelly/Achillea/tree/feature/tiger-simulation) at `697ad60d6e11dc3d6b21ad2f3c22c934d57305a4`. Obsolete backend archives and runbooks have been removed from this branch.

Requires **Node 24** and npm. No Java, Maven, Next.js, Express server or separately hosted application backend is required.

```sh
npm ci
# Copy .env.example to .env.local and supply your private server settings.
npm run dev
```

Open `http://127.0.0.1:5173`. Session login is temporarily disabled by default, so the workspace opens directly. To restore it, set `APP_AUTH_ENABLED=true` and configure `APP_ACCESS_PASSWORD` plus a distinct `APP_SESSION_SECRET`. The local Node listener is only a development adapter for the same function handler Vercel executes in production.

Deploy the **repository root**, not `frontend/`, as a Vercel project. `vercel.json` builds the existing frontend to `frontend/dist`, routes `/api/*` to `api/index.ts`, and retains React deep links. Add server secrets in Vercel settings; see the [deployment guide](docs/VERCEL_TIGER.md).

The runtime does **not** migrate, seed, reset or alter Tiger. Historical V1/V2 SQL files remain byte-for-byte unchanged under `backend/src/main/resources/db/migration/`. The external simulator owns raw observations, orientation, classifications, stream state and device status. Achillea reads that evidence and writes only nursing workflow records and review fields. Movement never automatically confirms care.

```sh
npm run typecheck
npm run lint
npm run build
npm test                 # security + component tests; database/live tests skip without isolation
npm run test:db          # full suite on disposable native local PostgreSQL
npm audit
```

For `test:db`, install PostgreSQL locally and set `PG_BIN` to its bin directory. The runner can also discover the existing Windows test binary cache. It creates a fresh loopback database, applies the historical schema only there, runs API/HTTP/React checks, and stops it. It overrides all hosted database credentials. No Docker or Java is required. Test seeding and cleanup explicitly refuse hosted targets.

- [Deployment, ownership, endpoints and test instructions](docs/VERCEL_TIGER.md)
- [Migration report and verification limits](docs/VERCEL_MIGRATION_REPORT.md)
- [External simulator storage handoff](docs/backend/SIMULATOR_STORAGE_HANDOFF.md)
- [Product scope](PRODUCT.md)

The shared demo login is a development access gate, not hospital identity management. There is one configured demo nurse with database-backed patient assignments. Production authentication, validated clinical/hardware use, EHR integration, retention planning and sustained capacity testing remain outside this synthetic demo. Typesense is not implemented.
