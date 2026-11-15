param([int]$Port=15274,[int]$BackendPort=18184,[string]$PublicUrl='')
$ErrorActionPreference='Stop'
$env:API_PROXY_TARGET="http://127.0.0.1:$BackendPort"
if($PublicUrl){$env:DEMO_PUBLIC_URL=$PublicUrl}else{Remove-Item Env:DEMO_PUBLIC_URL -ErrorAction SilentlyContinue}
Push-Location (Join-Path (Split-Path $PSScriptRoot -Parent) 'frontend')
try{npm.cmd run dev -- --port $Port --strictPort}finally{Pop-Location}
