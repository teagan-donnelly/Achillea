# V3 verification record — 2026-11-14

Branch feature/clinical-demo, based on origin/integration/achillea-v2 at af2d7d4b7b8c5de2d1a20932e37450b31833e74b. Work is limited to backend and docs/backend. No frontend edits, dependency upgrades, branch merges, or resets of existing persistent databases were performed.

## Complete Maven verification

Executed from repository root with Java 21.0.8, Maven 3.6.3 and the installed Maven repository:

```powershell
$env:JAVA_HOME = 'C:\Program Files\Eclipse Adoptium\jdk-21.0.8.9-hotspot'
& 'C:\Users\teaga\.m2\wrapper\dists\apache-maven-3.6.3-bin\1iopthnavndlasol9gbrbg6bf2\apache-maven-3.6.3\bin\mvn.cmd' '-Dmaven.repo.local=C:\Users\teaga\.m2\repository' '-Dachillea.build.directory=target/v3-final' -q -f backend/pom.xml verify
```

Exit 0. **43 tests, zero failures/errors/skips**:

| Suite | Tests | Coverage |
|---|---:|---|
| ClinicalDemoTest | 10 | Actual measurement summary accounting, append-only retention beyond old limits, inclusive polling ties/delay, device intervals/quality, every sensor scenario, technical/schedule tasks, five API guides each repeated twice, authorization, cross-task movement reuse, adaptive rounds and missing/legacy evidence |
| ClinicalEngineTest | 18 | Existing deterministic seed, monitoring history, transient disconnect/delay/reconnect, freshness, rounds, assignment isolation, validation, immutable chart/amendment provenance, movement reuse, legacy upgrade compatibility |
| WorkflowTest | 13 | Original ingestion/charting, sensor, task and nurse-verification behavior |
| RestartPersistenceTest | 1 | File-backed temporary H2 database closed/reopened with confirmed chart/provenance, acknowledged task, new scheduled task, sensor review evidence, technical task and manual disconnect preserved |
| DemoDisabledTest | 1 | Disabled scheduler and original/additive endpoints reject record operations |

All test databases are isolated memory stores or temporary files. The normal build initially reached packaging after passing tests, but Windows would not rename the JAR held open by the existing V2 server. The optional backend build-directory property was added to verify/package separately without stopping that server. Default output remains target. Final executable artifact: backend/target/v3-final/achillea-0.1.0.jar (ignored by Git).

Java formatting check passed for all ten changed/new Java files using the already-installed Prettier Java tooling. `git diff --check` passed. There is no backend lint plugin configured; no separate static-analysis result is claimed. No dependency changes were needed.

## Packaged server over real HTTP

Started the verified executable JAR at 127.0.0.1:18083 using `jdbc:h2:mem:clinical-v3-demo` and `app.monitor.enabled=false`. It did not open existing demo database files. `/api/health` reported UP. Ran all five presets through backend/scripts/Invoke-ClinicalDemo.ps1 with explicit `-ExecuteSteps`, using a process-only PowerShell execution-policy option because the local default blocks script files. All returned successfully:

- Routine-shift: assigned patient API, grouped measurement activity and rounds.
- Device-event: disconnected metadata, delayed connection, delayed measurement arrival, delta API and reconnect.
- Repositioning: both region histories, explicit nurse-confirmed movement, separate verified task completion, linked chart/history.
- Bedside-documentation: actual monitor evidence, draft, explicit confirmation, new amendment, separate amendment confirmation, activity.
- Adaptive-rounds: newly due task with explanation, acknowledgment and reasoned deferral, updated rounds.

Additional HTTP assertions passed: three assigned L&D patients, three ICU patients; confirmed bedside note; AMENDED addendum linked to original; one confirmed movement associated with its care-completion chart; no old measurements returned when polling since the latest snapshot; health still UP. Resulting demonstration state had six assigned patients, ten charts, 279 ICU observations, and 103 ICU activity presentation items. These counts describe that particular executed sequence, not fixed API promises.

The existing V2 application/server and persistent demo database were left intact. Browser/mobile UI testing was not performed; new frontend controls remain integration work. Physical sensors, bedside monitors, hospital authentication/EHR, and clinical validation are not implemented or verified. The demo rules are deterministic workflow illustrations, not clinical urgency scores. Raw history grows without pruning; production storage/pagination remains outside this prototype. See the [API contract](v3-contract.md) and [runbook](v3-demo-runbook.md).
