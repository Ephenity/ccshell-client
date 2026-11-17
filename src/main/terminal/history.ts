import { readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { ClaudeAccount, HistoryItem, HistoryMessage } from '../../shared/terminal'
import { configDir } from './claude'

interface Parsed {
  item: Omit<HistoryItem, 'openIn'>
  messages: HistoryMessage[]
}

const cache = new Map<string, { mtime: number; size: number; parsed: Parsed }>()

const ID_RE = /^[0-9a-f-]{36}$/i

function projectsDir(account: ClaudeAccount): string {
  return join(configDir(account), 'projects')
}

function accountOf(file: string): ClaudeAccount {
  return file.toLowerCase().startsWith(projectsDir('anthropic').toLowerCase()) ? 'anthropic' : 'ccshell'
}

function files(): string[] {
  const out: string[] = []
  for (const account of ['ccshell', 'anthropic'] as const) {
    const root = projectsDir(account)
    let dirs: string[] = []
    try {
      dirs = readdirSync(root)
    } catch {
      continue
    }
    for (const d of dirs) {
      let names: string[] = []
      try {
        names = readdirSync(join(root, d))
      } catch {
        continue
      }
      for (const n of names) if (n.endsWith('.jsonl') && ID_RE.test(n.slice(0, -6))) out.push(join(root, d, n))
    }
  }
  return out
}

function isNoise(text: string): boolean {
  return /^\s*<(command-|local-command-|system-reminder|bash-|user-memory|task-notification)/.test(text) || /^\s*Caveat: The messages below/.test(text)
}

function textOf(content: unknown): { text: string; tools: string[]; toolResultOnly: boolean } {
  if (typeof content === 'string') return { text: content, tools: [], toolResultOnly: false }
  if (!Array.isArray(content)) return { text: '', tools: [], toolResultOnly: false }
  const parts: string[] = []
  const tools: string[] = []
  let results = 0
  for (const b of content as { type?: string; text?: string; name?: string }[]) {
    if (b?.type === 'text' && typeof b.text === 'string') parts.push(b.text)
    else if (b?.type === 'tool_use' && b.name) tools.push(b.name)
    else if (b?.type === 'tool_result') results++
  }
  return { text: parts.join('\n\n'), tools, toolResultOnly: results > 0 && !parts.length }
}

function parse(file: string, size: number, mtime: number): Parsed {
  const id = basename(file, '.jsonl')
  const messages: HistoryMessage[] = []
  let cwd = ''
  let title = ''
  let model: string | null = null
  let started = 0
  let updated = 0
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line) continue
    const lead = /^\{"type":"([\w-]+)"/.exec(line)?.[1]
    if (lead ? !/^(summary|custom-title|ai-title)$/.test(lead) : !line.startsWith('{"parentUuid"')) continue
    let j: Record<string, any>
    try {
      j = JSON.parse(line)
    } catch {
      continue
    }
    if (j.type === 'custom-title' && typeof j.customTitle === 'string') {
      title = j.customTitle
      continue
    }
    if ((j.type === 'summary' || j.type === 'ai-title') && !title) {
      title = String(j.summary ?? j.aiTitle ?? '')
      continue
    }
    if (j.type !== 'user' && j.type !== 'assistant') continue
    if (j.isSidechain || j.isMeta) continue
    const at = Date.parse(j.timestamp) || 0
    if (at) {
      started ||= at
      updated = Math.max(updated, at)
    }
    if (typeof j.cwd === 'string' && j.cwd) cwd ||= j.cwd
    const { text, tools, toolResultOnly } = textOf(j.message?.content)
    if (j.type === 'user') {
      if (toolResultOnly || !text.trim() || isNoise(text)) continue
      messages.push({ role: 'user', text, tools: [], at })
    } else {
      if (typeof j.message?.model === 'string' && j.message.model !== '<synthetic>') model = j.message.model
      const prev = messages.at(-1)
      if (prev?.role === 'assistant') {
        if (text) prev.text = prev.text ? prev.text + '\n\n' + text : text
        prev.tools.push(...tools)
      } else if (text || tools.length) messages.push({ role: 'assistant', text, tools, at })
    }
  }
  const firstPrompt = messages.find((m) => m.role === 'user')?.text.replace(/\s+/g, ' ').trim().slice(0, 200) ?? ''
  return {
    item: {
      id,
      cwd,
      title: (title || firstPrompt || '（空对话）').slice(0, 120),
      firstPrompt,
      messages: messages.length,
      model,
      startedAt: started || mtime,
      updatedAt: updated || mtime,
      size
    },
    messages
  }
}

function load(file: string): Parsed | null {
  let st
  try {
    st = statSync(file)
  } catch {
    return null
  }
  const hit = cache.get(file)
  if (hit && hit.mtime === st.mtimeMs && hit.size === st.size) return hit.parsed
  try {
    const parsed = parse(file, st.size, st.mtimeMs)
    cache.set(file, { mtime: st.mtimeMs, size: st.size, parsed })
    return parsed
  } catch {
    return null
  }
}

export function listHistory(): Omit<HistoryItem, 'openIn'>[] {
  const out: Omit<HistoryItem, 'openIn'>[] = []
  for (const f of files()) {
    const p = load(f)
    if (p && p.item.messages > 0) out.push({ ...p.item, account: accountOf(f) === 'anthropic' ? 'anthropic' : undefined })
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt)
}

function fileOf(id: string): string {
  if (!ID_RE.test(id)) throw new Error('对话 ID 不对')
  const f = files().find((x) => basename(x, '.jsonl') === id)
  if (!f) throw new Error('找不到这段对话的记录')
  return f
}

export function historyExists(id: string): boolean {
  try {
    fileOf(id)
    return true
  } catch {
    return false
  }
}

export function historyItem(id: string): Omit<HistoryItem, 'openIn'> | null {
  try {
    const f = fileOf(id)
    const item = load(f)?.item
    return item ? { ...item, account: accountOf(f) === 'anthropic' ? 'anthropic' : undefined } : null
  } catch {
    return null
  }
}

export function historyMessages(id: string): HistoryMessage[] {
  return load(fileOf(id))?.messages ?? []
}

export function toMarkdown(id: string): string {
  const p = load(fileOf(id))
  if (!p) throw new Error('读不了这段对话的记录')
  const time = (t: number) => (t ? new Date(t).toLocaleString('zh-CN', { hour12: false }) : '')
  const lines = [
    `# ${p.item.title}`,
    '',
    `- 目录：\`${p.item.cwd}\``,
    `- 时间：${time(p.item.startedAt)} — ${time(p.item.updatedAt)}`,
    ...(p.item.model ? [`- 模型：${p.item.model}`] : []),
    `- 对话 ID：${p.item.id}`,
    ''
  ]
  for (const m of p.messages) {
    lines.push(`## ${m.role === 'user' ? '你' : 'Claude'}${m.at ? ` · ${time(m.at)}` : ''}`, '')
    if (m.text) lines.push(m.text, '')
    if (m.tools.length) lines.push(`> 工具：${m.tools.join('、')}`, '')
  }
  return lines.join('\n')
}

export function exportMarkdown(id: string, target: string): void {
  writeFileSync(target, toMarkdown(id), 'utf8')
}

export function deleteHistory(id: string): void {
  const f = fileOf(id)
  rmSync(f, { force: true })
  rmSync(f.slice(0, -6), { recursive: true, force: true })
  cache.delete(f)
}
