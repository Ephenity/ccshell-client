import { useEffect, useLayoutEffect, useRef, useState } from 'react'

export function useReplay<T extends HTMLElement = HTMLDivElement>(key: unknown, cls = 'anim-fade') {
  const ref = useRef<T>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.classList.remove(cls)
    void el.offsetWidth
    el.classList.add(cls)
  }, [key, cls])
  return ref
}

export function useTween(target: number, ms = 650, from?: number): number {
  const [v, setV] = useState(from ?? target)
  const last = useRef(from ?? target)
  useEffect(() => {
    const start = last.current
    if (start === target || matchMedia('(prefers-reduced-motion: reduce)').matches) {
      last.current = target
      setV(target)
      return
    }
    const t0 = performance.now()
    let raf = 0
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / ms)
      const cur = start + (target - start) * (1 - Math.pow(1 - k, 3))
      last.current = cur
      setV(cur)
      if (k < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [target, ms])
  return v
}

const dims = new Map<symbol, number>()
function pushDim() {
  window.ccshell.ui.dimTitleBar(1 - [...dims.values()].reduce((k, a) => k * (1 - a), 1))
}
export function useDimTitleBar(alpha: number, active = true): void {
  useEffect(() => {
    if (!active) return
    const key = Symbol()
    dims.set(key, alpha)
    pushDim()
    return () => {
      dims.delete(key)
      pushDim()
    }
  }, [alpha, active])
}
