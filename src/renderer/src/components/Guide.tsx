import { ArrowLeft, ArrowRight } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { useDimTitleBar } from './anim'

interface Step {
  module: 'chat' | 'code'
  target: string
  title: string
  text: string
  keys?: string[]
}

export const GUIDE_STEPS: Step[] = [
  {
    module: 'chat',
    target: 'switch',
    title: '两个工作区',
    text: '“对话”用来和模型交流；“Claude Code”在项目目录里读写代码、运行命令。在这里切换，两边的进度互不影响。'
  },
  {
    module: 'chat',
    target: 'composer',
    title: '开始一段对话',
    text: '输入后发送。下方可以切换模型、调整思考强度、启用工具；回答进行中继续发送的消息会自动排队。',
    keys: ['Enter 发送', 'Shift+Enter 换行', '/ 选择提示词']
  },
  {
    module: 'chat',
    target: 'library',
    title: '资源库',
    text: '助手、提示词、知识库与 MCP 集中在这里。常用的设定保存为助手，下次直接开始。'
  },
  {
    module: 'code',
    target: 'code-new',
    title: 'Claude Code 会话',
    text: '选择一个项目目录即可开始。多个会话可以同时运行，消息可以排队发送，会话还能弹出到独立窗口。',
    keys: ['Ctrl+Shift+N 新会话', 'Ctrl+Tab 切换会话']
  },
  {
    module: 'chat',
    target: 'account',
    title: '账户与设置',
    text: '余额、用量，以及 Claude Code、通知、外观等设置都在这里。随时可以按 Ctrl+K 搜索会话、页面和操作。',
    keys: ['Ctrl+K 搜索', 'Ctrl+, 设置']
  }
]

const PAD = 6
const CARD_W = 340
const GAP = 14

interface Box {
  x: number
  y: number
  w: number
  h: number
}

function findTarget(name: string): Box | null {
  for (const el of document.querySelectorAll<HTMLElement>(`[data-guide="${name}"]`)) {
    const r = el.getBoundingClientRect()
    if (r.width > 0 && r.height > 0) return { x: r.left - PAD, y: r.top - PAD, w: r.width + PAD * 2, h: r.height + PAD * 2 }
  }
  return null
}

function cardPlace(b: Box, cardH: number): CSSProperties {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const clampX = (x: number) => Math.min(vw - CARD_W - 16, Math.max(16, x))
  const clampY = (y: number) => Math.min(vh - cardH - 16, Math.max(16, y))
  if (b.y + b.h + GAP + cardH < vh - 16) return { left: clampX(b.x), top: b.y + b.h + GAP }
  if (b.y - GAP - cardH > 16) return { left: clampX(b.x + b.w - CARD_W), top: b.y - GAP - cardH }
  return { left: clampX(b.x + b.w + GAP), top: clampY(b.y) }
}

export function Guide({ onModule, onFinish }: { onModule: (m: 'chat' | 'code') => void; onFinish: () => void }) {
  const [i, setI] = useState(0)
  const [box, setBox] = useState<Box | null>(null)
  const [cardH, setCardH] = useState(200)
  const card = useRef<HTMLDivElement>(null)
  const step = GUIDE_STEPS[i]
  const last = i === GUIDE_STEPS.length - 1
  useDimTitleBar(0.45)

  useEffect(() => {
    onModule(step.module)
    let raf = 0
    let prev = ''
    const tick = () => {
      const b = findTarget(step.target)
      const key = b ? `${Math.round(b.x)},${Math.round(b.y)},${Math.round(b.w)},${Math.round(b.h)}` : ''
      if (key !== prev) {
        prev = key
        setBox(b)
      }
      raf = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(raf)
  }, [i])

  useLayoutEffect(() => {
    if (card.current) setCardH(card.current.offsetHeight)
  }, [i, box !== null])

  const next = () => (last ? onFinish() : setI(i + 1))
  const prev = () => i > 0 && setI(i - 1)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === 'Enter') next()
      else if (e.key === 'ArrowLeft') prev()
      else if (e.key === 'Escape') onFinish()
      else return
      e.preventDefault()
      e.stopPropagation()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [i])

  const move = 'transition-[left,top,width,height,opacity] duration-[260ms] ease-[cubic-bezier(0.2,0.9,0.1,1)]'
  return (
    <div data-guide-overlay className="anim-fade fixed inset-0 z-[820]" role="dialog" aria-label="新手指引" onMouseDown={(e) => e.preventDefault()}>
      {box ? (
        <div
          className={'pointer-events-none absolute rounded-xl ring-[1.5px] ring-brand/70 ' + move}
          style={{ left: box.x, top: box.y, width: box.w, height: box.h, boxShadow: '0 0 0 9999px rgb(0 0 0 / 0.45)' }}
        />
      ) : (
        <div className="absolute inset-0 bg-black/45" />
      )}

      <div
        ref={card}
        className={'absolute rounded-xl border border-border bg-surface p-5 shadow-[0_18px_50px_#00000040] ' + move}
        style={{ width: CARD_W, ...(box ? cardPlace(box, cardH) : { left: `calc(50% - ${CARD_W / 2}px)`, top: '40%' }) }}
      >
        <div key={i} className="anim-fade">
          <div className="text-[11.5px] font-medium tracking-wide text-brand-text">
            {i + 1} / {GUIDE_STEPS.length}
          </div>
          <h3 className="mt-1.5 font-serif text-[17px] font-semibold text-text">{step.title}</h3>
          <p className="mt-2 text-[13px] leading-relaxed text-text-2">{step.text}</p>
          {step.keys && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {step.keys.map((k) => (
                <span key={k} className="rounded-md border border-border bg-surface-2/60 px-2 py-0.5 font-mono text-[11.5px] text-text-2">
                  {k}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="mt-5 flex items-center gap-2">
          <div className="flex flex-1 items-center gap-1.5" aria-hidden>
            {GUIDE_STEPS.map((_, n) => (
              <span key={n} className={'h-1.5 rounded-full transition-[width,background-color] duration-[180ms] ' + (n === i ? 'w-4 bg-brand' : 'w-1.5 bg-border-strong')} />
            ))}
          </div>
          {!last && (
            <button className="btn btn-ghost h-8 px-2.5 text-[12.5px] text-text-3" onClick={onFinish}>
              跳过
            </button>
          )}
          {i > 0 && (
            <button className="btn btn-secondary size-8 p-0" aria-label="上一步" onClick={prev}>
              <ArrowLeft size={14} />
            </button>
          )}
          <button autoFocus className="btn btn-primary h-8 gap-1.5 px-3.5 text-[13px]" onClick={next}>
            {last ? '开始使用' : '下一步'}
            {!last && <ArrowRight size={14} />}
          </button>
        </div>
      </div>
    </div>
  )
}
