import { Copy, CornerDownLeft, ListPlus, Pin, Search, Settings2, SquarePlus } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { promptLabel, type PromptItem, type PromptUse } from '../../../shared/prompts'
import { matches } from '../../../shared/fuzzy'
import { usePrompts } from './queueState'

type Action = 'insert' | 'queue' | 'new' | 'copy'

export function PromptPicker(props: { sessionId: string; running: boolean; cwd: string; onClose: () => void; onManage: () => void; onStarted: (id: string) => void }) {
  const prompts = usePrompts()
  const [query, setQuery] = useState('')
  const [sel, setSel] = useState(0)
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null)
  const list = useRef<HTMLDivElement>(null)
  const box = useRef<HTMLDivElement>(null)

  const shown = useMemo(() => (query.trim() ? prompts.filter((p) => matches(`${p.title} ${p.text}`, query)) : prompts), [prompts, query])
  useEffect(() => setSel(0), [query])
  useEffect(() => {
    list.current?.querySelector(`[data-index="${sel}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [sel])
  useEffect(() => {
    const down = (e: MouseEvent) => !box.current?.contains(e.target as Node) && props.onClose()
    window.addEventListener('mousedown', down)
    return () => window.removeEventListener('mousedown', down)
  }, [props])

  const use = async (p: PromptItem | undefined, action: Action) => {
    if (!p) return
    if (action === 'insert' && !props.running) return setMsg({ text: '会话未运行，无法插入输入框', error: true })
    const u: PromptUse = action === 'new' ? { action, cwd: props.cwd } : action === 'copy' ? { action, sessionId: props.sessionId } : { action, sessionId: props.sessionId }
    const r = await window.ccshell.prompts.use(p.id, u)
    if (!r.ok) return setMsg({ text: r.error, error: true })
    if (action === 'new' && r.data) return props.onStarted(r.data)
    if (action === 'copy') return setMsg({ text: '已复制' })
    props.onClose()
  }

  const btn = (title: string, icon: React.ReactNode, onClick: () => void, disabled = false) => (
    <button
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      className="flex size-7 items-center justify-center rounded-sm text-text-3 hover:bg-surface-2 hover:text-text disabled:opacity-40"
    >
      {icon}
    </button>
  )

  return (
    <div ref={box} className="anim-pop-up absolute bottom-full left-0 z-40 mb-2 flex max-h-[60vh] w-[440px] flex-col overflow-hidden rounded-lg border border-border bg-bg-raised shadow-[0_12px_36px_rgba(0,0,0,0.28)]">
      <div className="flex items-center gap-2 border-b border-border px-3">
        <Search size={14} className="text-text-3" />
        <input
          autoFocus
          aria-label="搜索提示词"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setSel((i) => Math.min(shown.length - 1, i + 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setSel((i) => Math.max(0, i - 1))
            } else if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
              e.preventDefault()
              void use(shown[sel], e.ctrlKey ? 'queue' : 'insert')
            } else if (e.key === 'Escape') props.onClose()
          }}
          placeholder="搜索提示词"
          className="h-10 flex-1 bg-transparent text-[13px] outline-none focus-visible:shadow-none"
        />
      </div>
      <div ref={list} className="min-h-0 flex-1 overflow-y-auto p-1">
        {!prompts.length && (
          <div className="px-4 py-8 text-center text-xs text-text-3">
            暂无提示词。
            <button className="ml-1 text-brand hover:underline" onClick={props.onManage}>
              新建
            </button>
          </div>
        )}
        {!!prompts.length && !shown.length && <p className="px-3 py-6 text-center text-xs text-text-3">无匹配结果</p>}
        {shown.map((p, i) => (
          <div
            key={p.id}
            data-index={i}
            onMouseMove={() => setSel(i)}
            onClick={() => void use(p, 'insert')}
            className={'group flex cursor-pointer items-center gap-2 rounded-sm px-2.5 py-1.5 ' + (i === sel ? 'bg-surface-2' : '')}
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 text-[13px] text-text">
                {p.pinned && <Pin size={11} className="shrink-0 text-warning" />}
                <span className="truncate">{promptLabel(p)}</span>
              </div>
              <div className="truncate text-[11px] text-text-3">{p.text.replace(/\s+/g, ' ').slice(0, 120)}</div>
            </div>
            <div className={'flex shrink-0 items-center ' + (i === sel ? '' : 'invisible group-hover:visible')}>
              {btn('插入输入框（Enter）', <CornerDownLeft size={14} />, () => void use(p, 'insert'), !props.running)}
              {btn('加入队列（Ctrl+Enter）', <ListPlus size={14} />, () => void use(p, 'queue'))}
              {btn('在此目录新建会话并发送', <SquarePlus size={14} />, () => void use(p, 'new'))}
              {btn('复制内容（占位符已替换）', <Copy size={13} />, () => void use(p, 'copy'))}
            </div>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-3 border-t border-border px-3 py-1.5 text-[11px] text-text-3">
        <span className="min-w-0 flex-1 truncate">{msg ? <span className={msg.error ? 'text-danger' : 'text-success'}>{msg.text}</span> : 'Enter 插入输入框 · Ctrl+Enter 加入队列 · Esc 关闭'}</span>
        <button className="flex shrink-0 items-center gap-1 hover:text-text" onClick={props.onManage}>
          <Settings2 size={12} />
          管理提示词
        </button>
      </div>
    </div>
  )
}
