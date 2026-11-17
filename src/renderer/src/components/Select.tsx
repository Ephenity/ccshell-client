import { Check, ChevronDown } from 'lucide-react'
import { Children, isValidElement, useEffect, useLayoutEffect, useRef, useState, type ReactElement, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

interface Item {
  value: string
  label: string
  group?: string
  disabled?: boolean
}

function text(node: ReactNode): string {
  if (node == null || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(text).join('')
  if (isValidElement(node)) return text((node.props as { children?: ReactNode }).children)
  return ''
}

function collect(children: ReactNode, group?: string, out: Item[] = []): Item[] {
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return
    const el = child as ReactElement<{ value?: string | number; label?: string; disabled?: boolean; children?: ReactNode }>
    if (el.type === 'option') out.push({ value: String(el.props.value ?? text(el.props.children)), label: text(el.props.children), group, disabled: el.props.disabled })
    else if (el.type === 'optgroup') collect(el.props.children, el.props.label, out)
    else collect(el.props.children, group, out)
  })
  return out
}

export function Select(props: {
  value: string | number
  onChange: (e: { target: { value: string } }) => void
  children: ReactNode
  className?: string
  disabled?: boolean
  'aria-label'?: string
  title?: string
}) {
  const items = collect(props.children)
  const value = String(props.value)
  const current = items.find((i) => i.value === value)
  const [open, setOpen] = useState(false)
  const [hi, setHi] = useState(-1)
  const [pos, setPos] = useState<{ left: number; top: number; width: number; up: boolean; maxH: number } | null>(null)
  const btn = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const mono = props.className?.includes('font-mono')

  const place = () => {
    const r = btn.current!.getBoundingClientRect()
    const below = window.innerHeight - r.bottom - 8
    const above = r.top - 8
    const up = below < 220 && above > below
    setPos({ left: r.left, top: up ? r.top - 4 : r.bottom + 4, width: r.width, up, maxH: Math.min(320, up ? above : below) })
  }
  const show = () => {
    if (props.disabled) return
    place()
    setHi(Math.max(0, items.findIndex((i) => i.value === value)))
    setOpen(true)
  }
  const choose = (i: Item) => {
    if (i.disabled) return
    setOpen(false)
    btn.current?.focus()
    if (i.value !== value) props.onChange({ target: { value: i.value } })
  }

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!list.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setOpen(false)
    }
    const onScroll = (e: Event) => {
      if (!list.current?.contains(e.target as Node)) setOpen(false)
    }
    const onBlur = () => setOpen(false)
    window.addEventListener('mousedown', onDown, true)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onBlur)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onBlur)
      window.removeEventListener('blur', onBlur)
    }
  }, [open])

  useLayoutEffect(() => {
    if (open) list.current?.querySelector(`[data-i="${hi}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [open, hi])

  const move = (d: number) => {
    if (!items.length) return
    let i = hi
    for (let n = 0; n < items.length; n++) {
      i = (i + d + items.length) % items.length
      if (!items[i].disabled) break
    }
    setHi(i)
  }

  const onKey = (e: React.KeyboardEvent) => {
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
        e.preventDefault()
        show()
      }
      return
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      move(e.key === 'ArrowDown' ? 1 : -1)
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      if (items[hi]) choose(items[hi])
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      setOpen(false)
    } else if (e.key === 'Tab') setOpen(false)
  }

  let lastGroup: string | undefined
  return (
    <>
      <button
        ref={btn}
        type="button"
        disabled={props.disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={props['aria-label']}
        title={props.title}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={onKey}
        className={'flex items-center gap-2 text-left disabled:cursor-not-allowed disabled:opacity-50 ' + (open ? 'border-brand ' : '') + (props.className ?? '')}
      >
        <span className={'min-w-0 flex-1 truncate ' + (current ? '' : 'text-text-3')}>{current?.label ?? value}</span>
        <ChevronDown size={14} className={'shrink-0 text-text-3 transition-transform ' + (open ? 'rotate-180' : '')} />
      </button>
      {open &&
        pos &&
        createPortal(
          <div
            ref={list}
            role="listbox"
            className={(pos.up ? 'anim-pop-up' : 'anim-pop') + ' fixed z-[950] overflow-y-auto rounded-md border border-border bg-surface p-1 shadow-[0_12px_32px_#0000002b,0_2px_6px_#00000012] ' + (mono ? 'font-mono' : '')}
            style={{ left: pos.left, width: Math.max(pos.width, 160), maxHeight: pos.maxH, ...(pos.up ? { bottom: window.innerHeight - pos.top } : { top: pos.top }) }}
          >
            {items.map((it, i) => {
              const header = it.group && it.group !== lastGroup ? ((lastGroup = it.group), <div className="px-2.5 pt-2 pb-1 font-sans text-[11px] text-text-3">{it.group}</div>) : null
              const sel = it.value === value
              return (
                <div key={i}>
                  {header}
                  <div
                    role="option"
                    aria-selected={sel}
                    data-i={i}
                    onMouseEnter={() => setHi(i)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => choose(it)}
                    className={
                      'flex h-8 cursor-pointer items-center gap-2 rounded-sm px-2.5 text-[13px] ' +
                      (it.disabled ? 'cursor-default opacity-45 ' : '') +
                      (i === hi && !it.disabled ? 'bg-surface-2 ' : '') +
                      (sel ? 'font-medium text-brand-text' : 'text-text')
                    }
                  >
                    <span className="min-w-0 flex-1 truncate">{it.label}</span>
                    {sel && <Check size={14} className="shrink-0" />}
                  </div>
                </div>
              )
            })}
          </div>,
          document.body
        )}
    </>
  )
}
