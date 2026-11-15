# Serves the local Achillea demo on your own domain through a named Cloudflare Tunnel.
#
# One-time prerequisites (see docs/PUBLIC_DOMAIN.md):
#   1. Domain's nameservers point to Cloudflare and the site shows "Active" in Cloudflare.
#   2. cloudflared.exe downloaded to .demo-runtime\cloudflared.exe (or on PATH).
#   3. Backend built (mvn -f backend/pom.xml verify) and frontend deps installed (cd frontend; npm ci).
#
# Usage (from the repository root):
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/Start-PublicDemo.ps1 -Hostname achillea.example.tech
#
# Opens the backend and frontend in their own windows, then runs the tunnel in this one.
# Stop with Ctrl+C here and close the two other windows.
param(
  [Parameter(Mandatory)][ValidatePattern('^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)+$')][string]$Hostname,
  [ValidatePattern('^[a-zA-Z0-9_-]+$')][string]$DatabaseName = 'hackathon-demo',
  [ValidatePattern('^[a-zA-Z0-9_-]+$')][string]$TunnelName = 'achillea',
  [int]$FrontendPort = 15274,
  [int]$BackendPort = 18184,
  [switch]$Deterministic
)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$runtime = Join-Path $root '.demo-runtime'
New-Item -ItemType Directory -Force $runtime | Out-Null

# --- cloudflared
$cloudflared = Join-Path $runtime 'cloudflared.exe'
if (-not (Test-Path -LiteralPath $cloudflared)) {
  $onPath = Get-Command cloudflared -ErrorAction SilentlyContinue
  if ($onPath) { $cloudflared = $onPath.Source }
  else { throw "cloudflared not found. Download it to $cloudflared (see docs/PUBLIC_DOMAIN.md)." }
}
if (-not (Test-Path -LiteralPath (Join-Path $root 'backend/target/achillea-0.1.0.jar'))) { throw 'Build first: mvn -f backend/pom.xml verify' }
if (-not (Test-Path -LiteralPath (Join-Path $root 'frontend/node_modules'))) { throw 'Install frontend first: cd frontend; npm ci' }

# --- Cloudflare login (opens a browser once; stores ~/.cloudflared/cert.pem)
$cfDir = Join-Path $env:USERPROFILE '.cloudflared'
if (-not (Test-Path -LiteralPath (Join-Path $cfDir 'cert.pem'))) {
  Write-Host 'Log in to Cloudflare in the browser window and select your domain...'
  & $cloudflared tunnel login
  if ($LASTEXITCODE -ne 0) { throw 'cloudflared login failed' }
}

# --- named tunnel (created once, reused afterwards)
$tunnels = & $cloudflared tunnel list --name $TunnelName --output json | ConvertFrom-Json
$tunnel = @($tunnels) | Where-Object { $_.name -eq $TunnelName } | Select-Object -First 1
if (-not $tunnel) {
  Write-Host "Creating tunnel '$TunnelName'..."
  & $cloudflared tunnel create $TunnelName
  if ($LASTEXITCODE -ne 0) { throw 'Tunnel creation failed' }
  $tunnel = @(& $cloudflared tunnel list --name $TunnelName --output json | ConvertFrom-Json) | Where-Object { $_.name -eq $TunnelName } | Select-Object -First 1
}
$tunnelId = $tunnel.id
$credentials = Join-Path $cfDir "$tunnelId.json"
if (-not (Test-Path -LiteralPath $credentials)) { throw "Tunnel credentials missing: $credentials. Delete the tunnel in Cloudflare and rerun, or copy the file from the machine that created it." }

# --- DNS record hostname -> tunnel (idempotent)
& $cloudflared tunnel route dns --overwrite-dns $TunnelName $Hostname
if ($LASTEXITCODE -ne 0) { throw "Could not create DNS record for $Hostname. Is the domain Active in Cloudflare?" }

# --- tunnel config (kept in ignored .demo-runtime)
$config = Join-Path $runtime "cloudflared-$TunnelName.yml"
@"
tunnel: $tunnelId
credentials-file: $credentials
ingress:
  - hostname: $Hostname
    service: http://127.0.0.1:$FrontendPort
  - service: http_status:404
"@ | Set-Content -Encoding utf8 -LiteralPath $config

# --- backend + frontend in their own windows
$backendArgs = @('-NoExit', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $PSScriptRoot 'Start-HackathonBackend.ps1'), '-DatabaseName', $DatabaseName, '-Port', $BackendPort)
if ($Deterministic) { $backendArgs += '-Deterministic' }
Start-Process powershell -ArgumentList $backendArgs -WorkingDirectory $root

Write-Host 'Waiting for backend...'
$deadline = (Get-Date).AddSeconds(90)
do {
  Start-Sleep -Seconds 1
  try { $ok = (Invoke-RestMethod "http://127.0.0.1:$BackendPort/api/health" -TimeoutSec 2).status -eq 'UP' } catch { $ok = $false }
} until ($ok -or (Get-Date) -gt $deadline)
if (-not $ok) { throw 'Backend did not start; check its window.' }

Start-Process powershell -WorkingDirectory $root -ArgumentList @('-NoExit', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $PSScriptRoot 'Start-HackathonFrontend.ps1'), '-Port', $FrontendPort, '-BackendPort', $BackendPort, '-PublicUrl', "https://$Hostname")

Write-Host ''
Write-Host "Public URL: https://$Hostname   (local: http://127.0.0.1:$FrontendPort)" -ForegroundColor Green
Write-Host 'Anyone with this URL can view and change demo data. Ctrl+C stops the tunnel.' -ForegroundColor Yellow
& $cloudflared tunnel --config $config run $TunnelName
