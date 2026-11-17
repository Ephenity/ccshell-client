import { BookMarked, Folder, History, LayoutGrid, MessageSquare, Plus, Search, Star, Wrench } from 'lucide-react'
import { promptLabel } from '../../../shared/prompts'
import { usePrompts } from '../terminal/queueState'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { TerminalInfo, TerminalSession } from '../../../shared/terminal'
import { DESTINATIONS, type PageId } from '../pages'
import { dirName, STATE_STYLE, stateText } from '../terminal/state'
import { useTheme } from '../theme'
import { matches } from '../../../shared/fuzzy'
import { useDimTitleBar } from '../components/anim'

interface Item {
  id: string
  group: string
  label: string
  sub?: string
  icon: React.ReactNode
  run: () => void | Promise<void>
}

export function Palette(props: { onClose: () => void; onPage: (p: PageId) => void; onOpenSession: (id: string) => void; onPrompt: (id: string) => void }) {
  useDimTitleBar(0.3)
  const [query, setQuery] = useState('')
  const prompts = usePrompts()
  const [sessions, setSessions] = useState<TerminalSession[]>([])
  const [info, setInfo] = useState<TerminalInfo | null>(null)
  const [floatOn, setFloatOn] = useState(false)
  const [sel, setSel] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const list = useRef<HTMLDivElement>(null)
  const { theme, toggle } = useTheme()

  useEffect(() => {
    void window.ccshell.terminal.list().then((r) => r.ok && setSessions(r.data))
    void window.ccshell.terminal.info().then((r) => r.ok && setInfo(r.data))
    void window.ccshell.settings.get().then((r) => r.ok && setFloatOn(r.data.float.enabled))
  }, [])

  const start = async (cwd: string, resumeId?: string, title?: string) => {
    if (!info) return
    const r = await window.ccshell.terminal.create({ cwd, ...info.lastOptions, resumeId, title })
    if (!r.ok) return setError(r.error)
    props.onOpenSession(r.data.id)
    props.onClose()
  }

  const items = useMemo<Item[]>(() => {
    const out: Item[] = []
    const close = (fn: () => void) => () => {
      fn()
      props.onClose()
    }
    for (const s of sessions)
      out.push({
        id: 's:' + s.id,
        group: '会话',
        label: s.title,
        sub: `${stateText(s)} · ${dirName(s.cwd)}`,
        icon: <span className={'size-2 rounded-full ' + STATE_STYLE[s.state].dot} />,
        run: close(() => props.onOpenSession(s.id))
      })
    const open = new Set(sessions.filter((s) => s.status === 'running').map((s) => s.conversationId))
    for (const f of info?.favorites ?? [])
      if (!open.has(f.conversationId))
        out.push({ id: 'f:' + f.conversationId, group: '常用对话', label: f.title, sub: dirName(f.cwd), icon: <Star size={14} />, run: () => start(f.cwd, f.conversationId, f.title) })
    for (const d of [...(info?.pinnedDirs ?? []), ...(info?.recentDirs ?? [])])
      out.push({ id: 'd:' + d, group: '在此目录新建会话', label: dirName(d), sub: d, icon: <Folder size={14} />, run: () => start(d) })
    for (const p of prompts)
      out.push({
        id: 'pr:' + p.id,
        group: '提示词（插入当前会话输入框）',
        label: promptLabel(p),
        sub: p.text.replace(/\s+/g, ' ').slice(0, 60),
        icon: <BookMarked size={14} />,
        run: close(() => props.onPrompt(p.id))
      })
    for (const p of DESTINATIONS) out.push({ id: 'p:' + p.id, group: '页面', label: p.label, sub: p.description, icon: <p.icon size={14} />, run: close(() => props.onPage(p.id)) })
    out.push(
      { id: 'a:new', group: '操作', label: '新会话', sub: 'Ctrl+Shift+N', icon: <Plus size={14} />, run: close(() => props.onOpenSession('__new__')) },
      { id: 'a:history', group: '操作', label: '历史对话', sub: 'Claude Code 的 /resume', icon: <History size={14} />, run: close(() => props.onOpenSession('__history__')) },
      { id: 'a:theme', group: '操作', label: theme === 'dark' ? '切换为浅色主题' : '切换为深色主题', icon: <LayoutGrid size={14} />, run: close(toggle) },
      { id: 'a:float', group: '操作', label: floatOn ? '关闭悬浮窗' : '开启悬浮窗', icon: <MessageSquare size={14} />, run: close(() => void window.ccshell.settings.update({ float: { enabled: !floatOn } })) },
      { id: 'a:logs', group: '操作', label: '查看日志', icon: <Wrench size={14} />, run: close(() => props.onPage('logs')) },
      { id: 'a:env', group: '操作', label: '环境检查', icon: <Wrench size={14} />, run: close(() => props.onPage('env')) }
    )
    return out
  }, [sessions, info, theme, floatOn, prompts])

  const shown = useMemo(() => (query.trim() ? items.filter((i) => matches(`${i.label} ${i.sub ?? ''} ${i.group}`, query)) : items).slice(0, 60), [items, query])
  useEffect(() => setSel(0), [query])
  useEffect(() => {
    list.current?.querySelector(`[data-index="${sel}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [sel])

  return (
    <div className="dialog-backdrop fixed inset-0 z-[750] flex justify-center bg-black/30 pt-[12vh]" onMouseDown={props.onClose}>
      <div className="dialog-card flex h-fit max-h-[70vh] w-[560px] flex-col overflow-hidden rounded-lg border border-border bg-bg-raised shadow-[0_16px_48px_rgba(0,0,0,0.35)]" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2.5 border-b border-border px-4">
          <Search size={16} className="text-text-3" />
          <input
            autoFocus
            aria-label="搜索"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setSel((i) => Math.min(shown.length - 1, i + 1))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setSel((i) => Math.max(0, i - 1))
              } else if (e.key === 'Enter') {
                e.preventDefault()
                void shown[sel]?.run()
              } else if (e.key === 'Escape') props.onClose()
            }}
            placeholder="搜索会话、常用对话、目录、提示词或页面"
            className="h-12 flex-1 bg-transparent text-[14px] outline-none focus-visible:shadow-none"
          />
        </div>
        {error && <p className="border-b border-border px-4 py-2 text-xs text-danger">{error}</p>}
        <div ref={list} className="min-h-0 flex-1 overflow-y-auto p-1.5">
          {!shown.length && <p className="px-3 py-6 text-center text-xs text-text-3">无匹配结果</p>}
          {shown.map((it, i) => (
            <div key={it.id}>
              {(i === 0 || shown[i - 1].group !== it.group) && <div className="px-2.5 pt-2 pb-1 text-[11px] text-text-3">{it.group}</div>}
              <button
                data-index={i}
                onMouseMove={() => setSel(i)}
                onClick={() => void it.run()}
                className={'flex w-full items-center gap-2.5 rounded-sm px-2.5 py-1.5 text-left ' + (i === sel ? 'bg-surface-2 text-text' : 'text-text-2')}
              >
                <span className="flex size-4 shrink-0 items-center justify-center text-text-3">{it.icon}</span>
                <span className="max-w-[60%] shrink-0 truncate text-[13px]">{it.label}</span>
                {it.sub && <span className="ml-auto min-w-0 truncate pl-3 text-[11px] text-text-3" dir={/^[A-Za-z]:\\/.test(it.sub) ? 'rtl' : undefined} title={it.sub}>{it.sub}</span>}
              </button>
            </div>
          ))}
        </div>
        <div className="border-t border-border px-4 py-1.5 text-[11px] text-text-3">↑↓ 选择 · Enter 打开 · Esc 关闭 · 终端内使用 Ctrl+Shift+P</div>
      </div>
    </div>
  )
}
