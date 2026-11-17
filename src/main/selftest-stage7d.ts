import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import type { CcShellService } from './ccshell/service'
import { PEER_LIMITS, peerToolName } from '../shared/peers'
import type { Notice } from '../shared/terminal'
import { settings } from './settings'
import { findClaude } from './terminal/claude'
import { compose, PeerService } from './terminal/peers'
import { QueueService } from './terminal/queue'
import { TerminalService } from './terminal/service'
import { ChatService } from './chat/service'
import { McpService } from './mcp/service'

type Check = (name: string, pass: boolean, detail?: string) => void

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const until = async (cond: () => boolean | Promise<boolean>, ms: number) => {
  const t0 = Date.now()
  while (!(await cond()) && Date.now() - t0 < ms) await sleep(250)
  return cond()
}

type Part = { type: string; text?: string; content?: string | { type: string; text?: string }[]; is_error?: boolean }
interface MockReq {
  body: { messages: { role: string; content: string | Part[] }[]; tools?: { name: string }[] }
}

const textOf = (c: string | Part[]) => (typeof c === 'string' ? c : c.map((p) => p.text ?? (typeof p.content === 'string' ? p.content : (p.content ?? []).map((x) => x.text ?? '').join(''))).join('\n'))

export async function stage7dSelfTest(ccshell: CcShellService, mockUrl: string, check: Check): Promise<void> {
  const L = PEER_LIMITS
  check('协作：限额', L.maxText === 12000 && L.sendsPerHour === 40 && L.pairPer10Min === 12 && L.startsPerHour === 4 && L.maxRunning === 12)
  check('协作：工具名', peerToolName('session_send') === 'mcp__ccshell__session_send')

  if (!findClaude().path) {
    check('协作端到端（没有 Claude Code，跳过）', false)
    return
  }
  rmSync(join(app.getPath('userData'), 'terminal.json'), { force: true })
  settings.update({ stuck: { remindMinutes: 0, autoContinue: false }, queue: { autoResume: true, continueText: '继续' } })
  const term = new TerminalService(ccshell)
  const qdir = join(app.getPath('temp'), 'peers-queue')
  rmSync(qdir, { recursive: true, force: true })
  const queue = new QueueService(term, qdir)
  const pfile = join(app.getPath('temp'), 'peers-test.jsonl')
  rmSync(pfile, { force: true })
  rmSync(join(app.getPath('temp'), 'peers-chat.json'), { force: true })
  const peers = new PeerService(term, queue, pfile)
  const mcpSvc = new McpService()
  const notices: Notice[] = []
  term.on('notice', (n: Notice) => notices.push(n))

  const settingsFile = JSON.parse(readFileSync(await term.hooks.settingsFile('probe'), 'utf8'))
  check(
    '协作：只有列出会话不用问权限，读对话、发消息和开会话要问',
    JSON.stringify(settingsFile.permissions?.allow) === JSON.stringify(['mcp__ccshell__sessions_list']),
    JSON.stringify(settingsFile.permissions)
  )
  const probeFile = await term.hooks.mcpConfigFile('probe')
  const probe = JSON.parse(readFileSync(probeFile, 'utf8')).mcpServers?.ccshell
  check('协作：每个会话的 MCP 配置（HTTP、带会话 ID 和口令）', probe?.type === 'http' && /^http:\/\/127\.0\.0\.1:\d+\/mcp$/.test(probe.url) && probe.headers['X-CCShell-Session'] === 'probe', JSON.stringify(probe))
  const rpc = async (body: unknown, headers: Record<string, string> = probe.headers) => {
    const r = await fetch(probe.url, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers }, body: JSON.stringify(body) })
    const text = await r.text()
    return { status: r.status, json: text ? JSON.parse(text) : null }
  }
  const init = await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } })
  check('MCP：initialize', init.status === 200 && init.json.result?.serverInfo?.name === 'ccshell' && init.json.result.protocolVersion === '2025-06-18' && !!init.json.result.capabilities.tools, JSON.stringify(init))
  const note = await rpc({ jsonrpc: '2.0', method: 'notifications/initialized' })
  check('MCP：通知回 202', note.status === 202)
  const tl = await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' })
  check('MCP：tools/list 四个工具', JSON.stringify(tl.json.result?.tools?.map((t: { name: string }) => t.name)) === JSON.stringify(['sessions_list', 'session_read', 'session_send', 'session_start']))
  const unknown = await rpc({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'sessions_list', arguments: {} } })
  check('MCP：不认识的会话调用返回错误', unknown.json.result?.isError === true && /找不到你这个会话/.test(unknown.json.result.content[0].text), JSON.stringify(unknown.json))
  const bad = await rpc({ jsonrpc: '2.0', id: 4, method: 'tools/list' }, { ...probe.headers, 'X-CCShell-Token': 'wrong' })
  check('MCP：口令不对 404', bad.status === 404)
  const spoofed = await rpc({ jsonrpc: '2.0', id: 5, method: 'tools/list' }, { ...probe.headers, 'X-CCShell-Session': 'someone-else' })
  check('MCP：拿自己的口令冒充别的会话 404', spoofed.status === 404)
  const get = await fetch(probe.url, { headers: probe.headers })
  check('MCP：GET 回 405（不开 SSE）', get.status === 405)
  term.hooks.removeMcpConfig('probe')

  const mock = async <T,>(path: string, body?: unknown): Promise<T> =>
    ((await (await fetch(mockUrl + path, body ? { method: 'POST', body: JSON.stringify(body) } : undefined)).json()) as { data: T }).data
  const requests = async () => (await mock<MockReq[]>('/__mock/requests')).filter((r) => r.body?.messages)
  const allText = async () => (await requests()).map((r) => r.body.messages.map((m) => textOf(m.content)).join('\n')).join('\n')
  const lastResultOf = async (needle: string) => {
    for (const r of (await requests()).reverse()) {
      const last = r.body.messages.at(-1)
      if (last && typeof last.content !== 'string' && last.content.some((p) => p.type === 'tool_result')) {
        const t = textOf(last.content)
        if (t.includes(needle)) return t
      }
    }
    return ''
  }

  const projA = join(app.getPath('temp'), 'peer-a')
  const projB = join(app.getPath('temp'), 'peer-b')
  mkdirSync(projA, { recursive: true })
  mkdirSync(projB, { recursive: true })
  const opts = { model: 'claude-opus-5-5', allModels: true }
  try {
    const A = await term.create({ cwd: projA, title: '甲', ...opts })
    const B = await term.create({ cwd: projB, title: '乙', ...opts })
    term.resize(A.id, 120, 40)
    term.resize(B.id, 120, 40)
    const info = (id: string) => term.list().find((x) => x.id === id)
    const items = (id: string) => queue.get(id).items
    const doneAll = (id: string) => items(id).length > 0 && items(id).every((x) => ['done', 'failed', 'skipped'].includes(x.status))
    const approve = async (id: string, done: () => boolean) => {
      const seen: string[] = []
      const t0 = Date.now()
      while (!done() && Date.now() - t0 < 60_000) {
        if (info(id)?.state === 'waiting') {
          seen.push(info(id)?.stateDetail ?? '')
          await sleep(800)
          term.write(id, String.fromCharCode(13))
          await until(() => info(id)?.state !== 'waiting', 5000)
        }
        await sleep(300)
      }
      return seen
    }
    check('协作：两个会话起来了', await until(() => info(A.id)?.state === 'idle' && info(B.id)?.state === 'idle', 40_000))
    check('协作：MCP 配置文件写好了', existsSync(join(app.getPath('userData'), 'claude-hooks', 'mcp', `${A.id}.json`)))

    queue.add(A.id, '你好')
    await until(() => doneAll(A.id), 30_000)
    await sleep(1500)
    queue.add(B.id, '你好，我是乙的第一句话')
    queue.add(A.id, '工具 mcp__ccshell__sessions_list')
    await until(() => doneAll(A.id) && doneAll(B.id), 60_000)
    const reqs = await requests()
    check('协作：Claude Code 知道四个 ccshell 工具（延迟加载的列表里）', reqs.some((r) => ['sessions_list', 'session_read', 'session_send', 'session_start'].every((t) => JSON.stringify(r.body).includes(peerToolName(t as 'session_send')))))
    check('协作：用 ToolSearch 加载后调用了 sessions_list', reqs.some((r) => r.body.messages.some((m) => typeof m.content !== 'string' && m.content.some((p) => p.type === 'tool_use' && (p as { name?: string }).name === 'mcp__ccshell__sessions_list'))))
    const listed = await lastResultOf(B.id)
    check('协作：sessions_list 列出了乙（名字、目录、状态），自己标 self', listed.includes('"name": "乙"') && listed.includes('peer-b') && /"self": true/.test(listed), listed.slice(0, 600))
    check('协作：列出时没有问权限', items(A.id)[0]?.status === 'done' && info(A.id)?.state !== 'waiting')

    queue.add(A.id, `工具 mcp__ccshell__session_read 参数{"session":"${B.id}","last":5}`)
    const asked2 = await approve(A.id, () => doneAll(A.id))
    check('协作：读对话第一次问权限', asked2.some((x) => x.includes('mcp__ccshell__session_read')), JSON.stringify(asked2))
    await until(() => doneAll(A.id), 40_000)
    const readOut = await lastResultOf('我是乙的第一句话')
    check('协作：session_read 读到乙的对话', readOut.includes('用户：你好，我是乙的第一句话') && readOut.includes('Claude：'), readOut.slice(0, 400) || JSON.stringify(items(A.id).at(-1)))
    check('协作：读对话记进协作记录', peers.list().some((e) => e.kind === 'read' && e.from === A.id && e.to === B.id && e.ok))

    queue.add(A.id, `工具 mcp__ccshell__session_send 参数{"to":"${B.id}","text":"甲发来的问候：请看一下 README"}`)
    const asked3 = await approve(A.id, () => doneAll(A.id))
    check('协作：发消息第一次问权限', asked3.length > 0, JSON.stringify(asked3))
    check('协作：默认“每次询问”模式下弹的是普通的权限确认（没有 auto mode 的选择框）', asked3.every((x) => !x.includes('auto mode')) && asked3.some((x) => x.includes('mcp__ccshell__session_send')), JSON.stringify(asked3))
    check('协作：消息进了乙的队列并发出', await until(() => items(B.id).some((x) => x.source === 'peer' && x.status === 'done'), 60_000), JSON.stringify(items(B.id)))
    const got = items(B.id).find((x) => x.source === 'peer')
    check('协作：乙队列里标着来自甲', got?.from?.id === A.id && got.from.title === '甲' && /来自会话「甲」/.test(got.note ?? ''), JSON.stringify(got))
    const txt = await allText()
    check('协作：乙收到的消息写明来源、怎么回复', txt.includes('另一个 Claude 会话发来的消息') && txt.includes('甲发来的问候：请看一下 README') && txt.includes(`session_send 工具（to="${A.id}"）`))
    await until(() => doneAll(A.id), 30_000)
    const sendOut = await lastResultOf('delivery')
    check('协作：工具告诉甲怎么送达的', /"ok": true/.test(sendOut) && /"toName": "乙"/.test(sendOut), sendOut.slice(0, 400))
    check('协作：发消息记进协作记录', peers.list().some((e) => e.kind === 'send' && e.from === A.id && e.to === B.id && e.ok && e.mode === 'queue'))
    queue.clear(A.id, 'finished')
    queue.clear(B.id, 'finished')

    queue.add(B.id, '请帮我卡住一下')
    check('协作：乙开始处理', await until(() => info(B.id)?.state === 'busy', 30_000))
    await sleep(1500)
    const r4 = await peers.send(A.id, { to: B.id, text: '打断的消息：方向错了', mode: 'interrupt' })
    check('协作：interrupt 打断了乙', r4.ok === true && /打断/.test(String(r4.delivery)), JSON.stringify(r4))
    check('协作：被打断的那条标成跳过、乙的队列没有暂停', await until(() => items(B.id).find((x) => x.text === '请帮我卡住一下')?.status === 'skipped', 30_000) && !queue.get(B.id).paused, JSON.stringify(queue.get(B.id)))
    check('协作：打断后消息马上发进去', await until(async () => (await allText()).includes('打断了你正在做的这一轮'), 40_000))
    await until(() => doneAll(B.id), 30_000)

    queue.clear(B.id, 'finished')
    queue.add(B.id, '慢一点 讲个长故事')
    check('协作：乙开始慢慢回答', await until(() => info(B.id)?.state === 'busy', 30_000))
    await sleep(1000)
    const r5 = await peers.send(A.id, { to: B.id, text: '马上看的消息', mode: 'now' })
    check('协作：now 发进了正在进行的这一轮', r5.ok === true && /正在进行的这一轮/.test(String(r5.delivery)) && items(B.id).some((x) => x.source === 'peer' && x.status === 'done' && /已发送至当前回合/.test(x.note ?? '')), JSON.stringify(r5))
    check('协作：Claude Code 收到了这条', await until(async () => (await allText()).includes('马上看的消息'), 60_000))
    await until(() => info(B.id)?.state === 'idle', 60_000)

    const self = await peers.send(A.id, { to: A.id, text: 'x' })
    const empty = await peers.send(A.id, { to: B.id, text: '  ' })
    const long = await peers.send(A.id, { to: B.id, text: 'x'.repeat(L.maxText + 1) })
    const nobody = await peers.send(A.id, { to: 'nope', text: 'x' })
    check('协作：发给自己、空的、太长、没有这个会话都拒绝', !self.ok && !empty.ok && /太长/.test(String(long.error)) && /没有运行中的会话/.test(String(nobody.error)), JSON.stringify([self, empty, long, nobody].map((x) => x.error)))
    check('协作：拒绝的也记进协作记录', peers.list().filter((e) => !e.ok).length >= 4)

    queue.pause(B.id, '测试限额')
    queue.pause(A.id, '测试限额')
    peers.clear()
    let lastOk = true
    for (let i = 0; i < L.pairPer10Min; i++) {
      const r = i % 2 ? await peers.send(B.id, { to: A.id, text: `回 ${i}` }) : await peers.send(A.id, { to: B.id, text: `去 ${i}` })
      lastOk &&= r.ok === true
    }
    const over = await peers.send(A.id, { to: B.id, text: '第 13 条' })
    check('协作：来回 12 条后第 13 条被拒绝', lastOk && over.ok === false && /来回发了 12 条/.test(String(over.error)), JSON.stringify(over))
    const paused = await peers.send(B.id, { to: A.id, text: 'y' }).catch(() => null)
    check('协作：反方向也算在来回的条数里', paused?.ok === false)
    peers.clear()
    queue.clear(A.id, 'all')
    queue.clear(B.id, 'all')
    queue.resume(A.id)
    queue.resume(B.id)
    const pq = await peers.send(A.id, { to: B.id, text: '暂停时发的' })
    check('协作：对方空闲时说“马上发进去”', pq.ok === true && /空闲/.test(String(pq.delivery)), JSON.stringify(pq))
    await until(() => doneAll(B.id), 30_000)

    queue.clear(A.id, 'all')
    queue.add(A.id, `工具 mcp__ccshell__session_start 参数{"task":"新会话的任务：跑一遍测试","name":"帮手"}`)
    const asked8 = await approve(A.id, () => doneAll(A.id))
    check('协作：开会话第一次问权限', asked8.length > 0, JSON.stringify(asked8))
    check('协作：新会话出现在列表里，标着由甲开的', await until(() => term.list().some((s) => s.title === '帮手' && s.openedBy?.id === A.id), 40_000), JSON.stringify(term.list().map((s) => [s.title, s.openedBy])))
    const helper = term.list().find((s) => s.title === '帮手')
    if (!helper) return
    check('协作：新会话的目录默认和甲一样', helper?.cwd === A.cwd)
    await approve(helper.id, () => doneAll(helper.id))
    check('协作：任务自动发进新会话', await until(() => doneAll(helper.id), 60_000), JSON.stringify(items(helper.id)))
    const t8 = await allText()
    check('协作：任务里写明谁开的、做完怎么回报', t8.includes('新会话的任务：跑一遍测试') && t8.includes('由「甲」') && t8.includes(`session_send 工具（to="${A.id}"）`))
    check('协作：开会话记进协作记录', peers.list().some((e) => e.kind === 'start' && e.from === A.id && e.to === helper.id && e.ok))
    const st = await peers.start(A.id, { task: 'x', directory: join(projA, '没有这个目录') })
    check('协作：目录不存在时拒绝', st.ok === false && /没有这个目录/.test(String(st.error)))

    settings.update({ claudeCode: { permissionMode: 'auto' } })
    const C = await term.create({ cwd: projB, title: '丙', ...opts })
    settings.update({ claudeCode: { permissionMode: 'manual' } })
    term.resize(C.id, 120, 40)
    await until(() => info(C.id)?.state === 'idle', 40_000)
    queue.add(C.id, '你好')
    await until(() => doneAll(C.id), 30_000)
    const noticed = notices.length
    queue.add(C.id, `工具 mcp__ccshell__session_send 参数{"to":"${A.id}","text":"丙的消息"}`)
    check('auto mode：安全检查连不上时显示“等你确认”', await until(() => info(C.id)?.state === 'waiting' && /auto mode/.test(info(C.id)?.stateDetail ?? ''), 40_000), JSON.stringify(info(C.id)))
    check('auto mode：发了“需要你处理”的提醒', notices.slice(noticed).some((n) => n.kind === 'attention' && n.sessionId === C.id && /auto mode/.test(n.body)))
    term.remove(C.id)

    const chat = new ChatService(ccshell, mcpSvc)
    chat.setPeers(peers)
    peers.clear()
    const cv = chat.create()
    chat.updateSettings(cv.id, { model: 'claude-opus-5-5', peers: true, mcpServers: [], knowledgeBases: [], workspace: '' }, false)
    chat.rename(cv.id, '聊天甲')
    const chatId = 'chat:' + cv.id
    const convOf = () => chat.get(cv.id)
    const streaming = () => !!chat.list().find((x) => x.id === cv.id)?.streaming
    const settle = async (decision: 'allow' | 'always-tool' = 'allow', ms = 60_000) => {
      const t0 = Date.now()
      await sleep(500)
      while (Date.now() - t0 < ms) {
        for (const m of convOf().messages) for (const tc of m.tools ?? []) if (tc.status === 'approval') chat.approveTool(tc.id, decision)
        if (!streaming() && convOf().messages.at(-1)?.role === 'assistant') {
          await sleep(800)
          if (!streaming()) return true
        }
        await sleep(300)
      }
      return false
    }
    const toolCalls = () => convOf().messages.flatMap((m) => m.tools ?? [])
    const listed2 = peers.sessions(A.id) as { sessions: { id: string; kind: string; name: string }[] }
    check('聊天协作：终端会话的 sessions_list 里能看到开了协作的聊天', listed2.sessions.some((x) => x.id === chatId && x.kind === 'chat' && x.name === '聊天甲'), JSON.stringify(listed2.sessions.map((x) => [x.id, x.kind])))
    check('聊天协作：读别的会话的对话要确认', peers.chatTools(cv.id).tools.find((t) => t.name === 'session_read')?.needsApproval() === true)
    chat.send(cv.id, '工具 sessions_list', [])
    await settle()
    const lc = toolCalls().find((t) => t.tool === 'sessions_list')
    check('聊天协作：聊天里调用 sessions_list 不用确认、列出了终端会话', lc?.status === 'done' && (lc.output ?? '').includes('"name": "甲"') && (lc.output ?? '').includes('"self": true'), JSON.stringify(lc).slice(0, 400))
    queue.clear(B.id, 'all')
    chat.send(cv.id, `工具 session_send 参数{"to":"${B.id}","text":"聊天发来的消息：看一下日志"}`, [])
    let askedChat = false
    await until(() => (askedChat ||= toolCalls().some((t) => t.tool === 'session_send' && t.status === 'approval')), 30_000)
    check('聊天协作：发消息先弹确认卡片', askedChat)
    await settle('always-tool')
    check('聊天协作：消息进了终端会话乙的队列，标着来自聊天', await until(() => items(B.id).some((x) => x.from?.id === chatId && x.from.title === '聊天甲' && x.status === 'done'), 60_000), JSON.stringify(items(B.id)))
    check('聊天协作：乙收到的消息写明从聊天来、回复发给 chat:…', (await allText()).includes('来自「聊天甲」（聊天窗口里的对话）') && (await allText()).includes(`to="${chatId}"`))
    check('聊天协作：“总是允许”记住了', peers.chatTools(cv.id).tools.find((t) => t.name === 'session_send')?.needsApproval() === false)
    await until(() => doneAll(B.id), 40_000)

    const before = convOf().messages.length
    const back = await peers.send(B.id, { to: chatId, text: '乙的回信：日志里没有错误' })
    check('聊天协作：发给空闲的聊天“马上发进去”', back.ok === true && /空闲/.test(String(back.delivery)), JSON.stringify(back))
    await settle()
    const got2 = convOf().messages.slice(before)
    check('聊天协作：回信进了聊天、标着来自乙、自动回答了', got2[0]?.role === 'user' && got2[0].from?.id === B.id && got2[0].text.includes('乙的回信') && got2.some((m) => m.role === 'assistant' && m.status === 'done'), JSON.stringify(got2.map((m) => [m.role, m.from, m.status, m.text.slice(0, 40)])))

    chat.send(cv.id, '慢一点 讲个长故事', [])
    await until(streaming, 10_000)
    const held = await peers.send(B.id, { to: chatId, text: '排着的消息' })
    check('聊天协作：聊天正在回答时消息排着', held.ok === true && /这一轮结束后/.test(String(held.delivery)) && !convOf().messages.some((m) => m.text.includes('排着的消息')), JSON.stringify(held))
    check('聊天协作：这一轮结束后发进去并回答', await until(() => convOf().messages.some((m) => m.from && m.text.includes('排着的消息')), 90_000) && (await settle()), JSON.stringify(convOf().messages.slice(-3).map((m) => [m.role, m.status, m.text.slice(0, 30)])))

    const cv2 = chat.create()
    chat.updateSettings(cv2.id, { peers: false }, false)
    const no = await peers.send(B.id, { to: 'chat:' + cv2.id, text: 'x' })
    check('聊天协作：没开协作的聊天收不到消息', no.ok === false, JSON.stringify(no))
    const noDir = await peers.start(chatId, { task: '跑测试' })
    check('聊天协作：聊天没设工作目录时开会话要写目录', noDir.ok === false && /没有项目目录/.test(String(noDir.error)), JSON.stringify(noDir))
    const fromChat = await peers.start(chatId, { task: '跑测试', directory: projB, name: '聊天开的' })
    const opened = term.list().find((s) => s.title === '聊天开的')
    check('聊天协作：聊天开的会话标着由聊天开的', fromChat.ok === true && opened?.openedBy?.id === chatId && opened.openedBy.title === '聊天甲', JSON.stringify(fromChat))
    if (opened) term.remove(opened.id)
    chat.delete(cv.id)
    chat.delete(cv2.id)
    check('聊天协作：删掉的聊天不再出现在列表里', !(peers.sessions(A.id) as { sessions: { id: string }[] }).sessions.some((x) => x.id === chatId))

    check('协作：记录存在文件里，重新读还在', new PeerService(term, queue, pfile).list().length === peers.list().length && peers.list().length > 0)
    term.hooks.peers = (s, t, a) => peers.call(s, t, a)
    term.remove(helper.id)
    check('协作：删除会话时删掉它的 MCP 配置', !existsSync(join(app.getPath('userData'), 'claude-hooks', 'mcp', `${helper.id}.json`)))
    check('协作：compose 打断时多一句说明', compose({ id: A.id, title: '甲', cwd: A.cwd }, '正文', true).includes('打断了你正在做的这一轮') && !compose({ id: A.id, title: '甲', cwd: A.cwd }, '正文', false).includes('打断'))
  } finally {
    queue.shutdown()
    term.shutdown()
    mcpSvc.closeAll()
    rmSync(qdir, { recursive: true, force: true })
  }
}
