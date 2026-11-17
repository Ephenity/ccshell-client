import { MessageSquare, SquareTerminal } from 'lucide-react'
import { useLayoutEffect, useRef, useState } from 'react'

type Workspace = 'chat' | 'code'

const ITEMS: { value: Workspace; label: string; icon: typeof MessageSquare }[] = [
  { value: 'chat', label: '对话', icon: MessageSquare },
  { value: 'code', label: 'Claude Code', icon: SquareTerminal }
]

export function WorkspaceSwitch({ value, onChange }: { value: Workspace | null; onChange: (v: Workspace) => void }) {
  const track = useRef<HTMLDivElement>(null)
  const [thumb, setThumb] = useState<{ left: number; width: number } | null>(null)
  const [slide, setSlide] = useState(false)

  useLayoutEffect(() => {
    const el = track.current?.querySelector<HTMLElement>(`[data-ws="${value}"]`)
    setThumb(el ? { left: el.offsetLeft, width: el.offsetWidth } : null)
    const id = requestAnimationFrame(() => setSlide(true))
    return () => cancelAnimationFrame(id)
  }, [value])

  return (
    <div ref={track} role="tablist" aria-label="工作区" className="no-drag relative inline-flex h-8 items-center rounded-[9px] bg-surface-2 p-[3px]">
      {thumb && (
        <span
          aria-hidden
          className={
            'absolute top-[3px] bottom-[3px] left-0 rounded-[6px] bg-surface shadow-[0_1px_2px_#0000001f,0_0_0_1px_var(--border)] will-change-transform ' +
            (slide ? 'transition-[transform,width] duration-[130ms] ease-[cubic-bezier(0.2,0.9,0.1,1)]' : '')
          }
          style={{ transform: `translateX(${thumb.left}px)`, width: thumb.width }}
        />
      )}
      {ITEMS.map(({ value: v, label, icon: Icon }) => {
        const on = v === value
        return (
          <button
            key={v}
            type="button"
            role="tab"
            data-ws={v}
            aria-selected={on}
            aria-label={label}
            title={label}
            data-tip-place="bottom"
            onClick={() => onChange(v)}
            className={'relative z-[1] flex h-[26px] w-[34px] items-center justify-center rounded-[6px] ' + (on ? 'text-brand-text' : 'text-text-3 hover:text-text')}
          >
            <Icon size={15} strokeWidth={1.9} />
          </button>
        )
      })}
    </div>
  )
}
