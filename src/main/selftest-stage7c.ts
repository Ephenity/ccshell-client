import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { app } from 'electron'
import type { CcShellService } from './ccshell/service'
import { fillPlaceholders, nextClock, parseClock, parseDuration, parseQueueText, parseResetTime, type SessionQueue } from '../shared/queue'
import { promptLabel } from '../shared/prompts'
import type { Notice } from '../shared/terminal'
import { PromptStore } from './prompts'
import { settings } from './settings'
import { findClaude } from './terminal/claude'
import { QueueService } from './terminal/queue'
import { TerminalService } from './terminal/service'

type Check = (name: string, pass: boolean, detail?: string) => void

const strip = (t: string) => t.replace(/\x1b\[[0-9;?<>=]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(\x07|\x1b\\)|\x1b[()][0-9A-B]|\x1b[=>78]/g, '')
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const until = async (cond: () => boolean, ms: number) => {
  const t0 = Date.now()
  while (!cond() && Date.now() - t0 < ms) await sleep(200)
  return cond()
}

interface MockReq {
  body: { messages: { role: string; content: string | { type: string; text?: string }[] }[] }
}

function userSaid(r: MockReq): string {
  const last = r.body.messages.findLast((m) => m.role === 'user')?.content ?? ''
  const parts = typeof last === 'string' ? [last] : last.filter((p) => p.type === 'text').map((p) => p.text ?? '')
  return parts.filter((t) => t.length < 2000 && !/^\s*[<[#]/.test(t)).at(-1) ?? ''
}

export async function stage7cSelfTest(ccshell: CcShellService, mockUrl: string, check: Check): Promise<void> {
  const p = parseQueueText
  check('队列：普通的话', p('跑一遍测试').kind === 'prompt')
  check('队列：/new /clear /reset 都是清空', ['/new', '/clear', ' /reset '].every((t) => p(t).kind === 'clear'))
  check('队列：/wait 5m', JSON.stringify(p('/wait 5m')) === JSON.stringify({ kind: 'wait', ms: 300_000, label: '5m' }))
  check('队列：/wait 1h30m、/wait 90、/wait 2分钟', parseDuration('1h30m') === 5_400_000 && parseDuration('90') === 90_000 && parseDuration('2分钟') === 120_000)
  check('队列：/wait 写错了', p('/wait 一会儿').kind === 'bad' && parseDuration('5x') === null)
  check('队列：/at 02:30、7点半、14点30、7点', JSON.stringify([parseClock('02:30'), parseClock('7点半'), parseClock('14点30'), parseClock('7点')]) === JSON.stringify([{ hour: 2, minute: 30 }, { hour: 7, minute: 30 }, { hour: 14, minute: 30 }, { hour: 7, minute: 0 }]))
  check('队列：/until 23:00 和 /at 一样', (p('/until 23:00') as { label?: string }).label === '23:00' && p('/at 25:00').kind === 'bad')
  const base = new Date(2026, 10, 15, 10, 0, 0).getTime()
  check('队列：/at 时刻已经过了就等明天', nextClock(9, 0, base) === new Date(2026, 10, 16, 9, 0).getTime() && nextClock(11, 0, base) === new Date(2026, 10, 15, 11, 0).getTime())
  check('队列：/pause', p('/pause').kind === 'pause')
  check('队列：/compact、/model opus 交给 Claude', p('/compact').kind === 'slash' && (p('/model opus') as { text?: string }).text === '/model opus')
  check('队列：路径开头的是普通的话', p('/src/app.cs 有 bug').kind === 'prompt' && p('/README.md 看一下').kind === 'prompt')
  const when = new Date(2026, 8, 29, 9, 5)
  check('占位符：{date} {time} {weekday} {project}', fillPlaceholders('{date} {time} {weekday} {project} {other}', 'proj', when) === '2026-09-29 09:05 周二 proj {other}')
  const now = Date.now()
  check('重置时间：Unix 时间戳', parseResetTime(`limit reached|${Math.floor(now / 1000) + 3600}`, now) === (Math.floor(now / 1000) + 3600) * 1000)
  check('重置时间：retry after 120 seconds', parseResetTime('Please retry after 120 seconds', now) === now + 120_000)
  check('重置时间：resets 3pm', new Date(parseResetTime('5-hour limit reached ∙ resets 3pm', now)!).getHours() === 15)
  check('重置时间：找不到', parseResetTime('rate limited', now) === null)

  const pdir = join(app.getPath('temp'), 'prompts-test')
  rmSync(pdir, { recursive: true, force: true })
  mkdirSync(pdir, { recursive: true })
  const pfile = join(pdir, 'prompts.json')
  const store = new PromptStore(pfile)
  const a1 = store.create({ title: '日报', text: '整理 {date} 的改动' })
  await sleep(5)
  const a2 = store.create({ text: '第一行当标题\n第二行' })
  check('提示词：新建、标题为空时用第一行', store.list().length === 2 && promptLabel(a2) === '第一行当标题')
  store.update(a1.id, { pinned: true })
  check('提示词：固定的在前', store.list()[0].id === a1.id)
  store.update(a1.id, { pinned: false })
  store.touch(a1.id)
  check('提示词：用过的排前面、记次数', store.list()[0].id === a1.id && store.get(a1.id).useCount === 1)
  const dup = store.duplicate(a1.id)
  check('提示词：复制一份', dup.title === '日报（副本）' && dup.text === a1.text)
  store.remove(dup.id)
  check('提示词：删除、重新读文件还在', new PromptStore(pfile).list().length === 2)
  writeFileSync(pfile, '{ 坏掉的 json')
  const broken = new PromptStore(pfile)
  check('提示词：文件坏了另存为 .broken、从空库开始', broken.list().length === 0 && readdirSync(pdir).some((f) => f.startsWith('prompts.json.broken-')))
  rmSync(pdir, { recursive: true, force: true })

  const qdir = join(app.getPath('temp'), 'queue-test')
  rmSync(qdir, { recursive: true, force: true })
  mkdirSync(qdir, { recursive: true })
  const saved: SessionQueue = {
    sessionId: 'sess-1',
    paused: false,
    items: [
      { id: 'i1', text: '发到一半', status: 'running', addedAt: 1 },
      { id: 'i2', text: '还没发', status: 'pending', addedAt: 2 }
    ]
  }
  writeFileSync(join(qdir, 'sess-1.json'), JSON.stringify(saved))
  const fakeTerm = { on: () => undefined, emit: () => true, peek: () => null, holdDone: () => false } as unknown as TerminalService
  const restored = new QueueService(fakeTerm, qdir)
  const rq = restored.get('sess-1')
  check('队列：重启后还在；发到一半的标成失败', rq.items.length === 2 && rq.items[0].status === 'failed' && rq.items[0].note === '客户端退出时未完成' && rq.items[1].status === 'pending', JSON.stringify(rq.items))
  restored.requeue('sess-1', 'i1')
  check('队列：失败的重新排队放到待发送最前面', restored.get('sess-1').items[0].status === 'pending' && restored.get('sess-1').items[0].id === 'i1')
  restored.clear('sess-1', 'all')
  check('队列：清空后删掉文件', !existsSync(join(qdir, 'sess-1.json')))
  restored.shutdown()
  rmSync(qdir, { recursive: true, force: true })

  if (!findClaude().path) {
    check('队列端到端（没有 Claude Code，跳过）', false)
    return
  }
  rmSync(join(app.getPath('userData'), 'terminal.json'), { force: true })
  const proj = join(app.getPath('temp'), 'queue-proj')
  mkdirSync(proj, { recursive: true })
  settings.update({ stuck: { remindMinutes: 0, autoContinue: false }, queue: { autoResume: true, continueText: '继续' } })
  const term = new TerminalService(ccshell)
  const qdir2 = join(app.getPath('temp'), 'queue-e2e')
  rmSync(qdir2, { recursive: true, force: true })
  const queue = new QueueService(term, qdir2)
  const notices: Notice[] = []
  term.on('notice', (n: Notice) => notices.push(n))
  const mock = async <T,>(path: string, body?: unknown): Promise<T> =>
    ((await (await fetch(mockUrl + path, body ? { method: 'POST', body: JSON.stringify(body) } : undefined)).json()) as { data: T }).data
  const requests = async () => (await mock<MockReq[]>('/__mock/requests')).filter((r) => r.body?.messages)
  const said = async () => (await requests()).map(userSaid)
  try {
    const s = await term.create({ cwd: proj, model: 'claude-opus-5-5', allModels: true })
    term.resize(s.id, 120, 40)
    const info = () => term.list().find((x) => x.id === s.id)!
    const q = () => queue.get(s.id)
    const items = () => q().items
    const byText = (t: string) => items().find((x) => x.text === t)
    const allDone = () => items().every((x) => x.status === 'done' || x.status === 'failed' || x.status === 'skipped')

    queue.add(s.id, '第一条：你好')
    queue.add(s.id, '多行的一条\n这是第二行')
    queue.add(s.id, '/wait 2s')
    queue.add(s.id, '第三条 {project}')
    check('队列端到端：Claude 起来了', await until(() => /❯|for shortcuts|Try "/.test(term.buffer(s.id)), 30_000))
    const ok1 = await until(allDone, 90_000)
    const texts = await said()
    const i1 = texts.findIndex((t) => t.includes('第一条：你好'))
    const i2 = texts.findIndex((t) => t.includes('多行的一条'))
    const i3 = texts.findIndex((t) => t.includes('第三条'))
    check('队列：按顺序一条条发完', ok1 && items().every((x) => x.status === 'done') && i1 >= 0 && i1 < i2 && i2 < i3, `${items().map((x) => `${x.text.slice(0, 6)}:${x.status}:${x.note ?? ''}`).join(' | ')} || ${texts.slice(-5).join(' | ')}`)
    check('队列：多行内容作为一条消息发出（中途没有发出去）', i2 >= 0 && texts[i2].includes('这是第二行') && !texts.some((t) => t.trim() === '多行的一条'), texts[i2])
    check('队列：发送时替换 {project}', i3 >= 0 && texts[i3].includes(`第三条 ${basename(proj)}`), texts[i3])
    const w = byText('/wait 2s')
    check('队列：/wait 2s 真的等了', !!w?.sentAt && !!w.doneAt && w.doneAt - w.sentAt >= 1900, JSON.stringify(w))
    const dones = notices.filter((n) => n.kind === 'done' && n.sessionId === s.id)
    check('队列一条条执行时只在最后弹“回答完了”', dones.length === 1, String(dones.length))
    queue.clear(s.id, 'finished')

    term.write(s.id, 'abc用户打了一半')
    queue.add(s.id, '打字之后的一句')
    await sleep(1500)
    check('队列：用户刚打过字时先不发', byText('打字之后的一句')?.status === 'pending')
    check('队列：等打字停下后发出', await until(() => byText('打字之后的一句')?.status === 'done', 40_000), JSON.stringify(byText('打字之后的一句')))
    const t2 = (await said()).findLast((t) => t.includes('打字之后的一句')) ?? ''
    check('队列：发之前清掉了输入框里残留的字', !!t2 && !t2.includes('abc'), t2)
    queue.clear(s.id, 'finished')

    const convBefore = info().conversationId
    queue.add(s.id, '/new')
    queue.add(s.id, '清空后的一句')
    check('队列：/new 之后接着发', await until(allDone, 60_000), items().map((x) => `${x.text}:${x.status}:${x.note ?? ''}`).join(' | '))
    const reqs = await requests()
    const last = reqs.findLast((r) => userSaid(r).includes('清空后的一句'))
    check('队列：/new 真的清空了对话（对话 ID 变了，请求里只有一条用户消息）', !!last && info().conversationId !== convBefore && last.body.messages.filter((m) => m.role === 'user').length === 1, `${convBefore} → ${info().conversationId}; ${last?.body.messages.length}`)
    queue.clear(s.id, 'finished')

    queue.add(s.id, '/pause')
    queue.add(s.id, '暂停后的一句')
    check('队列：/pause 停下并提醒', await until(() => q().paused, 20_000) && /pause/.test(q().pauseReason ?? '') && byText('暂停后的一句')?.status === 'pending' && notices.some((n) => n.kind === 'attention' && n.title.includes('队列已暂停')))
    await sleep(3000)
    check('队列：暂停时不发', byText('暂停后的一句')?.status === 'pending')
    queue.resume(s.id)
    check('队列：继续后发出', await until(() => byText('暂停后的一句')?.status === 'done', 40_000), JSON.stringify(byText('暂停后的一句')))
    queue.clear(s.id, 'finished')

    queue.add(s.id, '请帮我卡住一下')
    queue.add(s.id, '中断后的一句')
    check('队列：发出会挂住的一句', await until(() => byText('请帮我卡住一下')?.status === 'running', 30_000), JSON.stringify(byText('请帮我卡住一下')))
    await sleep(1500)
    term.write(s.id, '\x1b')
    check('队列：被 Esc 中断后暂停', await until(() => q().paused, 20_000) && byText('请帮我卡住一下')?.status === 'skipped' && byText('中断后的一句')?.status === 'pending', `${q().pauseReason} ${JSON.stringify(items())}`)
    queue.clear(s.id, 'all')
    await until(() => info().state === 'idle', 10_000)

    await mock('/__mock/model-error', { times: 8, status: 400, type: 'invalid_request_error', message: '坏请求测试', match: '会出错的一句' })
    queue.add(s.id, '会出错的一句')
    queue.add(s.id, '出错后的一句')
    check('队列：这一轮出错后暂停', await until(() => q().paused, 40_000) && byText('会出错的一句')?.status === 'failed' && byText('出错后的一句')?.status === 'pending', `${q().pauseReason} ${JSON.stringify(items())}`)
    check('队列：出错原因写在暂停说明里、发了“出了问题”', /出错/.test(q().pauseReason ?? '') && notices.some((n) => n.kind === 'problem' && n.title.includes('队列已暂停')), q().pauseReason)
    queue.clear(s.id, 'all')
    await mock('/__mock/model-error', { times: 0, match: '' })

    await until(() => info().state === 'idle' || info().state === 'error', 10_000)
    await sleep(2500)
    await mock('/__mock/model-error', { times: 1, status: 429, type: 'rate_limit_error', message: 'Rate limit exceeded', match: '额度测试的一句' })
    queue.add(s.id, '额度测试的一句')
    queue.add(s.id, '额度之后的一句')
    const quotaPaused = await until(() => q().paused && !!q().resumeAt, 40_000)
    check('额度用完：暂停、写明什么时候继续', quotaPaused && /额度已耗尽/.test(q().pauseReason ?? ''), `${q().pauseReason} ${JSON.stringify(items())} | ${info().stateDetail}`)
    const auto = items().find((x) => x.source === 'auto')
    check('额度用完：在出错那条后面放了一条“继续”', !!auto && items().indexOf(auto) === items().findIndex((x) => x.text === '额度测试的一句') + 1 && auto.text === '继续', JSON.stringify(items()))
    check('额度用完：提醒一次', notices.filter((n) => n.title.includes('额度已耗尽')).length === 1)
    check('额度用完：到时间自动继续，“继续”和后面那条都发完', await until(() => byText('额度之后的一句')?.status === 'done', 60_000) && auto?.id !== undefined && items().find((x) => x.id === auto.id)?.status === 'done', JSON.stringify(items()))
    check('额度用完：发了“队列自动继续了”、计数清零', notices.some((n) => n.title.includes('队列已自动继续')) && !q().retry && !q().paused)
    const contReq = (await said()).findLast((t) => t.trim() === '继续')
    check('额度用完：Claude 真的收到了“继续”', contReq === '继续')
    queue.clear(s.id, 'all')

    await mock('/__mock/model-error', { times: 1, status: 529, type: 'overloaded_error', message: 'Overloaded', match: '服务器出错的一句' })
    queue.add(s.id, '服务器出错的一句')
    check('服务器出错：暂停并安排重试', await until(() => q().paused && !!q().resumeAt, 40_000) && /服务器/.test(q().pauseReason ?? ''), `${q().pauseReason} ${JSON.stringify(items())}`)
    check('服务器出错：重试后答完', await until(() => items().some((x) => x.source === 'auto' && x.status === 'done'), 60_000), JSON.stringify(items()))
    queue.clear(s.id, 'all')

    settings.update({ queue: { autoResume: false } })
    await mock('/__mock/model-error', { times: 1, status: 429, type: 'rate_limit_error', message: 'Rate limit exceeded', match: '不自动继续的一句' })
    queue.add(s.id, '不自动继续的一句')
    check('关掉自动继续：额度用完只暂停，不放“继续”', await until(() => q().paused, 40_000) && !q().resumeAt && !items().some((x) => x.source === 'auto'), `${q().pauseReason} ${JSON.stringify(items())}`)
    settings.update({ queue: { autoResume: true } })
    queue.clear(s.id, 'all')
    await mock('/__mock/model-error', { times: 0, match: '' })

    queue.pause(s.id, '测试')
    queue.add(s.id, '立即发的一句')
    await queue.sendNext(s.id)
    check('立即发送下一条：暂停中也马上发、并取消暂停', !q().paused && (await until(() => byText('立即发的一句')?.status === 'done', 40_000)))
    queue.clear(s.id, 'all')

    await until(() => info().state === 'idle', 10_000)
    await queue.sendDirect(s.id, '直接发送的一句')
    check('直接发送：条目标记为 direct（不在界面队列中列出）', byText('直接发送的一句')?.direct !== false)
    check('直接发送：答完后从队列删除', await until(() => !byText('直接发送的一句'), 40_000))
    check('直接发送：确实发给了 Claude', (await said()).some((t) => t.includes('直接发送的一句')))
    queue.clear(s.id, 'all')

    await until(() => info().state === 'idle', 10_000)
    await term.typeText(s.id, '放进输入框的提示词')
    await sleep(1500)
    const before = (await requests()).length
    check('提示词放进输入框：出现在 Claude 的输入框里', strip(term.buffer(s.id)).includes('放进输入框的提示词'))
    await sleep(1500)
    check('提示词放进输入框：没有发出去', (await requests()).length === before && info().state === 'idle')
    term.write(s.id, String.fromCharCode(21))

    queue.add(s.id, '/pause')
    queue.pause(s.id)
    check('队列文件存在', existsSync(join(qdir2, `${s.id}.json`)))
    await term.end(s.id)
    term.remove(s.id)
    check('会话删除后队列也删了', !existsSync(join(qdir2, `${s.id}.json`)) && queue.get(s.id).items.length === 0)
  } finally {
    await mock('/__mock/model-error', { times: 0, match: '' }).catch(() => undefined)
    queue.shutdown()
    term.shutdown()
    settings.update({ stuck: { remindMinutes: 2, autoContinue: true }, queue: { autoResume: true, continueText: '' } })
    rmSync(qdir2, { recursive: true, force: true })
  }
}
