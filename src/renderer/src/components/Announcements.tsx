import { ExternalLink, Megaphone } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { Announcement } from '../../../shared/ccshell'
import { useAccount } from '../account'
import { Markdown } from '../chat/Markdown'
import { useDimTitleBar } from './anim'

const RECHECK_MS = 5 * 60_000

const TYPE: Record<string, { label: string; cls: string }> = {
  default: { label: '公告', cls: 'bg-surface-2 text-text-2' },
  ongoing: { label: '进行中', cls: 'bg-brand-soft text-brand-text' },
  success: { label: '通知', cls: 'bg-success/15 text-success' },
  warning: { label: '注意', cls: 'bg-warning/15 text-warning' },
  error: { label: '重要', cls: 'bg-danger/12 text-danger' }
}

const day = (ms: number) => (ms ? `${new Date(ms).getMonth() + 1} 月 ${new Date(ms).getDate()} 日` : '')

export function Announcements() {
  const account = useAccount()
  const userId = account.user?.id
  const [items, setItems] = useState<Announcement[] | null>(null)

  useEffect(() => {
    if (!userId) return
    let alive = true
    const check = async () => {
      while (alive && document.querySelector('[data-onboarding]')) await new Promise((res) => setTimeout(res, 1000))
      if (!alive) return
      const r = await window.ccshell.account.dueAnnouncements()
      if (!alive) return
      while (alive && document.querySelector('[data-onboarding]')) await new Promise((res) => setTimeout(res, 1000))
      if (alive && r.ok && r.data?.length) setItems(r.data)
    }
    const first = setTimeout(() => void check(), 3000)
    const t = setInterval(() => void check(), RECHECK_MS)
    return () => {
      alive = false
      clearTimeout(first)
      clearInterval(t)
    }
  }, [userId])

  useEffect(() => {
    if (!items) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setItems(null)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [items])

  useDimTitleBar(0.25, !!items)
  if (!items) return null
  return (
    <div className="dialog-backdrop fixed inset-0 z-[880] flex items-center justify-center bg-black/25 p-6 backdrop-blur-[2px]" onMouseDown={(e) => e.target === e.currentTarget && setItems(null)}>
      <div role="dialog" aria-label="官网公告" className="dialog-card flex max-h-[80vh] w-full max-w-[460px] flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-[0_20px_60px_#0000002e]">
        <header className="flex items-center gap-2.5 px-6 pt-6 pb-3">
          <span className="flex size-8 items-center justify-center rounded-full bg-brand-soft text-brand-text">
            <Megaphone size={16} />
          </span>
          <h2 className="font-serif text-[18px] font-semibold">官网公告</h2>
        </header>
        <ol className="anim-stagger min-h-0 flex-1 overflow-y-auto px-6 pb-2">
          {items.map((a, i) => {
            const t = TYPE[a.type] ?? TYPE.default
            return (
              <li key={a.id || i} style={{ ['--i' as string]: i }} className="border-t border-border/70 py-3.5 first:border-t-0">
                <div className="mb-1.5 flex items-center gap-2 text-[11.5px]">
                  <span className={'rounded-full px-2 py-px font-medium ' + t.cls}>{t.label}</span>
                  <span className="text-text-3">{day(a.publishedAt)}</span>
                </div>
                <div className="announce-body text-[13.5px] leading-relaxed text-text select-text">
                  <Markdown text={a.content} />
                </div>
                {a.extra && <p className="mt-1 text-xs text-text-3">{a.extra}</p>}
              </li>
            )
          })}
        </ol>
        <footer className="flex items-center gap-2 border-t border-border px-6 py-4">
          <button className="btn btn-ghost h-9 gap-1.5 px-3 text-[13px]" onClick={() => void window.ccshell.account.openHome()}>
            <ExternalLink size={14} />
            前往官网
          </button>
          <div className="flex-1" />
          <button autoFocus className="btn btn-primary h-9 px-5 text-[13px]" onClick={() => setItems(null)}>
            知道了
          </button>
        </footer>
      </div>
    </div>
  )
}
