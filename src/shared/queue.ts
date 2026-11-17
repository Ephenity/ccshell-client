import type { Attachment } from './chat'

export type QueueItemStatus = 'pending' | 'sending' | 'running' | 'waiting' | 'done' | 'failed' | 'skipped'

export interface QueueItem {
  id: string
  text: string
  status: QueueItemStatus
  note?: string
  addedAt: number
  sentAt?: number
  doneAt?: number
  until?: number
  source?: 'user' | 'auto' | 'prompt' | 'peer'
  from?: { id: string; title: string }
  attachments?: Attachment[]
  regenerate?: boolean
  direct?: boolean
}

export interface SessionQueue {
  sessionId: string
  items: QueueItem[]
  paused: boolean
  pauseReason?: string
  resumeAt?: number
  retry?: { kind: 'quota' | 'server'; count: number }
}

export const emptyQueue = (sessionId: string): SessionQueue => ({ sessionId, items: [], paused: false })

export type QueueMap = Record<string, SessionQueue>

export type QueueCommand =
  | { kind: 'prompt'; text: string }
  | { kind: 'clear' }
  | { kind: 'wait'; ms: number; label: string }
  | { kind: 'at'; hour: number; minute: number; label: string }
  | { kind: 'pause' }
  | { kind: 'slash'; text: string }
  | { kind: 'bad'; error: string }

const pad = (n: number) => String(n).padStart(2, '0')

export function parseClock(s: string): { hour: number; minute: number } | null {
  const t = s.trim()
  let m = /^(\d{1,2})[:：](\d{2})$/.exec(t)
  if (!m) m = /^(\d{1,2})点(?:(半)|(\d{1,2})分?)?$/.exec(t)
  if (!m) return null
  const hour = Number(m[1])
  const minute = m[2] === '半' ? 30 : m[3] !== undefined ? Number(m[3]) : m[2] !== undefined && /^\d+$/.test(m[2]) ? Number(m[2]) : 0
  if (hour > 23 || minute > 59) return null
  return { hour, minute }
}

export function parseDuration(s: string): number | null {
  const t = s.trim().toLowerCase().replace(/\s+/g, '')
  if (/^\d+$/.test(t)) return Number(t) * 1000
  const re = /(\d+(?:\.\d+)?)(s|sec|秒|m|min|分钟|分|h|hr|小时|时)/g
  let total = 0
  let used = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(t))) {
    const n = Number(m[1])
    const unit = m[2]
    total += n * (/^(s|sec|秒)$/.test(unit) ? 1000 : /^(m|min|分钟|分)$/.test(unit) ? 60_000 : 3_600_000)
    used += m[0].length
  }
  return used === t.length && total > 0 ? total : null
}

export function parseQueueText(text: string): QueueCommand {
  const t = text.trim()
  const m = /^\/([A-Za-z][\w:-]*)(?:\s+([\s\S]*))?$/.exec(t)
  if (!m) return { kind: 'prompt', text }
  const name = m[1].toLowerCase()
  const arg = (m[2] ?? '').trim()
  if (name === 'new' || name === 'clear' || name === 'reset') return { kind: 'clear' }
  if (name === 'pause') return { kind: 'pause' }
  if (name === 'wait') {
    const ms = parseDuration(arg)
    return ms ? { kind: 'wait', ms, label: arg } : { kind: 'bad', error: '写法：/wait 30s、/wait 5m、/wait 1h' }
  }
  if (name === 'at' || name === 'until') {
    const c = parseClock(arg)
    return c ? { kind: 'at', ...c, label: `${pad(c.hour)}:${pad(c.minute)}` } : { kind: 'bad', error: '写法：/at 02:30、/at 7点半、/at 14点30' }
  }
  return { kind: 'slash', text: t }
}

export function nextClock(hour: number, minute: number, now = Date.now()): number {
  const d = new Date(now)
  d.setHours(hour, minute, 0, 0)
  if (d.getTime() <= now) d.setDate(d.getDate() + 1)
  return d.getTime()
}

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

export function fillPlaceholders(text: string, project: string, now = new Date()): string {
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
  const time = `${pad(now.getHours())}:${pad(now.getMinutes())}`
  return text.replace(/\{(date|time|weekday|project)\}/g, (_, k: string) => (k === 'date' ? date : k === 'time' ? time : k === 'weekday' ? WEEKDAYS[now.getDay()] : project))
}

export const QUEUE_COMMANDS: { name: string; insert: string; desc: string }[] = [
  { name: '/new', insert: '/new', desc: '清空对话（Claude Code 的 /clear），确认清空后再发下一条' },
  { name: '/wait', insert: '/wait 5m', desc: '停一会儿再继续：/wait 30s、/wait 5m、/wait 1h' },
  { name: '/at', insert: '/at 02:30', desc: '等到这个时刻：/at 02:30、/at 7点半（过了就等明天）' },
  { name: '/pause', insert: '/pause', desc: '队列停在这里，点“继续”后才往下走' },
  { name: '/compact', insert: '/compact', desc: '压缩对话上下文（交给 Claude Code）' }
]

export function parseResetTime(detail: string, now = Date.now()): number | null {
  if (!detail) return null
  const ts = /\b(1[6-9]\d{8})\b/.exec(detail)
  if (ts) {
    const t = Number(ts[1]) * 1000
    if (t > now && t - now < 8 * 86_400_000) return t
  }
  const iso = /\b(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)\b/.exec(detail)
  if (iso) {
    const t = Date.parse(iso[1].replace(' ', 'T'))
    if (t > now && t - now < 8 * 86_400_000) return t
  }
  const after = /(?:retry|try again)\s+(?:after|in)\s+(\d+)\s*(s|sec|seconds?|m|min|minutes?|h|hours?)/i.exec(detail)
  if (after) {
    const n = Number(after[1])
    const u = after[2].toLowerCase()
    return now + n * (u.startsWith('h') ? 3_600_000 : u.startsWith('m') ? 60_000 : 1000)
  }
  const at = /resets?\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i.exec(detail)
  if (at) {
    let h = Number(at[1])
    const min = Number(at[2] ?? 0)
    const ap = at[3]?.toLowerCase()
    if (ap === 'pm' && h < 12) h += 12
    if (ap === 'am' && h === 12) h = 0
    if (h <= 23 && min <= 59) return nextClock(h, min, now)
  }
  return null
}
