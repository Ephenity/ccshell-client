$root  = Split-Path -Parent (Split-Path -Parent $PSCommandPath)
$cache = Join-Path (Split-Path -Parent $root) '.cache'

$dirs = @{
  npm      = Join-Path $cache 'npm'
  electron = Join-Path $cache 'electron'
  builder  = Join-Path $cache 'electron-builder'
  gyp      = Join-Path $cache 'node-gyp'
  tmp      = Join-Path $cache 'tmp'
}
foreach ($d in $dirs.Values) { New-Item -ItemType Directory -Force $d | Out-Null }

$env:TEMP                   = $dirs.tmp
$env:TMP                    = $dirs.tmp
$env:npm_config_cache       = $dirs.npm
$env:electron_config_cache  = $dirs.electron
$env:ELECTRON_CACHE         = $dirs.electron
$env:ELECTRON_BUILDER_CACHE = $dirs.builder
$env:npm_config_update_notifier = 'false'

$testClaude = Join-Path $cache 'claude-code\node_modules\@anthropic-ai\claude-code-win32-x64\claude.exe'
if (Test-Path $testClaude) { $env:CCSHELL_CLAUDE_PATH = $testClaude }

Write-Host "缓存目录：$cache"
