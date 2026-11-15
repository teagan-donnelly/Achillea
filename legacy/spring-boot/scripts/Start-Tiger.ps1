param(
 [string]$JdbcUrl=$env:SPRING_DATASOURCE_URL,
 [string]$Username=$env:SPRING_DATASOURCE_USERNAME,
 [int]$Port=8080,
 [switch]$SeedIfEmpty,
 [switch]$EnableSimulation,
 [string]$Bindings='simulator-001=encounter-synthetic-icu-01'
)
$ErrorActionPreference='Stop'
if(-not $JdbcUrl){$JdbcUrl=Read-Host 'PostgreSQL JDBC URL (without password)'}
if(-not $JdbcUrl.StartsWith('jdbc:postgresql://')){throw 'A PostgreSQL JDBC URL is required'}
if(-not $Username){$Username=Read-Host 'Database username'}
$env:SPRING_DATASOURCE_URL=$JdbcUrl
$env:SPRING_DATASOURCE_USERNAME=$Username
function Read-ProcessSecret([string]$Prompt){$secured=Read-Host $Prompt -AsSecureString;$buffer=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secured);try{return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($buffer)}finally{[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($buffer)}}
if(-not $env:SPRING_DATASOURCE_PASSWORD){$env:SPRING_DATASOURCE_PASSWORD=Read-ProcessSecret 'Database password'}
$env:APP_SEED_SYNTHETIC_DATA=$SeedIfEmpty.IsPresent.ToString().ToLowerInvariant()
$env:APP_ALLOW_DEMO_RESET='false'
$env:MONITOR_SIMULATION_ENABLED='false'
$env:SIMULATION_INGESTION_ENABLED=$EnableSimulation.IsPresent.ToString().ToLowerInvariant()
if($EnableSimulation){if(-not $env:SIMULATION_API_KEY){$env:SIMULATION_API_KEY=Read-ProcessSecret 'Private simulator key (at least 24 characters; use the same key in the client)'};if($env:SIMULATION_API_KEY.Length -lt 24){throw 'Simulator key is too short'};$env:SIMULATION_BINDINGS=$Bindings}
$jar=Join-Path $PSScriptRoot '..\target\tiger\achillea-0.1.0.jar'
if(-not(Test-Path -LiteralPath $jar)){throw 'Build first: mvn -f backend/pom.xml -Dachillea.build.directory=target/tiger verify'}
$javaCommand=if($env:JAVA_HOME){Join-Path $env:JAVA_HOME 'bin\java.exe'}else{'java'}
try{& $javaCommand -jar $jar "--server.port=$Port"}finally{Remove-Item Env:SPRING_DATASOURCE_PASSWORD -ErrorAction SilentlyContinue;Remove-Item Env:SIMULATION_API_KEY -ErrorAction SilentlyContinue}
