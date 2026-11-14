# V3 backend setup and demonstration

Branch: feature/clinical-demo. Base: af2d7d4b7b8c5de2d1a20932e37450b31833e74b from origin/integration/achillea-v2. No dependency changes. Requires Java 21 and Maven 3.6.3+; first install resolves Maven dependencies. Node is only needed to run the existing frontend.

From the repository root:

```powershell
git switch feature/clinical-demo
mvn -f backend/pom.xml verify
Set-Location backend
java -jar target/achillea-0.1.0.jar --server.port=18083 --spring.datasource.url=jdbc:h2:mem:clinical-v3-demo --app.monitor.enabled=false
```

The in-memory database above is disposable and disappears when the server stops. It does not open or reset existing files under backend/data. Keep the scheduler disabled for a recording without timer races. Invoke `/api/demo/scenarios/monitor-tick` explicitly when showing background feed behavior; ordinary presets need no sleeps. For a live feed, omit `--app.monitor.enabled=false`; the default cadence is 15 seconds, with device-specific observation intervals of 15/30/45 seconds. No API key or hardware is needed. Backend binds 127.0.0.1. Health: http://127.0.0.1:18083/api/health.

If an already-running Windows server holds `target/achillea-0.1.0.jar` open, use an isolated build output instead of stopping it:

```powershell
mvn -f backend/pom.xml -Dachillea.build.directory=target/v3-verify verify
Set-Location backend
java -jar target/v3-verify/achillea-0.1.0.jar --server.port=18083 --spring.datasource.url=jdbc:h2:mem:clinical-v3-demo --app.monitor.enabled=false
```

`achillea.build.directory` is an optional backend-only Maven property; the default remains target. It changes no dependencies or runtime behavior. Use the same option with the explicit Maven executable below when needed.

If Maven is not on PATH on this development machine, use from the repository root:

```powershell
$env:JAVA_HOME = 'C:\Program Files\Eclipse Adoptium\jdk-21.0.8.9-hotspot'
$maven = 'C:\Users\teaga\.m2\wrapper\dists\apache-maven-3.6.3-bin\1iopthnavndlasol9gbrbg6bf2\apache-maven-3.6.3\bin\mvn.cmd'
& $maven '-Dmaven.repo.local=C:\Users\teaga\.m2\repository' -f backend/pom.xml verify
```

To test persistence manually, select a **new** file path instead of the in-memory URL, e.g. `--spring.datasource.url=jdbc:h2:file:./target/v3-disposable-persistence`. Start from backend, run a documentation guide, stop the server, restart with the exact same command and inspect `/api/patients/synthetic-ld-01/chart` and `/api/events`. Do not reset between restarts. The automated suite separately does this with a temporary file and closes/reopens Spring application contexts.

The only destructive operation is the existing `POST /api/demo/reset`. For a repeatable clean recording, call it **only against the disposable server above**. It discards that database's entire synthetic aggregate. Presets never call reset, never delete historical data, and never automatically confirm care. Startup seeds only when there is no aggregate.

## Optional existing frontend

In another terminal from repository root:

```powershell
Set-Location frontend
npm.cmd ci
$env:API_PROXY_TARGET = 'http://127.0.0.1:18083'
npm.cmd run dev -- --port 15174 --strictPort
```

Open http://127.0.0.1:15174/. Original frontend workflows continue through the unchanged APIs. New V3 summary/preset controls require frontend integration; selecting this backend branch does not itself add those screens. These commands do not require stopping any existing V2 server at other ports. Frontend installation/UI execution is outside this backend verification scope.

## Two-minute demonstration

Plan 20 seconds for routine monitoring, 20 for device loss/delay, 35 for movement review and separate completion, 30 for draft/confirmation/amendment, and 15 for adaptive rounds. No timer waits are required. API setup examples:

```powershell
$base = 'http://127.0.0.1:18083'
Invoke-RestMethod "$base/api/demo/presets"
$plan = Invoke-RestMethod -Method Post "$base/api/demo/presets/repositioning"
$plan.evidenceIds
$plan.steps | Format-Table title,method,path
```

Each preset supplies concrete evidence/task IDs. Execute its steps individually to narrate the workflow. Repositioning care remains OPEN until the explicit verified task completion call. Documentation remains a draft until the explicit confirmation call, and the original confirmed note remains unchanged after amendment. Adaptive-rounds includes the original rounds in beforeRounds for comparison. Device delay shows stale capture time even though receipt time is current.

For a repeatable API walkthrough from repository root, the helper adds setup and prints the guide by default:

```powershell
.\backend\scripts\Invoke-ClinicalDemo.ps1 -Preset repositioning
```

`-ExecuteSteps` explicitly opts into **scripted synthetic nurse confirmation/completion**. This is a demonstration driver, not background application behavior. Use only with a disposable synthetic database:

```powershell
.\backend\scripts\Invoke-ClinicalDemo.ps1 -Preset routine-shift -ExecuteSteps
.\backend\scripts\Invoke-ClinicalDemo.ps1 -Preset device-event -ExecuteSteps
.\backend\scripts\Invoke-ClinicalDemo.ps1 -Preset repositioning -ExecuteSteps
.\backend\scripts\Invoke-ClinicalDemo.ps1 -Preset bedside-documentation -ExecuteSteps
.\backend\scripts\Invoke-ClinicalDemo.ps1 -Preset adaptive-rounds -ExecuteSteps
```

Optional `-PatientId` selects another assigned patient; `-BaseUrl` selects the server. The driver binds draft/amendment response IDs into later commands. It never resets or deletes data. Repeated runs add new UUID evidence; deterministic outcomes do not mean byte-identical identities. The automated fixed-clock tests reset only their isolated in-memory database and compare workflow outcomes across repeated runs.

On this development machine PowerShell blocks `.ps1` execution by default. The verified invocation uses a process-only policy option, without changing the machine/user policy:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\backend\scripts\Invoke-ClinicalDemo.ps1 -BaseUrl http://127.0.0.1:18083 -Preset repositioning -ExecuteSteps
```

## Verification and boundaries

Run `mvn -f backend/pom.xml verify` for all existing and new tests plus executable JAR packaging. Tests cover summary counts/traceability, raw retention past old limits, interval/quality behavior, inclusive polling and delayed receipt, sensor scenarios and missing regions, technical review, schedule changes, all five real API guides repeated twice, unauthorized/unit scope/disabled mode, evidence reuse, original chart/task workflows, legacy snapshots, and file-backed restart persistence.

No browser verification or hardware integration is claimed. Existing demo assignment checks are not hospital authentication. The single-process JSON aggregate retains raw events/observations indefinitely: storage and response sizes grow, so production archiving/pagination would require separate work. Measurements/rules are synthetic; there is no validated clinical scoring, diagnosis, pressure-offloading verification, physical sensor calibration, hospital monitor integration, or external AI dependency. Historical events deleted by earlier V2 retention cannot be recovered; V3 stops further pruning.
