import { appendFileSync, copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const args = process.argv.slice(2)
const mode = process.env.MOCKNPM_MODE || 'ok'
const version = process.env.MOCKNPM_VERSION || '9.9.9'
if (process.env.MOCKNPM_LOG) {
  const env = Object.fromEntries(['npm_config_registry', 'npm_config_cache', 'npm_config_proxy', 'npm_config_https_proxy', 'TEMP'].map((k) => [k, process.env[k] ?? null]))
  appendFileSync(process.env.MOCKNPM_LOG, JSON.stringify({ args, env }) + '\n')
}
if (mode === 'network') {
  console.error('npm error code ETIMEDOUT')
  console.error('npm error network request to https://registry.npmjs.org/@anthropic-ai%2fclaude-code failed, reason: connect ETIMEDOUT')
  process.exit(1)
}
if (args[0] === 'view') {
  console.log(process.env.MOCKNPM_LATEST || version)
  process.exit(0)
}
if (args[0] === 'install') {
  const prefix = args[args.indexOf('--prefix') + 1]
  const delay = Number(process.env.MOCKNPM_DELAY) || 0
  for (const l of ['npm http fetch GET 200 ' + (process.env.npm_config_registry || '') + '@anthropic-ai%2fclaude-code 120ms', 'npm http fetch GET 200 ' + (process.env.npm_config_registry || '') + '@anthropic-ai/claude-code-win32-x64 95ms', '（假 npm：不联网）']) {
    console.log(l)
    if (delay) await new Promise((r) => setTimeout(r, delay))
  }
  const pkg = join(prefix, 'node_modules', '@anthropic-ai', 'claude-code')
  mkdirSync(pkg, { recursive: true })
  writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name: '@anthropic-ai/claude-code', version }))
  if (mode !== 'noexe') {
    const win = join(prefix, 'node_modules', '@anthropic-ai', 'claude-code-win32-x64')
    mkdirSync(win, { recursive: true })
    writeFileSync(join(win, 'package.json'), JSON.stringify({ name: '@anthropic-ai/claude-code-win32-x64', version }))
    const from = process.env.MOCKNPM_EXE_FROM
    if (from && existsSync(from)) copyFileSync(from, join(win, 'claude.exe'))
    else writeFileSync(join(win, 'claude.exe'), 'not a real exe')
  }
  console.log(`\nadded 2 packages in 1s`)
  process.exit(0)
}
console.error('mock-npm: unknown command ' + args.join(' '))
process.exit(1)
