import { ResizableAside } from '../components/ResizableAside'
import { Select } from '../components/Select'
import { confirmDialog } from '../components/Dialog'
import { BookMarked, Copy, CopyPlus, ListPlus, Pin, Plus, Search, SquarePlus, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { matches } from '../../../shared/fuzzy'
import { PLACEHOLDER_HELP, promptLabel, type PromptItem } from '../../../shared/prompts'
import type { TerminalInfo, TerminalSession } from '../../../shared/terminal'
import { usePrompts } from '../terminal/queueState'
import { dirName } from '../terminal/state'
import type { ConversationSummary } from '../../../shared/chat'
import { putChatInsert } from '../chat/insert'

export function PromptsPage({ onOpenSession }: { onOpenSession: (id: string) => void }) {
  const prompts = usePrompts()
  const [selected, setSelected] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null)
  const current = prompts.find((p) => p.id === selected) ?? null
  const shown = useMemo(() => (query.trim() ? prompts.filter((p) => matches(`${p.title} ${p.text}`, query)) : prompts), [prompts, query])

  useEffect(() => {
    if ((!selected || !prompts.some((p) => p.id === selected)) && prompts.length) setSelected(prompts[0].id)
  }, [prompts, selected])

  const say = (text: string, error = false) => setMsg({ text, error })
  const create = async () => {
    const r = await window.ccshell.prompts.create({ title: '', text: '' })
    if (r.ok) setSelected(r.data.id)
  }
  return (
    <div className="flex h-full">
      <ResizableAside id="prompts" defaultWidth={288}>
        <div className="flex h-12 shrink-0 items-center gap-1 border-b border-border px-3">
          <h2 className="flex-1 text-[14px] font-semibold text-text">全部提示词</h2>
          <button className="btn btn-ghost h-8 px-2" title="新建提示词" onClick={() => void create()}>
            <Plus size={16} />
          </button>
        </div>
        <div className="flex items-center gap-2 border-b border-border px-3">
          <Search size={13} className="text-text-3" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索标题和内容" aria-label="搜索提示词" className="h-9 flex-1 bg-transparent text-[13px] outline-none focus-visible:shadow-none" />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {!prompts.length && (
            <div className="px-3 py-10 text-center text-xs leading-relaxed text-text-3">
              保存需要反复使用的内容，例如工作规范、日报模板、固定的检查步骤。
              <div className="mt-3 flex justify-center">
                <button className="btn btn-primary h-8 px-3 text-[12.5px]" onClick={() => void create()}>
                  新建
                </button>
              </div>
            </div>
          )}
          {shown.map((p) => (
            <button key={p.id} onClick={() => setSelected(p.id)} className={'flex w-full items-start gap-2 rounded-md px-3 py-2 text-left ' + (p.id === selected ? 'bg-surface-2' : 'hover:bg-surface-2/60')}>
              {p.pinned ? <Pin size={13} className="mt-0.5 shrink-0 text-warning" /> : <BookMarked size={13} className="mt-0.5 shrink-0 text-text-3" />}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13.5px]">{promptLabel(p)}</span>
                <span className="block truncate text-[11px] text-text-3">{p.text.replace(/\s+/g, ' ').slice(0, 80) || '（空）'}</span>
              </span>
            </button>
          ))}
          {!!prompts.length && !shown.length && <p className="px-3 py-6 text-center text-xs text-text-3">无匹配结果</p>}
        </div>
        {msg && <p className={'border-t border-border px-3 py-2 text-xs ' + (msg.error ? 'text-danger' : 'text-text-3')}>{msg.text}</p>}
      </ResizableAside>
      <section className="min-w-0 flex-1 overflow-y-auto">
        {current ? <Editor key={current.id} prompt={current} onOpenSession={onOpenSession} onMessage={say} /> : <div className="flex h-full items-center justify-center text-xs text-text-3">选择一条提示词，或新建</div>}
      </section>
    </div>
  )
}

function Editor({ prompt, onOpenSession, onMessage }: { prompt: PromptItem; onOpenSession: (id: string) => void; onMessage: (t: string, error?: boolean) => void }) {
  const [title, setTitle] = useState(prompt.title)
  const [text, setText] = useState(prompt.text)
  const [sessions, setSessions] = useState<TerminalSession[]>([])
  const [info, setInfo] = useState<TerminalInfo | null>(null)
  const [target, setTarget] = useState('')
  const [chats, setChats] = useState<ConversationSummary[]>([])
  useEffect(() => {
    void window.ccshell.chat.list().then((r) => r.ok && setChats(r.data))
    return window.ccshell.chat.onList(setChats)
  }, [])
  const [dir, setDir] = useState('')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latest = useRef({ title, text })
  latest.current = { title, text }

  useEffect(() => {
    void window.ccshell.terminal.list().then((r) => r.ok && setSessions(r.data))
    void window.ccshell.terminal.info().then((r) => {
      if (!r.ok) return
      setInfo(r.data)
      setDir((d) => d || r.data.pinnedDirs[0] || r.data.recentDirs[0] || '')
    })
    return window.ccshell.terminal.onList(setSessions)
  }, [])
  const live = sessions.filter((s) => s.status === 'running')
  useEffect(() => {
    if (!target || (!sessions.some((s) => s.id === target) && !target.startsWith('chat:'))) setTarget(live.at(-1)?.id ?? sessions.at(-1)?.id ?? '')
  }, [sessions])

  const flush = () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    const v = latest.current
    if (v.title !== prompt.title || v.text !== prompt.text) void window.ccshell.prompts.update(prompt.id, v)
  }
  useEffect(() => () => flush(), [])
  const change = (patch: { title?: string; text?: string }) => {
    if (patch.title !== undefined) setTitle(patch.title)
    if (patch.text !== undefined) setText(patch.text)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(flush, 500)
  }

  const use = async (action: 'insert' | 'queue' | 'new' | 'copy') => {
    flush()
    const u = action === 'new' ? { action, cwd: dir } : action === 'copy' ? { action, sessionId: target || undefined } : { action, sessionId: target }
    const r = await window.ccshell.prompts.use(prompt.id, u)
    if (!r.ok) return onMessage(r.error, true)
    if (action === 'new' && r.data) return onOpenSession(r.data)
    if (action === 'insert' && targetChat) putChatInsert(targetChat.id, r.data ?? text)
    if (action === 'insert') return onOpenSession(target)
    onMessage(action === 'copy' ? '已复制（占位符已替换）' : targetChat ? '已加入该对话的队列，空闲时发送' : '已加入队列，Claude 空闲时发送')
  }
  const targetChat = target.startsWith('chat:') ? chats.find((c) => 'chat:' + c.id === target) : undefined
  const targetSession = sessions.find((s) => s.id === target) ?? (targetChat ? { status: 'running' } : undefined)
  const dirs = [...(info?.pinnedDirs ?? []), ...(info?.recentDirs ?? [])]

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 p-6">
      <div className="flex items-center gap-2">
        <input
          value={title}
          onChange={(e) => change({ title: e.target.value })}
          onBlur={flush}
          placeholder="标题（留空则使用内容首行）"
          aria-label="标题"
          className="h-10 min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-2 font-serif text-[22px] font-semibold text-text outline-none hover:border-border focus:border-brand"
        />
        <button className={'btn h-8 gap-1.5 px-2.5 text-[12.5px] ' + (prompt.pinned ? 'btn-secondary text-warning' : 'btn-ghost')} onClick={() => void window.ccshell.prompts.update(prompt.id, { pinned: !prompt.pinned })} title="固定后排在列表顶部">
          <Pin size={13} />
          {prompt.pinned ? '已固定' : '固定'}
        </button>
        <button className="btn btn-ghost h-8 px-2" title="创建副本" aria-label="创建副本" onClick={() => void window.ccshell.prompts.duplicate(prompt.id)}>
          <CopyPlus size={15} />
        </button>
        <button
          className="btn btn-ghost h-8 px-2 hover:text-danger"
          title="删除"
          aria-label="删除"
          onClick={async () => (await confirmDialog({ title: `删除“${promptLabel(prompt)}”`, confirmText: '删除', danger: true })) && void window.ccshell.prompts.remove(prompt.id)}
        >
          <Trash2 size={15} />
        </button>
      </div>
      <textarea
        value={text}
        onChange={(e) => change({ text: e.target.value })}
        onBlur={flush}
        placeholder="内容。以 / 开头的为 Claude Code 命令（例如 /compact）"
        aria-label="内容"
        rows={14}
        className="w-full resize-y rounded-md border border-border-strong bg-bg-raised px-3 py-2.5 text-[13.5px] leading-relaxed text-text outline-none focus:border-brand"
      />
      <p className="-mt-2 text-xs text-text-3">
        占位符（发送时替换）：{PLACEHOLDER_HELP}
        {prompt.useCount ? ` · 已使用 ${prompt.useCount} 次` : ''}
      </p>

      <div className="rounded-lg border border-border bg-surface p-4 shadow-[var(--shadow-card)]">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] text-text-2">发送至</span>
          <Select value={target} onChange={(e) => setTarget(e.target.value)} aria-label="发送目标" className="h-8 min-w-0 max-w-72 flex-1 rounded-md border border-border-strong bg-bg-raised px-2 text-[13px] text-text outline-none focus:border-brand">
            {!sessions.length && <option value="">（暂无会话）</option>}
            {!!sessions.length && (
              <optgroup label="Claude Code 会话">
                {sessions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.title} · {dirName(s.cwd)}
                    {s.status === 'running' ? '' : '（已结束）'}
                  </option>
                ))}
              </optgroup>
            )}
            {!!chats.length && (
              <optgroup label="对话">
                {chats.map((c) => (
                  <option key={c.id} value={'chat:' + c.id}>
                    {c.title}
                  </option>
                ))}
              </optgroup>
            )}
          </Select>
          <button className="btn btn-secondary h-8 gap-1.5 px-3 text-[12.5px]" disabled={!targetSession || targetSession.status !== 'running' || !text.trim()} onClick={() => void use('insert')} title="插入输入框（不发送），可编辑后再发送">
            插入输入框
          </button>
          <button className="btn btn-secondary h-8 gap-1.5 px-3 text-[12.5px]" disabled={!targetSession || !text.trim()} onClick={() => void use('queue')} title="加入该会话的队列末尾，空闲时发送">
            <ListPlus size={13} />
            加入队列
          </button>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-[13px] text-text-2">新建会话</span>
          <input list="prompt-dirs" value={dir} onChange={(e) => setDir(e.target.value)} placeholder="项目目录" aria-label="项目目录" className="h-8 min-w-0 flex-1 rounded-md border border-border-strong bg-bg-raised px-2.5 font-mono text-[12.5px] text-text outline-none focus:border-brand" />
          <datalist id="prompt-dirs">
            {dirs.map((d) => (
              <option key={d} value={d} />
            ))}
          </datalist>
          <button
            className="btn btn-ghost h-8 px-2.5 text-[12.5px]"
            onClick={async () => {
              const r = await window.ccshell.terminal.pickDir()
              if (r.ok && r.data) setDir(r.data)
            }}
          >
            浏览…
          </button>
          <button className="btn btn-primary h-8 gap-1.5 px-3 text-[12.5px]" disabled={!dir.trim() || !text.trim()} onClick={() => void use('new')} title="在此目录新建会话，就绪后发送此提示词">
            <SquarePlus size={13} />
            新建会话并发送
          </button>
          <button className="btn btn-ghost h-8 gap-1.5 px-2.5 text-[12.5px]" disabled={!text.trim()} onClick={() => void use('copy')}>
            <Copy size={13} />
            复制
          </button>
        </div>
      </div>
    </div>
  )
}
