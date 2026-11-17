import { testEnv } from '../testhooks'
import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { app } from 'electron'
import type { Attachment } from '../../shared/chat'
import { CHAT_PEER_PREFIX, type PeerMode } from '../../shared/peers'
import { emptyQueue, fillPlaceholders, nextClock, parseQueueText, parseResetTime, type QueueItem, type SessionQueue } from '../../shared/queue'
import { log } from '../log'
import { settings } from '../settings'

const TICK_MS = Number(testEnv('CCSHELL_QUEUE_TICK_MS')) || 1000
const RETRY_SCALE = Number(testEnv('CCSHELL_QUEUE_RETRY_SCALE')) || 1
const GAP_MS = 300
const QUOTA_MAX = 6
const QUOTA_RETRY_MS = 15 * 60_000
const QUOTA_AFTER_RESET_MS = 90_000
const SERVER_DELAYS_MS = [2 * 60_000, 5 * 60_000, 10 * 60_000]

export interface ChatQueueHost {
  exists(convId: string): boolean
  isRunning(convId: string): boolean
  workspaceOf(convId: string): string
  titleOf(convId: string): string
  sendQueued(convId: string, text: string, attachments: Attachment[], from?: QueueItem['from']): void
  regenerate(convId: string): void
  stop(convId: string): void
  on(event: 'turn', fn: (e: ChatTurn) => void): unknown
}

export interface ChatTurn {
  convId: string
  status: 'done' | 'stopped' | 'error'
  error?: string
}

const fmtTime = (t: number) => new Date(t).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
export const chatKey = (convId: string) => CHAT_PEER_PREFIX + convId
const convOf = (key: string) => key.slice(CHAT_PEER_PREFIX.length)
const REGEN_TEXT = '（重新生成上一条回复）'

function parseChat(text: string) {
  const cmd = parseQueueText(text)
  if (cmd.kind === 'clear') return { kind: 'bad' as const, error: '对话中不支持 /new，如需切换话题请新建对话' }
  if (cmd.kind === 'slash') return { kind: 'prompt' as const, text }
  return cmd
}

export class ChatQueue extends EventEmitter<{ changed: [SessionQueue] }> {
  private readonly queues = new Map<string, SessionQueue>()
  private readonly active = new Map<string, string>()
  private readonly stopReason = new Map<string, 'peer' | 'next'>()
  private readonly endedAt = new Map<string, number>()
  private readonly ticker: NodeJS.Timeout

  constructor(
    private readonly chat: ChatQueueHost,
    private readonly dir = join(app.getPath('userData'), 'chat-queues')
  ) {
    super()
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
    chat.on('turn', (e) => this.onTurn(e))
    this.ticker = setInterval(() => this.tick(), TICK_MS)
    this.ticker.unref()
  }

  get(key: string): SessionQueue {
    return this.queues.get(key) ?? emptyQueue(key)
  }

  all(): SessionQueue[] {
    return [...this.queues.values()]
  }

  pendingCount(convId: string): number {
    return this.get(chatKey(convId)).items.filter((x) => x.status === 'pending' || x.status === 'waiting').length
  }

  private save(q: SessionQueue): void {
    const file = join(this.dir, `${convOf(q.sessionId)}.json`)
    if (!q.items.length && !q.paused) {
      this.queues.delete(q.sessionId)
      rmSync(file, { force: true })
    } else {
      this.queues.set(q.sessionId, q)
      writeFileSync(file + '.tmp', JSON.stringify(q, null, 2))
      renameSync(file + '.tmp', file)
    }
    this.emit('changed', q)
  }

  private edit(key: string, fn: (q: SessionQueue) => void): SessionQueue {
    const q = structuredClone(this.get(key))
    fn(q)
    this.save(q)
    return q
  }

  private item(q: SessionQueue, itemId: string): QueueItem {
    const it = q.items.find((x) => x.id === itemId)
    if (!it) throw new Error('队列中不存在此条目')
    return it
  }

  private setItem(key: string, itemId: string, patch: Partial<QueueItem>): void {
    this.edit(key, (q) => {
      const it = q.items.find((x) => x.id === itemId)
      if (it) Object.assign(it, patch)
    })
  }

  private title(key: string): string {
    return this.chat.titleOf(convOf(key))
  }

  add(key: string, text: string, opts: { index?: number; source?: QueueItem['source']; note?: string; from?: QueueItem['from']; attachments?: Attachment[] } = {}): SessionQueue {
    const attachments = opts.attachments ?? []
    if (!text.trim() && !attachments.length) throw new Error('内容为空')
    const cmd = parseChat(text)
    if (cmd.kind === 'bad') throw new Error(cmd.error)
    if (attachments.length && cmd.kind !== 'prompt') throw new Error('命令不能带附件')
    if (!this.chat.exists(convOf(key))) throw new Error('对话不存在')
    return this.edit(key, (q) => {
      const it: QueueItem = {
        id: randomUUID(),
        text: text.replace(/\r\n?/g, '\n').trim(),
        status: 'pending',
        addedAt: Date.now(),
        source: opts.source ?? 'user',
        note: opts.note,
        ...(opts.from ? { from: opts.from } : {}),
        ...(attachments.length ? { attachments } : {})
      }
      const i = opts.index === undefined ? q.items.length : Math.max(0, Math.min(q.items.length, opts.index))
      q.items.splice(i, 0, it)
    })
  }

  deliver(convId: string, text: string, from: { id: string; title: string }, mode: PeerMode): string {
    const key = chatKey(convId)
    const q = this.get(key)
    const running = this.chat.isRunning(convId)
    const hasPending = q.items.some((x) => x.status === 'pending' || x.status === 'waiting')
    const note = `来自会话「${from.title}」`
    const item: QueueItem = { id: randomUUID(), text: text.replace(/\r\n?/g, '\n').trim(), status: 'pending', addedAt: Date.now(), source: 'peer', from, note }
    const front = mode !== 'queue'
    this.edit(key, (qq) => {
      const i = qq.items.findIndex((x) => x.status === 'pending')
      if (front && i >= 0) qq.items.splice(i, 0, item)
      else qq.items.push(item)
    })
    log('队列', `聊天「${this.title(key)}」：收到「${from.title}」的消息（${mode}）${item.text.replace(/\s+/g, ' ').slice(0, 80)}`)
    if (!running && !q.paused && (!hasPending || front)) {
      this.dispatch(key, item.id)
      return '对方空闲，马上发进去'
    }
    if (q.paused) return `对方的队列暂停了（${q.pauseReason ?? '用户暂停'}），消息已排进队列${front ? '最前面' : ''}，用户点“继续”后发进去`
    if (mode === 'interrupt' && running) {
      this.setItem(key, item.id, { note: `${note}；已中断对方当前回合` })
      this.stopReason.set(key, 'peer')
      this.chat.stop(convId)
      return '已停下对方正在写的回答，消息排在它队列的最前面，马上发进去'
    }
    if (running) return front ? '对方正在回答（聊天不能在回答中途插话），消息排在它队列的最前面，这一轮结束后马上发进去' : '对方正在回答，已排进它的队列，这一轮结束后发进去'
    return '已排进对方的队列，前面的发完后发进去'
  }

  update(key: string, itemId: string, text: string): SessionQueue {
    const cmd = parseChat(text)
    if (cmd.kind === 'bad') throw new Error(cmd.error)
    return this.edit(key, (q) => {
      const it = this.item(q, itemId)
      if (it.status !== 'pending' && it.status !== 'failed' && it.status !== 'skipped') throw new Error('已发送的条目无法修改')
      if (it.regenerate) throw new Error('自动重试条目无法修改（可删除）')
      if (!text.trim() && !it.attachments?.length) throw new Error('内容为空')
      it.text = text.replace(/\r\n?/g, '\n').trim()
    })
  }

  remove(key: string, itemId: string): SessionQueue {
    if (this.active.get(key) === itemId) this.active.delete(key)
    return this.edit(key, (q) => (q.items = q.items.filter((x) => x.id !== itemId)))
  }

  move(key: string, itemId: string, delta: -1 | 1): SessionQueue {
    return this.edit(key, (q) => {
      const pend = q.items.filter((x) => x.status === 'pending')
      const i = pend.findIndex((x) => x.id === itemId)
      const j = i + delta
      if (i < 0 || j < 0 || j >= pend.length) return
      const a = q.items.indexOf(pend[i])
      const b = q.items.indexOf(pend[j])
      ;[q.items[a], q.items[b]] = [q.items[b], q.items[a]]
    })
  }

  requeue(key: string, itemId: string): SessionQueue {
    return this.edit(key, (q) => {
      const it = this.item(q, itemId)
      q.items = q.items.filter((x) => x !== it)
      const first = q.items.findIndex((x) => x.status === 'pending')
      q.items.splice(first < 0 ? q.items.length : first, 0, { ...it, status: 'pending', note: undefined, sentAt: undefined, doneAt: undefined, until: undefined })
    })
  }

  clear(key: string, what: 'finished' | 'pending' | 'all'): SessionQueue {
    if (what === 'all') this.active.delete(key)
    return this.edit(key, (q) => {
      const done = (x: QueueItem) => x.status === 'done' || x.status === 'failed' || x.status === 'skipped'
      q.items = what === 'all' ? [] : q.items.filter((x) => (what === 'finished' ? !done(x) : x.status !== 'pending' && x.status !== 'waiting'))
      if (what === 'all') Object.assign(q, { paused: false, pauseReason: undefined, resumeAt: undefined, retry: undefined })
    })
  }

  pause(key: string, reason?: string): SessionQueue {
    return this.edit(key, (q) => Object.assign(q, { paused: true, pauseReason: reason, resumeAt: undefined }))
  }

  resume(key: string): SessionQueue {
    log('队列', `聊天「${this.title(key)}」：继续队列`)
    return this.edit(key, (q) => {
      Object.assign(q, { paused: false, pauseReason: undefined, resumeAt: undefined })
      for (const it of q.items) if (it.status === 'waiting') Object.assign(it, { status: 'done', doneAt: Date.now(), note: '提前结束等待' })
    })
  }

  cancelAutoResume(key: string): SessionQueue {
    return this.edit(key, (q) => Object.assign(q, { resumeAt: undefined, retry: undefined, pauseReason: (q.pauseReason ?? '已暂停') + '（已取消自动继续）' }))
  }

  sendNext(key: string): SessionQueue {
    const convId = convOf(key)
    if (!this.get(key).items.some((x) => x.status === 'pending')) throw new Error('无待发送条目')
    this.edit(key, (q) => {
      Object.assign(q, { paused: false, pauseReason: undefined, resumeAt: undefined })
      for (const it of q.items) if (it.status === 'waiting') Object.assign(it, { status: 'done', doneAt: Date.now(), note: '提前结束等待' })
    })
    if (this.chat.isRunning(convId)) {
      this.stopReason.set(key, 'next')
      this.chat.stop(convId)
    } else {
      const next = this.get(key).items.find((x) => x.status === 'pending')
      if (next) this.dispatch(key, next.id)
    }
    return this.get(key)
  }

  drop(convId: string): void {
    const key = chatKey(convId)
    this.active.delete(key)
    this.queues.delete(key)
    rmSync(join(this.dir, `${convId}.json`), { force: true })
    this.emit('changed', emptyQueue(key))
  }

  shutdown(): void {
    clearInterval(this.ticker)
  }

  private stop(key: string, reason: string): void {
    log('队列', `聊天「${this.title(key)}」：暂停（${reason}）`)
    this.edit(key, (q) => Object.assign(q, { paused: true, pauseReason: reason, resumeAt: undefined }))
  }

  private finish(key: string, status: QueueItem['status'], note?: string): void {
    const itemId = this.active.get(key)
    if (!itemId) return
    this.active.delete(key)
    const it = this.get(key).items.find((x) => x.id === itemId)
    this.setItem(key, itemId, { status, doneAt: Date.now(), ...(note ? { note: [it?.note, note].filter(Boolean).join('；') } : {}) })
  }

  private dispatch(key: string, itemId: string): void {
    const convId = convOf(key)
    const it = this.get(key).items.find((x) => x.id === itemId)
    if (!it || this.chat.isRunning(convId)) return
    const cmd = parseChat(it.text)
    const now = Date.now()
    log('队列', `聊天「${this.title(key)}」：发送 ${it.text.replace(/\s+/g, ' ').slice(0, 80)}`)
    switch (cmd.kind) {
      case 'bad':
        this.setItem(key, itemId, { status: 'failed', note: cmd.error, doneAt: now })
        this.stop(key, `命令格式有误：${cmd.error}`)
        return
      case 'wait':
        this.setItem(key, itemId, { status: 'waiting', until: now + cmd.ms, sentAt: now })
        return
      case 'at':
        this.setItem(key, itemId, { status: 'waiting', until: nextClock(cmd.hour, cmd.minute, now), sentAt: now })
        return
      case 'pause':
        this.setItem(key, itemId, { status: 'done', doneAt: now, sentAt: now })
        this.stop(key, '队列在 /pause 处暂停，继续后发送后续条目')
        return
      case 'prompt': {
        this.active.set(key, itemId)
        this.setItem(key, itemId, { status: 'running', sentAt: now })
        try {
          if (it.regenerate) this.chat.regenerate(convId)
          else {
            const project = basename(this.chat.workspaceOf(convId) || '') || '{project}'
            this.chat.sendQueued(convId, it.source === 'peer' ? it.text : fillPlaceholders(it.text, project), it.attachments ?? [], it.from)
          }
        } catch (e) {
          this.finish(key, 'failed', (e as Error).message)
          this.stop(key, `发送失败：${(e as Error).message}`)
        }
      }
    }
  }

  private onTurn(e: ChatTurn): void {
    const key = chatKey(e.convId)
    this.endedAt.set(key, Date.now())
    const reason = this.stopReason.get(key)
    this.stopReason.delete(key)
    setTimeout(() => this.tick(), GAP_MS + 20).unref()
    if (!this.active.has(key)) return
    if (e.status === 'done') {
      this.finish(key, 'done')
      if (this.get(key).retry) this.edit(key, (q) => (q.retry = undefined))
    } else if (e.status === 'stopped') {
      if (reason === 'peer') this.finish(key, 'skipped', '被其他会话中断')
      else if (reason === 'next') this.finish(key, 'done', '未等待回答结束即发送下一条')
      else {
        this.finish(key, 'skipped', '本轮已停止')
        this.stop(key, '本轮已停止，确认后可继续')
      }
    } else this.onFailure(key, e.error ?? '')
  }

  private onFailure(key: string, error: string): void {
    const cfg = settings.get().queue
    const quota = /HTTP 429|额度|quota|rate.?limit|usage limit/i.test(error)
    const server = !quota && /HTTP 5\d\d|overloaded|网络连接失败/i.test(error)
    const text = error || '本轮出错'
    if (!cfg.autoResume || (!quota && !server)) {
      this.finish(key, 'failed', text)
      this.stop(key, `本轮出错：${text}`)
      return
    }
    const itemId = this.active.get(key)
    const q = this.get(key)
    const sameKind = q.retry?.kind === (quota ? 'quota' : 'server')
    const count = (sameKind ? q.retry!.count : 0) + 1
    const max = quota ? QUOTA_MAX : SERVER_DELAYS_MS.length
    this.finish(key, 'failed', `${text}（已在其后追加自动重试）`)
    if (count > max) {
      this.edit(key, (qq) => (qq.retry = undefined))
      this.stop(key, `${quota ? '额度耗尽' : '服务器错误'}，已连续自动重试 ${max} 次仍未成功：${text}`)
      return
    }
    const now = Date.now()
    const reset = quota ? parseResetTime(error, now) : null
    const wait = quota ? (reset ? reset - now + QUOTA_AFTER_RESET_MS : QUOTA_RETRY_MS) : SERVER_DELAYS_MS[count - 1]
    const resumeAt = now + Math.max(1000, Math.round(wait * RETRY_SCALE))
    const why = quota
      ? reset
        ? `额度已耗尽，将于 ${fmtTime(reset)} 重置，${fmtTime(resumeAt)} 自动重试`
        : `请求过于频繁或额度已耗尽，将于 ${fmtTime(resumeAt)} 重试`
      : `服务器临时错误，将于 ${fmtTime(resumeAt)} 自动重试（第 ${count} 次）`
    this.edit(key, (qq) => {
      const i = qq.items.findIndex((x) => x.id === itemId)
      qq.items.splice(i + 1, 0, { id: randomUUID(), text: REGEN_TEXT, regenerate: true, status: 'pending', addedAt: now, source: 'auto', note: quota ? '额度耗尽后自动重试' : '服务器错误后自动重试' })
      Object.assign(qq, { paused: true, pauseReason: why, resumeAt, retry: { kind: quota ? 'quota' : 'server', count } })
    })
    log('队列', `聊天「${this.title(key)}」：${why}（${text}）`)
  }

  tick(): void {
    const now = Date.now()
    for (const q of [...this.queues.values()]) {
      const key = q.sessionId
      const convId = convOf(key)
      if (!this.chat.exists(convId)) continue
      if (q.paused && q.resumeAt && now >= q.resumeAt) {
        log('队列', `聊天「${this.title(key)}」：到时间了，自动继续`)
        this.edit(key, (qq) => Object.assign(qq, { paused: false, pauseReason: undefined, resumeAt: undefined }))
        continue
      }
      const waiting = q.items.find((x) => x.status === 'waiting')
      if (waiting) {
        if (waiting.until && now >= waiting.until) this.setItem(key, waiting.id, { status: 'done', doneAt: now })
        continue
      }
      if (q.paused || this.chat.isRunning(convId)) continue
      if (this.active.has(key)) {
        this.finish(key, 'failed', '未收到回答结束信号')
        continue
      }
      if (now - (this.endedAt.get(key) ?? 0) < GAP_MS) continue
      const next = q.items.find((x) => x.status === 'pending')
      if (next) this.dispatch(key, next.id)
    }
  }
}
