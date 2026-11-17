param([string]$Target = '', [switch]$NoDeploy, [switch]$Test, [switch]$Installer, [string]$Delivery = '')
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'env.ps1') | Out-Null
$app = Split-Path -Parent $PSScriptRoot
Set-Location $app
$env:CSC_IDENTITY_AUTO_DISCOVERY = 'false'

npx tsc --noEmit -p tsconfig.node.json
if ($LASTEXITCODE -ne 0) { throw '类型检查失败（node）' }
npx tsc --noEmit -p tsconfig.web.json
if ($LASTEXITCODE -ne 0) { throw '类型检查失败（web）' }

if ($Installer -and $Test) { throw '-Installer 只打正式版' }
$outName = if ($Test) { 'dist-test' } elseif ($Installer) { 'dist-installer' } else { 'dist' }
$winTarget = if ($Installer) { 'nsis' } else { 'dir' }
if ($Test) { Remove-Item Env:CCSHELL_RELEASE -ErrorAction SilentlyContinue } else { $env:CCSHELL_RELEASE = '1' }
try {
  cmd /c "npx electron-vite build 2>&1" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw '构建失败' }
} finally {
  Remove-Item Env:CCSHELL_RELEASE -ErrorAction SilentlyContinue
}
if (-not $Test) {
  $leak = @(Get-ChildItem out -Recurse -File -Include *.js | Select-String -Pattern 'runSelfTest|quitTest|CCSHELL_SELFTEST|__ccshellGo' -List)
  if ($leak.Count) { throw "正式版里还有测试代码：$(($leak | ForEach-Object Path) -join ', ')" }
}
cmd /c "npx electron-builder --win $winTarget --publish never --config.directories.output=../.cache/$outName 2>&1" | Where-Object { $_ -match 'electron-builder|packaging|building|download|error|Error' }
if ($LASTEXITCODE -ne 0) { throw '打包失败' }
if ($Installer) {
  $ver = (Get-Content package.json -Raw -Encoding UTF8 | ConvertFrom-Json).version
  $setup = Join-Path (Split-Path -Parent $app) ".cache\$outName\CC-Shell-Setup-$ver.exe"
  if (-not (Test-Path $setup)) { throw "没找到安装包：$setup" }
  if (-not $Delivery) { $Delivery = Join-Path (Split-Path -Parent (Split-Path -Parent $app)) 'delivery' }
  New-Item -ItemType Directory -Force $Delivery | Out-Null
  $dest = Join-Path $Delivery ("CC Shell 客户端安装包-v$ver-" + (Get-Date -Format 'yyyy-MM-dd') + '.exe')
  Copy-Item $setup $dest -Force
  Write-Host "安装包：$dest（$([math]::Round((Get-Item $dest).Length / 1MB, 1)) MB）"
  $gh = Join-Path $Delivery "GitHub 发布文件-v$ver"
  if (Test-Path $gh) { Remove-Item $gh -Recurse -Force }
  New-Item -ItemType Directory -Force $gh | Out-Null
  $dist = Split-Path -Parent $setup
  foreach ($f in @($setup, "$setup.blockmap", (Join-Path $dist 'latest.yml'))) {
    if (-not (Test-Path $f)) { throw "没找到发布文件：$f" }
    Copy-Item $f $gh -Force
  }
  Write-Host "GitHub 发布文件：$gh"
  exit 0
}
$out = Join-Path (Split-Path -Parent $app) ".cache\$outName\win-unpacked"
Write-Host "打包完成（$(if ($Test) { '测试版' } else { '正式版' })）：$out"
if ($NoDeploy -or $Test -or -not $Target) { exit 0 }

New-Item -ItemType Directory -Force $Target | Out-Null
$Target = (Resolve-Path $Target).Path.TrimEnd('\')
$running = Get-CimInstance Win32_Process -Filter "Name = 'CC Shell.exe'" | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith("$Target\", [StringComparison]::OrdinalIgnoreCase) }
if ($running) {
  throw "$Target 里的 CC Shell 还在运行（pid $(($running | ForEach-Object ProcessId) -join ', ')，含会话后台进程）。先退出客户端并结束所有会话再打包。"
}
robocopy $out $Target /MIR /XD (Join-Path $Target 'data') (Join-Path $Target '.cache') /R:1 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { throw "复制失败（robocopy $LASTEXITCODE）" }
Write-Host "已复制到 $Target"
exit 0
