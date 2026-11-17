import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, safeStorage } from 'electron'
import type { AnthropicStatus } from '../shared/anthropic'
import { anthropicLoggedIn, configDir } from './terminal/claude'
import { settings } from './settings'
import { log } from './log'

const dir = () => join(app.getPath('userData'), 'anthropic')
const secretsFile = () => join(dir(), 'secrets.bin')

function loadKey(): string | null {
  try {
    const s = JSON.parse(safeStorage.decryptString(readFileSync(secretsFile()))) as { apiKey?: string }
    return s.apiKey || null
  } catch {
    return null
  }
}

export function anthropicApiKey(): string | null {
  return loadKey()
}

export function setAnthropicApiKey(key: string): void {
  const k = key.trim()
  if (!/^sk-ant-[A-Za-z0-9_-]{20,}$/.test(k)) throw new Error('密钥格式不对：Anthropic API 密钥以 sk-ant- 开头')
  if (!safeStorage.isEncryptionAvailable()) throw new Error('系统加密不可用，无法安全保存密钥')
  mkdirSync(dir(), { recursive: true })
  writeFileSync(secretsFile(), safeStorage.encryptString(JSON.stringify({ apiKey: k })))
  log('Anthropic', `已保存 API 密钥（…${k.slice(-4)}）`)
}

export function clearAnthropicApiKey(): void {
  rmSync(secretsFile(), { force: true })
  log('Anthropic', '已清除 API 密钥')
}

export function logoutAnthropic(): void {
  rmSync(join(configDir('anthropic'), '.credentials.json'), { force: true })
  log('Anthropic', '已退出订阅账户（删除了本机凭据）')
}

export function anthropicLoginDir(): string {
  const d = join(dir(), 'workspace')
  mkdirSync(d, { recursive: true })
  return d
}

export function anthropicStatus(): AnthropicStatus {
  const a = settings.get().claudeCode.anthropic
  const key = loadKey()
  const loggedIn = anthropicLoggedIn()
  return {
    method: a.method,
    model: a.model,
    loggedIn,
    apiKeyHint: key ? key.slice(-4) : null,
    configDir: configDir('anthropic'),
    ready: a.method === 'apikey' ? !!key : loggedIn
  }
}
