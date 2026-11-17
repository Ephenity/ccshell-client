import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { TITLE_BAR_HEIGHT } from '../../../shared/theme'

const widths = new Map<string, number>()
const listeners = new Map<string, Set<() => void>>()

export const MAIN_ASIDE = { id: 'main', defaultWidth: 256, min: 200, max: 400 } as const

function read(id: string, fallback: number): number {
  const cached = widths.get(id)
  if (cached) return cached
  let v = 0
  try {
    v = Number(localStorage.getItem(`ccshell-aside-${id}`))
    if (!v && id === MAIN_ASIDE.id) v = Number(localStorage.getItem('ccshell-aside-chat'))
  } catch {
  }
  const w = v || fallback
  widths.set(id, w)
  return w
}

function write(id: string, w: number) {
  if (widths.get(id) === w) return
  widths.set(id, w)
  try {
    localStorage.setItem(`ccshell-aside-${id}`, String(w))
  } catch {
  }
  listeners.get(id)?.forEach((f) => f())
}

export function useAsideWidth(id: string, defaultWidth: number, min = 200, max = 480): number {
  const w = useSyncExternalStore(
    (cb) => {
      let set = listeners.get(id)
      if (!set) listeners.set(id, (set = new Set()))
      set.add(cb)
      return () => set.delete(cb)
    },
    () => read(id, defaultWidth)
  )
  return Math.min(max, Math.max(min, w))
}

export function ResizableAside(props: {
  id: string
  defaultWidth: number
  min?: number
  max?: number
  className?: string
  'aria-label'?: string
  children: ReactNode
}) {
  const { id, defaultWidth, min = 200, max = 480 } = props
  const clamp = (w: number) => Math.min(max, Math.max(min, Math.round(w)))
  const width = useAsideWidth(id, defaultWidth, min, max)
  const setWidth = (w: number) => write(id, clamp(w))
  const [dragging, setDragging] = useState(false)
  const start = useRef<{ x: number; w: number } | null>(null)

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    start.current = { x: e.clientX, w: width }
    setDragging(true)
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (!start.current) return
    setWidth(start.current.w + e.clientX - start.current.x)
  }
  const end = () => {
    start.current = null
    setDragging(false)
  }

  useEffect(() => {
    if (!dragging) return
    const prev = document.body.style.cursor
    document.body.style.cursor = 'col-resize'
    document.body.classList.add('select-none')
    return () => {
      document.body.style.cursor = prev
      document.body.classList.remove('select-none')
    }
  }, [dragging])

  return (
    <aside aria-label={props['aria-label']} className={'relative flex shrink-0 flex-col border-r border-border ' + (props.className ?? '')} style={{ width }}>
      {id === MAIN_ASIDE.id && <div className="shrink-0" style={{ height: TITLE_BAR_HEIGHT }} />}
      {props.children}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-valuenow={width}
        aria-valuemin={min}
        aria-valuemax={max}
        title="拖动调整宽度，双击恢复默认"
        data-tip-place="right"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={end}
        onPointerCancel={end}
        onDoubleClick={() => setWidth(defaultWidth)}
        className="group absolute top-0 -right-[3px] bottom-0 z-10 w-[6px] cursor-col-resize"
      >
        <span className={'absolute inset-y-0 left-1/2 w-[2px] -translate-x-1/2 transition-colors ' + (dragging ? 'bg-brand' : 'bg-transparent group-hover:bg-brand/50')} />
      </div>
    </aside>
  )
}
