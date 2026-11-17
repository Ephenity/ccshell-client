param(
  [switch]$Dev,
  [Parameter(ValueFromRemainingArguments = $true)][string[]]$Packages
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'env.ps1')
Set-Location (Split-Path -Parent $PSScriptRoot)
$npmArgs = @('install', '--no-fund', '--no-audit')
if ($Dev) { $npmArgs += '--save-dev' }
if ($Packages) { $npmArgs += $Packages }
Write-Host "npm $($npmArgs -join ' ')"
$ErrorActionPreference = 'Continue'
& npm.cmd @npmArgs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
if (-not (Test-Path 'node_modules\electron\dist\electron.exe')) { node node_modules/electron/install.js }
exit $LASTEXITCODE
