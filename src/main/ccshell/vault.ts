import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, safeStorage } from 'electron'
import { DEFAULT_BASE_URL } from '../../shared/ccshell'

export interface Secrets {
  sid?: string
  apiKey?: { id: string; masked: string; secret: string }
}

interface Config {
  baseUrl: string
}

const dir = () => join(app.getPath('userData'), 'ccshell')
const secretsFile = () => join(dir(), 'secrets.bin')
const configFile = () => join(dir(), 'config.json')
const announceFile = () => join(dir(), 'announcements-seen.json')

export type AnnounceSeen = Record<string, { day: string; ids: string[] } | string>

export function loadAnnounceSeen(): AnnounceSeen {
  try {
    return JSON.parse(readFileSync(announceFile(), 'utf8')) as AnnounceSeen
  } catch {
    return {}
  }
}

export function saveAnnounceSeen(seen: AnnounceSeen): void {
  mkdirSync(dir(), { recursive: true })
  writeFileSync(announceFile(), JSON.stringify(seen, null, 2))
}

export function loadConfig(): Config {
  try {
    const raw = JSON.parse(readFileSync(configFile(), 'utf8')) as Partial<Config>
    if (typeof raw.baseUrl === 'string' && raw.baseUrl) return { baseUrl: raw.baseUrl }
  } catch {}
  return { baseUrl: DEFAULT_BASE_URL }
}

export function saveConfig(config: Config): void {
  mkdirSync(dir(), { recursive: true })
  writeFileSync(configFile(), JSON.stringify(config, null, 2))
}

export function loadSecrets(): Secrets {
  try {
    return JSON.parse(safeStorage.decryptString(readFileSync(secretsFile()))) as Secrets
  } catch {
    return {}
  }
}

export function saveSecrets(secrets: Secrets): void {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('系统加密不可用，无法安全保存登录信息')
  mkdirSync(dir(), { recursive: true })
  writeFileSync(secretsFile(), safeStorage.encryptString(JSON.stringify(secrets)))
}

export function clearSecrets(): void {
  rmSync(secretsFile(), { force: true })
}
