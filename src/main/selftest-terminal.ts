import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import type { CcShellService } from './ccshell/service'
import { assertNoAccountLogin, cleanEnv, configDir, findClaude, launchEnv, prepareConfig } from './terminal/claude'
import { TerminalService } from './terminal/service'
import { historyMessages, listHistory, toMarkdown } from './terminal/history'

type Check = (name: string, pass: boolean, detail?: string) => void

const strip = (s: string) => s.replace(/\x1b\[[0-9;?<>=]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(\x07|\x1b\\)|\x1b[()][0-9A-B]|\x1b[=>78]/g, '')

function waitFor(get: () => string, pattern: RegExp, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const started = Date.now()
    const tick = () => {
      if (pattern.test(strip(get()))) return resolve(true)
      if (Date.now() - started > timeoutMs) return resolve(false)
      setTimeout(tick, 250)
    }
    tick()
  })
}

export async function terminalSelfTest(ccshell: CcShellService, mockUrl: string, check: Check): Promise<void> {
  process.env.ANTHROPIC_API_KEY = 'leak-test'
  process.env.CLAUDE_CODE_USE_BEDROCK = '1'
  process.env.ANTHROPIC_BASE_URL = 'https://api.anthropic.com'
  const clean = cleanEnv()
  check(
    '继承的 ANTHROPIC_* / CLAUDE_* 变量被去掉',
    !Object.keys(clean).some((k) => /^(ANTHROPIC_|CLAUDE_CODE_)/i.test(k)) && clean.CLAUDE_CONFIG_DIR === configDir(),
    clean.CLAUDE_CONFIG_DIR
  )
  const env = launchEnv({ baseUrl: mockUrl, apiKey: 'sk-test', model: 'claude-haiku-5-5', allModels: true })
  check(
    '启动环境只有 CC Shell 的地址和密钥',
    env.ANTHROPIC_BASE_URL === mockUrl &&
      env.ANTHROPIC_AUTH_TOKEN === 'sk-test' &&
      !('ANTHROPIC_API_KEY' in env) &&
      !('CLAUDE_CODE_USE_BEDROCK' in env) &&
      env.CLAUDE_CODE_SUBAGENT_MODEL === 'claude-haiku-5-5' &&
      env.ANTHROPIC_DEFAULT_SONNET_MODEL === 'claude-haiku-5-5'
  )
  delete process.env.ANTHROPIC_API_KEY
  delete process.env.CLAUDE_CODE_USE_BEDROCK
  delete process.env.ANTHROPIC_BASE_URL

  check('配置目录在客户端数据目录里，不在用户目录', configDir().startsWith(app.getPath('userData')), configDir())

  rmSync(configDir(), { recursive: true, force: true })
  mkdirSync(configDir(), { recursive: true })
  writeFileSync(join(configDir(), '.credentials.json'), '{}')
  let refused = ''
  try {
    assertNoAccountLogin()
  } catch (e) {
    refused = (e as Error).message
  }
  check('配置目录里有 Anthropic 登录凭据时拒绝启动', refused.includes('.credentials.json'), refused.slice(0, 40))
  rmSync(join(configDir(), '.credentials.json'))

  const proj = join(app.getPath('temp'), 'term-proj')
  mkdirSync(proj, { recursive: true })
  prepareConfig(proj, '9.9.9')
  const cfg = JSON.parse(readFileSync(join(configDir(), '.claude.json'), 'utf8'))
  check(
    '预先跳过首次设置、信任工作目录',
    cfg.hasCompletedOnboarding === true && cfg.projects[proj.replace(/\\/g, '/')]?.hasTrustDialogAccepted === true
  )

  rmSync(join(app.getPath('userData'), 'terminal.json'), { force: true })
  const term = new TerminalService(ccshell)
  let err = ''
  try {
    await term.create({ cwd: join(proj, 'not-here'), model: 'claude-opus-5-5', allModels: true })
  } catch (e) {
    err = (e as Error).message
  }
  check('工作目录不存在时给出提示', err.startsWith('工作目录不存在'), err)

  const found = findClaude()
  if (!found.path) {
    check('找到 Claude Code（未找到，跳过端到端测试）', false)
    return
  }
  check('找到 Claude Code', true, `${found.source}：${found.path}`)

  const s = await term.create({ cwd: proj, model: 'claude-opus-5-5', allModels: true })
  term.resize(s.id, 120, 40)
  const ready = await waitFor(() => term.buffer(s.id), /❯|for shortcuts|for agents|Try "/i, 30_000)
  check('Claude Code 在终端里启动', ready && term.list()[0]?.status === 'running', strip(term.buffer(s.id)).replace(/\s+/g, ' ').slice(-160))
  const noLogin = !/Select login method|Log in with|Anthropic Console account|Claude account with subscription/i.test(strip(term.buffer(s.id)))
  check('没有出现 Anthropic 账户登录界面', noLogin)

  term.write(s.id, '你好')
  await new Promise((r) => setTimeout(r, 500))
  term.write(s.id, '\r')
  const replied = await waitFor(() => term.buffer(s.id), /你说的是/, 60_000)
  check('经 CC Shell 接口收到回复（模拟后台）', replied, strip(term.buffer(s.id)).replace(/\s+/g, ' ').slice(-200))
  const last = ((await (await fetch(`${mockUrl}/__mock/last-request`)).json()) as { data: { path: string; headers: { auth: string }; body: { model: string } } }).data
  check('请求用 Bearer 密钥、指定的模型', last.path === '/v1/messages' && last.headers.auth === 'bearer' && last.body.model === 'claude-opus-5-5', JSON.stringify({ path: last.path, auth: last.headers.auth, model: last.body.model }))
  check('配置目录里没有 Anthropic 登录凭据', !existsSync(join(configDir(), '.credentials.json')))

  const until = async (cond: () => boolean, ms: number) => {
    const t0 = Date.now()
    while (!cond() && Date.now() - t0 < ms) await new Promise((r) => setTimeout(r, 200))
    return cond()
  }
  const info = () => term.list().find((x) => x.id === s.id)!
  check('HTTP hook 回报：回答完后状态是“空闲”', await until(() => info().state === 'idle', 15_000), info().state)
  const conv = info().conversationId
  check('hook 回报了对话 ID', !!conv && /^[0-9a-f-]{36}$/.test(conv), conv)
  const again = await term.create({ cwd: proj, model: 'claude-opus-5-5', allModels: true, resumeId: conv })
  check('继续一段已经开着的对话：直接返回那个会话，不开第二个', again.id === s.id && term.list().length === 1)

  term.write(s.id, '慢一点 第二句')
  await new Promise((r) => setTimeout(r, 400))
  term.write(s.id, '\r')
  const sawBusy = await until(() => info().state === 'busy', 10_000)
  check('发消息后状态变成“处理中”', sawBusy, info().state)
  check('回答完回到“空闲”', await until(() => info().state === 'idle', 60_000), info().state)

  const h = listHistory().find((x) => x.id === conv)
  check('历史对话里有这段对话：标题是第一句、目录对、2 条用户消息', !!h && h.title === '你好' && h.cwd.toLowerCase() === proj.toLowerCase() && historyMessages(conv!).filter((m) => m.role === 'user').length === 2, JSON.stringify(h))
  check('历史对话：标记正在哪个会话里开着', term.history().find((x) => x.id === conv)?.openIn === s.id)
  let delErr = ''
  try {
    term.deleteHistory(conv!)
  } catch (e) {
    delErr = (e as Error).message
  }
  check('正开着的对话不能删除', delErr.includes('已在会话中打开'), delErr)
  const md = toMarkdown(conv!)
  check('导出 Markdown：标题、两边的消息', md.startsWith('# 你好') && md.includes('## 你') && md.includes('## Claude') && md.includes('你说的是'), md.slice(0, 80))

  term.setFavorite({ sessionId: s.id }, true)
  check('加入常用对话', (await term.info()).favorites.some((f) => f.conversationId === conv && f.title === s.title))

  const t0 = Date.now()
  await term.end(s.id)
  check('结束会话：Claude Code 正常退出（/exit），记录留在列表', info().status === 'exited' && info().state === 'exited' && term.list().length === 1, `${Date.now() - t0} ms，退出码 ${info().exitCode}`)
  check('正常结束没有等到超时', Date.now() - t0 < 11_000)

  term.shutdown()
  const term2 = new TerminalService(ccshell)
  const restored = term2.list().find((x) => x.id === s.id)
  check('客户端重启后会话记录还在（已结束、带对话 ID）', !!restored && restored.restored === true && restored.status === 'exited' && restored.conversationId === conv, JSON.stringify(restored))

  const r = await term2.restart(s.id)
  check('重新启动：同一行、同一个会话', r.id === s.id && term2.list().length === 1)
  const ready2 = await waitFor(() => term2.buffer(s.id), /❯|for shortcuts|for agents|Try "/i, 30_000)
  check('重新启动后 Claude Code 起来了', ready2)
  term2.write(s.id, '第三句')
  await new Promise((r) => setTimeout(r, 400))
  term2.write(s.id, '\r')
  await waitFor(() => term2.buffer(s.id), /第三句/, 5000)
  const gotReply = await (async () => {
    const t = Date.now()
    while (Date.now() - t < 60_000) {
      const all = ((await (await fetch(`${mockUrl}/__mock/requests`)).json()) as { data: { body: unknown }[] }).data
      const body = all.map((x) => JSON.stringify(x.body)).find((b) => b.includes('第三句') && b.includes('你好') && b.includes('第二句'))
      if (body) return body
      await new Promise((r) => setTimeout(r, 500))
    }
    return ''
  })()
  check('重新启动用 --resume 接着原来的对话（请求里带着之前的消息）', gotReply.includes('第三句') && gotReply.includes('你好') && gotReply.includes('第二句'))
  check('接着同一段对话：对话 ID 不变', await until(() => term2.list()[0]?.conversationId === conv, 15_000), term2.list()[0]?.conversationId)

  await term2.end(s.id)
  term2.deleteHistory(conv!)
  check('结束后可以删除历史对话（常用对话里也去掉）', !listHistory().some((x) => x.id === conv) && !(await term2.info()).favorites.some((f) => f.conversationId === conv))
  term2.remove(s.id)
  check('从列表删除后列表为空', term2.list().length === 0)
  term2.shutdown()
  check('删除后重启也不再出现', new TerminalService(ccshell).list().length === 0)
}
