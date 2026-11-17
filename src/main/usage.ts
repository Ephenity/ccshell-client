import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import type { Money } from '../shared/ccshell'
import type { Conversation, TokenUsage } from '../shared/chat'
import type { UsageRange, UsageRow, UsageSummary } from '../shared/maintenance'
import { configDir } from './terminal/claude'

interface Rec {
  at: number
  model: string
  source: 'code' | 'chat'
  usage: TokenUsage
}

const fileCache = new Map<string, { mtime: number; size: number; recs: Rec[] }>()

function walk(dir: string, out: string[], depth = 0): void {
  if (depth > 4) return
  let names: import('node:fs').Dirent[] = []
  try {
    names = readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const d of names) {
    const p = join(dir, d.name)
    if (d.isDirectory()) walk(p, out, depth + 1)
    else if (d.name.endsWith('.jsonl')) out.push(p)
  }
}

function parseCode(file: string): Rec[] {
  const byId = new Map<string, Rec>()
  let n = 0
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.startsWith('{"parentUuid"') || !line.includes('"usage"')) continue
    let j: { type?: string; timestamp?: string; message?: { id?: string; model?: string; usage?: Record<string, number> } }
    try {
      j = JSON.parse(line)
    } catch {
      continue
    }
    const u = j.message?.usage
    if (j.type !== 'assistant' || !u || !j.message?.model || j.message.model === '<synthetic>') continue
    const rec: Rec = {
      at: Date.parse(j.timestamp ?? '') || 0,
      model: j.message.model,
      source: 'code',
      usage: {
        input: u.input_tokens ?? 0,
        output: u.output_tokens ?? 0,
        cacheRead: u.cache_read_input_tokens ?? 0,
        cacheWrite: u.cache_creation_input_tokens ?? 0,
        reasoning: 0
      }
    }
    byId.set(j.message.id ?? `#${n++}`, rec)
  }
  return [...byId.values()]
}

function codeRecords(): { recs: Rec[]; files: number } {
  const files: string[] = []
  walk(join(configDir(), 'projects'), files)
  const recs: Rec[] = []
  for (const f of files) {
    try {
      const st = statSync(f)
      let hit = fileCache.get(f)
      if (!hit || hit.mtime !== st.mtimeMs || hit.size !== st.size) {
        hit = { mtime: st.mtimeMs, size: st.size, recs: parseCode(f) }
        fileCache.set(f, hit)
      }
      recs.push(...hit.recs)
    } catch {
    }
  }
  return { recs, files: files.length }
}

function chatRecords(): Rec[] {
  const dir = join(app.getPath('userData'), 'chats')
  const recs: Rec[] = []
  let names: string[] = []
  try {
    names = readdirSync(dir).filter((n) => n.endsWith('.json') && n !== 'settings.json')
  } catch {
    return recs
  }
  for (const n of names) {
    try {
      const conv = JSON.parse(readFileSync(join(dir, n), 'utf8')) as Conversation
      for (const m of conv.messages ?? []) if (m.role === 'assistant' && m.usage && m.model) recs.push({ at: m.createdAt, model: m.model, source: 'chat', usage: m.usage })
    } catch {
    }
  }
  return recs
}

export function rangeStart(range: UsageRange, now = Date.now()): number {
  if (range === '5h') return now - 5 * 3_600_000
  if (range === 'today') {
    const d = new Date(now)
    d.setHours(0, 0, 0, 0)
    return d.getTime()
  }
  return now - (range === '7d' ? 7 : 30) * 86_400_000
}

const dayKey = (t: number) => {
  const d = new Date(t)
  return `${d.getMonth() + 1}-${String(d.getDate()).padStart(2, '0')}`
}

export async function usageSummary(range: UsageRange, cost?: (model: string, u: TokenUsage) => Promise<Money | undefined>): Promise<UsageSummary> {
  const t0 = Date.now()
  const from = rangeStart(range)
  const code = codeRecords()
  const recs = [...code.recs, ...chatRecords()].filter((r) => r.at >= from)
  const rows = new Map<string, UsageRow>()
  const days = new Map<string, number>()
  let total: Money | undefined
  for (const r of recs) {
    const key = `${r.source}|${r.model}`
    const row = rows.get(key) ?? { model: r.model, source: r.source, requests: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
    row.requests++
    row.input += r.usage.input
    row.output += r.usage.output
    row.cacheRead += r.usage.cacheRead
    row.cacheWrite += r.usage.cacheWrite
    const c = cost ? await cost(r.model, r.usage).catch(() => undefined) : undefined
    if (c) {
      row.cost = { amount: (row.cost?.amount ?? 0) + c.amount, symbol: c.symbol }
      total = { amount: (total?.amount ?? 0) + c.amount, symbol: c.symbol }
    }
    rows.set(key, row)
    const k = dayKey(r.at)
    days.set(k, (days.get(k) ?? 0) + r.usage.input + r.usage.output + r.usage.cacheRead + r.usage.cacheWrite)
  }
  const dayList: { day: string; tokens: number }[] = []
  if (range === '7d' || range === '30d') {
    const n = range === '7d' ? 7 : 30
    for (let i = n - 1; i >= 0; i--) {
      const k = dayKey(Date.now() - i * 86_400_000)
      dayList.push({ day: k, tokens: days.get(k) ?? 0 })
    }
  }
  return {
    range,
    from,
    rows: [...rows.values()].sort((a, b) => b.input + b.output + b.cacheRead + b.cacheWrite - (a.input + a.output + a.cacheRead + a.cacheWrite)),
    days: dayList,
    totalCost: total,
    files: code.files,
    ms: Date.now() - t0
  }
}
