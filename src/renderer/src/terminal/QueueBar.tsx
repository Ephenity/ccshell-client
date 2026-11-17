import { AlertTriangle, ArrowDown, Workflow, ArrowUp, Check, ChevronDown, ChevronUp, Clock, ListOrdered, ListPlus, Pause, Pencil, Play, RotateCcw, SkipForward, Trash2, X } from 'lucide-react'
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { promptLabel } from '../../../shared/prompts'
import { QUEUE_COMMANDS, type QueueItem, type SessionQueue } from '../../../shared/queue'
import { matches } from '../../../shared/fuzzy'
import { hm, pendingCount, STATUS_STYLE, STATUS_TEXT, usePrompts } from './queueState'
import { filesToPaths, hasFiles, quotePath } from './pastePath'

export interface QueueBarHandle {
  focus: () => void
}

const peerBody = (t: string) => t.split('\n\n').slice(1, -1).join('\n\n').trim() || t

const done = (x: QueueItem) => x.status === 'done' || x.status === 'failed' || x.status === 'skipped'

export const QueueBar = forwardRef<
  QueueBarHandle,
  {
    session: { id: string; status: string }
    queue: SessionQueue
    open: boolean
    onToggle: () => void
    onOpenSession?: (id: string) => void
    chat?: boolean
    idle?: boolean
    tools?: React.ReactNode
  }
>(function QueueBar({ session, queue, open, onToggle, onOpenSession, chat, idle, tools }, ref) {
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null)
  const [menuSel, setMenuSel] = useState(0)
  const [, setNow] = useState(0)
  const input = useRef<HTMLTextAreaElement>(null)
  const prompts = usePrompts()
  const id = session.id

  useImperativeHandle(ref, () => ({ focus: () => input.current?.focus() }), [])
  useEffect(() => {
    try {
      setText(localStorage.getItem(`queue-draft:${id}`) ?? '')
    } catch {
      setText('')
    }
    setEditing(null)
    setError(null)
  }, [id])
  const setDraft = (v: string) => {
    setText(v)
    try {
      if (v) localStorage.setItem(`queue-draft:${id}`, v)
      else localStorage.removeItem(`queue-draft:${id}`)
    } catch {
    }
  }
  const insertFiles = async (files: File[]) => {
    const { paths, error } = await filesToPaths(files)
    setError(error ?? null)
    if (!paths.length) return
    const el = input.current
    const cur = el?.value ?? text
    const start = el?.selectionStart ?? cur.length
    const end = el?.selectionEnd ?? cur.length
    const before = cur.slice(0, start)
    const ins = (before && !/\s$/.test(before) ? ' ' : '') + paths.map(quotePath).join(' ') + ' '
    setDraft(before + ins + cur.slice(end))
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(start + ins.length, start + ins.length)
    })
  }
  const ticking = queue.items.some((x) => x.status === 'waiting') || !!queue.resumeAt
  useEffect(() => {
    if (!ticking) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [ticking])

  const run = async (p: Promise<{ ok: true } | { ok: false; error: string }>) => {
    const r = await p
    setError(r.ok ? null : r.error)
    return r.ok
  }

  const editRef = useRef<{ id: string; text: string } | null>(null)
  editRef.current = editing
  const saveEdit = async () => {
    const e = editRef.current
    if (!e) return
    editRef.current = null
    const orig = queue.items.find((x) => x.id === e.id)?.text
    if (!e.text.trim() || e.text === orig) return setEditing(null)
    if (await run(window.ccshell.queue.update(id, e.id, e.text))) setEditing(null)
    else editRef.current = e
  }
  const cancelEdit = () => {
    editRef.current = null
    setEditing(null)
  }

  const direct = !!idle && !queue.paused && !queue.items.some((x) => x.status === 'pending' || x.status === 'waiting' || x.status === 'sending' || x.status === 'running')
  const directText = useRef<string | null>(null)
  const add = async () => {
    if (!text.trim()) return
    const sendNow = direct
    if (sendNow) directText.current = text.replace(/\r\n?/g, '\n').trim()
    const r = sendNow ? await window.ccshell.queue.sendDirect(id, text) : await window.ccshell.queue.add(id, text)
    directText.current = null
    if (!r.ok) return setError(r.error)
    setError(null)
    setDraft('')
  }

  const slash = /^\/(\S*)$/.exec(text.trim()) && !text.includes('\n') ? text.trim().slice(1) : null
  const menu = useMemo(() => {
    if (slash === null) return []
    const cmds = QUEUE_COMMANDS.filter((c) => c.name.slice(1).startsWith(slash.toLowerCase())).map((c) => ({ key: c.name, label: c.name, sub: c.desc, apply: () => setDraft(c.insert) }))
    const ps = prompts.filter((p) => p.text.trim() && (!slash || matches(`${p.title} ${p.text}`, slash))).map((p) => ({ key: p.id, label: promptLabel(p), sub: '提示词 · ' + p.text.replace(/\s+/g, ' ').slice(0, 80), apply: () => setDraft(p.text) }))
    return [...cmds, ...ps]
  }, [slash, prompts])
  useEffect(() => setMenuSel(0), [slash])

  const items = queue.items.filter((x) => !(x.direct && x.status !== 'failed' && x.status !== 'skipped') && !(x.status === 'pending' && x.text === directText.current))
  const left = pendingCount(queue)
  const finished = items.filter(done).length
  const waiting = items.find((x) => x.status === 'waiting')
  const runningItem = items.find((x) => x.status === 'sending' || x.status === 'running')
  const ended = session.status !== 'running'

  let summary: string
  if (queue.paused) summary = queue.pauseReason ?? '已暂停'
  else if (waiting?.until) summary = `等待至 ${hm(waiting.until)}（剩余 ${Math.max(0, Math.ceil((waiting.until - Date.now()) / 1000))} 秒）`
  else if (runningItem) summary = `正在执行第 ${items.indexOf(runningItem) + 1} 条`
  else if (left && ended) summary = `${left} 条待发送 · 会话已结束，重新启动后继续`
  else if (left) summary = chat ? `${left} 条待发送 · 本轮回答结束后发送下一条` : `${left} 条待发送 · 空闲后发送下一条`
  else summary = items.length ? '已全部发送' : ''

  const contextMenu = async () => {
    const r = await window.ccshell.app.contextMenu([
      { id: 'finished', label: '清除已结束项', enabled: finished > 0 },
      { id: 'pending', label: '清空待发送', enabled: items.some((x) => x.status === 'pending' || x.status === 'waiting') },
      { id: 'all', label: '清除全部', danger: true, separatorBefore: true, enabled: items.length > 0 }
    ])
    if (r.ok && r.data) void run(window.ccshell.queue.clear(id, r.data as 'finished' | 'pending' | 'all'))
  }

  const pendIds = items.filter((x) => x.status === 'pending').map((x) => x.id)

  return (
    <Wrap
      chat={chat}
      hasQueue={!!items.length}
      queue={
        <>
      {!!items.length && (
        <div className={'flex items-center gap-2 px-3 py-1.5 text-[12.5px] ' + (queue.paused ? 'bg-warning/10' : '')}>
          <button className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={onToggle} title={open ? '收起队列' : '展开队列'}>
            {queue.paused ? <AlertTriangle size={14} className="shrink-0 text-warning" /> : <ListOrdered size={14} className="shrink-0 text-text-3" />}
            <span className="shrink-0 font-medium text-text">队列</span>
            <span className="shrink-0 text-text-3">{left ? `${left} 条` : `${items.length} 条`}</span>
            <span className={'min-w-0 truncate ' + (queue.paused ? 'text-text' : 'text-text-3')} title={summary}>
              · {summary}
            </span>
          </button>
          {queue.paused ? (
            <>
              <button className="btn btn-secondary h-7 gap-1 px-2.5 text-[12px]" onClick={() => void run(window.ccshell.queue.resume(id))} title={queue.resumeAt ? '立即继续' : '继续发送'}>
                <Play size={12} />
                继续
              </button>
              {queue.resumeAt && (
                <button className="btn btn-ghost h-7 px-2 text-[12px]" onClick={() => void run(window.ccshell.queue.cancelAuto(id))}>
                  取消自动继续
                </button>
              )}
            </>
          ) : (
            !!left && (
              <button className="btn btn-ghost h-7 gap-1 px-2 text-[12px]" onClick={() => void run(window.ccshell.queue.pause(id))} title={chat ? '暂停队列' : '暂停队列（需在终端中手动操作时使用）'}>
                <Pause size={12} />
                暂停
              </button>
            )
          )}
          <button
            className="flex size-7 items-center justify-center rounded-sm text-text-3 hover:bg-surface-2 hover:text-text disabled:opacity-40"
            title={chat ? '立即发送下一条（如正在回答，将先中止本轮）' : '立即发送下一条（不等待空闲；也可用于跳过长时间无响应的条目）'}
            aria-label="立即发送下一条"
            disabled={ended || !pendIds.length}
            onClick={() => void run(window.ccshell.queue.sendNext(id))}
          >
            <SkipForward size={14} />
          </button>
          <button className="flex size-7 items-center justify-center rounded-sm text-text-3 hover:bg-surface-2 hover:text-text" title="清除…" aria-label="清除" onClick={() => void contextMenu()}>
            <Trash2 size={13} />
          </button>
          <button className="flex size-7 items-center justify-center rounded-sm text-text-3 hover:bg-surface-2 hover:text-text" onClick={onToggle} aria-label={open ? '收起' : '展开'}>
            {open ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
          </button>
        </div>
      )}
      {open && !!items.length && (
        <ol className="max-h-[32vh] overflow-y-auto border-t border-border/60 px-2 py-1">
          {items.map((it, i) => {
            const lines = (it.source === 'peer' ? peerBody(it.text) : it.text).split('\n')
            const isEditing = editing?.id === it.id
            const p = pendIds.indexOf(it.id)
            return (
              <li
                key={it.id}
                className={'group flex items-start gap-2 rounded-sm px-1.5 py-1 hover:bg-surface-2/60 ' + (done(it) ? 'opacity-60' : '')}
                onDoubleClick={() => it.status === 'pending' && !it.regenerate && setEditing({ id: it.id, text: it.text })}
              >
                <span className="w-5 shrink-0 pt-0.5 text-right font-mono text-[11px] text-text-3">{i + 1}</span>
                <span className={'w-12 shrink-0 pt-0.5 text-[11px] ' + STATUS_STYLE[it.status]}>
                  {it.status === 'waiting' && it.until ? (
                    <span className="flex items-center gap-0.5" title={`等待至 ${hm(it.until)}`}>
                      <Clock size={10} />
                      {hm(it.until).slice(0, 5)}
                    </span>
                  ) : (
                    STATUS_TEXT[it.status]
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  {isEditing ? (
                    <textarea
                      autoFocus
                      aria-label="编辑此条"
                      value={editing.text}
                      rows={Math.min(6, editing.text.split('\n').length)}
                      onChange={(e) => setEditing({ id: it.id, text: e.target.value })}
                      onBlur={() => void saveEdit()}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') {
                          e.stopPropagation()
                          cancelEdit()
                        } else if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                          e.preventDefault()
                          void saveEdit()
                        }
                      }}
                      className="w-full resize-none rounded-md border border-brand/70 bg-bg-raised px-2 py-1 text-[12.5px] text-text outline-none"
                    />
                  ) : (
                    <div className={'text-[12.5px] text-text ' + (it.text.startsWith('/') ? 'font-mono' : '')} title={it.text}>
                      <span className="line-clamp-2 break-all whitespace-pre-wrap">{lines.slice(0, 2).join('\n')}</span>
                      {lines.length > 2 && <span className="text-[11px] text-text-3">（另有 {lines.length - 2} 行）</span>}
                    </div>
                  )}
                  {!!it.attachments?.length && <div className="truncate text-[11px] text-text-3">附件：{it.attachments.map((a) => a.name).join('、')}</div>}
                  {it.from ? (
                    <div className="flex min-w-0 items-center gap-1 text-[11px] text-text-3" title={it.note}>
                      <button
                        title="跳转至该会话"
                        onClick={() => onOpenSession?.(it.from!.id)}
                        className="flex shrink-0 items-center gap-0.5 rounded-sm bg-surface-2 px-1 text-text-2 hover:text-brand"
                      >
                        <Workflow size={10} />
                        来自「{it.from.title}」
                      </button>
                      <span className="truncate">{(it.note ?? '').replace(/^(协作任务，)?来自会话「[^」]*」[；，]?/, '$1')}</span>
                    </div>
                  ) : (
                    it.note && <div className="truncate text-[11px] text-text-3" title={it.note}>{it.note}</div>
                  )}
                </div>
                {isEditing ? (
                  <div className="flex shrink-0 items-center gap-0.5 pt-0.5">
                    <IconBtn title="保存（Enter）" tone="brand" onMouseDown={(e) => e.preventDefault()} onClick={() => void saveEdit()}>
                      <Check size={13} />
                    </IconBtn>
                    <IconBtn title="放弃修改（Esc）" onMouseDown={(e) => e.preventDefault()} onClick={cancelEdit}>
                      <X size={13} />
                    </IconBtn>
                  </div>
                ) : (
                <div className="invisible flex shrink-0 items-center group-hover:visible">
                  {it.status === 'pending' && !it.regenerate && (
                    <>
                      <IconBtn title="编辑（或双击）" onClick={() => setEditing({ id: it.id, text: it.text })}>
                        <Pencil size={12} />
                      </IconBtn>
                      <IconBtn title="上移" disabled={p <= 0} onClick={() => void run(window.ccshell.queue.move(id, it.id, -1))}>
                        <ArrowUp size={12} />
                      </IconBtn>
                      <IconBtn title="下移" disabled={p < 0 || p >= pendIds.length - 1} onClick={() => void run(window.ccshell.queue.move(id, it.id, 1))}>
                        <ArrowDown size={12} />
                      </IconBtn>
                    </>
                  )}
                  {(it.status === 'failed' || it.status === 'skipped') && (
                    <IconBtn title="重新排队" onClick={() => void run(window.ccshell.queue.requeue(id, it.id))}>
                      <RotateCcw size={12} />
                    </IconBtn>
                  )}
                  {it.status !== 'sending' && it.status !== 'running' && (
                    <IconBtn title="删除" onClick={() => void run(window.ccshell.queue.remove(id, it.id))}>
                      <X size={13} />
                    </IconBtn>
                  )}
                </div>
                )}
              </li>
            )
          })}
        </ol>
      )}
        </>
      }
    >
      {!chat && (
      <div className="relative">
        {!!menu.length && (
          <div className="anim-pop-up absolute bottom-full left-0 z-30 mb-2 max-h-72 w-[min(560px,100%)] overflow-y-auto rounded-md border border-border bg-bg-raised p-1 shadow-[0_8px_28px_rgba(0,0,0,0.25)]">
            {menu.map((m, i) => (
              <button
                key={m.key}
                onMouseDown={(e) => {
                  e.preventDefault()
                  m.apply()
                }}
                onMouseMove={() => setMenuSel(i)}
                ref={i === menuSel ? (el) => el?.scrollIntoView({ block: 'nearest' }) : undefined}
                className={'flex w-full items-baseline gap-2 rounded-sm px-2 py-1 text-left ' + (i === menuSel ? 'bg-surface-2' : '')}
              >
                <span className={'shrink-0 text-[12.5px] text-text ' + (m.label.startsWith('/') ? 'font-mono' : '')}>{m.label}</span>
                <span className="min-w-0 truncate text-[11px] text-text-3">{m.sub}</span>
              </button>
            ))}
          </div>
        )}
        <div
          className="px-3 pt-3 pb-2"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            if (!hasFiles(e.dataTransfer)) return
            e.preventDefault()
            void insertFiles([...e.dataTransfer.files])
          }}
        >
          <textarea
            ref={input}
            aria-label="输入消息"
            value={text}
            rows={Math.min(6, Math.max(1, text.split('\n').length))}
            onChange={(e) => setDraft(e.target.value)}
            onPaste={(e) => {
              if (!hasFiles(e.clipboardData) || e.clipboardData.getData('text/plain')) return
              e.preventDefault()
              void insertFiles([...e.clipboardData.files])
            }}
            onKeyDown={(e) => {
              if (menu.length && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
                e.preventDefault()
                setMenuSel((i) => (i + (e.key === 'ArrowDown' ? 1 : -1) + menu.length) % menu.length)
              } else if (menu.length && (e.key === 'Tab' || (e.key === 'Enter' && !e.ctrlKey && slash !== null && !QUEUE_COMMANDS.some((c) => c.insert === text.trim())))) {
                e.preventDefault()
                menu[menuSel]?.apply()
              } else if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                void add()
              } else if (e.key === 'Escape' && text) {
                e.stopPropagation()
                setDraft('')
              }
            }}
            placeholder={ended ? '会话已结束，重新启动后发送' : direct ? '向 Claude Code 发送消息，输入 / 选择命令或提示词' : '加入队列，输入 / 选择命令或提示词'}
            className="block max-h-48 min-h-[44px] w-full resize-none bg-transparent px-1 text-[13.5px] leading-[22px] text-text outline-none placeholder:text-text-3"
          />
          <div className="mt-1.5 flex items-center gap-0.5">
            {tools}
            <button
              className={'relative flex size-8 items-center justify-center rounded-md transition-colors disabled:opacity-40 ' + (open && items.length ? 'bg-surface-2 text-text' : 'text-text-2 hover:bg-surface-2 hover:text-text')}
              title={items.length ? (open ? '收起队列' : '展开队列') : '队列为空'}
              aria-label="队列"
              disabled={!items.length}
              onClick={onToggle}
            >
              <ListOrdered size={16} />
              {!!left && <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand px-1 font-mono text-[10px] leading-none text-on-brand">{left}</span>}
            </button>
            <span className="mx-2 h-4 w-px bg-border" />
            <span
              className="flex items-center gap-1.5 text-[12px] text-text-3"
              title={ended ? '会话已结束，重新启动后发送' : direct ? 'Claude 空闲：Enter 直接发送' : 'Claude 正在处理或已有排队：Enter 加入队列，空闲后依次发送'}
            >
              <span className={'size-1.5 rounded-full ' + (ended ? 'bg-text-3' : direct ? 'bg-success' : 'bg-warning')} />
              {ended ? '会话已结束' : direct ? '直接发送' : '排队发送'}
            </span>
            <div className="flex-1" />
            <button
              className="btn btn-primary size-8 p-0"
              title={(direct ? '发送' : '加入队列') + '（Enter）\nShift+Enter 换行'}
              aria-label={direct ? '发送' : '加入队列'}
              disabled={!text.trim()}
              onClick={() => void add()}
            >
              {direct ? <ArrowUp size={16} /> : <ListPlus size={15} />}
            </button>
          </div>
        </div>
        {error && <p className="mt-1.5 px-1 text-xs text-danger">{error}</p>}
      </div>
      )}
      {chat && error && <p className="px-3 pb-1.5 text-xs text-danger">{error}</p>}
    </Wrap>
  )
})

function Wrap({ chat, hasQueue, queue, children }: { chat?: boolean; hasQueue: boolean; queue: React.ReactNode; children: React.ReactNode }) {
  if (chat)
    return (
      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        {queue}
        {children}
      </div>
    )
  return (
    <div className="shrink-0 bg-bg px-4 pt-2 pb-4">
      <div className="mx-auto w-full max-w-4xl overflow-visible rounded-xl border border-border-strong bg-surface shadow-[var(--shadow-card)] transition-colors focus-within:border-brand/60">
        {hasQueue && <div className="anim-fade overflow-hidden rounded-t-xl border-b border-border bg-surface-2/40">{queue}</div>}
        {children}
      </div>
    </div>
  )
}

function IconBtn({ title, onClick, onMouseDown, disabled, tone, children }: { title: string; onClick: () => void; onMouseDown?: (e: React.MouseEvent) => void; disabled?: boolean; tone?: 'brand'; children: React.ReactNode }) {
  return (
    <button
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      onMouseDown={onMouseDown}
      className={'flex size-6 items-center justify-center rounded-sm disabled:opacity-30 ' + (tone === 'brand' ? 'bg-brand text-on-brand hover:bg-brand-hover' : 'text-text-3 hover:bg-surface hover:text-text')}
    >
      {children}
    </button>
  )
}
