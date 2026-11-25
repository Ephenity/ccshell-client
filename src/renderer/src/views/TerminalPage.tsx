import { AccountDock } from '../components/AccountDock'
import { TopStrip } from '../components/TitleBar'
import { useReplay } from '../components/anim'
import { MAIN_ASIDE, ResizableAside } from '../components/ResizableAside'
import { SideIconButton, SideNewButton } from '../components/SideNewButton'
import { confirmDialog } from '../components/Dialog'
import { AlertTriangle, AppWindow, ArrowDownToLine, BookMarked, ChevronDown, ChevronRight, History, ListOrdered, Play, Plus, RotateCcw, Square, SquareArrowOutUpRight, Star, Workflow, X } from 'lucide-react'
import type { CodeRequest } from '../App'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { FavoriteConversation, TerminalInfo, TerminalSession } from '../../../shared/terminal'
import { HistoryView } from '../terminal/HistoryView'
import { anthropicLabel, useAnthropicNames } from '../terminal/anthropicNames'
import { Launcher } from '../terminal/Launcher'
import { dirName, STATE_STYLE, stateText, useSettings } from '../terminal/state'
import { disposeTerminal, enableGpu, getTerminal, setTerminalTheme } from '../terminal/xterm'
import { PromptPicker } from '../terminal/PromptPicker'
import { QueueBar, type QueueBarHandle } from '../terminal/QueueBar'
import { filesToPaths, hasFiles, quotePath } from '../terminal/pastePath'
import { pendingCount, queueOf, useQueues } from '../terminal/queueState'
import type { SessionQueue } from '../../../shared/queue'
import { useTheme } from '../theme'

type View = { kind: 'launcher'; cwd?: string } | { kind: 'history' } | { kind: 'session'; id: string }

const sameDir = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

export function TerminalPage({ visible, request, onOpenAccount, onOpenPrompts, onOpenChat }: { visible: boolean; request: CodeRequest | null; onOpenAccount: () => void; onOpenPrompts: () => void; onOpenChat?: (id: string) => void }) {
  const queues = useQueues()
  const [sessions, setSessions] = useState<TerminalSession[]>([])
  const [info, setInfo] = useState<TerminalInfo | null>(null)
  const [view, setView] = useState<View>({ kind: 'launcher' })
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [renaming, setRenaming] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { theme } = useTheme()

  const loadInfo = () => void window.ccshell.terminal.info().then((r) => r.ok && setInfo(r.data))
  const st = useSettings()
  const binKey = st ? `${st.claudeCode.binary}|${st.claudeCode.binaryPath}` : ''
  useEffect(() => {
    if (binKey) loadInfo()
  }, [binKey])
  useEffect(() => {
    if (visible) loadInfo()
  }, [visible])
  useEffect(() => {
    const onFocus = () => loadInfo()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [])

  useEffect(() => {
    void window.ccshell.terminal.list().then((r) => {
      if (!r.ok) return
      setSessions(r.data)
      const live = r.data.filter((s) => s.status === 'running')
      if (live.length) setView({ kind: 'session', id: live.at(-1)!.id })
    })
    loadInfo()
    return window.ccshell.terminal.onList((list) => {
      setSessions(list)
      setView((v) => (v.kind === 'session' && !list.some((s) => s.id === v.id) ? { kind: 'launcher' } : v))
      loadInfo()
    })
  }, [])

  useEffect(() => setTerminalTheme(theme), [theme])

  const open = (id: string) => setView({ kind: 'session', id })
  const run = async <T,>(p: Promise<{ ok: true; data: T } | { ok: false; error: string }>): Promise<T | null> => {
    setError(null)
    const r = await p
    if (!r.ok) {
      setError(r.error)
      return null
    }
    return r.data
  }

  const resume = async (conversationId: string, cwd: string, title?: string) => {
    if (!info) return
    const { account: _last, ...opts } = info.lastOptions
    const s = await run(window.ccshell.terminal.create({ cwd, ...opts, resumeId: conversationId, title }))
    if (s) open(s.id)
  }

  const startIn = async (cwd: string) => {
    if (!info) return
    const s = await run(window.ccshell.terminal.create({ cwd, ...info.lastOptions }))
    if (s) open(s.id)
  }

  const restart = async (s: TerminalSession) => {
    const r = await run(window.ccshell.terminal.restart(s.id))
    if (r) open(r.id)
  }

  const remove = async (s: TerminalSession) => {
    if (s.status === 'running' && s.state === 'busy' && !(await confirmDialog({ title: `“${s.title}”正在处理中`, message: '结束并从列表移除？对话记录将保留在历史对话中。', confirmText: '结束并移除', danger: true }))) return
    await run(window.ccshell.terminal.remove(s.id))
    disposeTerminal(s.id)
  }

  const end = async (s: TerminalSession) => {
    if (!(await confirmDialog({ title: `结束“${s.title}”`, message: '对话记录将保留，可随时重新启动。', confirmText: '结束' }))) return
    await run(window.ccshell.terminal.end(s.id))
  }

  const isFavorite = (s: TerminalSession) => !!s.conversationId && !!info?.favorites.some((f) => f.conversationId === s.conversationId)

  const menu = async (s: TerminalSession) => {
    const fav = isFavorite(s)
    const id = await window.ccshell.app.contextMenu([
      { id: 'open', label: '打开' },
      { id: 'rename', label: '重命名' },
      { id: 'fav', label: fav ? '移出常用对话' : '加入常用对话', enabled: !!s.conversationId },
      { id: 'new', label: '在此目录新建会话', separatorBefore: true },
      { id: 'dir', label: '打开文件夹' },
      ...(s.status === 'running'
        ? [
            s.detached ? { id: 'reclaim', label: '收回到 CC Shell', separatorBefore: true } : { id: 'detach', label: '分离到终端窗口', separatorBefore: true },
            s.popout ? { id: 'unpop', label: '放回主窗口' } : { id: 'popout', label: '弹出到独立窗口', enabled: !s.detached },
            { id: 'end', label: '结束会话' }
          ]
        : [{ id: 'restart', label: '重新启动', separatorBefore: true }]),
      { id: 'remove', label: '从列表移除' }
    ])
    if (!id.ok || !id.data) return
    const act: Record<string, () => unknown> = {
      open: () => open(s.id),
      rename: () => setRenaming(s.id),
      fav: () => run(window.ccshell.terminal.favorite({ sessionId: s.id }, !fav)),
      new: () => startIn(s.cwd),
      dir: () => window.ccshell.terminal.openDir(s.cwd),
      end: () => end(s),
      detach: () => run(window.ccshell.terminal.detach(s.id)),
      reclaim: () => run(window.ccshell.terminal.reclaim(s.id)),
      popout: () => run(window.ccshell.terminal.popout(s.id)),
      unpop: () => run(window.ccshell.terminal.popoutClose(s.id)),
      restart: () => restart(s),
      remove: () => remove(s)
    }
    await act[id.data]?.()
  }

  const groups = useMemo(() => {
    const map = new Map<string, TerminalSession[]>()
    for (const s of sessions) {
      const key = [...map.keys()].find((k) => sameDir(k, s.cwd)) ?? s.cwd
      map.set(key, [...(map.get(key) ?? []), s])
    }
    return [...map.entries()]
  }, [sessions])
  const grouped = groups.length >= 2
  const order = grouped ? groups.filter(([cwd]) => !collapsed.has(cwd.toLowerCase())).flatMap(([, l]) => l) : sessions

  useEffect(() => {
    if (!request) return
    if (request.prompt) {
      const cur = view.kind === 'session' ? sessions.find((s) => s.id === view.id && s.status === 'running') : undefined
      const target = cur ?? sessions.filter((s) => s.status === 'running').at(-1)
      if (!target) {
        setError('当前无运行中的会话，无法插入提示词。可在资源库的“提示词”中以其新建会话')
        return
      }
      setView({ kind: 'session', id: target.id })
      void run(window.ccshell.prompts.use(request.prompt, { action: 'insert', sessionId: target.id })).then(() => requestAnimationFrame(() => getTerminal(target.id, theme).term.focus()))
      return
    }
    if (request.open === '__new__') setView({ kind: 'launcher' })
    else if (request.open === '__history__') setView({ kind: 'history' })
    else if (request.open) setView({ kind: 'session', id: request.open })
    else if (order.length) {
      const cur = view.kind === 'session' ? order.findIndex((s) => s.id === view.id) : -1
      const i = request.index !== undefined ? request.index : (cur + (request.delta ?? 1) + order.length) % order.length
      if (order[i]) setView({ kind: 'session', id: order[i].id })
    }
  }, [request])

  useEffect(() => {
    window.ccshell.ui.setActiveSession(visible && view.kind === 'session' ? view.id : null)
  }, [visible, view])
  const openConvs = new Set(sessions.filter((s) => s.status === 'running' && s.conversationId).map((s) => s.conversationId))
  const favorites = (info?.favorites ?? []).filter((f) => !openConvs.has(f.conversationId))
  const hasExited = sessions.some((s) => s.status === 'exited')
  const active = view.kind === 'session' ? (sessions.find((s) => s.id === view.id) ?? null) : null

  const row = (s: TerminalSession) => (
    <SessionRow
      key={s.id}
      session={s}
      queued={pendingCount(queueOf(queues, s.id))}
      active={active?.id === s.id}
      favorite={isFavorite(s)}
      renaming={renaming === s.id}
      onRenamed={(title) => {
        setRenaming(null)
        if (title !== null) void run(window.ccshell.terminal.rename(s.id, title))
      }}
      onOpen={() => open(s.id)}
      onMenu={() => void menu(s)}
      onRestart={() => void restart(s)}
      onRemove={() => void remove(s)}
    />
  )

  const paneRef = useReplay<HTMLElement>(view.kind === 'history' ? 'history' : (active?.id ?? 'launcher'))

  return (
    <div className="flex h-full">
      <ResizableAside {...MAIN_ASIDE}>
        <SideNewButton
          guide="code-new"
          label="新会话"
          active={view.kind === 'launcher'}
          onClick={() => setView({ kind: 'launcher' })}
          extra={
            <SideIconButton label="历史对话" active={view.kind === 'history'} onClick={() => setView({ kind: 'history' })}>
              <History size={16} />
            </SideIconButton>
          }
        />
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          {!sessions.length && !favorites.length && <div className="px-4 py-10 text-center text-xs text-text-3">暂无会话</div>}
          {grouped
            ? groups.map(([cwd, list]) => {
                const shut = collapsed.has(cwd.toLowerCase())
                return (
                  <div key={cwd} className="mb-1">
                    <div className="group flex items-center gap-1 px-1 py-1 text-xs text-text-3">
                      <button
                        className="flex min-w-0 flex-1 items-center gap-1 hover:text-text"
                        title={cwd}
                        onClick={() =>
                          setCollapsed((c) => {
                            const n = new Set(c)
                            if (!n.delete(cwd.toLowerCase())) n.add(cwd.toLowerCase())
                            return n
                          })
                        }
                      >
                        {shut ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                        <span className="truncate font-medium">{dirName(cwd)}</span>
                        <span className="shrink-0 text-text-3">{list.length}</span>
                      </button>
                      <button title="在此项目中新建会话" className="hidden size-5 items-center justify-center rounded-sm group-hover:flex hover:bg-surface-2 hover:text-text" onClick={() => void startIn(cwd)}>
                        <Plus size={13} />
                      </button>
                    </div>
                    {!shut && list.map(row)}
                  </div>
                )
              })
            : sessions.map(row)}
          {!!favorites.length && (
            <div className="mt-2">
              <div className="flex items-center gap-1 px-1 py-1 text-xs font-medium text-text-3">
                <Star size={12} className="fill-current text-warning" />
                常用对话
              </div>
              {favorites.map((f) => (
                <FavoriteRow
                  key={f.conversationId}
                  fav={f}
                  onOpen={() => void resume(f.conversationId, f.cwd, f.title)}
                  onRemove={() => void run(window.ccshell.terminal.favorite({ conversationId: f.conversationId }, false))}
                />
              ))}
            </div>
          )}
        </div>
        {(hasExited || error) && (
          <div className="border-t border-border px-3 py-2">
            {error && <p className="mb-1 text-xs text-danger select-text">{error}</p>}
            {hasExited && (
              <button className="text-xs text-text-3 hover:text-text" onClick={() => void run(window.ccshell.terminal.clearExited())}>
                清除已结束的会话
              </button>
            )}
          </div>
        )}
        <AccountDock />
      </ResizableAside>

      <section ref={paneRef} className="flex min-w-0 flex-1 flex-col">
        <TopStrip />
        {view.kind === 'history' ? (
          <HistoryView
            favorites={info?.favorites ?? []}
            onOpenSession={open}
            onResume={(h) => void resume(h.id, h.cwd, h.title.slice(0, 40))}
            onFavorite={(id, on) => void run(window.ccshell.terminal.favorite({ conversationId: id }, on))}
          />
        ) : active ? (
          <SessionView
            session={active}
            queue={queueOf(queues, active.id)}
            onOpenPrompts={onOpenPrompts}
            onOpenSession={(id) => (id.startsWith('chat:') ? onOpenChat?.(id) : open(id))}
            visible={visible}
            favorite={isFavorite(active)}
            onRestart={() => void restart(active)}
            onEnd={() => void end(active)}
            onDetach={() => void run(window.ccshell.terminal.detach(active.id))}
            onReclaim={() => void run(window.ccshell.terminal.reclaim(active.id))}
            onPopout={() => void run(window.ccshell.terminal.popout(active.id))}
            onPopoutClose={() => void run(window.ccshell.terminal.popoutClose(active.id))}
            onRename={(t) => void run(window.ccshell.terminal.rename(active.id, t))}
            onFavorite={(on) => void run(window.ccshell.terminal.favorite({ sessionId: active.id }, on))}
          />
        ) : (
          <Launcher info={info} reloadInfo={loadInfo} initialCwd={view.kind === 'launcher' ? view.cwd : undefined} onOpenAccount={onOpenAccount} onStarted={(s) => open(s.id)} onManagePrompts={onOpenPrompts} />
        )}
      </section>
    </div>
  )
}

export function StateDot({ s }: { s: TerminalSession }) {
  return <span className={'mt-1.5 size-2 shrink-0 rounded-full ' + (s.stuck ? 'bg-warning' : STATE_STYLE[s.state].dot)} title={stateText(s) + (s.stateDetail ? `：${s.stateDetail}` : '')} />
}

function SessionRow(props: {
  session: TerminalSession
  queued: number
  active: boolean
  favorite: boolean
  renaming: boolean
  onRenamed: (title: string | null) => void
  onOpen: () => void
  onMenu: () => void
  onRestart: () => void
  onRemove: () => void
}) {
  const s = props.session
  const anthNames = useAnthropicNames()
  return (
    <div
      role="button"
      tabIndex={0}
      data-session={s.id}
      onClick={props.onOpen}
      onContextMenu={(e) => {
        e.preventDefault()
        props.onMenu()
      }}
      onKeyDown={(e) => {
        if (e.key === 'Delete' && !props.renaming) props.onRemove()
      }}
      className={
        'anim-rise group relative flex cursor-pointer items-start gap-2 rounded-sm px-2 py-2 outline-none transition-colors duration-150 ' +
        (props.active ? 'nav-item-active' : 'text-text-2 hover:bg-surface-2 hover:text-text')
      }
    >
      <StateDot s={s} />
      <span className="min-w-0 flex-1">
        {props.renaming ? (
          <RenameInput value={s.title} onDone={props.onRenamed} />
        ) : (
          <span className="flex items-center gap-1 text-[13px]">
            <span className="truncate">{s.title}</span>
            {props.favorite && <Star size={11} className="shrink-0 fill-current text-warning" />}
            {props.queued > 0 && (
              <span className="ml-auto flex shrink-0 items-center gap-0.5 rounded-full bg-surface-2 px-1.5 text-[10.5px] text-text-3" title={`队列中待发送 ${props.queued} 条`}>
                <ListOrdered size={10} />
                {props.queued}
              </span>
            )}
          </span>
        )}
        <span className="block truncate text-[11px] text-text-3" title={s.cwd}>
          {stateText(s)}
          {s.stateDetail && s.state !== 'exited' ? ` · ${s.stateDetail}` : ''} · {s.account === 'anthropic' && `${anthropicLabel(anthNames, s.anthropicId)} · `}
          <span className="font-mono">{s.model || '默认模型'}</span>
        </span>
        {s.popout && !s.detached && s.status === 'running' && (
          <span className="flex items-center gap-1 truncate text-[11px] text-brand-text" title="该会话位于独立窗口中；可通过右键菜单“放回主窗口”">
            <AppWindow size={10} className="shrink-0" />
            <span className="truncate">独立窗口中</span>
          </span>
        )}
        {s.detached && s.status === 'running' && (
          <span className="flex items-center gap-1 truncate text-[11px] text-brand-text" title="该会话在终端窗口中运行；可通过右键菜单“收回到 CC Shell”">
            <SquareArrowOutUpRight size={10} className="shrink-0" />
            <span className="truncate">终端窗口中</span>
          </span>
        )}
        {s.openedBy && (
          <span className="flex items-center gap-1 truncate text-[11px] text-text-3" title={`由会话「${s.openedBy.title}」创建（会话协作）`}>
            <Workflow size={10} className="shrink-0" />
            <span className="truncate">由「{s.openedBy.title}」创建</span>
          </span>
        )}
      </span>
      {s.status === 'exited' && (
        <button
          title="重新启动并继续此对话"
          className="flex size-6 shrink-0 items-center justify-center rounded-sm text-text-3 hover:bg-bg hover:text-text"
          onClick={(e) => {
            e.stopPropagation()
            props.onRestart()
          }}
        >
          <RotateCcw size={13} />
        </button>
      )}
      <button
        title="从列表移除"
        className="hidden size-6 shrink-0 items-center justify-center rounded-sm group-hover:flex hover:bg-bg hover:text-danger"
        onClick={(e) => {
          e.stopPropagation()
          props.onRemove()
        }}
      >
        <X size={13} />
      </button>
    </div>
  )
}

function FavoriteRow({ fav, onOpen, onRemove }: { fav: FavoriteConversation; onOpen: () => void; onRemove: () => void }) {
  return (
    <div role="button" tabIndex={0} onClick={onOpen} className="group flex cursor-pointer items-start gap-2 rounded-sm px-2 py-2 text-text-2 hover:bg-surface hover:text-text">
      <Star size={11} className="mt-1 shrink-0 text-text-3" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px]">{fav.title}</span>
        <span className="block truncate font-mono text-[11px] text-text-3" title={fav.cwd}>
          {dirName(fav.cwd)}
        </span>
      </span>
      <button
        title="移出常用"
        className="hidden size-6 shrink-0 items-center justify-center rounded-sm group-hover:flex hover:bg-bg hover:text-danger"
        onClick={(e) => {
          e.stopPropagation()
          onRemove()
        }}
      >
        <X size={13} />
      </button>
    </div>
  )
}

function RenameInput({ value, onDone, className }: { value: string; onDone: (v: string | null) => void; className?: string }) {
  const [v, setV] = useState(value)
  const done = useRef(false)
  const finish = (r: string | null) => {
    if (done.current) return
    done.current = true
    onDone(r)
  }
  return (
    <input
      autoFocus
      value={v}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setV(e.target.value)}
      onFocus={(e) => e.target.select()}
      onBlur={() => finish(v.trim() && v !== value ? v : null)}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') finish(v.trim() && v !== value ? v : null)
        if (e.key === 'Escape') finish(null)
      }}
      className={'h-6 w-full rounded-sm border border-brand bg-bg-raised px-1.5 text-[13px] text-text outline-none ' + (className ?? '')}
    />
  )
}

export function SessionView(props: {
  inPopout?: boolean
  onPopout: () => void
  onPopoutClose: () => void
  session: TerminalSession
  queue: SessionQueue
  visible: boolean
  favorite: boolean
  onRestart: () => void
  onEnd: () => void
  onDetach: () => void
  onReclaim: () => void
  onRename: (t: string) => void
  onFavorite: (on: boolean) => void
  onOpenPrompts: () => void
  onOpenSession: (id: string) => void
}) {
  const anthNames = useAnthropicNames()
  const { session, queue } = props
  const [editing, setEditing] = useState(false)
  const [picker, setPicker] = useState(false)
  const [queueOpen, setQueueOpen] = useState(true)
  const bar = useRef<QueueBarHandle>(null)
  const { theme } = useTheme()
  const running = session.status === 'running'
  useEffect(() => setPicker(false), [session.id])
  return (
    <>
      <header className="flex h-14 shrink-0 items-center gap-4 border-b border-border px-4">
        <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5">
          <div className="flex min-w-0 items-center gap-2">
            <StateDot s={session} />
            {editing ? (
              <div className="w-56">
                <RenameInput
                  value={session.title}
                  onDone={(t) => {
                    setEditing(false)
                    if (t) props.onRename(t)
                  }}
                />
              </div>
            ) : (
              <h2 className="min-w-0 shrink cursor-text truncate font-serif text-[15px] font-semibold" title="点击重命名" onClick={() => setEditing(true)}>
                {session.title}
              </h2>
            )}
            <span className="min-w-0 shrink truncate text-xs text-text-2" title={session.stateDetail}>
              {stateText(session)}
              {session.stateDetail && session.state !== 'exited' ? ` · ${session.stateDetail}` : ''}
            </span>
          </div>
          <div className="flex min-w-0 items-center gap-1.5 pl-4 text-[11.5px] text-text-3">
            <span className="min-w-0 truncate font-mono" title={session.cwd}>
              {session.cwd}
            </span>
            <span className="text-border-strong">·</span>
            {session.account === 'anthropic' && (
              <span className="shrink-0 rounded-full border border-border px-1.5 text-[10.5px] text-text-2" title="使用 Anthropic 账户（每个账户一个配置目录）">
                {anthropicLabel(anthNames, session.anthropicId)}
              </span>
            )}
            <span className="shrink-0 font-mono">{session.model || '默认模型'}</span>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <HeaderButton
            label={session.conversationId ? (props.favorite ? '移出常用对话' : '加入常用对话') : '获取对话 ID 后可加入常用'}
            disabled={!session.conversationId}
            onClick={() => props.onFavorite(!props.favorite)}
          >
            <Star size={16} className={props.favorite ? 'fill-current text-warning' : ''} />
          </HeaderButton>

          <span className="mx-1.5 h-5 w-px bg-border" />

          {session.status === 'exited' ? (
            <button className="btn btn-secondary h-8 gap-1.5 px-3 text-[13px]" onClick={props.onRestart}>
              <RotateCcw size={14} />
              重新启动
            </button>
          ) : (
            <>
              {props.inPopout ? (
                <HeaderButton label="放回主窗口（不中断运行）" onClick={props.onPopoutClose}>
                  <AppWindow size={16} />
                </HeaderButton>
              ) : (
                !session.detached && (
                  <HeaderButton label="弹出到独立窗口（不中断运行）" onClick={props.onPopout}>
                    <AppWindow size={16} />
                  </HeaderButton>
                )
              )}
              {session.detached ? (
                <HeaderButton label="收回到 CC Shell（不中断运行）" onClick={props.onReclaim}>
                  <ArrowDownToLine size={16} />
                </HeaderButton>
              ) : (
                <HeaderButton label="分离到终端窗口（退出 CC Shell 不受影响）" onClick={props.onDetach}>
                  <SquareArrowOutUpRight size={16} />
                </HeaderButton>
              )}
              <span className="mx-1.5 h-5 w-px bg-border" />
              <HeaderButton label="结束会话（/exit）" danger onClick={props.onEnd}>
                <Square size={14} />
              </HeaderButton>
            </>
          )}
        </div>
      </header>
      {(session.stuck || session.continuing) && session.status === 'running' && <StuckBar session={session} />}
      {session.restored ? (
        <div className="flex flex-1 items-center justify-center" style={{ background: 'var(--hero-glow)' }}>
          <div className="max-w-sm rounded-lg border border-border bg-surface p-6 text-center shadow-[var(--shadow-card)]">
            <p className="text-[13px] text-text-2">此会话来自上次运行，已结束。</p>
            <p className="mt-1 text-xs text-text-3">{session.conversationId ? '重新启动后将继续此对话。' : '未记录对话 ID，重新启动后将继续该目录最近的对话。'}</p>
            <button className="btn btn-primary mt-4 h-9 gap-1.5 px-4" onClick={props.onRestart}>
              <RotateCcw size={15} />
              重新启动
            </button>
          </div>
        </div>
      ) : (
        <div className="relative flex min-h-0 flex-1 flex-col">
          <TerminalHost id={session.id} visible={props.visible} inactive={running && (!!session.detached || (!!session.popout && !props.inPopout))} />
          {session.detached && running && (
            <div className="anim-fade absolute inset-0 z-20 flex items-center justify-center bg-bg/80 backdrop-blur-[2px]">
              <div className="max-w-sm rounded-lg border border-border bg-surface p-6 text-center shadow-[var(--shadow-card)]">
                <SquareArrowOutUpRight size={22} className="mx-auto text-brand-text" />
                <p className="mt-3 text-[13px] text-text-2">该会话正在终端窗口中运行</p>
                <button className="btn btn-primary mt-4 h-9 gap-1.5 px-4" onClick={props.onReclaim}>
                  <ArrowDownToLine size={15} />
                  收回到 CC Shell
                </button>
              </div>
            </div>
          )}
          {!session.detached && session.popout && running && !props.inPopout && (
            <div className="anim-fade absolute inset-0 z-20 flex items-center justify-center bg-bg/80 backdrop-blur-[2px]">
              <div className="max-w-sm rounded-lg border border-border bg-surface p-6 text-center shadow-[var(--shadow-card)]">
                <AppWindow size={22} className="mx-auto text-brand-text" />
                <p className="mt-3 text-[13px] text-text-2">该会话正在独立窗口中运行</p>
                <div className="mt-4 flex justify-center gap-2">
                  <button className="btn btn-secondary h-9 px-4" onClick={props.onPopout}>
                    切换到该窗口
                  </button>
                  <button className="btn btn-primary h-9 px-4" onClick={props.onPopoutClose}>
                    放回主窗口
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
      {!(running && (session.detached || (session.popout && !props.inPopout))) && (
      <QueueBar
        ref={bar}
        session={session}
        queue={queue}
        open={queueOpen}
        idle={running && !session.restored && !session.detached && session.state === 'idle'}
        onToggle={() => setQueueOpen((v) => !v)}
        onOpenSession={props.onOpenSession}
        tools={
          <div className="relative">
            <button
              className={'flex size-8 items-center justify-center rounded-md transition-colors ' + (picker ? 'bg-surface-2 text-text' : 'text-text-2 hover:bg-surface-2 hover:text-text')}
              title={'提示词\n插入输入框、加入队列或新建会话'}
              aria-label="提示词"
              onClick={() => setPicker((v) => !v)}
            >
              <BookMarked size={16} />
            </button>
              {picker && (
                <PromptPicker
                  sessionId={session.id}
                  running={running}
                  cwd={session.cwd}
                  onClose={() => {
                    setPicker(false)
                    if (running && !session.restored) requestAnimationFrame(() => getTerminal(session.id, theme).term.focus())
                  }}
                  onManage={() => {
                    setPicker(false)
                    props.onOpenPrompts()
                  }}
                  onStarted={(id) => {
                    setPicker(false)
                    props.onOpenSession(id)
                  }}
                />
              )}
            </div>
        }
      />
      )}
    </>
  )
}

function HeaderButton(props: { label: string; onClick?: () => void; disabled?: boolean; active?: boolean; warn?: boolean; danger?: boolean; children: React.ReactNode }) {
  return (
    <button
      title={props.label}
      aria-label={props.label}
      disabled={props.disabled}
      onClick={props.onClick}
      className={
        'relative flex size-8 items-center justify-center rounded-md transition-colors disabled:opacity-40 ' +
        (props.active ? 'bg-surface-2 text-text ' : props.warn ? 'text-warning hover:bg-surface-2 ' : 'text-text-2 hover:bg-surface-2 hover:text-text ') +
        (props.danger ? 'hover:!bg-danger/10 hover:!text-danger' : '')
      }
    >
      {props.children}
    </button>
  )
}

export function TerminalHost({ id, visible, inactive }: { id: string; visible: boolean; inactive?: boolean }) {
  const box = useRef<HTMLDivElement>(null)
  const { theme } = useTheme()

  useLayoutEffect(() => {
    const el = box.current!
    const entry = getTerminal(id, theme)
    el.appendChild(entry.host)
    enableGpu(entry)
    const fit = () => {
      if (el.clientWidth > 0 && el.clientHeight > 0) {
        try {
          entry.fit.fit()
        } catch {
        }
      }
    }
    fit()
    if (!inactive) entry.term.focus()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => {
      ro.disconnect()
      if (entry.host.parentElement === el) el.removeChild(entry.host)
    }
  }, [id])

  useEffect(() => {
    if (!visible) return
    const entry = getTerminal(id, theme)
    requestAnimationFrame(() => {
      try {
        entry.fit.fit()
      } catch {
      }
      if (inactive) return entry.term.blur()
      entry.term.focus()
      window.ccshell.terminal.resize(id, entry.term.cols, entry.term.rows)
    })
  }, [visible, id, inactive])

  return (
    <div
      className="min-h-0 flex-1 bg-bg py-2 pl-3"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault()
        void filesToPaths([...e.dataTransfer.files]).then(({ paths }) => {
          if (paths.length) window.ccshell.terminal.write(id, paths.map(quotePath).join(' ') + ' ')
        })
      }}
      onPasteCapture={(e) => {
        if (!hasFiles(e.clipboardData) || e.clipboardData.getData('text/plain')) return
        e.preventDefault()
        e.stopPropagation()
        void filesToPaths([...e.clipboardData.files]).then(({ paths }) => {
          if (paths.length) window.ccshell.terminal.write(id, paths.map(quotePath).join(' ') + ' ')
        })
      }}
    >
      <div ref={box} className="h-full w-full" />
    </div>
  )
}

function StuckBar({ session }: { session: TerminalSession }) {
  const [msg, setMsg] = useState<string | null>(null)
  const go = async () => {
    setMsg(null)
    const r = await window.ccshell.terminal.continueNow(session.id)
    setMsg(r.ok ? r.data : r.error)
  }
  return (
    <div className="anim-rise flex shrink-0 items-center gap-3 border-b border-warning/40 bg-warning/10 px-4 py-2 text-[13px]">
      <AlertTriangle size={15} className="shrink-0 text-warning" />
      <span className="min-w-0 flex-1 truncate text-text" title={session.stateDetail}>
        {session.continuing ? '正在中断当前回合，确认停止后将发送继续指令…' : (session.stateDetail ?? '疑似停滞')}
        {msg && <span className="ml-2 text-text-3">{msg}</span>}
      </span>
      {!session.continuing && (
        <>
          <button className="btn btn-secondary h-7 gap-1.5 px-2.5 text-[12.5px]" title="中断当前回合，确认停止后发送继续指令（可在设置中修改）" onClick={() => void go()}>
            <Play size={13} />
            续跑
          </button>
          <button className="btn btn-ghost h-7 px-2.5 text-[12.5px]" onClick={() => window.ccshell.terminal.write(session.id, '\x1b')}>
            停止（Esc）
          </button>
        </>
      )}
    </div>
  )
}
