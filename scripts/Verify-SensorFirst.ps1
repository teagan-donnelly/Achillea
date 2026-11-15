param([string]$BaseUrl='http://127.0.0.1:15474', [switch]$DisposableDatabase)
$ErrorActionPreference='Stop'
$target=[Uri]$BaseUrl
if (!$DisposableDatabase -or $target.Host -notin @('127.0.0.1','localhost')) { throw 'Requires an explicitly disposable loopback backend. Never target an existing demo.' }
function CallApi($path,$body=$null) {
  $args=@{Uri=($BaseUrl.TrimEnd('/')+'/api'+$path)}
  if ($null -ne $body) { $args.Method='Post'; $args.ContentType='application/json'; $args.Body=($body|ConvertTo-Json -Depth 12) }
  Invoke-RestMethod @args
}
if ((CallApi '/health').status -ne 'UP') { throw 'Backend unavailable' }
$null=CallApi '/demo/repositioning' @{}
$queue=CallApi '/repositioning?unit=ICU'
if ($queue.Count -ne 3) { throw 'ICU assignments missing' }
$patient=$queue | Where-Object scheduleStatus -eq 'OVERDUE' | Select-Object -First 1
if (!$patient) { throw 'Use a fresh disposable database for a reproducible overdue patient; existing confirmations are intentionally preserved.' }
$pidValue=$patient.patientId
$before=$patient.nextDueAt
$state=CallApi ("/demo/scenarios/coordinated?patientId="+$pidValue) @{}
$movement=$state.movements | Where-Object patientId -eq $pidValue | Sort-Object capturedAt | Select-Object -Last 1
$unchanged=(CallApi '/repositioning?unit=ICU') | Where-Object patientId -eq $pidValue
if ($unchanged.nextDueAt -ne $before -or $unchanged.lastConfirmedCareAt) { throw 'Movement incorrectly advanced care' }
$text='Synthetic verification: nurse explicitly observed prescribed repositioning and checked comfort.'
$state=CallApi ("/patients/"+$pidValue+"/repositioning/confirm") @{movementId=$movement.id;verified=$true;text=$text}
$after=(CallApi '/repositioning?unit=ICU') | Where-Object patientId -eq $pidValue
if ($after.scheduleStatus -ne 'ON_TRACK' -or !$after.lastConfirmedCareAt) { throw 'Confirmed care did not advance schedule' }
$chart=$state.charts | Where-Object { $_.linkedMovementId -eq $movement.id -and $_.status -eq 'CONFIRMED' } | Select-Object -Last 1
if (!$chart -or !($state.events | Where-Object type -eq 'repositioning.confirmed')) { throw 'Documentation/audit missing' }
try { $null=CallApi ("/patients/"+$pidValue+"/repositioning/confirm") @{movementId=$movement.id;verified=$true;text=$text}; throw 'Duplicate confirmation was accepted' } catch { if ($_.Exception.Response.StatusCode.value__ -ne 409) { throw } }
Write-Output "PASS: proxied API, ICU queue, movement without confirmation, explicit confirmed chart, advanced deadline, audit, duplicate prevention."
Write-Output ("Persistence check chart ID: "+$chart.id)
