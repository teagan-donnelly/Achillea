param(
  [string]$BaseUrl = 'http://127.0.0.1:18083',
  [ValidateSet('routine-shift', 'device-event', 'repositioning', 'bedside-documentation', 'adaptive-rounds')]
  [string]$Preset = 'routine-shift',
  [string]$PatientId,
  [switch]$ExecuteSteps
)

$ErrorActionPreference = 'Stop'
$base = $BaseUrl.TrimEnd('/')
$presetPath = "$base/api/demo/presets/$Preset"
if ($PatientId) { $presetPath += '?patientId=' + [Uri]::EscapeDataString($PatientId) }
# Setup adds synthetic evidence/tasks, but never resets data or confirms care.
$plan = Invoke-RestMethod -Method Post -Uri $presetPath
if (-not $ExecuteSteps) {
  $plan | ConvertTo-Json -Depth 30
  return
}

# This flag explicitly runs the scripted synthetic nurse actions, including confirmation.
# Intended only for an isolated demonstration, never real clinical documentation.
$bindings = @{}
foreach ($step in $plan.steps) {
  $path = $step.path
  foreach ($key in @($bindings.Keys)) {
    $path = $path.Replace('${' + $key + '}', [string]$bindings[$key])
  }
  Write-Output ($step.method + ' ' + $path + ' - ' + $step.title)
  if ($step.method -eq 'GET') {
    $result = Invoke-RestMethod -Method Get -Uri ($base + $path)
  } else {
    $result = Invoke-RestMethod -Method Post -Uri ($base + $path) -ContentType 'application/json' -Body ($step.body | ConvertTo-Json -Depth 20)
  }
  if ($step.captureAs) { $bindings[$step.captureAs] = $result.id }
}
Write-Output ('Completed synthetic guide: ' + $plan.key)
Write-Output ($plan.evidenceIds | ConvertTo-Json -Compress)
