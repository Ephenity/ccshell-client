import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { app } from 'electron'
import { CHAT_PEER_PREFIX, PEER_LIMITS as L, isChatPeer, type PeerEntry, type PeerMode, type PeerTool } from '../../shared/peers'
import type { TerminalSession } from '../../shared/terminal'
import type { ChatTool } from '../chat/tools'
import { log } from '../log'
import { settings } from '../settings'
import { historyMessages } from './history'
import { PEER_TOOL_DEFS } from './peersMcp'
import type { QueueService } from './queue'
import type { TerminalService } from './service'

const ENDED_SHOWN_MS = 2 * 3600_000
const KEEP_MS = 7 * 24 * 3600_000
const KEEP_MAX = 2000

const STATE_TEXT: Record<TerminalSession['state'], string> = {
  starting: '启动中',
  idle: '空闲',
  busy: '处理中',
  waiting: '等用户确认或回答',
  error: '这一轮出错了',
  running: '运行中（状态不明）',
  exited: '已结束'
}

const squash = (s: string, max: number) => {
  const flat = s.replace(/\s+/g, ' ').trim()
  return flat.length > max ? flat.slice(0, max) + '…' : flat
}

type Answer = Record<string, unknown>
const fail = (error: string): Answer => ({ ok: false, error })

export interface PeerChatInfo {
  id: string
  title: string
  workspace: string
  model: string
  state: 'idle' | 'busy'
  updatedAt: number
  lastText: string
  pending: number
}

export interface PeerChat {
  peerChats(): PeerChatInfo[]
  closedChats?(): string[]
  peerChat(id: string): PeerChatInfo | null
  peerMessages(id: string): { role: 'user' | 'assistant'; text: string; tools: string[] }[]
  deliverPeer(id: string, text: string, from: { id: string; title: string }, mode: PeerMode): string
}

interface Party {
  id: string
  kind: 'session' | 'chat'
  title: string
  cwd: string
  live: boolean
}

export class PeerService extends EventEmitter<{ changed: [PeerEntry[]] }> {
  private entries: PeerEntry[] = []
  private readonly file: string
  private chat: PeerChat | null = null
  private chatAllowed: PeerTool[] = []
  private readonly allowFile: string

  constructor(
    private readonly term: TerminalService,
    private readonly queue: QueueService,
    file = join(app.getPath('userData'), 'peers.jsonl')
  ) {
    super()
    this.file = file
    this.allowFile = join(dirname(file), 'peers-chat.json')
    try {
      const since = Date.now() - KEEP_MS
      this.entries = readFileSync(file, 'utf8')
        .split('\n')
        .flatMap((line) => {
          try {
            const e = JSON.parse(line) as PeerEntry
            return e && e.at >= since ? [e] : []
          } catch {
            return []
          }
        })
        .slice(-KEEP_MAX)
    } catch {
    }
    try {
      this.chatAllowed = (JSON.parse(readFileSync(this.allowFile, 'utf8')).alwaysAllow ?? []) as PeerTool[]
    } catch {
    }
    term.hooks.peers = (session, tool, args) => this.call(session, tool, args)
  }

  attachChat(chat: PeerChat): void {
    this.chat = chat
  }

  list(): PeerEntry[] {
    return [...this.entries].reverse()
  }

  clear(): void {
    this.entries = []
    this.write()
    this.emit('changed', this.list())
  }

  private write(): void {
    try {
      writeFileSync(this.file + '.tmp', this.entries.map((e) => JSON.stringify(e)).join('\n') + (this.entries.length ? '\n' : ''))
      renameSync(this.file + '.tmp', this.file)
    } catch (e) {
      log('协作', `记录写不进去：${(e as Error).message}`)
    }
  }

  private record(e: Omit<PeerEntry, 'id' | 'at'>): void {
    const since = Date.now() - KEEP_MS
    this.entries = [...this.entries.filter((x) => x.at >= since), { id: randomUUID(), at: Date.now(), ...e }].slice(-KEEP_MAX)
    this.write()
    this.emit('changed', this.list())
  }

  private party(id: string): Party | null {
    if (isChatPeer(id)) {
      const c = this.chat?.peerChat(id.slice(CHAT_PEER_PREFIX.length))
      return c ? { id, kind: 'chat', title: c.title, cwd: c.workspace, live: true } : null
    }
    const p = this.term.peek(id)
    return p ? { id, kind: 'session', title: p.info.title, cwd: p.info.cwd, live: p.running } : null
  }

  private title(id: string): string {
    return this.party(id)?.title ?? id
  }

  async call(self: string, tool: PeerTool, args: Record<string, unknown>): Promise<Answer> {
    if (!this.party(self)) return fail(isChatPeer(self) ? '这个聊天对话没有开“会话协作”。' : '客户端里找不到你这个会话（可能已经从列表删除了）。')
    switch (tool) {
      case 'sessions_list':
        return this.sessions(self)
      case 'session_read':
        return this.read(self, args)
      case 'session_send':
        return this.send(self, args)
      case 'session_start':
        return this.start(self, args)
    }
  }

  chatTools(conversationId: string): { tools: ChatTool[]; prompt: string } {
    const self = CHAT_PEER_PREFIX + conversationId
    const tools: ChatTool[] = PEER_TOOL_DEFS.map((d) => ({
      name: d.name,
      description: d.description,
      inputSchema: d.inputSchema,
      serverId: 'peers',
      serverName: '会话协作',
      tool: d.name,
      needsApproval: () => d.name !== 'sessions_list' && !this.chatAllowed.includes(d.name),
      allowAlways: (scope) => {
        const add: PeerTool[] = scope === 'tool' ? [d.name] : ['session_read', 'session_send', 'session_start']
        this.chatAllowed = [...new Set([...this.chatAllowed, ...add])]
        try {
          mkdirSync(dirname(this.allowFile), { recursive: true })
          writeFileSync(this.allowFile, JSON.stringify({ alwaysAllow: this.chatAllowed }, null, 2))
        } catch (e) {
          log('协作', `“总是允许”没能保存：${(e as Error).message}`)
        }
      },
      call: async (input) => {
        const r = await this.call(self, d.name, (input ?? {}) as Record<string, unknown>)
        return r.ok === false ? { text: String(r.error ?? '失败'), isError: true } : { text: JSON.stringify(r, null, 2), isError: false }
      }
    }))
    const prompt =
      `你在 CC Shell 客户端的一个聊天对话里（在会话协作里你的 id 是 ${self}）。客户端里还有 Claude Code 终端会话和别的聊天对话：` +
      '可以用 sessions_list 看有哪些、session_read 读它们的对话、session_send 给它们发消息、session_start 开新的 Claude Code 会话分派任务。' +
      '别的会话发来的消息会以“【另一个 Claude 会话发来的消息 · CC Shell 会话协作】”开头出现在对话里，需要回复时用 session_send。'
    return { tools, prompt }
  }

  sessions(self: string): Answer {
    const now = Date.now()
    const sessions: Answer[] = this.term
      .list()
      .filter((s) => s.status === 'running' || now - s.stateAt < ENDED_SHOWN_MS)
      .map((s) => {
        const q = this.queue.get(s.id)
        const last = s.conversationId ? historyMessages(s.conversationId).findLast((m) => m.role === 'assistant' && m.text.trim()) : undefined
        return {
          id: s.id,
          kind: 'claude-code',
          self: s.id === self,
          name: s.title,
          directory: s.cwd,
          model: s.model,
          state: s.status === 'running' ? s.state : 'exited',
          stateText: s.status === 'running' ? (s.stateDetail ? `${STATE_TEXT[s.state]}（${s.stateDetail}）` : STATE_TEXT[s.state]) : '已结束',
          since: new Date(s.stateAt).toISOString(),
          activity: s.activity ?? '',
          lastText: last ? squash(last.text, 300) : '',
          conversation: s.conversationId ?? '',
          queued: q.items.filter((x) => x.status === 'pending' || x.status === 'waiting').length,
          queuePaused: q.paused,
          openedBy: s.openedBy ? `${s.openedBy.title}（${s.openedBy.id}）` : ''
        }
      })
    for (const c of this.chat?.peerChats() ?? []) {
      const id = CHAT_PEER_PREFIX + c.id
      sessions.push({
        id,
        kind: 'chat',
        self: id === self,
        name: c.title,
        directory: c.workspace,
        model: c.model,
        state: c.state,
        stateText: c.state === 'busy' ? '正在回答' : '空闲',
        since: new Date(c.updatedAt).toISOString(),
        lastText: squash(c.lastText, 300),
        queued: c.pending
      })
    }
    const closed = this.chat?.closedChats?.() ?? []
    const note =
      'kind=claude-code 是 Claude Code 终端会话，kind=chat 是聊天窗口里的对话。' +
      (closed.length
        ? `另有 ${closed.length} 个聊天对话没有开启“会话协作”，不在列表里，也读不到、发不了消息：${closed.slice(0, 20).map((t) => `「${t}」`).join('、')}。用户要找的对话在其中时，请告诉用户在那个对话输入框的“工具”里勾选“与 Claude Code 会话协作”。`
        : '')
    return { ok: true, self, note, sessions }
  }

  read(self: string, args: Record<string, unknown>): Answer {
    const session = String(args.session ?? '').trim()
    const n = Number(args.last)
    const last = Number.isFinite(n) && n >= 1 ? Math.min(200, Math.floor(n)) : 20
    if (!session) return fail('要给出 session（sessions_list 里的 id）。')
    const target = this.party(session)
    if (!target) return fail(`没有会话 ${session}（用 sessions_list 看有哪些）。`)
    let conv = ''
    let messages: { role: 'user' | 'assistant'; text: string; tools: string[] }[]
    if (target.kind === 'chat') messages = this.chat!.peerMessages(session.slice(CHAT_PEER_PREFIX.length))
    else {
      conv = this.term.peek(session)!.info.conversationId ?? ''
      if (!conv) return fail(`会话「${target.title}」还没有对话记录（Claude 还没开始第一轮）。`)
      messages = historyMessages(conv)
    }
    const shown = messages.slice(-last)
    let text = shown
      .map((m) => (m.role === 'user' ? '用户：' : 'Claude：') + [m.text.trim(), ...m.tools.map((t) => `[工具] ${t}`)].filter(Boolean).join('\n'))
      .join('\n\n')
    const cut = text.length > L.maxRead
    if (cut) text = '…' + text.slice(-L.maxRead)
    this.record({ kind: 'read', from: self, fromTitle: this.title(self), to: session, toTitle: target.title, ok: true })
    log('协作', `${this.title(self)} 读了「${target.title}」的对话（最后 ${shown.length} 条）`)
    return { ok: true, session, name: target.title, ...(conv ? { conversation: conv } : {}), total: messages.length, shown: shown.length, cut, text }
  }

  private recent(ms: number): PeerEntry[] {
    const since = Date.now() - ms
    return this.entries.filter((e) => e.ok && e.at >= since)
  }

  limitFor(self: string, kind: 'send' | 'start', to?: string): string | null {
    const hour = this.recent(3600_000)
    if (kind === 'send') {
      if (hour.filter((e) => e.kind === 'send' && e.from === self).length >= L.sendsPerHour)
        return `这个会话一小时内已经发了 ${L.sendsPerHour} 条消息，先停一下（防止两个会话无限循环）。需要的话请用户来协调。`
      const pair = this.recent(10 * 60_000).filter((e) => e.kind === 'send' && ((e.from === self && e.to === to) || (e.from === to && e.to === self)))
      if (pair.length >= L.pairPer10Min) return `这两个会话 10 分钟内已经来回发了 ${L.pairPer10Min} 条，可能在互相循环：先停下，把结论写清楚，或者请用户介入。`
      return null
    }
    if (hour.filter((e) => e.kind === 'start' && e.from === self).length >= L.startsPerHour)
      return `这个会话一小时内已经开了 ${L.startsPerHour} 个新会话，先用已有的会话（session_send），或者请用户来开。`
    const running = this.term.list().filter((s) => s.status === 'running').length
    if (running >= L.maxRunning) return `已经有 ${running} 个会话在运行，不再开新的；先用已有的会话，或者请用户结束一些。`
    return null
  }

  async send(self: string, args: Record<string, unknown>): Promise<Answer> {
    const to = String(args.to ?? '').trim()
    const body = String(args.text ?? '').replace(/\r\n?/g, '\n').trim()
    const mode: PeerMode = args.mode === 'now' || args.mode === 'interrupt' ? args.mode : 'queue'
    const me = this.party(self)!
    const target = to ? this.party(to) : null
    const refuse = (error: string): Answer => {
      this.record({ kind: 'send', from: self, fromTitle: me.title, to, toTitle: target?.title ?? '', mode, text: squash(body, 2000), ok: false, error })
      log('协作', `${me.title} → ${target?.title ?? to}：拒绝（${error}）`)
      return fail(error)
    }
    if (!body) return refuse('消息是空的。')
    if (body.length > L.maxText) return refuse(`消息太长（${body.length} 字，最多 ${L.maxText}）：把内容写进项目里的一个文件，消息里给出路径。`)
    if (to === self) return refuse('不能发给自己。')
    if (!target || !target.live) return refuse(`没有运行中的会话 ${to}（用 sessions_list 看有哪些）。`)
    const limit = this.limitFor(self, 'send', to)
    if (limit) return refuse(limit)
    const from = { id: self, title: me.title }
    let delivery: string
    try {
      if (target.kind === 'chat') {
        const busy = this.chat!.peerChat(to.slice(CHAT_PEER_PREFIX.length))?.state === 'busy'
        delivery = this.chat!.deliverPeer(to.slice(CHAT_PEER_PREFIX.length), compose(me, body, mode === 'interrupt' && busy), from, mode)
      } else {
        const interrupting = mode === 'interrupt' && this.term.peek(to)?.info.state === 'busy'
        delivery = await this.queue.deliver(to, compose(me, body, interrupting), from, mode)
      }
    } catch (e) {
      return refuse((e as Error).message)
    }
    this.record({ kind: 'send', from: self, fromTitle: me.title, to, toTitle: target.title, mode, text: squash(body, 2000), ok: true, delivery })
    log('协作', `${me.title} → ${target.title}（${mode}）：${squash(body, 120)}；${delivery}`)
    return { ok: true, to, toName: target.title, mode, delivery }
  }

  async start(self: string, args: Record<string, unknown>): Promise<Answer> {
    const task = String(args.task ?? '').replace(/\r\n?/g, '\n').trim()
    const me = this.party(self)!
    const name = String(args.name ?? '').replace(/\s+/g, ' ').trim().slice(0, 60) || '协作'
    let dir = String(args.directory ?? '').trim() || me.cwd
    const refuse = (error: string): Answer => {
      this.record({ kind: 'start', from: self, fromTitle: me.title, to: '', toTitle: name, text: squash(task, 2000), ok: false, error })
      log('协作', `${me.title} 开新会话：拒绝（${error}）`)
      return fail(error)
    }
    if (!task) return refuse('没有给新会话的任务（task）。')
    if (task.length > L.maxText) return refuse(`任务太长（${task.length} 字，最多 ${L.maxText}）：写进项目里的一个文件，任务里给出路径。`)
    if (!dir) return refuse('没有项目目录：聊天对话没有设 Agent 工作目录，要在 directory 里写明新会话的项目目录（完整路径）。')
    if (!isAbsolute(dir)) {
      if (!me.cwd) return refuse(`directory 要写完整路径：${dir}`)
      dir = resolve(me.cwd, dir)
    }
    if (!existsSync(dir) || !statSync(dir).isDirectory()) return refuse(`没有这个目录：${dir}`)
    const limit = this.limitFor(self, 'start')
    if (limit) return refuse(limit)
    const cc = settings.get().claudeCode
    let created: TerminalSession
    try {
      created = await this.term.create({ cwd: dir, model: cc.model, allModels: cc.allModels, title: name, openedBy: { id: self, title: me.title } })
    } catch (e) {
      return refuse(`会话没能启动：${(e as Error).message}`)
    }
    const where = me.kind === 'chat' ? '聊天窗口里的对话' : `会话 ${self}，目录 ${me.cwd}`
    const text =
      `【这个会话是另一个 Claude 会话为了分派任务开的 · CC Shell 会话协作】由「${me.title}」（${where}）开启。\n\n${task}\n\n` +
      `——做完、卡住或需要商量时，用 ccshell 的 session_send 工具（to="${self}"）告诉它。`
    try {
      this.queue.add(created.id, text, { source: 'peer', note: `协作任务，来自会话「${me.title}」`, from: { id: self, title: me.title } })
    } catch (e) {
      return refuse(`会话开了，但任务没能放进它的队列：${(e as Error).message}`)
    }
    this.record({ kind: 'start', from: self, fromTitle: me.title, to: created.id, toTitle: created.title, text: squash(task, 2000), ok: true })
    log('协作', `${me.title} 开了新会话「${created.title}」（${dir}）：${squash(task, 120)}`)
    return {
      ok: true,
      session: created.id,
      name: created.title,
      directory: created.cwd,
      model: created.model,
      note: '会话正在启动（约十几秒），启动后任务自动发进去。可以用 sessions_list 看它的状态；它做完会用 session_send 告诉你。'
    }
  }
}

export function compose(me: { id: string; title: string; cwd: string; kind?: 'session' | 'chat' }, body: string, interrupted: boolean): string {
  const where = me.kind === 'chat' ? '聊天窗口里的对话' : `会话 ${me.id}，目录 ${me.cwd}`
  const lines = [`【另一个 Claude 会话发来的消息 · CC Shell 会话协作】来自「${me.title}」（${where}）`]
  if (interrupted) lines.push('（它认为这件事要紧，打断了你正在做的这一轮。处理完之后接着做原来的事。）')
  lines.push('', body, '', `——要回复时用 session_send 工具（to="${me.id}"）；不需要回复就不用回。`)
  return lines.join('\n')
}
