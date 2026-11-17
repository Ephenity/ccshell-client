param([int]$Sessions = 1, [int]$TimeoutSec = 30)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'env.ps1') | Out-Null
$app = Split-Path -Parent $PSScriptRoot
Set-Location $app
$dataDir = Join-Path (Split-Path -Parent $app) 'data\quittest'
New-Item -ItemType Directory -Force $dataDir | Out-Null
$port = 5179
$mock = Start-Process node -ArgumentList 'tools/mock-ccshell.mjs', $port -PassThru -NoNewWindow `
  -RedirectStandardOutput (Join-Path $dataDir 'mock.log') -RedirectStandardError (Join-Path $dataDir 'mock.err.log')

function Get-Tree([int]$rootId) {
  $all = Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, Name
  $ids = @($rootId); $found = @()
  while ($ids.Count) {
    $kids = @($all | Where-Object { $ids -contains $_.ParentProcessId })
    $found += $kids; $ids = @($kids | ForEach-Object { $_.ProcessId })
  }
  $found
}

try {
  Start-Sleep -Milliseconds 800
  npm run build --silent | Out-Null
  if ($LASTEXITCODE -ne 0) { throw '构建失败' }
  $env:CCSHELL_PROFILE = 'quittest'
  $env:CCSHELL_QUITTEST = "http://127.0.0.1:$port"
  $env:CCSHELL_QUITTEST_N = "$Sessions"
  Remove-Item (Join-Path $dataDir 'quittest.txt') -ErrorAction SilentlyContinue
  $before = @(Get-Process claude -ErrorAction SilentlyContinue | ForEach-Object Id)
  $p = Start-Process .\node_modules\electron\dist\electron.exe -ArgumentList '.' -PassThru
  Remove-Item Env:CCSHELL_QUITTEST, Env:CCSHELL_QUITTEST_N, Env:CCSHELL_PROFILE
  $out = Join-Path $dataDir 'quittest.txt'
  $t0 = Get-Date; $claude = @()
  while (-not ((Test-Path $out) -and (Select-String -Path $out -Pattern 'app.quit' -Quiet))) {
    if ($p.HasExited) { break }
    $c = @(Get-Process claude -ErrorAction SilentlyContinue | Where-Object { $before -notcontains $_.Id } | ForEach-Object { [pscustomobject]@{ ProcessId = $_.Id } }); if ($c.Count) { $claude = $c }
    if (((Get-Date) - $t0).TotalSeconds -gt 120) { throw '等客户端调用退出超时' }
    Start-Sleep -Milliseconds 300
  }
  $quitAt = Get-Date
  $exited = $p.WaitForExit($TimeoutSec * 1000)
  $lines = Get-Content $out -Encoding UTF8
  $lines
  $quitLine = $lines | Where-Object { $_ -match 'app\.quit' } | Select-Object -First 1
  if ($exited -and $quitLine) {
    $quitAt = [DateTime]::Parse($quitLine.Split(' ')[0]).ToUniversalTime()
    $secs = [Math]::Round(($p.ExitTime.ToUniversalTime() - $quitAt).TotalSeconds, 1)
  } else { $secs = [Math]::Round(((Get-Date) - $quitAt).TotalSeconds, 1) }
  "退出前的 claude.exe：$(@($claude | ForEach-Object ProcessId) -join ', ')"
  $left = @($claude | Where-Object { Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue })
  if ($exited) { "结果：客户端 $secs 秒后退出，退出码 $($p.ExitCode)" }
  else {
    "结果：客户端 $TimeoutSec 秒内没有退出（卡住）"
    $tree = Get-Tree $p.Id
    "还活着的子进程：$(@($tree | ForEach-Object { "$($_.Name)#$($_.ProcessId)" }) -join ', ')"
    Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
    $tree | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  }
  "残留的 claude.exe：$(if ($left.Count) { @($left | ForEach-Object ProcessId) -join ', ' } else { '没有' })"
  $left | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
} finally {
  Stop-Process -Id $mock.Id -Force -ErrorAction SilentlyContinue
}
