param([string]$Packaged = '')
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'env.ps1') | Out-Null
$app = Split-Path -Parent $PSScriptRoot
Set-Location $app
if ($Packaged) { $Packaged = (Resolve-Path $Packaged).Path }
$dataDir = if ($Packaged) { Join-Path $Packaged 'data\selftest' } else { Join-Path (Split-Path -Parent $app) 'data\selftest' }
New-Item -ItemType Directory -Force $dataDir | Out-Null

$port = 5189
$env:MOCK_TTL = '3'
$mock = Start-Process node -ArgumentList 'tools/mock-ccshell.mjs', $port -PassThru -NoNewWindow `
  -RedirectStandardOutput (Join-Path $dataDir 'mock.log') -RedirectStandardError (Join-Path $dataDir 'mock.err.log')
try {
  Start-Sleep -Milliseconds 800
  if (-not $Packaged) {
    npm run build --silent | Out-Null
    if ($LASTEXITCODE -ne 0) { throw '构建失败' }
  }
  $env:CCSHELL_STUCK_TICK_MS = '1000'
  $env:CCSHELL_QUEUE_TICK_MS = '300'
  $env:CCSHELL_QUEUE_RETRY_SCALE = '0.005'
  $env:CCSHELL_CLAUDE_MAX_RETRIES = '0'
  $env:CCSHELL_SELFTEST = "http://127.0.0.1:$port"
  if ($Packaged) {
    $env:CCSHELL_DEV_APP = $app
    $p = Start-Process (Join-Path $Packaged 'CC Shell.exe') -PassThru -Wait
    Remove-Item Env:CCSHELL_DEV_APP
  } else {
    $p = Start-Process .\node_modules\electron\dist\electron.exe -ArgumentList '.' -PassThru -Wait
  }
  Remove-Item Env:CCSHELL_SELFTEST
  Get-Content (Join-Path $dataDir 'selftest.txt') -Encoding UTF8
  exit $p.ExitCode
} finally {
  Stop-Process -Id $mock.Id -Force -ErrorAction SilentlyContinue
}
