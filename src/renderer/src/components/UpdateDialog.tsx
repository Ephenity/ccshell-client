import { CircleArrowUp, ExternalLink } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { UpdateState } from '../../../shared/update'
import { busyText, fmtSize, startUpdate, useUpdate } from '../update'
import { useDimTitleBar } from './anim'

const date = (iso?: string) => {
  const d = iso ? new Date(iso) : null
  return d && !isNaN(+d) ? `${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日` : ''
}

export function UpdateDialog() {
  const s = useUpdate()
  const [error, setError] = useState<string | null>(null)
  const open = !!s && (s.remind || s.status === 'installing')
  const locked = s?.status === 'installing'

  const later = () => {
    if (locked) return
    setError(null)
    void window.ccshell.update.dismiss()
  }

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && later()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  useDimTitleBar(0.25, open)
  if (!s || !open) return null

  const go = async () => {
    setError(null)
    setError(await startUpdate(s))
  }
  const meta = [date(s.releaseDate), fmtSize(s.size)].filter(Boolean).join(' · ')

  return (
    <div className="dialog-backdrop fixed inset-0 z-[860] flex items-center justify-center bg-black/25 p-6 backdrop-blur-[2px]" onMouseDown={(e) => e.target === e.currentTarget && later()}>
      <div role="dialog" aria-label="发现新版本" data-update-dialog className="dialog-card flex max-h-[80vh] w-full max-w-[460px] flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-[0_20px_60px_#0000002e]">
        <header className="flex items-center gap-2.5 px-6 pt-6 pb-4">
          <span className="flex size-8 items-center justify-center rounded-full bg-brand-soft text-brand-text">
            <CircleArrowUp size={16} />
          </span>
          <h2 className="font-serif text-[18px] font-semibold">发现新版本</h2>
        </header>

        <div className="mx-6 flex items-baseline gap-2.5 border-b border-border/70 pb-3.5">
          <span className="font-mono text-[20px] leading-none font-semibold text-text">{s.latest}</span>
          <span className="rounded-full bg-surface-2 px-2 py-px text-[11.5px] text-text-2">当前 {s.current}</span>
          {meta && <span className="ml-auto text-xs text-text-3">{meta}</span>}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-3.5">
          <div className="mb-1.5 text-[11.5px] font-medium tracking-wide text-text-3">更新内容</div>
          <p className="text-[13.5px] leading-relaxed whitespace-pre-line text-text select-text">{s.notes || '暂无更新说明。'}</p>
        </div>

        <StatusLine s={s} error={error} className="mx-6 mb-3" />

        <footer className="flex items-center gap-2 border-t border-border px-6 py-4">
          {s.releaseUrl && (
            <button className="btn btn-ghost h-9 gap-1.5 px-3 text-[13px]" onClick={() => void window.ccshell.app.openExternal(s.releaseUrl!)}>
              <ExternalLink size={14} />
              发布页
            </button>
          )}
          <div className="flex-1" />
          {!locked && (
            <button className="btn btn-secondary h-9 px-4 text-[13px]" onClick={later}>
              稍后
            </button>
          )}
          <ActionButton s={s} onClick={() => void go()} className="h-9 px-5" autoFocus />
        </footer>
      </div>
    </div>
  )
}

export function StatusLine({ s, error, className = '' }: { s: UpdateState; error?: string | null; className?: string }) {
  const err = error ?? (s.status === 'error' ? s.error : null)
  if (s.status === 'downloading')
    return (
      <div className={className}>
        <div className="mb-1 flex justify-between text-xs text-text-2">
          <span>正在下载，可以先关掉这个窗口</span>
          <span className="font-mono">{s.percent ?? 0}%</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuenow={s.percent ?? 0} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full rounded-full bg-brand transition-[width] duration-300" style={{ width: `${s.percent ?? 0}%` }} />
        </div>
      </div>
    )
  if (s.status === 'downloaded') {
    const busy = busyText(s)
    return <p className={'text-xs leading-relaxed ' + (busy ? 'text-warning' : 'text-text-2') + ' ' + className}>{busy ? `已下载。重启安装会结束${busy}，对话记录会保留。` : '已下载，重启后完成更新。'}</p>
  }
  if (s.status === 'installing') return <p className={'text-xs leading-relaxed text-text-2 ' + className}>正在结束会话并重启安装，完成后客户端会自动重新打开。</p>
  if (err) return <p className={'text-xs text-danger ' + className}>{err}</p>
  return null
}

export function ActionButton({ s, onClick, className = 'h-8 px-4', autoFocus }: { s: UpdateState; onClick: () => void; className?: string; autoFocus?: boolean }) {
  const label = s.status === 'downloaded' ? '重启并更新' : s.status === 'downloading' ? '下载中' : s.status === 'installing' ? '正在重启' : s.status === 'error' ? '重试' : '更新'
  return (
    <button autoFocus={autoFocus} className={'btn btn-primary text-[13px] ' + className} disabled={s.status === 'downloading' || s.status === 'installing'} onClick={onClick}>
      {label}
    </button>
  )
}
