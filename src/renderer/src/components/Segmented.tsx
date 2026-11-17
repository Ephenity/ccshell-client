import { useLayoutEffect, useRef, useState, type ComponentType, type ReactNode } from 'react'

export interface SegOption<T extends string> {
  value: T
  label?: ReactNode
  icon?: ComponentType<{ size?: number; strokeWidth?: number; className?: string }>
  title?: string
  disabled?: boolean
}

export function Segmented<T extends string>(props: {
  value: T | null
  options: SegOption<T>[]
  onChange: (v: T) => void
  size?: 'sm' | 'md'
  block?: boolean
  className?: string
  'aria-label'?: string
}) {
  const { value, options, onChange, size = 'md', block } = props
  const track = useRef<HTMLDivElement>(null)
  const [thumb, setThumb] = useState<{ left: number; width: number } | null>(null)
  const [animate, setAnimate] = useState(false)

  useLayoutEffect(() => {
    const el = track.current?.querySelector<HTMLElement>(`[data-seg="${value}"]`)
    if (!el) return setThumb(null)
    setThumb({ left: el.offsetLeft, width: el.offsetWidth })
  }, [value, options.length])
  useLayoutEffect(() => {
    const id = requestAnimationFrame(() => setAnimate(true))
    return () => cancelAnimationFrame(id)
  }, [])
  useLayoutEffect(() => {
    if (!track.current) return
    const ro = new ResizeObserver(() => {
      const el = track.current?.querySelector<HTMLElement>(`[data-seg="${value}"]`)
      if (el) setThumb({ left: el.offsetLeft, width: el.offsetWidth })
    })
    ro.observe(track.current)
    return () => ro.disconnect()
  }, [value])

  const h = size === 'sm' ? 'h-7' : 'h-8'
  const item = size === 'sm' ? 'h-[22px] px-2.5 text-[12px]' : 'h-[26px] px-3 text-[13px]'
  const iconOnly = options.every((o) => !o.label)
  return (
    <div
      ref={track}
      role="tablist"
      aria-label={props['aria-label']}
      className={'relative inline-flex items-center rounded-[9px] bg-surface-2 p-[3px] ' + h + (block ? ' flex w-full' : '') + ' ' + (props.className ?? '')}
    >
      {thumb && (
        <span
          aria-hidden
          className={'absolute top-[3px] bottom-[3px] left-0 rounded-[6px] bg-surface shadow-[0_1px_2px_#0000001f,0_0_0_1px_var(--border)] will-change-transform ' + (animate ? 'transition-[transform,width] duration-[130ms] ease-[cubic-bezier(0.2,0.9,0.1,1)]' : '')}
          style={{ transform: `translateX(${thumb.left}px)`, width: thumb.width }}
        />
      )}
      {options.map((o) => {
        const on = o.value === value
        const Icon = o.icon
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            data-seg={o.value}
            aria-selected={on}
            aria-label={iconOnly ? o.title : undefined}
            title={o.title}
            disabled={o.disabled}
            onClick={() => onChange(o.value)}
            className={
              'relative z-[1] flex items-center justify-center gap-1.5 rounded-[6px] ' +
              item +
              (iconOnly ? ' w-9 px-0' : '') +
              (block ? ' flex-1' : '') +
              (on ? ' font-medium text-text' : o.disabled ? ' text-text-3 opacity-40' : ' text-text-3 hover:text-text')
            }
          >
            {Icon && <Icon size={15} strokeWidth={1.9} className={on ? 'text-brand-text' : ''} />}
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
