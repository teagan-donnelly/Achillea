# Verification evidence

Verified on November 14, 2026, on `feature/clinical-data`, based on main commit `874f2ee05a50c9e8c0b9078ef3535625fd5ddc3c`. No browser automation was used. No frontend or shared root files were modified. No physical hardware, EHR, external authentication, or AI integration was tested or claimed.

## Automated tests and build

Executed from the repository root using Java 21.0.8:

```powershell
$env:JAVA_HOME='C:\Program Files\Eclipse Adoptium\jdk-21.0.8.9-hotspot'
& 'C:\Users\teaga\.m2\wrapper\dists\apache-maven-3.6.3-bin\1iopthnavndlasol9gbrbg6bf2\apache-maven-3.6.3\bin\mvn.cmd' '-Dmaven.repo.local=C:\Users\teaga\.m2\repository' -q -f backend/pom.xml verify
```

Result: **33 tests passed, 0 failures, 0 errors, 0 skipped; verify/package succeeded**.

| Test class | Passed | Coverage |
|---|---:|---|
| WorkflowTest | 13 | Original workflow regression coverage updated for expanded seeded data; source idempotence; draft integrity; verification and assignment checks |
| ClinicalEngineTest | 18 | Fixed/mutable-clock reset reproducibility; current-relative and timezone-safe schedules; census/assignment scope; vital ranges/units/sources; stale and disconnected devices; scheduled tick behavior; delayed arrivals; independent sensor chronology; task actions; cross-patient links; amendment integrity; legacy data compatibility |
| DemoDisabledTest | 1 | Scheduler absent and new/old demo endpoints denied when demo mode is off |
| RestartPersistenceTest | 1 | Close and reopen the whole Spring application against a temporary file H2 database; confirmed note, vital links, provenance, task and history survive |

The first test run exposed inconsistent reset freshness metadata; this was fixed. Subsequent regression checks preserve legacy disconnection and distinguish original sample time from recent receipt time. Automatic delayed packets are retained as delayed observations, including out-of-order arrivals.

Java formatting was checked on every changed/new Java file with the already installed Prettier Java formatter; all passed. `git diff --check` passed. The backend has no dedicated Java lint/static-analysis plugin; no such lint pass is claimed. No backend dependency versions were changed.

## Direct HTTP walkthrough

Started the packaged backend from `backend/` on a separate test port and database:

```powershell
java -jar target/achillea-0.1.0.jar --server.port=18080 --spring.datasource.url=jdbc:h2:file:./target/clinical-smoke --app.monitor.cadence-ms=2000 --app.monitor.initial-delay-ms=2000
```

Used PowerShell `Invoke-RestMethod` against `http://127.0.0.1:18080/api` and checked results:

- health UP; explicit reset; 3 assigned L&D and 3 assigned ICU patients versus 10 L&D census patients;
- Now/Next/Later all present in L&D rounds;
- metric-filtered five-point heart-rate history;
- create and confirm bedside draft linked to a genuine observation;
- create and confirm append-only amendment; original record remains confirmed;
- acknowledge and defer a task with a reason;
- partial then coordinated sensor scenarios; candidate remains UNREVIEWED;
- explicit movement verification followed by prescribed-task completion;
- disconnect pelvis, trigger coordinated movement, observe UNKNOWN; reconnect;
- flagged synthetic reading and chart-amended event filter;
- background monitorTick advanced without manual tick trigger.

## Separate Java-process restart proof

The first Java process was stopped after the HTTP-created confirmed entry. A new Java process was launched against the **same file database**, with no reset:

```powershell
java -jar target/achillea-0.1.0.jar --server.port=18080 --spring.datasource.url=jdbc:h2:file:./target/clinical-smoke --app.monitor.enabled=false
```

HTTP reads verified:

- confirmed chart `00f480d6-e653-48d2-a33d-61325f0556d3` retained its exact text, confirmation, and one linked vital;
- its correction remained AMENDED with the original amendmentOfId link;
- task-1 remained DEFERRED and task-3 remained COMPLETED;
- the chart.amended event remained available through patient/type filtering;
- ICU census remained 7 patients and 21 tasks;
- orientation history and three patient devices remained available;
- the additive manual monitor-tick trigger generated an audited trigger on the final packaged code.

The test server was stopped afterward. The test database and proof JSON live under ignored backend/target, not in the commit.

## Limits of this evidence

This verifies the local backend and its HTTP/JSON contract, not end-to-end frontend behavior, mobile layout, hardware accuracy, clinical utility, production security, or hospital compatibility. Periodic streams, chest/pelvis observations, device disconnections, and patient data are simulated. Production remains outside scope. Existing databases require an explicit reset to opt into the expanded seed; ordinary restart preserves the old dataset.
