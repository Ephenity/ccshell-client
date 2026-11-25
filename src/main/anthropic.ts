import { randomBytes } from 'node:crypto'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, safeStorage } from 'electron'
import { ANTHROPIC_MAX, DEFAULT_ANTHROPIC_ID, type AnthropicAccount, type AnthropicState } from '../shared/anthropic'
import { anthropicLoggedIn, configDir } from './terminal/claude'
import { settings } from './settings'
import { log } from './log'

const dir = () => join(app.getPath('userData'), 'anthropic')
const secretsFile = () => join(dir(), 'secrets.bin')

function loadKeys(): Record<string, string> {
  try {
    const s = JSON.parse(safeStorage.decryptString(readFileSync(secretsFile()))) as { apiKey?: string; keys?: Record<string, string> }
    if (s.keys && typeof s.keys === 'object') return s.keys
    return s.apiKey ? { [DEFAULT_ANTHROPIC_ID]: s.apiKey } : {}
  } catch {
    return {}
  }
}

function saveKeys(keys: Record<string, string>): void {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('系统加密不可用，无法安全保存密钥')
  mkdirSync(dir(), { recursive: true })
  writeFileSync(secretsFile(), safeStorage.encryptString(JSON.stringify({ keys })))
}

export function anthropicAccounts(): AnthropicAccount[] {
  const cc = settings.get().claudeCode
  if (cc.anthropicAccounts.length) return cc.anthropicAccounts
  const first: AnthropicAccount = {
    id: DEFAULT_ANTHROPIC_ID,
    name: '账户 1',
    method: cc.anthropic.method,
    model: cc.anthropic.model,
    createdAt: Date.now()
  }
  settings.update({ claudeCode: { anthropicAccounts: [first], anthropicAccountId: first.id } })
  return [first]
}

export function anthropicAccount(id?: string): AnthropicAccount {
  const list = anthropicAccounts()
  return list.find((a) => a.id === id) ?? list.find((a) => a.id === currentAnthropicId()) ?? list[0]
}

export function currentAnthropicId(): string {
  const list = anthropicAccounts()
  const id = settings.get().claudeCode.anthropicAccountId
  return list.some((a) => a.id === id) ? id : list[0].id
}

export function setCurrentAnthropicId(id: string): void {
  if (!anthropicAccounts().some((a) => a.id === id)) throw new Error('没有这个 Anthropic 账户')
  settings.update({ claudeCode: { anthropicAccountId: id } })
}

function write(list: AnthropicAccount[], currentId = currentAnthropicId()): void {
  settings.update({ claudeCode: { anthropicAccounts: list, anthropicAccountId: list.some((a) => a.id === currentId) ? currentId : list[0].id } })
}

export function addAnthropicAccount(name?: string): AnthropicAccount {
  const list = anthropicAccounts()
  if (list.length >= ANTHROPIC_MAX) throw new Error(`最多 ${ANTHROPIC_MAX} 个 Anthropic 账户`)
  let id = ''
  do {
    id = randomBytes(4).toString('hex')
  } while (list.some((a) => a.id === id))
  const used = new Set(list.map((a) => a.name))
  let n = list.length + 1
  while (used.has(`账户 ${n}`)) n++
  const account: AnthropicAccount = { id, name: name?.trim().slice(0, 40) || `账户 ${n}`, method: 'subscription', model: '', createdAt: Date.now() }
  write([...list, account], id)
  log('Anthropic', `新建账户（${account.name}）`)
  return account
}

export function renameAnthropicAccount(id: string, name: string): void {
  const text = name.trim().slice(0, 40)
  if (!text) throw new Error('请填写账户名称')
  write(anthropicAccounts().map((a) => (a.id === id ? { ...a, name: text } : a)))
}

export function updateAnthropicAccount(id: string, patch: Partial<Pick<AnthropicAccount, 'method' | 'model'>>): void {
  write(anthropicAccounts().map((a) => (a.id === id ? { ...a, ...patch } : a)))
}

export function removeAnthropicAccount(id: string, deleteData: boolean): void {
  const list = anthropicAccounts()
  if (list.length <= 1) throw new Error('至少要保留一个 Anthropic 账户')
  const account = list.find((a) => a.id === id)
  if (!account) throw new Error('没有这个 Anthropic 账户')
  write(list.filter((a) => a.id !== id))
  const { [id]: _dropped, ...rest } = loadKeys()
  saveKeys(rest)
  if (deleteData) rmSync(configDir('anthropic', id), { recursive: true, force: true })
  log('Anthropic', `移除账户（${account.name}）${deleteData ? '，并删除了本机数据' : ''}`)
}

export function anthropicApiKey(id: string): string | null {
  return loadKeys()[id] || null
}

export function setAnthropicApiKey(id: string, key: string): void {
  anthropicAccount(id)
  const k = key.trim()
  if (!/^sk-ant-[A-Za-z0-9_-]{20,}$/.test(k)) throw new Error('密钥格式不对：Anthropic API 密钥以 sk-ant- 开头')
  saveKeys({ ...loadKeys(), [id]: k })
  log('Anthropic', `已保存 API 密钥（…${k.slice(-4)}）`)
}

export function clearAnthropicApiKey(id: string): void {
  const { [id]: _dropped, ...rest } = loadKeys()
  saveKeys(rest)
  log('Anthropic', '已清除 API 密钥')
}

export function logoutAnthropic(id: string): void {
  rmSync(join(configDir('anthropic', id), '.credentials.json'), { force: true })
  log('Anthropic', '已退出订阅账户（删除了本机凭据）')
}

export function anthropicLoginDir(): string {
  const d = join(dir(), 'workspace')
  mkdirSync(d, { recursive: true })
  return d
}

export function anthropicState(): AnthropicState {
  const keys = loadKeys()
  return {
    currentId: currentAnthropicId(),
    accounts: anthropicAccounts().map((a) => {
      const key = keys[a.id] || null
      const loggedIn = anthropicLoggedIn(a.id)
      return {
        ...a,
        loggedIn,
        apiKeyHint: key ? key.slice(-4) : null,
        configDir: configDir('anthropic', a.id),
        ready: a.method === 'apikey' ? !!key : loggedIn
      }
    })
  }
}
