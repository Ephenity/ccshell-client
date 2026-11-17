import { PictureInPicture2, Plus, Power } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import type { TerminalSession } from '../../../shared/terminal'
import { LogoMark } from '../components/LogoMark'
import { STATE_STYLE } from '../terminal/state'

export function TrayMenu() {
  const [sessions, setSessions] = useState<TerminalSession[]>([])
  const [floatOn, setFloatOn] = useState(false)
  const [shown, setShown] = useState(0)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void window.ccshell.terminal.list().then((r) => r.ok && setSessions(r.data))
    void window.ccshell.settings.get().then((r) => r.ok && setFloatOn(r.data.float.enabled))
    const offs = [
      window.ccshell.terminal.onList(setSessions),
      window.ccshell.settings.onChanged((s) => setFloatOn(s.float.enabled)),
      window.ccshell.tray.onShown(() => setShown((n) => n + 1))
    ]
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && window.ccshell.tray.hide()
    window.addEventListener('keydown', onKey)
    return () => {
      offs.forEach((f) => f())
      window.removeEventListener('keydown', onKey)
    }
  }, [])

  useLayoutEffect(() => {
    window.ccshell.tray.resize(box.current?.offsetHeight ?? 200)
  })

  const running = sessions.filter((s) => s.status === 'running')

  return (
    <div ref={box} className="px-3 pt-2 pb-4">
      <div
        key={shown}
        className="anim-pop-up overflow-hidden rounded-[10px] border border-border bg-bg-raised p-1 text-text shadow-[0_4px_12px_#0000002e,0_1px_3px_#0000001f] select-none"
      >
        <Item icon={<LogoMark size={16} />} label="显示 CC Shell" onClick={() => window.ccshell.tray.showWindow()} strong />
        <Divider />
        <div className="px-2.5 pt-1 pb-1 text-[11px] text-text-3">Claude Code 会话{running.length ? ` · ${running.length}` : ''}</div>
        {running.length ? (
          <div className="max-h-[300px] overflow-y-auto">
            {running.map((s) => {
              const st = s.stuck ? { dot: 'bg-warning', label: '疑似停滞' } : STATE_STYLE[s.state]
              const attention = s.state === 'waiting' || !!s.stuck
              return (
                <button
                  key={s.id}
                  onClick={() => window.ccshell.tray.openSession(s.id)}
                  className="flex h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-[13px] hover:bg-surface-2"
                >
                  <span className="flex w-4 shrink-0 justify-center">
                    <span className={'size-2 rounded-full ' + st.dot.replace('animate-pulse', '')} />
                  </span>
                  <span className="min-w-0 flex-1 truncate">{s.title}</span>
                  <span className={'shrink-0 text-[11.5px] ' + (attention ? 'text-warning' : 'text-text-3')}>{st.label}</span>
                </button>
              )
            })}
          </div>
        ) : (
          <div className="flex h-8 items-center px-2.5 text-[12.5px] text-text-3">暂无运行中的会话</div>
        )}
        <Divider />
        <Item icon={<Plus size={15} strokeWidth={1.9} />} label="新会话" onClick={() => window.ccshell.tray.openSession('__new__')} />
        <Item
          icon={<PictureInPicture2 size={15} strokeWidth={1.9} />}
          label="悬浮窗"
          onClick={() => void window.ccshell.settings.update({ float: { enabled: !floatOn } })}
          right={
            <span role="switch" aria-checked={floatOn} className={'relative h-[18px] w-8 shrink-0 rounded-full transition-colors ' + (floatOn ? 'bg-brand' : 'bg-border-strong')}>
              <span className={'absolute top-[2px] size-[14px] rounded-full bg-white shadow transition-all ' + (floatOn ? 'left-[16px]' : 'left-[2px]')} />
            </span>
          }
        />
        <Divider />
        <Item icon={<Power size={15} strokeWidth={1.9} />} label="退出 CC Shell" onClick={() => window.ccshell.tray.quit()} danger />
      </div>
    </div>
  )
}

function Item({ icon, label, onClick, right, strong, danger }: { icon: ReactNode; label: string; onClick: () => void; right?: ReactNode; strong?: boolean; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={
        'group flex h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-[13px] transition-colors ' +
        (danger ? 'text-text-2 hover:bg-danger/10 hover:text-danger' : 'hover:bg-surface-2') +
        (strong ? ' font-medium' : '')
      }
    >
      <span className={'flex w-4 shrink-0 justify-center ' + (danger ? '' : 'text-text-2 group-hover:text-text')}>{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {right}
    </button>
  )
}

function Divider() {
  return <div className="mx-2 my-1 h-px bg-border" />
}
