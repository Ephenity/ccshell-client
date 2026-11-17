import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import type { CcShellService } from './ccshell/service'
import { anthropicApiKey, anthropicStatus, clearAnthropicApiKey, logoutAnthropic, setAnthropicApiKey } from './anthropic'
import { anthropicEnv, assertNoAccountLogin, configDir, launchEnv, prepareConfig } from './terminal/claude'
import { listHistory } from './terminal/history'
import { TerminalService } from './terminal/service'
import { settings } from './settings'

type Check = (name: string, pass: boolean, detail?: string) => void

export async function anthropicSelfTest(ccshell: CcShellService, check: Check): Promise<void> {
  const before = settings.get().claudeCode
  const fakeKey = 'sk-ant-api03-' + 'x'.repeat(30) + 'TAIL1234'

  check('Anthropic 账户使用独立配置目录', configDir('anthropic') !== configDir('ccshell') && configDir('anthropic').startsWith(app.getPath('userData')), configDir('anthropic'))

  process.env.ANTHROPIC_BASE_URL = 'https://leak.example'
  process.env.ANTHROPIC_AUTH_TOKEN = 'leak'
  const sub = anthropicEnv({ method: 'subscription', model: 'opus' })
  check(
    'Anthropic 订阅：官方地址、不带任何密钥、独立目录、指定模型',
    !('ANTHROPIC_BASE_URL' in sub) && !('ANTHROPIC_AUTH_TOKEN' in sub) && !('ANTHROPIC_API_KEY' in sub) && sub.CLAUDE_CONFIG_DIR === configDir('anthropic') && sub.ANTHROPIC_MODEL === 'opus',
    JSON.stringify({ base: sub.ANTHROPIC_BASE_URL, dir: sub.CLAUDE_CONFIG_DIR, model: sub.ANTHROPIC_MODEL })
  )
  check('Anthropic 模式同样关闭遥测与自动更新', sub.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC === '1' && sub.DISABLE_AUTOUPDATER === '1')
  const def = anthropicEnv({ method: 'subscription', model: '' })
  check('模型留空时由 Claude Code 决定（不设 ANTHROPIC_MODEL）', !('ANTHROPIC_MODEL' in def))
  const key = anthropicEnv({ method: 'apikey', apiKey: fakeKey, model: 'sonnet' })
  check('Anthropic API 密钥：作为 ANTHROPIC_API_KEY 交给 Claude Code', key.ANTHROPIC_API_KEY === fakeKey && !('ANTHROPIC_AUTH_TOKEN' in key) && !('ANTHROPIC_BASE_URL' in key))
  let noKey = ''
  try {
    anthropicEnv({ method: 'apikey' })
  } catch (e) {
    noKey = (e as Error).message
  }
  check('API 密钥方式但没有密钥：拒绝', noKey.includes('API 密钥'), noKey)
  const cc = launchEnv({ baseUrl: 'http://x', apiKey: 'k', model: 'm', allModels: true })
  check('CC Shell 账户的环境不受影响（仍用 CC Shell 目录与密钥）', cc.CLAUDE_CONFIG_DIR === configDir('ccshell') && cc.ANTHROPIC_AUTH_TOKEN === 'k' && !('ANTHROPIC_API_KEY' in cc))
  delete process.env.ANTHROPIC_BASE_URL
  delete process.env.ANTHROPIC_AUTH_TOKEN

  rmSync(configDir('anthropic'), { recursive: true, force: true })
  mkdirSync(configDir('anthropic'), { recursive: true })
  settings.update({ claudeCode: { anthropic: { method: 'subscription', model: '' } } })
  check('未登录时状态为“未登录、不可用”', !anthropicStatus().loggedIn && !anthropicStatus().ready)
  writeFileSync(join(configDir('anthropic'), '.credentials.json'), '{}')
  check('Claude Code 写了凭据后显示已登录', anthropicStatus().loggedIn && anthropicStatus().ready)
  let refused = ''
  try {
    assertNoAccountLogin()
  } catch (e) {
    refused = (e as Error).message
  }
  check('Anthropic 目录里的凭据不影响 CC Shell 账户启动', refused === '', refused)
  logoutAnthropic()
  check('退出订阅登录：删除本机凭据', !existsSync(join(configDir('anthropic'), '.credentials.json')) && !anthropicStatus().loggedIn)

  let bad = ''
  try {
    setAnthropicApiKey('sk-123')
  } catch (e) {
    bad = (e as Error).message
  }
  check('API 密钥格式不对时拒绝（不联网验证）', bad.includes('sk-ant-'), bad)
  setAnthropicApiKey('  ' + fakeKey + '\n')
  settings.update({ claudeCode: { anthropic: { method: 'apikey' } } })
  const st = anthropicStatus()
  check('API 密钥加密保存、状态只显示末尾 4 位', anthropicApiKey() === fakeKey && st.apiKeyHint === '1234' && st.ready && !JSON.stringify(st).includes(fakeKey))
  const raw = readFileSync(join(app.getPath('userData'), 'anthropic', 'secrets.bin'))
  check('保存的文件里没有明文密钥', !raw.toString('latin1').includes('TAIL1234'))

  const proj = join(app.getPath('temp'), 'anthropic-proj')
  mkdirSync(proj, { recursive: true })
  prepareConfig(proj, '9.9.9', 'anthropic', fakeKey)
  const acfg = JSON.parse(readFileSync(join(configDir('anthropic'), '.claude.json'), 'utf8'))
  check('API 密钥末尾 20 位记为已同意（免得每次启动询问）', acfg.customApiKeyResponses?.approved?.includes(fakeKey.slice(-20)) && !JSON.stringify(acfg).includes(fakeKey))
  let ccCfg = ''
  try {
    ccCfg = readFileSync(join(configDir('ccshell'), '.claude.json'), 'utf8')
  } catch {}
  check('CC Shell 目录的配置里没有 Anthropic 密钥', !ccCfg.includes(fakeKey.slice(-20)))

  clearAnthropicApiKey()
  check('清除 API 密钥', anthropicApiKey() === null && !anthropicStatus().ready)

  const term = new TerminalService(ccshell)
  let startErr = ''
  try {
    await term.create({ cwd: proj, account: 'anthropic', model: '', allModels: false })
  } catch (e) {
    startErr = (e as Error).message
  }
  check('Anthropic 会话缺少密钥时不启动，并提示去设置', startErr.includes('Anthropic API 密钥') && !term.list().some((s) => s.cwd === proj), startErr)

  const id = '7a7a7a7a-1111-2222-3333-444444444444'
  const pdir = join(configDir('anthropic'), 'projects', 'X--anthropic-proj')
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
  check('历史对话包含 Anthropic 账户的记录并标出账户', h?.account === 'anthropic', JSON.stringify(h ?? null).slice(0, 120))
  check('CC Shell 账户的记录不标 Anthropic', listHistory().every((x) => x.id === id || x.account !== 'anthropic'))
  rmSync(pdir, { recursive: true, force: true })

  settings.update({ claudeCode: { account: before.account, anthropic: before.anthropic } })
}
