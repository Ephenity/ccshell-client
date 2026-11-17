import { testEnv } from '../testhooks'
import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { app } from 'electron'
import type { Notice } from '../../shared/terminal'
import type { PeerMode } from '../../shared/peers'
import { emptyQueue, fillPlaceholders, nextClock, parseQueueText, parseResetTime, type QueueItem, type SessionQueue } from '../../shared/queue'
import { log } from '../log'
import { settings } from '../settings'
import { errorText, type TerminalService, type TurnEvent } from './service'

const TICK_MS = Number(testEnv('CCSHELL_QUEUE_TICK_MS')) || 1000
const RETRY_SCALE = Number(testEnv('CCSHELL_QUEUE_RETRY_SCALE')) || 1
const IDLE_MS = 2000
const TYPING_MS = 3000
const ENTER_RETRY_MS = 10_000
const START_TIMEOUT_MS = 45_000
const CLEAR_TIMEOUT_MS = 20_000
const CLEAR_SETTLE_MS = 2500
const SLASH_DONE_MS = 8000
const SLASH_QUIET_MS = 3000
const PANEL_COMMANDS = /^\/(model|config|resume|help|mcp|agents|permissions|status|cost|usage|memory|hooks|ide|doctor|login|logout|theme|output-style|vim|terminal-setup|export|context|todos|plugin|bashes|tasks)\s*$/i

const QUOTA_MAX = 6
const QUOTA_RETRY_MS = 15 * 60_000
const QUOTA_AFTER_RESET_MS = 90_000
const SERVER_DELAYS_MS = [2 * 60_000, 5 * 60_000, 10 * 60_000]

interface Active {
  itemId: string
  phase: 'sending' | 'running' | 'clear' | 'slash'
  sentAt: number
  enterTries: number
  conversationId?: string
  started?: boolean
}

const fmtTime = (t: number) => new Date(t).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })

export class QueueService extends EventEmitter<{ changed: [SessionQueue] }> {
  private readonly queues = new Map<string, SessionQueue>()
  private readonly active = new Map<string, Active>()
  private readonly peerEsc = new Map<string, number>()
  private readonly ticker: NodeJS.Timeout
  private readonly dir: string

  constructor(private readonly term: TerminalService, dir = join(app.getPath('userData'), 'queues')) {
    super()
    this.dir = dir
    mkdirSync(dir, { recursive: true })
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.json')) continue
      try {
        const q = JSON.parse(readFileSync(join(dir, f), 'utf8')) as SessionQueue
        if (!q.sessionId || !Array.isArray(q.items)) continue
        for (const it of q.items)
          if (it.status === 'sending' || it.status === 'running') Object.assign(it, { status: 'failed', note: '客户端退出时未完成' })
        this.queues.set(q.sessionId, q)
      } catch {
      }
    }
    term.holdDone = (id) => this.hasMore(id)
    term.on('turn', (e) => this.onTurn(e))
    term.on('removed', (id) => this.drop(id))
    this.ticker = setInterval(() => this.tick(), TICK_MS)
  }

  get(sessionId: string): SessionQueue {
    return this.queues.get(sessionId) ?? emptyQueue(sessionId)
  }

  all(): SessionQueue[] {
    return [...this.queues.values()]
  }

  private save(q: SessionQueue): void {
    this.queues.set(q.sessionId, q)
    const file = join(this.dir, `${q.sessionId}.json`)
    if (!q.items.length && !q.paused) {
      this.queues.delete(q.sessionId)
      rmSync(file, { force: true })
    } else {
      writeFileSync(file + '.tmp', JSON.stringify(q, null, 2))
      renameSync(file + '.tmp', file)
    }
    this.emit('changed', q)
  }

  private edit(sessionId: string, fn: (q: SessionQueue) => void): SessionQueue {
    const q = structuredClone(this.get(sessionId))
    fn(q)
    q.items = q.items.filter((x) => !(x.direct && x.status === 'done'))
    this.save(q)
    return q
  }

  private item(q: SessionQueue, itemId: string): QueueItem {
    const it = q.items.find((x) => x.id === itemId)
    if (!it) throw new Error('队列中不存在此条目')
    return it
  }

  private hasMore(sessionId: string): boolean {
    const q = this.queues.get(sessionId)
    return !!q && !q.paused && q.items.some((x) => x.status === 'pending' || x.status === 'waiting')
  }

  private notice(sessionId: string, kind: Notice['kind'], title: string, body: string): void {
    const name = this.term.peek(sessionId)?.info.title ?? '会话'
    this.term.emit('notice', { id: randomUUID(), kind, sessionId, title: `${name}：${title}`, body, at: Date.now() })
  }

  async sendDirect(sessionId: string, text: string): Promise<SessionQueue> {
    const first = this.get(sessionId).items.findIndex((x) => x.status === 'pending')
    this.add(sessionId, text, { direct: true, index: first < 0 ? undefined : first })
    return this.sendNext(sessionId)
  }

  add(sessionId: string, text: string, opts: { index?: number; source?: QueueItem['source']; note?: string; from?: QueueItem['from']; direct?: boolean } = {}): SessionQueue {
    if (!text.trim()) throw new Error('内容为空')
    const cmd = parseQueueText(text)
    if (cmd.kind === 'bad') throw new Error(cmd.error)
    if (!this.term.peek(sessionId)) throw new Error('会话不存在')
    return this.edit(sessionId, (q) => {
      const it: QueueItem = { id: randomUUID(), text: text.replace(/\r\n?/g, '\n').trim(), status: 'pending', addedAt: Date.now(), source: opts.source ?? 'user', note: opts.note, ...(opts.from ? { from: opts.from } : {}), ...(opts.direct ? { direct: true } : {}) }
      const i = opts.index === undefined ? q.items.length : Math.max(0, Math.min(q.items.length, opts.index))
      q.items.splice(i, 0, it)
    })
  }

  async deliver(sessionId: string, text: string, from: { id: string; title: string }, mode: PeerMode): Promise<string> {
    const peek = this.term.peek(sessionId)
    if (!peek?.running) throw new Error('目标会话未运行')
    const s = peek.info
    const q = this.get(sessionId)
    const now = Date.now()
    const waitsForPerson = s.state === 'waiting'
    const typing = now - peek.typedAt < TYPING_MS
    const a = this.active.get(sessionId)
    const note = `来自会话「${from.title}」`
    const item: QueueItem = { id: randomUUID(), text: text.replace(/\r\n?/g, '\n').trim(), status: 'pending', addedAt: now, source: 'peer', from, note }
    const firstPending = q.items.findIndex((x) => x.status === 'pending')
    const front = mode !== 'queue'
    const place = (it: QueueItem) =>
      this.edit(sessionId, (qq) => {
        const i = qq.items.findIndex((x) => x.status === 'pending')
        if (front || it.status !== 'pending') qq.items.splice(i < 0 ? qq.items.length : i, 0, it)
        else qq.items.push(it)
      })
    log('队列', `${s.title}：收到「${from.title}」的消息（${mode}）${item.text.replace(/\s+/g, ' ').slice(0, 80)}`)
    if (mode === 'now' && s.state === 'busy' && !q.paused && !typing && (!a || a.phase === 'running')) {
      place({ ...item, status: 'done', sentAt: now, doneAt: now, note: `${note}；已发送至当前回合` })
      await this.term.typeText(sessionId, item.text, { clear: true, submit: true })
      return '已发进对方正在进行的这一轮（Claude Code 会在这一轮中途读到它）'
    }
    if (mode === 'interrupt' && s.state === 'busy' && !q.paused) {
      place({ ...item, note: `${note}；已中断对方当前回合` })
      this.peerEsc.set(sessionId, now)
      this.term.key(sessionId, 'esc')
      return '已打断对方这一轮，消息排在它队列的最前面，停下后马上发进去'
    }
    place(item)
    if (q.paused) return `对方的队列暂停了（${q.pauseReason ?? '用户暂停'}），消息已排进队列${front && firstPending >= 0 ? '最前面' : ''}，用户点“继续”后发进去`
    if (waitsForPerson) return `对方正在等用户回答问题或确认权限，不能打断；消息已排进它的队列${front ? '最前面' : ''}，用户处理完后发进去`
    if (s.state === 'starting') return '对方正在启动，启动后发进去'
    if (front && typing) return '用户正在那个会话里打字，没有打进去；消息排在队列最前面，Claude 空闲后发进去'
    if (s.state === 'idle' || s.state === 'error') return '对方空闲，马上发进去'
    return front ? '对方正在处理，消息排在它队列的最前面，这一轮结束后马上发进去' : '已排进对方的队列，它这一轮结束后发进去'
  }

  update(sessionId: string, itemId: string, text: string): SessionQueue {
    const cmd = parseQueueText(text)
    if (cmd.kind === 'bad') throw new Error(cmd.error)
    if (!text.trim()) throw new Error('内容为空')
    return this.edit(sessionId, (q) => {
      const it = this.item(q, itemId)
      if (it.status !== 'pending' && it.status !== 'failed' && it.status !== 'skipped') throw new Error('已发送的条目无法修改')
      it.text = text.replace(/\r\n?/g, '\n').trim()
    })
  }

  remove(sessionId: string, itemId: string): SessionQueue {
    if (this.active.get(sessionId)?.itemId === itemId) this.active.delete(sessionId)
    return this.edit(sessionId, (q) => (q.items = q.items.filter((x) => x.id !== itemId)))
  }

  move(sessionId: string, itemId: string, delta: -1 | 1): SessionQueue {
    return this.edit(sessionId, (q) => {
      const pend = q.items.filter((x) => x.status === 'pending')
      const i = pend.findIndex((x) => x.id === itemId)
      const j = i + delta
      if (i < 0 || j < 0 || j >= pend.length) return
      const a = q.items.indexOf(pend[i])
      const b = q.items.indexOf(pend[j])
      ;[q.items[a], q.items[b]] = [q.items[b], q.items[a]]
    })
  }

  requeue(sessionId: string, itemId: string): SessionQueue {
    return this.edit(sessionId, (q) => {
      const it = this.item(q, itemId)
      q.items = q.items.filter((x) => x !== it)
      const firstPending = q.items.findIndex((x) => x.status === 'pending')
      q.items.splice(firstPending < 0 ? q.items.length : firstPending, 0, { ...it, status: 'pending', note: undefined, sentAt: undefined, doneAt: undefined, until: undefined })
    })
  }

  clear(sessionId: string, what: 'finished' | 'pending' | 'all'): SessionQueue {
    if (what === 'all') this.active.delete(sessionId)
    return this.edit(sessionId, (q) => {
      const done = (x: QueueItem) => x.status === 'done' || x.status === 'failed' || x.status === 'skipped'
      q.items = what === 'all' ? [] : q.items.filter((x) => (what === 'finished' ? !done(x) : x.status !== 'pending' && x.status !== 'waiting'))
      if (what === 'all') Object.assign(q, { paused: false, pauseReason: undefined, resumeAt: undefined, retry: undefined })
    })
  }

  pause(sessionId: string, reason?: string): SessionQueue {
    return this.edit(sessionId, (q) => Object.assign(q, { paused: true, pauseReason: reason, resumeAt: undefined }))
  }

  resume(sessionId: string): SessionQueue {
    log('队列', `${this.title(sessionId)}：继续队列`)
    return this.edit(sessionId, (q) => {
      Object.assign(q, { paused: false, pauseReason: undefined, resumeAt: undefined })
      for (const it of q.items) if (it.status === 'waiting') Object.assign(it, { status: 'done', doneAt: Date.now(), note: '提前结束等待' })
    })
  }

  cancelAutoResume(sessionId: string): SessionQueue {
    return this.edit(sessionId, (q) => Object.assign(q, { resumeAt: undefined, retry: undefined, pauseReason: (q.pauseReason ?? '已暂停') + '（已取消自动继续）' }))
  }

  async sendNext(sessionId: string): Promise<SessionQueue> {
    const peek = this.term.peek(sessionId)
    if (!peek?.running) throw new Error('会话未运行')
    const a = this.active.get(sessionId)
    if (a) {
      this.edit(sessionId, (q) => {
        const it = q.items.find((x) => x.id === a.itemId)
        if (it) Object.assign(it, { status: 'done', doneAt: Date.now(), note: '未等待结束即发送下一条' })
      })
      this.active.delete(sessionId)
    }
    const q = this.get(sessionId)
    const waiting = q.items.find((x) => x.status === 'waiting')
    if (waiting) {
      this.edit(sessionId, (qq) => Object.assign(this.item(qq, waiting.id), { status: 'done', doneAt: Date.now(), note: '提前结束等待' }))
    }
    const next = this.get(sessionId).items.find((x) => x.status === 'pending')
    if (!next) throw new Error('无待发送条目')
    if (this.get(sessionId).paused) this.edit(sessionId, (qq) => Object.assign(qq, { paused: false, pauseReason: undefined, resumeAt: undefined }))
    await this.dispatch(sessionId, next.id, true)
    return this.get(sessionId)
  }

  drop(sessionId: string): void {
    this.active.delete(sessionId)
    this.queues.delete(sessionId)
    rmSync(join(this.dir, `${sessionId}.json`), { force: true })
    this.emit('changed', emptyQueue(sessionId))
  }

  shutdown(): void {
    clearInterval(this.ticker)
  }

  private title(sessionId: string): string {
    return this.term.peek(sessionId)?.info.title ?? sessionId
  }

  private setItem(sessionId: string, itemId: string, patch: Partial<QueueItem>): void {
    this.edit(sessionId, (q) => {
      const it = q.items.find((x) => x.id === itemId)
      if (it) Object.assign(it, patch)
    })
  }

  private finish(sessionId: string, status: QueueItem['status'], note?: string): void {
    const a = this.active.get(sessionId)
    if (!a) return
    this.active.delete(sessionId)
    const it = this.get(sessionId).items.find((x) => x.id === a.itemId)
    this.setItem(sessionId, a.itemId, { status, doneAt: Date.now(), ...(note !== undefined ? { note: [it?.note, note].filter(Boolean).join('；') } : {}) })
  }

  private stop(sessionId: string, reason: string, notify: Notice['kind'] | null = 'problem'): void {
    log('队列', `${this.title(sessionId)}：暂停（${reason}）`)
    this.edit(sessionId, (q) => Object.assign(q, { paused: true, pauseReason: reason, resumeAt: undefined }))
    if (notify) this.notice(sessionId, notify, '队列已暂停', reason)
  }

  private async dispatch(sessionId: string, itemId: string, force = false): Promise<void> {
    const peek = this.term.peek(sessionId)
    if (!peek?.running) return
    const it = this.get(sessionId).items.find((x) => x.id === itemId)
    if (!it) return
    const cmd = parseQueueText(it.text)
    const now = Date.now()
    const base: Active = { itemId, phase: 'sending', sentAt: now, enterTries: 0, conversationId: peek.info.conversationId }
    log('队列', `${peek.info.title}：发送 ${it.text.replace(/\s+/g, ' ').slice(0, 80)}${force ? '（立即发送）' : ''}`)
    switch (cmd.kind) {
      case 'bad':
        this.setItem(sessionId, itemId, { status: 'failed', note: cmd.error, doneAt: now })
        this.stop(sessionId, `命令格式有误：${cmd.error}`)
        return
      case 'wait':
        this.setItem(sessionId, itemId, { status: 'waiting', until: now + cmd.ms, sentAt: now })
        return
      case 'at':
        this.setItem(sessionId, itemId, { status: 'waiting', until: nextClock(cmd.hour, cmd.minute, now), sentAt: now })
        return
      case 'pause':
        this.setItem(sessionId, itemId, { status: 'done', doneAt: now, sentAt: now })
        this.stop(sessionId, '队列在 /pause 处暂停，继续后发送后续条目', 'attention')
        return
      case 'clear':
        this.active.set(sessionId, { ...base, phase: 'clear' })
        this.setItem(sessionId, itemId, { status: 'sending', sentAt: now })
        await this.term.typeText(sessionId, '/clear', { clear: true, submit: true })
        return
      case 'slash':
        this.active.set(sessionId, { ...base, phase: 'slash' })
        this.setItem(sessionId, itemId, { status: 'sending', sentAt: now })
        await this.term.typeText(sessionId, cmd.text, { clear: true, submit: true })
        return
      case 'prompt': {
        this.active.set(sessionId, base)
        this.setItem(sessionId, itemId, { status: 'sending', sentAt: now })
        const project = basename(peek.info.cwd)
        await this.term.typeText(sessionId, it.source === 'peer' ? it.text : fillPlaceholders(it.text, project), { clear: true, submit: true })
        return
      }
    }
  }

  private onTurn(e: TurnEvent): void {
    const a = this.active.get(e.id)
    if (e.kind === 'exit') {
      if (a) this.finish(e.id, 'failed', '会话已结束')
      return
    }
    if (!a) return
    switch (e.kind) {
      case 'start':
        if (a.phase === 'sending') {
          a.phase = 'running'
          this.setItem(e.id, a.itemId, { status: 'running' })
        } else if (a.phase === 'slash') {
          a.started = true
          this.setItem(e.id, a.itemId, { status: 'running' })
        }
        break
      case 'stop':
        if (a.phase === 'running' || (a.phase === 'slash' && a.started)) {
          this.finish(e.id, 'done')
          const q = this.get(e.id)
          if (q.retry) this.edit(e.id, (qq) => (qq.retry = undefined))
        }
        break
      case 'session-start':
        if (a.phase === 'clear' && e.source === 'clear') this.finish(e.id, 'done')
        else if (a.phase === 'slash' && e.source === 'compact') this.finish(e.id, 'done')
        break
      case 'interrupted':
        if (Date.now() - (this.peerEsc.get(e.id) ?? 0) < 15_000) {
          this.peerEsc.delete(e.id)
          this.finish(e.id, 'skipped', '被其他会话中断')
          break
        }
        if (a.phase === 'running' || a.phase === 'sending' || a.phase === 'slash') {
          this.finish(e.id, 'skipped', '本轮已被 Esc 中断')
          this.stop(e.id, '本轮已被 Esc 中断，确认后可继续', null)
        }
        break
      case 'failure':
        if (a.phase === 'running' || a.phase === 'sending' || a.phase === 'slash') this.onFailure(e, a)
        break
    }
  }

  private onFailure(e: TurnEvent, a: Active): void {
    const kind = e.error ?? ''
    const detail = e.detail ?? ''
    const text = errorText(kind, detail) || '本轮出错'
    const cfg = settings.get().queue
    const quota = kind === 'rate_limit' || kind === 'billing_error' || /额度|quota|rate.?limit|usage limit|429/i.test(detail)
    const server = !quota && (kind === 'overloaded' || kind === 'server_error' || /overloaded|529|5\d\d/.test(detail))
    if (!cfg.autoResume || (!quota && !server)) {
      this.finish(e.id, 'failed', text)
      this.stop(e.id, `本轮出错：${text}`)
      return
    }
    const q = this.get(e.id)
    const sameKind = q.retry?.kind === (quota ? 'quota' : 'server')
    const count = (sameKind ? q.retry!.count : 0) + 1
    const max = quota ? QUOTA_MAX : SERVER_DELAYS_MS.length
    this.finish(e.id, 'failed', `${text}（已在其后追加继续指令）`)
    if (count > max) {
      this.edit(e.id, (qq) => (qq.retry = undefined))
      this.stop(e.id, `${quota ? '额度耗尽' : '服务器错误'}，已连续自动继续 ${max} 次仍未成功：${text}`)
      return
    }
    const now = Date.now()
    const reset = quota ? parseResetTime(detail, now) : null
    const wait = quota ? (reset ? reset - now + QUOTA_AFTER_RESET_MS : QUOTA_RETRY_MS) : SERVER_DELAYS_MS[count - 1]
    const resumeAt = now + Math.max(1000, Math.round(wait * RETRY_SCALE))
    const why = quota
      ? reset
        ? `额度已耗尽，将于 ${fmtTime(reset)} 重置，${fmtTime(resumeAt)} 自动继续`
        : `额度已耗尽，重置时间未知，将于 ${fmtTime(resumeAt)} 尝试继续`
      : `服务器临时错误，将于 ${fmtTime(resumeAt)} 自动重试（第 ${count} 次）`
    this.edit(e.id, (qq) => {
      const i = qq.items.findIndex((x) => x.id === a.itemId)
      qq.items.splice(i + 1, 0, { id: randomUUID(), text: cfg.continueText, status: 'pending', addedAt: now, source: 'auto', note: quota ? '额度耗尽后自动继续' : '服务器错误后自动重试' })
      Object.assign(qq, { paused: true, pauseReason: why, resumeAt, retry: { kind: quota ? 'quota' : 'server', count } })
    })
    log('队列', `${this.title(e.id)}：${why}（${text}）`)
    if (count === 1) this.notice(e.id, 'problem', quota ? '额度已耗尽' : '服务器错误', `${why}。${text}`)
  }

  tick(): void {
    const now = Date.now()
    for (const q of [...this.queues.values()]) {
      const id = q.sessionId
      const peek = this.term.peek(id)
      if (!peek) continue
      if (q.paused && q.resumeAt && now >= q.resumeAt) {
        log('队列', `${peek.info.title}：到时间了，自动继续`)
        this.edit(id, (qq) => Object.assign(qq, { paused: false, pauseReason: undefined, resumeAt: undefined }))
        this.notice(id, 'problem', '队列已自动继续', q.retry?.kind === 'quota' ? '额度耗尽后自动继续' : '服务器错误后自动重试')
        continue
      }
      if (!peek.running) continue
      const s = peek.info
      const waiting = q.items.find((x) => x.status === 'waiting')
      if (waiting) {
        if (waiting.until && now >= waiting.until) this.setItem(id, waiting.id, { status: 'done', doneAt: now })
        continue
      }
      const a = this.active.get(id)
      if (a) {
        this.check(id, a, now)
        continue
      }
      if (q.paused) continue
      const next = q.items.find((x) => x.status === 'pending')
      if (!next) continue
      const ready = (s.state === 'idle' || s.state === 'error') && !s.continuing && now - s.stateAt >= IDLE_MS && now - peek.typedAt >= TYPING_MS
      if (ready) void this.dispatch(id, next.id)
    }
  }

  private check(id: string, a: Active, now: number): void {
    const peek = this.term.peek(id)!
    const s = peek.info
    const age = now - a.sentAt
    if (a.phase === 'sending') {
      if (age >= START_TIMEOUT_MS) {
        this.finish(id, 'failed', 'Claude 未开始处理')
        this.stop(id, `发送 ${START_TIMEOUT_MS / 1000} 秒后 Claude 仍未开始处理（输入框中可能有其他内容，或回车被补全菜单拦截）。请检查终端`)
      } else if (s.state === 'idle' && a.enterTries < 2 && age >= ENTER_RETRY_MS * (a.enterTries + 1)) {
        a.enterTries++
        this.term.key(id, 'enter')
        const it = this.get(id).items.find((x) => x.id === a.itemId)
        this.setItem(id, a.itemId, { note: [it?.note?.replace(/；?已自动补按回车.*$/, ''), `已自动补按回车${a.enterTries > 1 ? `（${a.enterTries} 次）` : ''}`].filter(Boolean).join('；') })
        log('队列', `${s.title}：发出 ${Math.round(age / 1000)} 秒还没开始处理，补按一次回车`)
      }
    } else if (a.phase === 'clear') {
      if (s.conversationId && a.conversationId && s.conversationId !== a.conversationId) this.finish(id, 'done')
      else if (age >= CLEAR_SETTLE_MS && now - peek.outputAt >= SLASH_QUIET_MS / 2 && s.state !== 'busy' && peek.outputAt > a.sentAt) this.finish(id, 'done')
      else if (age >= CLEAR_TIMEOUT_MS) {
        this.finish(id, 'failed', '未收到清空确认')
        this.stop(id, `/new 发送 ${CLEAR_TIMEOUT_MS / 1000} 秒后未收到清空确认，已停止发送后续条目（避免发送至旧对话）`)
      }
    } else if (a.phase === 'slash' && !a.started) {
      if (age >= SLASH_DONE_MS && now - peek.outputAt >= SLASH_QUIET_MS && s.state !== 'busy') {
        const it = this.get(id).items.find((x) => x.id === a.itemId)
        if (it && PANEL_COMMANDS.test(it.text.trim())) this.term.key(id, 'esc')
        this.finish(id, 'done')
      }
    }
  }
}
