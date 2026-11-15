# Achillea

Care that moves with you. A React/TypeScript nursing workflow demo running on Vercel with an existing Tiger Data PostgreSQL database. Synthetic data only; not for clinical use.

This is the `feature/vercel-tiger` architecture. The complete Spring Boot implementation is preserved on [`feature/tiger-simulation`](https://github.com/teagan-donnelly/Achillea/tree/feature/tiger-simulation) at `697ad60d6e11dc3d6b21ad2f3c22c934d57305a4`. Obsolete backend archives and runbooks have been removed from this branch.

Requires **Node 24** and npm. No Java, Maven, Next.js, Express server or separately hosted application backend is required.

```sh
npm ci
# Keep your existing root .env.local database settings.
npm start
```

Open `http://localhost:3000`. `npm start` runs **Vercel CLI**, serving the React app and API functions together; `npm run dev` is an alias. The alias avoids Vercel's prohibition on a `dev` script directly invoking `vercel dev`. No Vite application server runs. Vercel CLI may request a one-time account login/project link if this computer has not already been linked. Session login is temporarily disabled by default. Existing database environment variable names and values are unchanged.

The project has a conventional root layout: `src/index.tsx` and React components, `public/index.html`, `api/` functions, `server/` workflow logic, and one `package.json`. There is no nested frontend workspace. `vercel.json` declares the generic React/static build, Vercel development command, root `dist/` output, and API/SPA routing. The React assets are compiled with esbuild; Vite is not used to build or serve the application. Existing Vercel database secrets still need to be configured in the hosting account; local `.env.local` is never uploaded as credentials. See the [deployment guide](docs/VERCEL_TIGER.md).

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
