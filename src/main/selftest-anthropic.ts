import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import type { CcShellService } from './ccshell/service'
import {
  addAnthropicAccount,
  anthropicAccount,
  anthropicAccounts,
  anthropicApiKey,
  anthropicState,
  clearAnthropicApiKey,
  currentAnthropicId,
  logoutAnthropic,
  removeAnthropicAccount,
  renameAnthropicAccount,
  setAnthropicApiKey,
  setCurrentAnthropicId,
  updateAnthropicAccount
} from './anthropic'
import { anthropicEnv, assertNoAccountLogin, configDir, launchEnv, prepareConfig } from './terminal/claude'
import { listHistory } from './terminal/history'
import { TerminalService } from './terminal/service'
import { settings } from './settings'
import { DEFAULT_ANTHROPIC_ID } from '../shared/anthropic'

type Check = (name: string, pass: boolean, detail?: string) => void

export async function anthropicSelfTest(ccshell: CcShellService, check: Check): Promise<void> {
  const before = settings.get().claudeCode
  const fakeKey = 'sk-ant-api03-' + 'x'.repeat(30) + 'TAIL1234'
  const fakeKey2 = 'sk-ant-api03-' + 'y'.repeat(30) + 'TAIL5678'

  settings.update({ claudeCode: { anthropicAccounts: [], anthropic: { method: 'apikey', model: 'opus' } } })
  const migrated = anthropicAccounts()
  check(
    '旧的单账户设置迁成第一个账户（沿用原配置目录，不用重新登录）',
    migrated.length === 1 && migrated[0].id === DEFAULT_ANTHROPIC_ID && migrated[0].method === 'apikey' && migrated[0].model === 'opus' && configDir('anthropic', migrated[0].id) === configDir('anthropic'),
    JSON.stringify(migrated)
  )
  updateAnthropicAccount(DEFAULT_ANTHROPIC_ID, { method: 'subscription', model: '' })

  const second = addAnthropicAccount('第二个账户')
  check('Anthropic 账户使用独立配置目录', configDir('anthropic') !== configDir('ccshell') && configDir('anthropic').startsWith(app.getPath('userData')), configDir('anthropic'))
  check(
    '每个 Anthropic 账户一个配置目录',
    configDir('anthropic', second.id) !== configDir('anthropic', DEFAULT_ANTHROPIC_ID) && configDir('anthropic', second.id).startsWith(app.getPath('userData')),
    configDir('anthropic', second.id)
  )
  check('新建账户后默认选中它', currentAnthropicId() === second.id)
  renameAnthropicAccount(second.id, '工作账户')
  check('重命名账户', anthropicAccount(second.id).name === '工作账户')

  process.env.ANTHROPIC_BASE_URL = 'https://leak.example'
  process.env.ANTHROPIC_AUTH_TOKEN = 'leak'
  const sub = anthropicEnv({ accountId: DEFAULT_ANTHROPIC_ID, method: 'subscription', model: 'opus' })
  check(
    'Anthropic 订阅：官方地址、不带任何密钥、独立目录、指定模型',
    !('ANTHROPIC_BASE_URL' in sub) && !('ANTHROPIC_AUTH_TOKEN' in sub) && !('ANTHROPIC_API_KEY' in sub) && sub.CLAUDE_CONFIG_DIR === configDir('anthropic') && sub.ANTHROPIC_MODEL === 'opus',
    JSON.stringify({ base: sub.ANTHROPIC_BASE_URL, dir: sub.CLAUDE_CONFIG_DIR, model: sub.ANTHROPIC_MODEL })
  )
  const sub2 = anthropicEnv({ accountId: second.id, method: 'subscription', model: 'opus' })
  check('换一个账户启动时换配置目录', sub2.CLAUDE_CONFIG_DIR === configDir('anthropic', second.id) && sub2.CLAUDE_CONFIG_DIR !== sub.CLAUDE_CONFIG_DIR, sub2.CLAUDE_CONFIG_DIR)
  check('Anthropic 模式同样关闭遥测与自动更新', sub.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC === '1' && sub.DISABLE_AUTOUPDATER === '1')
  const def = anthropicEnv({ accountId: DEFAULT_ANTHROPIC_ID, method: 'subscription', model: '' })
  check('模型留空时由 Claude Code 决定（不设 ANTHROPIC_MODEL）', !('ANTHROPIC_MODEL' in def))
  const key = anthropicEnv({ accountId: DEFAULT_ANTHROPIC_ID, method: 'apikey', apiKey: fakeKey, model: 'sonnet' })
  check('Anthropic API 密钥：作为 ANTHROPIC_API_KEY 交给 Claude Code', key.ANTHROPIC_API_KEY === fakeKey && !('ANTHROPIC_AUTH_TOKEN' in key) && !('ANTHROPIC_BASE_URL' in key))
  let noKey = ''
  try {
    anthropicEnv({ accountId: DEFAULT_ANTHROPIC_ID, method: 'apikey' })
  } catch (e) {
    noKey = (e as Error).message
  }
  check('API 密钥方式但没有密钥：拒绝', noKey.includes('API 密钥'), noKey)
  const cc = launchEnv({ baseUrl: 'http://x', apiKey: 'k', model: 'm', allModels: true })
  check('CC Shell 账户的环境不受影响（仍用 CC Shell 目录与密钥）', cc.CLAUDE_CONFIG_DIR === configDir('ccshell') && cc.ANTHROPIC_AUTH_TOKEN === 'k' && !('ANTHROPIC_API_KEY' in cc))
  delete process.env.ANTHROPIC_BASE_URL
  delete process.env.ANTHROPIC_AUTH_TOKEN

  for (const id of [DEFAULT_ANTHROPIC_ID, second.id]) {
    rmSync(configDir('anthropic', id), { recursive: true, force: true })
    mkdirSync(configDir('anthropic', id), { recursive: true })
  }
  const stat = (id: string) => anthropicState().accounts.find((a) => a.id === id)!
  check('未登录时状态为“未登录、不可用”', !stat(DEFAULT_ANTHROPIC_ID).loggedIn && !stat(DEFAULT_ANTHROPIC_ID).ready)
  writeFileSync(join(configDir('anthropic'), '.credentials.json'), '{}')
  check('Claude Code 写了凭据后显示已登录', stat(DEFAULT_ANTHROPIC_ID).loggedIn && stat(DEFAULT_ANTHROPIC_ID).ready)
  check('一个账户登录不影响另一个账户的状态', !stat(second.id).loggedIn && !stat(second.id).ready)
  let refused = ''
  try {
    assertNoAccountLogin()
  } catch (e) {
    refused = (e as Error).message
  }
  check('Anthropic 目录里的凭据不影响 CC Shell 账户启动', refused === '', refused)
  logoutAnthropic(DEFAULT_ANTHROPIC_ID)
  check('退出订阅登录：删除本机凭据', !existsSync(join(configDir('anthropic'), '.credentials.json')) && !stat(DEFAULT_ANTHROPIC_ID).loggedIn)

  let bad = ''
  try {
    setAnthropicApiKey(DEFAULT_ANTHROPIC_ID, 'sk-123')
  } catch (e) {
    bad = (e as Error).message
  }
  check('API 密钥格式不对时拒绝（不联网验证）', bad.includes('sk-ant-'), bad)
  setAnthropicApiKey(DEFAULT_ANTHROPIC_ID, '  ' + fakeKey + '\n')
  setAnthropicApiKey(second.id, fakeKey2)
  updateAnthropicAccount(DEFAULT_ANTHROPIC_ID, { method: 'apikey' })
  const st = stat(DEFAULT_ANTHROPIC_ID)
  check(
    'API 密钥加密保存、状态只显示末尾 4 位',
    anthropicApiKey(DEFAULT_ANTHROPIC_ID) === fakeKey && st.apiKeyHint === '1234' && st.ready && !JSON.stringify(anthropicState()).includes(fakeKey)
  )
  check('每个账户各存各的密钥', anthropicApiKey(second.id) === fakeKey2 && stat(second.id).apiKeyHint === '5678')
  const raw = readFileSync(join(app.getPath('userData'), 'anthropic', 'secrets.bin'))
  check('保存的文件里没有明文密钥', !raw.toString('latin1').includes('TAIL1234'))

  const proj = join(app.getPath('temp'), 'anthropic-proj')
  mkdirSync(proj, { recursive: true })
  prepareConfig(proj, '9.9.9', 'anthropic', { apiKey: fakeKey, anthropicId: DEFAULT_ANTHROPIC_ID })
  const acfg = JSON.parse(readFileSync(join(configDir('anthropic'), '.claude.json'), 'utf8'))
  check('API 密钥末尾 20 位记为已同意（免得每次启动询问）', acfg.customApiKeyResponses?.approved?.includes(fakeKey.slice(-20)) && !JSON.stringify(acfg).includes(fakeKey))
  check('另一个 Anthropic 账户的配置里没有这个密钥', !existsSync(join(configDir('anthropic', second.id), '.claude.json')))
  let ccCfg = ''
  try {
    ccCfg = readFileSync(join(configDir('ccshell'), '.claude.json'), 'utf8')
  } catch {}
  check('CC Shell 目录的配置里没有 Anthropic 密钥', !ccCfg.includes(fakeKey.slice(-20)))

  clearAnthropicApiKey(DEFAULT_ANTHROPIC_ID)
  check('清除 API 密钥只影响这个账户', anthropicApiKey(DEFAULT_ANTHROPIC_ID) === null && !stat(DEFAULT_ANTHROPIC_ID).ready && anthropicApiKey(second.id) === fakeKey2)

  setCurrentAnthropicId(DEFAULT_ANTHROPIC_ID)
  const term = new TerminalService(ccshell)
  let startErr = ''
  try {
    await term.create({ cwd: proj, account: 'anthropic', model: '', allModels: false })
  } catch (e) {
    startErr = (e as Error).message
  }
  check('Anthropic 会话缺少密钥时不启动，并提示去设置', startErr.includes('还没有设置 API 密钥') && !term.list().some((s) => s.cwd === proj), startErr)
  check('提示里写明是哪个账户', startErr.includes(anthropicAccount(DEFAULT_ANTHROPIC_ID).name), startErr)

  const id = '7a7a7a7a-1111-2222-3333-444444444444'
  const pdir = join(configDir('anthropic', second.id), 'projects', 'X--anthropic-proj')
  mkdirSync(pdir, { recursive: true })
  const now = new Date().toISOString()
  writeFileSync(
    join(pdir, id + '.jsonl'),
    [
      { parentUuid: null, isSidechain: false, type: 'user', cwd: proj, sessionId: id, timestamp: now, message: { role: 'user', content: '官方账户的对话' } },
      { parentUuid: 'a', isSidechain: false, type: 'assistant', cwd: proj, sessionId: id, timestamp: now, message: { role: 'assistant', model: 'claude-x', content: [{ type: 'text', text: '好的' }] } }
    ]
      .map((x) => JSON.stringify(x))
      .join('\n') + '\n'
  )
  const h = listHistory().find((x) => x.id === id)
  check('历史对话包含 Anthropic 账户的记录并标出是哪个账户', h?.account === 'anthropic' && h?.anthropicId === second.id, JSON.stringify(h ?? null).slice(0, 140))
  check('CC Shell 账户的记录不标 Anthropic', listHistory().every((x) => x.id === id || x.account !== 'anthropic'))

  let last = ''
  try {
    removeAnthropicAccount(second.id, false)
    removeAnthropicAccount(DEFAULT_ANTHROPIC_ID, false)
  } catch (e) {
    last = (e as Error).message
  }
  check('移除账户（保留本机数据）：目录还在、密钥已清', existsSync(pdir) && anthropicApiKey(second.id) === null && anthropicAccounts().length === 1)
  check('不能移除最后一个账户', last.includes('至少要保留一个'), last)
  const third = addAnthropicAccount()
  mkdirSync(configDir('anthropic', third.id), { recursive: true })
  removeAnthropicAccount(third.id, true)
  check('移除账户并删除本机数据：配置目录被删掉', !existsSync(configDir('anthropic', third.id)))
  check('默认名字按顺序给（账户 2、账户 3…）', /^账户 \d+$/.test(third.name), third.name)

  rmSync(configDir('anthropic', second.id), { recursive: true, force: true })
  settings.update({ claudeCode: { account: before.account, anthropic: before.anthropic, anthropicAccounts: before.anthropicAccounts, anthropicAccountId: before.anthropicAccountId } })
}
