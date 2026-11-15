param(
  [ValidatePattern('^[a-zA-Z0-9_-]+$')][string]$DatabaseName='hackathon-demo',
  [int]$Port=18184,
  [switch]$Deterministic
)
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$jar=Join-Path $root 'backend/target/achillea-0.1.0.jar'
if(-not(Test-Path -LiteralPath $jar)){throw 'Build first: mvn -f backend/pom.xml verify'}
$data=Join-Path $root '.demo-runtime/data'
New-Item -ItemType Directory -Force $data | Out-Null
$database=(Join-Path $data $DatabaseName).Replace('\','/')
$java=if($env:JAVA_HOME){Join-Path $env:JAVA_HOME 'bin/java.exe'}else{'java'}
$monitor=(-not $Deterministic.IsPresent).ToString().ToLowerInvariant()
Write-Host "Synthetic demo database: $database (existing records preserved)"
& $java -jar $jar "--server.port=$Port" '--server.address=127.0.0.1' "--spring.datasource.url=jdbc:h2:file:$database" '--app.demo-mode=true' "--app.monitor.enabled=$monitor"
exit $LASTEXITCODE
