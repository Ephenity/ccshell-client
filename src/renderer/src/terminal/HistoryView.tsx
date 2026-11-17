import { Loading } from '../components/Loading'
import { Segmented } from '../components/Segmented'
import { confirmDialog } from '../components/Dialog'
import { Download, Play, RefreshCw, Search, Star, Trash2, Wrench } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { FavoriteConversation, HistoryItem, HistoryMessage } from '../../../shared/terminal'
import { Markdown } from '../chat/Markdown'
import { dirName, when } from './state'

export function HistoryView(props: {
  favorites: FavoriteConversation[]
  onOpenSession: (id: string) => void
  onResume: (h: HistoryItem) => void
  onFavorite: (conversationId: string, on: boolean) => void
}) {
  const [items, setItems] = useState<HistoryItem[] | null>(null)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [messages, setMessages] = useState<HistoryMessage[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  const load = () =>
    void window.ccshell.terminal.history().then((r) => {
      if (r.ok) setItems(r.data)
      else setError(r.error)
    })
  useEffect(() => {
    load()
    return window.ccshell.terminal.onList(() => load())
  }, [])

  useEffect(() => {
    setMessages(null)
    setNote(null)
    if (!selected) return
    void window.ccshell.terminal.historyMessages(selected).then((r) => (r.ok ? setMessages(r.data) : setError(r.error)))
  }, [selected])

  const [scope, setScope] = useState<'all' | 'ccshell' | 'anthropic'>('all')
  const hasAnth = !!items?.some((h) => h.account === 'anthropic')
  const filtered = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean)
    return (items ?? []).filter((h) => (scope === 'all' || (h.account ?? 'ccshell') === scope) && words.every((w) => `${h.title}\n${h.firstPrompt}\n${h.cwd}\n${h.model ?? ''}`.toLowerCase().includes(w)))
  }, [items, query, scope])

  const current = items?.find((h) => h.id === selected) ?? null
  const fav = current ? props.favorites.some((f) => f.conversationId === current.id) : false

  const remove = async (h: HistoryItem) => {
    if (!(await confirmDialog({ title: '删除对话记录', message: `“${h.title}”将被永久删除，且无法继续。`, confirmText: '删除', danger: true }))) return
    const r = await window.ccshell.terminal.deleteHistory(h.id)
    if (!r.ok) return setError(r.error)
    setSelected(null)
    load()
  }

  const exportMd = async (h: HistoryItem) => {
    setNote(null)
    const r = await window.ccshell.terminal.exportHistory(h.id)
    if (!r.ok) setError(r.error)
    else if (r.data) setNote(`已导出：${r.data}`)
  }

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex w-[340px] shrink-0 flex-col border-r border-border">
        <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
          <div className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md border border-border-strong bg-bg-raised px-2.5 focus-within:border-brand">
            <Search size={14} className="shrink-0 text-text-3" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索标题、内容、目录"
              className="min-w-0 flex-1 bg-transparent text-[13px] outline-none focus-visible:shadow-none"
            />
          </div>
          <button title="刷新" className="flex size-8 items-center justify-center rounded-sm text-text-3 hover:bg-surface-2 hover:text-text" onClick={load}>
            <RefreshCw size={14} />
          </button>
        </div>
        {hasAnth && (
          <div className="border-b border-border px-3 py-2">
            <Segmented
              value={scope}
              options={[
                { value: 'all', label: '全部' },
                { value: 'ccshell', label: 'CC Shell' },
                { value: 'anthropic', label: 'Anthropic' }
              ]}
              onChange={setScope}
            />
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto p-2" aria-label="历史对话列表">
          {items === null && <Loading label="正在读取" size={36} />}
          {items !== null && !filtered.length && <p className="px-3 py-8 text-center text-xs text-text-3">{items.length ? '无匹配的对话' : '暂无对话记录'}</p>}
          {filtered.map((h) => (
            <button
              key={h.id}
              onClick={() => setSelected(h.id)}
              onDoubleClick={() => (h.openIn ? props.onOpenSession(h.openIn) : props.onResume(h))}
              className={'mb-0.5 flex w-full flex-col gap-0.5 rounded-sm px-2.5 py-2 text-left ' + (h.id === selected ? 'bg-surface-2 ring-1 ring-border' : 'hover:bg-surface')}
            >
              <span className="flex items-center gap-1.5 text-[13px] text-text">
                {h.openIn && <span className="size-1.5 shrink-0 rounded-full bg-success" title="已在会话中打开" />}
                <span className="truncate">{h.title}</span>
                {props.favorites.some((f) => f.conversationId === h.id) && <Star size={11} className="shrink-0 fill-current text-warning" />}
              </span>
              <span className="flex gap-2 text-[11px] text-text-3">
                <span className="truncate font-mono" title={h.cwd}>
                  {dirName(h.cwd)}
                </span>
                {h.account === 'anthropic' && <span className="shrink-0 text-brand-text">Anthropic</span>}
                <span className="shrink-0">{h.messages} 条</span>
                <span className="ml-auto shrink-0">{when(h.updatedAt)}</span>
              </span>
            </button>
          ))}
        </div>
        {error && <p className="border-t border-border px-3 py-2 text-xs text-danger select-text">{error}</p>}
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        {!current ? (
          <div className="flex flex-1 items-center justify-center text-[13px] text-text-3">选择对话查看，双击继续</div>
        ) : (
          <>
            <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
              <div className="min-w-0 flex-1">
                <h2 className="truncate font-serif text-[15px] font-semibold">{current.title}</h2>
                <p className="truncate font-mono text-[11px] text-text-3" title={current.cwd}>
                  {current.cwd} · {current.model ?? '模型未知'} · {new Date(current.startedAt).toLocaleString('zh-CN', { hour12: false })}
                </p>
              </div>
              {current.openIn ? (
                <button className="btn btn-primary h-8 gap-1.5 px-3 text-[13px]" onClick={() => props.onOpenSession(current.openIn!)}>
                  <Play size={14} />
                  切换至该会话
                </button>
              ) : (
                <button className="btn btn-primary h-8 gap-1.5 px-3 text-[13px]" onClick={() => props.onResume(current)} title="在原目录新建会话并继续此对话">
                  <Play size={14} />
                  继续
                </button>
              )}
              <button className="btn btn-secondary h-8 gap-1.5 px-3 text-[13px]" onClick={() => props.onFavorite(current.id, !fav)}>
                <Star size={14} className={fav ? 'fill-current text-warning' : ''} />
                {fav ? '移出常用' : '加入常用'}
              </button>
              <button className="btn btn-secondary h-8 gap-1.5 px-3 text-[13px]" onClick={() => void exportMd(current)}>
                <Download size={14} />
                导出 Markdown
              </button>
              <button className="btn btn-ghost h-8 gap-1.5 px-3 text-[13px] text-danger" disabled={!!current.openIn} title={current.openIn ? '已在会话中打开，请先结束该会话' : ''} onClick={() => void remove(current)}>
                <Trash2 size={14} />
                删除
              </button>
            </header>
            {note && <p className="border-b border-border px-4 py-1.5 text-xs text-success select-text">{note}</p>}
            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
              {!messages && <p className="text-xs text-text-3">正在读取…</p>}
              <div className="mx-auto flex max-w-3xl flex-col gap-4">
                {messages?.map((m, i) =>
                  m.role === 'user' ? (
                    <div key={i} className="ml-auto max-w-[85%] rounded-lg bg-surface-2 px-4 py-2.5 text-[13.5px] whitespace-pre-wrap text-text select-text">
                      {m.text}
                    </div>
                  ) : (
                    <div key={i} className="text-[13.5px] select-text">
                      {m.text && <Markdown text={m.text} />}
                      {!!m.tools.length && (
                        <p className="mt-1 flex items-center gap-1.5 text-xs text-text-3">
                          <Wrench size={12} />
                          {m.tools.join('、')}
                        </p>
                      )}
                    </div>
                  )
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
