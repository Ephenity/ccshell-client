import { AlertTriangle, CheckCircle2, Info, OctagonAlert, X } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Notice } from '../../../shared/terminal'

type Card = Notice & { sound: boolean }

const LIFETIME: Record<Notice['kind'], number> = { done: 8000, info: 6000, attention: 15000, problem: 15000 }
const MAX = 3
const MERGE_MS = 8_000
const SHIFT_GUARD_MS = 350

let ctx: AudioContext | null = null

function tone(freq: number, at: number, len: number, type: OscillatorType, gain: number, glideTo?: number, filter?: number) {
  ctx ??= new AudioContext()
  const t = ctx.currentTime + at
  const osc = ctx.createOscillator()
  const g = ctx.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, t)
  if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, t + len)
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(gain, t + 0.01)
  g.gain.exponentialRampToValueAtTime(0.0001, t + len)
  let node: AudioNode = osc
  if (filter) {
    const f = ctx.createBiquadFilter()
    f.type = 'lowpass'
    f.frequency.value = filter
    osc.connect(f)
    node = f
  }
  node.connect(g).connect(ctx.destination)
  osc.start(t)
  osc.stop(t + len + 0.05)
}

export function playSound(kind: Notice['kind']): void {
  try {
    if (kind === 'done') {
      ;[523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
        tone(f, i * 0.09, 0.35, 'sine', 0.22)
        tone(f * 4, i * 0.09, 0.08, 'sine', 0.05)
      })
    } else if (kind === 'attention') {
      ;[0, 0.12, 0.42, 0.54].forEach((at) => tone(1760, at, 0.09, 'square', 0.06, undefined, 4000))
    } else if (kind === 'problem') {
      tone(196, 0, 0.32, 'sawtooth', 0.12, undefined, 900)
      tone(138.59, 0.3, 0.6, 'sawtooth', 0.12, 110, 700)
    } else {
      tone(1318.5, 0, 0.9, 'sine', 0.12)
      tone(2637, 0, 0.5, 'sine', 0.04)
    }
  } catch {
  }
}

const KIND_STYLE: Record<Notice['kind'], { icon: typeof Info; color: string; label: string }> = {
  done: { icon: CheckCircle2, color: 'text-success', label: '回答完成' },
  attention: { icon: AlertTriangle, color: 'text-warning', label: '需要处理' },
  problem: { icon: OctagonAlert, color: 'text-danger', label: '异常' },
  info: { icon: Info, color: 'text-brand-text', label: '提示' }
}

export function ToastApp() {
  const [cards, setCards] = useState<Card[]>([])
  const [hover, setHover] = useState<string | null>(null)
  const box = useRef<HTMLDivElement>(null)
  const timers = useRef(new Map<string, { left: number; started: number; timer: number | null }>())
  const added = useRef(new Map<string, number>())
  const shiftedAt = useRef(0)
  const settled = () => Date.now() - shiftedAt.current > SHIFT_GUARD_MS

  const remove = (id: string) => {
    shiftedAt.current = Date.now()
    setHover((h) => (h === id ? null : h))
    const t = timers.current.get(id)
    if (t?.timer) clearTimeout(t.timer)
    timers.current.delete(id)
    setCards((c) => c.filter((x) => x.id !== id))
  }

  const arm = (id: string, ms: number) => {
    const t = { left: ms, started: Date.now(), timer: window.setTimeout(() => remove(id), ms) }
    timers.current.set(id, t)
  }

  useEffect(() => {
    const off = window.ccshell.toast.onAdd((n) => {
      if (n.sound) playSound(n.kind)
      shiftedAt.current = Date.now()
      setCards((c) => {
        const now = Date.now()
        const merged = c.filter((x) => {
          const same = !!n.sessionId && x.sessionId === n.sessionId && x.kind === n.kind && now - (added.current.get(x.id) ?? 0) < MERGE_MS
          if (same) {
            const t = timers.current.get(x.id)
            if (t?.timer) clearTimeout(t.timer)
            timers.current.delete(x.id)
          }
          return !same
        })
        added.current.set(n.id, now)
        const next = [...merged, n]
        while (next.length > MAX) {
          const gone = next.shift()!
          const t = timers.current.get(gone.id)
          if (t?.timer) clearTimeout(t.timer)
          timers.current.delete(gone.id)
        }
        return next
      })
      arm(n.id, LIFETIME[n.kind])
    })
    window.ccshell.toast.ready()
    return off
  }, [])

  useEffect(() => {
    for (const [id, t] of timers.current) {
      if (id === hover && t.timer) {
        clearTimeout(t.timer)
        t.left -= Date.now() - t.started
        t.timer = null
      } else if (id !== hover && !t.timer) {
        t.started = Date.now()
        t.timer = window.setTimeout(() => remove(id), Math.max(1500, t.left))
      }
    }
  }, [hover])

  useLayoutEffect(() => {
    window.ccshell.toast.resize(cards.length ? (box.current?.offsetHeight ?? 0) : 0)
  }, [cards])

  return (
    <div className="flex h-screen flex-col justify-end overflow-hidden">
      <div ref={box} className="flex flex-col justify-end gap-2 px-4 pt-3 pb-5">
        {cards.map((c) => {
          const k = KIND_STYLE[c.kind]
          const Icon = k.icon
          return (
            <div
              key={c.id}
              role="button"
              onMouseEnter={() => setHover(c.id)}
              onMouseLeave={() => setHover(null)}
              onPointerDown={(e) => {
                if (e.button !== 0) return
                const close = e.target instanceof Element && !!e.target.closest('button')
                if (!settled()) return window.ccshell.toast.trace('按下（忽略）')
                window.ccshell.toast.trace(close ? '按下（关闭）' : '按下（打开会话）')
                if (!close) window.ccshell.toast.click(c.sessionId)
                remove(c.id)
              }}
              className="toast-in group relative flex cursor-pointer gap-3 rounded-lg border border-border bg-bg-raised p-3.5 pr-8 shadow-[0_4px_12px_rgba(0,0,0,0.16)] hover:border-border-strong"
            >
              <Icon size={18} className={'mt-0.5 shrink-0 ' + k.color} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-semibold text-text">{c.title}</div>
                <div className="mt-0.5 line-clamp-3 text-[12.5px] leading-relaxed whitespace-pre-line text-text-2">{c.body}</div>
                <div className="mt-1 text-[11px] text-text-3">
                  {k.label} · {new Date(c.at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })}
                </div>
              </div>
              <button
                title="关闭"
                className="absolute top-2 right-2 flex size-6 items-center justify-center rounded-sm text-text-3 hover:bg-surface-2 hover:text-text"
              >
                <X size={13} />
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
