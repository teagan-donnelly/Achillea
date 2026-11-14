# Existing Vercel project + Tiger Data

Prepared 2026-11-14. Target: the **existing** project serving https://frontend-one-alpha-45.vercel.app. No Vercel account settings, environment variables, domains, or deployments were changed during this work. No duplicate project was created. Deployment requires the owner's confirmation and account access; the CLI is not authenticated here.

## Architecture and support

The repository-root `vercel.json` defines Vercel Services: Vite frontend plus a Java 21 OCI container built with `backend/Dockerfile.vercel`. `/api` and `/api/*` route to Spring with the original request path; other requests route to the frontend with its SPA fallback. Frontend requests remain same-origin, including session cookies and simulator requests. No database passwords or simulator keys belong in browser code.

Official references checked during implementation: [Services configuration](https://vercel.com/kb/guide/vercel-services), [OCI container support](https://vercel.com/kb/guide/does-vercel-support-docker-deployments), [configuration schema](https://openapi.vercel.sh/vercel.json), [Git deployment controls](https://vercel.com/docs/project-configuration/git-configuration), and [Daemons](https://vercel.com/docs/daemons). Container Functions and Daemons are beta capabilities; confirm availability in the existing team before deployment. This is a container service, not a Java HTTP function adapter. Docker is unavailable on this computer, so the container image itself has not been built or run here.

`integration/achillea-tiger` has Git automatic deployment disabled in **both** root and `frontend/vercel.json`. The second file covers the project's current frontend Root Directory. Pushing this branch is for review and must not publish it. The main branch's Git behavior is unchanged. Keep these guards until deployment is approved; a later merge into a production branch can still trigger that branch's normal deployments.

## Owner dashboard checklist — do not apply until approved

1. Open the existing domain's Vercel project, and confirm its project/team and connected repository. Do not import a new project. Confirm Services/container support is available for this team.
2. In **Settings → Build and Deployment**, change **Root Directory** from `frontend` to the repository root (blank/root as the dashboard presents it). Clear old project-level frontend install/build/output overrides; the two services now define their own commands and output. Do not apply a global Vite output-directory override to the backend. Record current settings first for rollback.
3. Keep the existing domain and Production Branch unchanged. Review the integration branch using an explicitly approved preview deployment before changing production. Do not remove the branch's Git guard merely to obtain a preview.
4. In **Settings → Environment Variables**, add the server-side variables below. Select the intended environment explicitly. Use a separate disposable PostgreSQL database/schema and distinct secrets for Preview; do not point automated preview tests at saved production data. If the dashboard offers service scoping, scope these to `backend`. Never add a `VITE_` prefix to a secret. Changing variables requires a new deployment to take effect.
5. Rotate the previously shared Tiger password **before** using it, then enter the new password directly in Vercel. Do not send it through chat, commit it, embed it in the JDBC URL, or put it in command history. Keep TLS certificate/hostname validation enabled.

### Backend environment variables

| Name | Value / instruction |
|---|---|
| `SPRING_PROFILES_ACTIVE` | `vercel` |
| `PORT` | `8080` — required for Vercel's service router as well as Spring; Docker's ENV alone does not configure the router |
| `SPRING_DATASOURCE_URL` | `jdbc:postgresql://HOST:PORT/tsdb?sslmode=verify-full&sslfactory=org.postgresql.ssl.DefaultJavaSSLFactory` using the Tiger-provided host/port/database |
| `SPRING_DATASOURCE_USERNAME` | Tiger database user; preferably an appropriately restricted application role |
| `SPRING_DATASOURCE_PASSWORD` | Rotated secret, entered directly in the dashboard |
| `DB_SCHEMA` | `achillea` for the existing initialized database; isolate previews |
| `DATABASE_SSLMODE` | `verify-full` |
| `DB_POOL_MAX` | `3` initially; size total connections for concurrently active containers and Tiger limits |
| `DB_POOL_MIN` | `0` |
| `APP_DEMO_MODE` | `true` for synthetic demonstration workflows |
| `APP_ACCESS_ENABLED` | `true` (also enforced by the Vercel profile) |
| `APP_ACCESS_PASSWORD` | New random shared demo password, at least 24 characters |
| `APP_SESSION_SECRET` | Independent random signing secret, at least 32 characters; identical across backend instances |
| `APP_SECURE_COOKIE` | `true` |
| `APP_SEED_SYNTHETIC_DATA` | `false` for the existing database |
| `APP_ALLOW_DEMO_RESET` | `false` |
| `MONITOR_SIMULATION_ENABLED` | `false` |
| `SIMULATION_INGESTION_ENABLED` | `false` until the external simulator is configured; then `true` |
| `SIMULATION_API_KEY` | If ingestion enabled: independent secret, at least 24 characters; only backend and external simulator receive it |
| `SIMULATION_BINDINGS` | If enabled: approved source-to-encounter bindings, e.g. `simulator-001=encounter-synthetic-icu-01`; confirm IDs against the selected database |

Do not set `LEGACY_IMPORT_FILE`, disable Flyway, enable destructive reset, or weaken TLS. There is no deployed H2 fallback. `DATABASE_URL`, if used instead, must be a PostgreSQL **JDBC** URL, not a `postgres://` URI. Avoid conflicting aliases.

Flyway V1/V2 run on startup and retain existing records. With separate migration credentials, also configure `SPRING_FLYWAY_URL` (the same explicit `verify-full` JDBC options), `SPRING_FLYWAY_USER`, and `SPRING_FLYWAY_PASSWORD`. The migration role needs schema creation/migration privileges; an application role needs the runtime table/sequence privileges. Never run Flyway clean or edit already-applied migrations. Back up the database before an approved hosted migration. A code rollback does not roll back schema changes.

The migration branch reports previously initializing Tiger, but this session did **not** reconnect to that database. Check its migration history and existing synthetic records before deployment. Only for an approved **empty** database, bootstrap once using `backend/scripts/Start-Tiger.ps1 -SeedIfEmpty`; it seeds only if empty. Keep seeding disabled for normal hosted startup. See [Tiger setup](backend/tiger-data-setup.md) for connection and migration details.

## Deployment commands — only after account/configuration confirmation

Run from repository root. The pinned CLI version reviewed was 65.16.0:

```powershell
npx --yes vercel@65.16.0 login
npx --yes vercel@65.16.0 link
```

In `link`, select the existing team and existing project that serves the supplied domain. Stop if offered creation of a new project. Privately verify `.vercel/project.json` identifies that project; this directory is ignored. Do not pull secrets into tracked files or paste CLI credentials in chat.

After owner approval of configuration and a preview deployment:

```powershell
npx --yes vercel@65.16.0 deploy
```

Inspect build/runtime logs without copying secrets. Production publication requires the owner's separate go-ahead after preview checks; no production command was run here. Do not change the production branch or domain to work around failures.

To test the container locally on a Docker-equipped machine:

```powershell
docker build -f backend/Dockerfile.vercel -t achillea-backend backend
docker run --rm -p 8080:8080 --env-file .env.vercel.local achillea-backend
```

Create the ignored `.env.vercel.local` privately using the server variables above and a disposable TLS-enabled PostgreSQL database. Keep the Vercel profile's secure cookie enabled and use an HTTPS reverse proxy for authenticated browser testing. The image is non-root and stores all clinical state in PostgreSQL. Container base tags can change upstream; the Maven version and JAR output timestamp are pinned, but a byte-identical image is not claimed.

## Simulator and access behavior

HTTP containers can idle or restart. The Vercel profile disables the scheduled in-process monitor loop and fails startup if it is re-enabled. The supported initial workflow is an external teammate/local simulator posting authenticated batches to `/api/integrations/simulation/v1/observations`, with `X-Simulation-Key`; processed feedback is available from `/processed`. Use the existing [simulator contract and client](backend/simulator-integration.md). Retries are idempotent. This integration does not provision an always-running worker or claim continuous autonomous simulation. Manual demo scenarios remain available after login. A future Vercel Daemon would need explicit production-only provisioning/cost review; none was created here.

All patient, charting, rounds, and demo APIs require a signed demo session when deployed. `/api/health` and `/api/session` are public; simulator routes use their separate key instead of the session. The shared demo password creates an eight-hour HttpOnly, Secure, SameSite=Strict cookie. Signing secrets must remain stable across instances; rotating the signing secret invalidates existing cookies. Sign-out clears the browser cookie; copied tokens remain valid until expiry or key rotation. Login throttling is per instance, not a distributed abuse-control service. Consider the team's Vercel WAF controls for public exposure. This is synthetic-demo access control, not hospital identity, individual nurse authorization, or clinical production authentication.

## Verification and acceptance

Local verification uses actual disposable native PostgreSQL, not saved Tiger data: 60 backend tests (including restart persistence, relational constraints, immutable charting, simulation retries and access protection) passed with Maven `verify`. All 51 frontend tests passed, including nine actual-HTTP React/jsdom tests through Vite and Spring; these are not browser/device verification. Typecheck, lint, production build, and npm audit (zero vulnerabilities) passed. An additional real HTTP simulator submission accepted one observation and acknowledged its identical retry as one duplicate. Root and legacy frontend Vercel configurations validated against the official JSON schema. No cloud account, rotated Tiger credentials, Docker engine, or authenticated Vercel CLI was available, so hosted TLS connectivity, OCI execution, public routing, cold-start latency, and mobile browser appearance remain unverified.

On an approved preview, check health, unauthenticated 401 responses and login; retrieve assigned patients in both L&D and ICU; inspect measurements, Activity, monitoring history, sensor review and rounds priorities; create/confirm/amend a uniquely labeled synthetic chart and verify persistence across a backend restart; check missing/stale/disconnected states and simulator duplicate acknowledgments. Do not reset existing records. Use a disposable preview database for automated tests; the live test suite intentionally refuses non-loopback targets. Review logs for credential leakage and confirm unauthenticated simulator requests fail. Only then approve production publication in the existing project.
