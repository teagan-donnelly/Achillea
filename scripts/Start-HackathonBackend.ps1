param(
  [ValidatePattern('^[a-zA-Z0-9_-]+$')][string]$DatabaseName='hackathon-demo',
  [int]$Port=18184,
  [switch]$Deterministic,
  # For simulator/: seeds only the simulator's 5 ICU patients (no synthetic history), disables the built-in
  # fake monitor, and assigns ICU 04-07 to the demo nurse (also on older databases).
  [switch]$Simulator,
  # Turn off the backend-managed recorded-data replay (on by default in census mode).
  [switch]$NoReplay,
  # Replay speed: 1, 5 or 10 recorded minutes per real second.
  [ValidateSet(1,5,10)][int]$ReplaySpeed=10
)
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$jar=Join-Path $root 'backend/target/achillea-0.1.0.jar'
if(-not(Test-Path -LiteralPath $jar)){throw 'Build first: mvn -f backend/pom.xml verify'}
$data=Join-Path $root '.demo-runtime/data'
New-Item -ItemType Directory -Force $data | Out-Null
$database=(Join-Path $data $DatabaseName).Replace('\','/')
$java=if($env:JAVA_HOME){Join-Path $env:JAVA_HOME 'bin/java.exe'}else{'java'}
$monitor=(-not ($Deterministic.IsPresent -or $Simulator.IsPresent)).ToString().ToLowerInvariant()
$replay=(-not ($Deterministic.IsPresent -or $Simulator.IsPresent -or $NoReplay.IsPresent)).ToString().ToLowerInvariant()
# ICU 04-07 carry recorded MIMIC-IV demo data; assign them so the replay census shows several patients.
$assign=if($Simulator -or $replay -eq 'true'){'synthetic-icu-04,synthetic-icu-05,synthetic-icu-06,synthetic-icu-07'}else{''}
$seed=if($Simulator){'simulator'}else{'census'}
Write-Host "Synthetic demo database: $database (existing records preserved)"
if($replay -eq 'true'){Write-Host "Recorded data replay: on (speed ${ReplaySpeed}x, loops). Do not also run simulator/ against this backend."}
if($Simulator){
  Write-Host 'Simulator mode: only simulator patients, no seeded data; built-in monitor off'
  if(Test-Path -LiteralPath "$database.mv.db"){Write-Warning "Database '$DatabaseName' already exists and keeps any records seeded earlier. Use a new -DatabaseName for a simulator-only database."}
}
& $java -jar $jar "--server.port=$Port" '--server.address=127.0.0.1' "--spring.datasource.url=jdbc:h2:file:$database" '--app.demo-mode=true' "--app.monitor.enabled=$monitor" "--app.demo.assign-patients=$assign" "--app.demo.seed=$seed" "--app.replay.enabled=$replay" "--app.replay.speed=$ReplaySpeed"
exit $LASTEXITCODE
