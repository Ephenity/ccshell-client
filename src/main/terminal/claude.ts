import { testEnv } from '../testhooks'
import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { delimiter, dirname, join, resolve } from 'node:path'
import { app, nativeTheme } from 'electron'
import { settings } from '../settings'
import { pathDirs } from '../syspath'
import type { ClaudeAccount } from '../../shared/terminal'

export const WIN_PKG = join('node_modules', '@anthropic-ai', 'claude-code-win32-x64', 'claude.exe')

export function configDir(account: ClaudeAccount = 'ccshell'): string {
  return join(app.getPath('userData'), account === 'anthropic' ? 'claude-anthropic' : 'claude')
}

export function anthropicLoggedIn(): boolean {
  return existsSync(join(configDir('anthropic'), '.credentials.json'))
}

export function ownInstallDir(): string {
  return resolve(app.getPath('userData'), '..', 'claude-code')
}

export const SOURCE_OWN = '客户端安装'

export interface ClaudeFound {
  path: string | null
  source: string
}

function exeFromShim(cmd: string): string | null {
  try {
    const text = readFileSync(cmd, 'utf8')
    const m = /"%~?dp0%?\\?([^"]*?claude\.exe)"/i.exec(text)
    if (!m) return null
    const p = resolve(dirname(cmd), m[1])
    return existsSync(p) ? p : null
  } catch {
    return null
  }
}

export function findSystemClaude(): { path: string; source: string }[] {
  const out: { path: string; source: string }[] = []
  const add = (p: string | null, source: string) => {
    if (p && existsSync(p) && !out.some((x) => x.path.toLowerCase() === p.toLowerCase())) out.push({ path: p, source })
  }
  const home = process.env.USERPROFILE
  if (home) add(join(home, '.local', 'bin', 'claude.exe'), '本机安装')
  const own = ownInstallDir().toLowerCase()
  for (const dir of pathDirs()) {
    if (dir.toLowerCase().startsWith(own)) continue
    add(join(dir, 'claude.exe'), '本机安装')
    add(exeFromShim(join(dir, 'claude.cmd')), '本机安装（npm）')
  }
  if (process.env.APPDATA) add(exeFromShim(join(process.env.APPDATA, 'npm', 'claude.cmd')), '本机安装（npm）')
  return out
}

export function findClaude(): ClaudeFound {
  const { binary, binaryPath } = settings.get().claudeCode
  if (binary === 'custom') {
    if (binaryPath && existsSync(binaryPath)) return { path: binaryPath, source: '手动指定' }
    return { path: null, source: binaryPath ? '指定的文件不存在' : '未指定文件' }
  }
  if (binary === 'auto') {
    const own = join(ownInstallDir(), WIN_PKG)
    if (existsSync(own)) return { path: own, source: SOURCE_OWN }
    const test = testEnv('CCSHELL_CLAUDE_PATH')
    if (test && existsSync(test)) return { path: test, source: '测试副本' }
  }
  const sys = findSystemClaude()[0]
  return sys ?? { path: null, source: '未找到' }
}

let versionCache: { path: string; version: string | null } | null = null

export function clearVersionCache(): void {
  versionCache = null
}

export function packageVersion(exe: string): string | null {
  const dir = dirname(exe)
  const pkg = /claude-code-win32-x64$/i.test(dir)
    ? join(dir, 'package.json')
    : /[\\/]@anthropic-ai[\\/]claude-code[\\/]bin$/i.test(dir)
      ? join(dir, '..', 'package.json')
      : null
  if (!pkg) return null
  try {
    const v = JSON.parse(readFileSync(pkg, 'utf8')).version
    return typeof v === 'string' ? v : null
  } catch {
    return null
  }
}

export function claudeVersion(path: string): Promise<string | null> {
  if (versionCache?.path === path) return Promise.resolve(versionCache.version)
  const fromPkg = packageVersion(path)
  if (fromPkg) {
    versionCache = { path, version: fromPkg }
    return Promise.resolve(fromPkg)
  }
  return new Promise((done) => {
    execFile(path, ['--version'], { timeout: 15_000, env: cleanEnv(), windowsHide: true }, (err, stdout) => {
      const version = err ? null : (stdout.trim().match(/\d+\.\d+\.\d+\S*/)?.[0] ?? (stdout.trim() || null))
      versionCache = { path, version }
      done(version)
    })
  })
}

export function cleanEnv(account: ClaudeAccount = 'ccshell'): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined) continue
    if (/^(ANTHROPIC_|CLAUDE_|CLAUDECODE$|AWS_BEARER_TOKEN_BEDROCK$|VERTEX_|CLOUD_ML_)/i.test(k)) continue
    if (/^(ELECTRON_|VITE_|CCSHELL_|npm_)/i.test(k)) continue
    env[k] = v
  }
  env.CLAUDE_CONFIG_DIR = configDir(account)
  return env
}

export interface LaunchParams {
  baseUrl: string
  apiKey: string
  model: string
  allModels: boolean
  modelMap?: { opus: string; sonnet: string; haiku: string; subagent: string }
  hook?: { session: string }
}

export function launchEnv(p: LaunchParams): Record<string, string> {
  const env = cleanEnv('ccshell')
  env.ANTHROPIC_BASE_URL = p.baseUrl
  env.ANTHROPIC_AUTH_TOKEN = p.apiKey
  env.ANTHROPIC_MODEL = p.model
  if (p.allModels) {
    env.ANTHROPIC_DEFAULT_OPUS_MODEL = p.model
    env.ANTHROPIC_DEFAULT_SONNET_MODEL = p.model
    env.ANTHROPIC_DEFAULT_HAIKU_MODEL = p.model
    env.ANTHROPIC_SMALL_FAST_MODEL = p.model
    env.CLAUDE_CODE_SUBAGENT_MODEL = p.model
  } else if (p.modelMap) {
    const m = p.modelMap
    if (m.opus.trim()) env.ANTHROPIC_DEFAULT_OPUS_MODEL = m.opus.trim()
    if (m.sonnet.trim()) env.ANTHROPIC_DEFAULT_SONNET_MODEL = m.sonnet.trim()
    if (m.haiku.trim()) env.ANTHROPIC_DEFAULT_HAIKU_MODEL = env.ANTHROPIC_SMALL_FAST_MODEL = m.haiku.trim()
    if (m.subagent.trim()) env.CLAUDE_CODE_SUBAGENT_MODEL = m.subagent.trim()
  }
  return common(env, p.hook)
}

export interface AnthropicLaunchParams {
  method: 'subscription' | 'apikey'
  apiKey?: string
  model?: string
  hook?: { session: string }
}

export function anthropicEnv(p: AnthropicLaunchParams): Record<string, string> {
  const env = cleanEnv('anthropic')
  if (p.method === 'apikey') {
    if (!p.apiKey) throw new Error('尚未设置 Anthropic API 密钥')
    env.ANTHROPIC_API_KEY = p.apiKey
  }
  if (p.model?.trim()) env.ANTHROPIC_MODEL = p.model.trim()
  return common(env, p.hook)
}

function common(env: Record<string, string>, hook?: { session: string }): Record<string, string> {
  if (hook) env.CCSHELL_SESSION_ID = hook.session
  env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = '1'
  env.DISABLE_AUTOUPDATER = '1'
  const retries = testEnv('CCSHELL_CLAUDE_MAX_RETRIES')
  if (retries) env.CLAUDE_CODE_MAX_RETRIES = retries
  env.FORCE_COLOR = '1'
  env.COLORTERM = 'truecolor'
  env.TERM = 'xterm-256color'
  return env
}

export function claudeTheme(): 'light' | 'dark' {
  return nativeTheme.themeSource === 'light' ? 'light' : 'dark'
}

export function assertNoAccountLogin(): void {
  if (existsSync(join(configDir('ccshell'), '.credentials.json')))
    throw new Error(
      `Claude Code 的配置目录里有 Anthropic 账户的登录凭据（${join(configDir(), '.credentials.json')}）。` +
        'CC Shell 账户的会话只用 CC Shell 密钥运行，请删除这个文件后再启动；要用 Anthropic 账户，请在启动会话时选择 Anthropic。'
    )
}

export function prepareConfig(cwd: string, version: string | null, account: ClaudeAccount = 'ccshell', apiKey?: string): void {
  const dir = configDir(account)
  mkdirSync(dir, { recursive: true })
  const file = join(dir, '.claude.json')
  let cfg: Record<string, unknown> = {}
  try {
    cfg = JSON.parse(readFileSync(file, 'utf8'))
  } catch {
  }
  cfg.hasCompletedOnboarding = true
  cfg.theme = claudeTheme()
  if (version) cfg.lastOnboardingVersion = version
  const projects = (cfg.projects ?? {}) as Record<string, Record<string, unknown>>
  for (const key of new Set([cwd.replace(/\\/g, '/'), cwd])) {
    projects[key] = { ...projects[key], hasTrustDialogAccepted: true, hasCompletedProjectOnboarding: true }
  }
  cfg.projects = projects
  if (account === 'anthropic' && apiKey) {
    const r = (cfg.customApiKeyResponses ?? {}) as { approved?: string[]; rejected?: string[] }
    const tail = apiKey.slice(-20)
    cfg.customApiKeyResponses = { ...r, approved: [...new Set([...(r.approved ?? []), tail])], rejected: (r.rejected ?? []).filter((x) => x !== tail) }
  }
  writeFileSync(file + '.tmp', JSON.stringify(cfg, null, 2))
  renameSync(file + '.tmp', file)
}
