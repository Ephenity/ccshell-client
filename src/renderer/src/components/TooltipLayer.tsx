import { useEffect, useLayoutEffect, useRef, useState } from 'react'

type Place = 'top' | 'bottom' | 'right'

export function TooltipLayer() {
  const [tip, setTip] = useState<{ text: string; rect: DOMRect; place: Place } | null>(null)
  const box = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  useEffect(() => {
    let el: HTMLElement | null = null
    let timer: ReturnType<typeof setTimeout> | undefined

    const release = () => {
      clearTimeout(timer)
      if (el && el.dataset.tip !== undefined) {
        if (!el.hasAttribute('title')) el.setAttribute('title', el.dataset.tip)
        delete el.dataset.tip
      }
      el = null
      setTip(null)
    }

    const over = (e: PointerEvent) => {
      const target = (e.target as Element | null)?.closest?.('[title],[data-tip]') as HTMLElement | null
      if (target === el) return
      release()
      if (!target) return
      const text = target.getAttribute('title') ?? ''
      if (!text.trim()) return
      el = target
      el.dataset.tip = text
      el.removeAttribute('title')
      timer = setTimeout(() => {
        if (!el || !el.isConnected) return
        const place = (el.dataset.tipPlace as Place | undefined) ?? (el.closest('[data-tip-rail]') ? 'right' : 'bottom')
        setTip({ text, rect: el.getBoundingClientRect(), place })
      }, 450)
    }
    const hide = () => {
      clearTimeout(timer)
      setTip(null)
    }

    document.addEventListener('pointerover', over, true)
    document.addEventListener('pointerdown', hide, true)
    document.addEventListener('keydown', hide, true)
    document.addEventListener('wheel', hide, { capture: true, passive: true })
    window.addEventListener('blur', release)
    return () => {
      document.removeEventListener('pointerover', over, true)
      document.removeEventListener('pointerdown', hide, true)
      document.removeEventListener('keydown', hide, true)
      document.removeEventListener('wheel', hide, true)
      window.removeEventListener('blur', release)
      release()
    }
  }, [])

  useLayoutEffect(() => {
    if (!tip || !box.current) return setPos(null)
    const { width: w, height: h } = box.current.getBoundingClientRect()
    const r = tip.rect
    const gap = 8
    const vw = window.innerWidth
    const vh = window.innerHeight
    let left: number
    let top: number
    if (tip.place === 'right') {
      left = r.right + gap
      top = r.top + r.height / 2 - h / 2
    } else {
      left = r.left + r.width / 2 - w / 2
      top = tip.place === 'top' || r.bottom + gap + h > vh - 4 ? r.top - gap - h : r.bottom + gap
      if (top < 4) top = r.bottom + gap
    }
    setPos({ left: Math.max(6, Math.min(left, vw - w - 6)), top: Math.max(6, Math.min(top, vh - h - 6)) })
  }, [tip])

  if (!tip) return null
  return (
    <div
      ref={box}
      role="tooltip"
      className="tip-bubble pointer-events-none fixed z-[1000] max-w-[300px] rounded-md px-2.5 py-1.5 text-[12px] leading-[1.5] whitespace-pre-line [overflow-wrap:anywhere]"
      style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: -9999 }}
    >
      {(() => {
        const [head, ...rest] = tip.text.split('\n')
        return rest.length ? (
          <>
            <div className="font-medium">{head}</div>
            <div className="opacity-65">{rest.join('\n')}</div>
          </>
        ) : (
          head
        )
      })()}
    </div>
  )
}
