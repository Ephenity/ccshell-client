import { ChevronDown, ChevronUp, X } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { TerminalSession } from '../../../shared/terminal'
import { STATE_STYLE } from '../terminal/state'

function elapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

export function FloatApp() {
  const [sessions, setSessions] = useState<TerminalSession[]>([])
  const [collapsed, setCollapsed] = useState(false)
  const [, tick] = useState(0)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void window.ccshell.terminal.list().then((r) => r.ok && setSessions(r.data))
    void window.ccshell.settings.get().then((r) => r.ok && setCollapsed(r.data.float.collapsed))
    const offs = [window.ccshell.terminal.onList(setSessions), window.ccshell.float.onCollapsed(setCollapsed)]
    const t = setInterval(() => tick((n) => n + 1), 1000)
    return () => {
      offs.forEach((f) => f())
      clearInterval(t)
    }
  }, [])

  const running = sessions.filter((s) => s.status === 'running')
  useLayoutEffect(() => {
    window.ccshell.float.resize((box.current?.offsetHeight ?? 40) + 2)
  })

  const count = (pred: (s: TerminalSession) => boolean) => running.filter(pred).length
  const counts = [
    { n: count((s) => s.state === 'busy' && !s.stuck), cls: 'bg-[#5b8fd1]', title: '处理中' },
    { n: count((s) => s.state === 'waiting' || !!s.stuck), cls: 'bg-warning', title: '需要处理' },
    { n: count((s) => s.state === 'idle' || s.state === 'running'), cls: 'bg-success', title: '空闲' },
    { n: count((s) => s.state === 'error'), cls: 'bg-danger', title: '出错' }
  ]
  const toggle = () => window.ccshell.float.collapse(!collapsed)

  return (
    <div ref={box} className="overflow-hidden rounded-lg border border-border bg-bg-raised/95 text-text">
      <div className="flex h-8 items-center gap-2 px-2.5 select-none" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties} onDoubleClick={toggle}>
        <span className="text-[12.5px] font-semibold">Claude Code</span>
        <span className="flex flex-1 items-center gap-2">
          {counts
            .filter((c) => c.n)
            .map((c) => (
              <span key={c.title} title={c.title} className="flex items-center gap-1 text-[11px] text-text-2">
                <span className={'size-1.5 rounded-full ' + c.cls} />
                {c.n}
              </span>
            ))}
          {!running.length && <span className="text-[11px] text-text-3">暂无运行中的会话</span>}
        </span>
        <span className="flex gap-0.5" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <button title={collapsed ? '展开' : '收起'} className="flex size-5 items-center justify-center rounded-sm text-text-3 hover:bg-surface-2 hover:text-text" onClick={toggle}>
            {collapsed ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
          </button>
          <button title="关闭悬浮窗" className="flex size-5 items-center justify-center rounded-sm text-text-3 hover:bg-surface-2 hover:text-danger" onClick={() => window.ccshell.float.close()}>
            <X size={13} />
          </button>
        </span>
      </div>
      {!collapsed && !!running.length && (
        <div className="max-h-[520px] overflow-y-auto border-t border-border py-1">
          {running.map((s) => {
            const st = s.stuck ? { dot: 'bg-warning', label: '疑似停滞' } : STATE_STYLE[s.state]
            const line = s.state === 'waiting' || s.stuck ? (s.stateDetail ?? s.activity) : s.activity
            return (
              <button
                key={s.id}
                title={`${s.title}\n${s.cwd}\n${st.label}${line ? '：' + line : ''}`}
                onClick={() => window.ccshell.float.openSession(s.id)}
                className="flex w-full items-start gap-2 px-2.5 py-1.5 text-left hover:bg-surface"
              >
                <span className="relative mt-1.5 flex size-2 shrink-0">
                  {s.state === 'busy' && !s.stuck && <span className="absolute inline-flex size-full animate-ping rounded-full bg-[#5b8fd1] opacity-60" />}
                  <span className={'relative inline-flex size-2 rounded-full ' + st.dot.replace('animate-pulse', '')} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-[12.5px]">{s.title}</span>
                    {s.state === 'busy' && s.busySince && <span className="ml-auto shrink-0 font-mono text-[11px] text-text-3">{elapsed(Date.now() - s.busySince)}</span>}
                  </span>
                  <span className={'block truncate text-[11px] ' + (s.state === 'waiting' || s.stuck ? 'text-warning' : 'text-text-3')}>{line || st.label}</span>
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
