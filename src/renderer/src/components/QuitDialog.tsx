import { Check } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useDimTitleBar } from './anim'

export function QuitDialog() {
  const [ask, setAsk] = useState<{ id: string; count: number } | null>(null)
  const [remember, setRemember] = useState(false)
  const first = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (__TEST_HOOKS__) (window as unknown as { __ccshellQuitAsk?: (n: number) => void }).__ccshellQuitAsk = (n) => setAsk({ id: 'shot', count: n })
    return window.ccshell.quit.onAsk((q) => (setRemember(false), setAsk(q)))
  }, [])

  const answer = (choice: 'detach' | 'end' | null) => {
    if (!ask) return
    window.ccshell.quit.answer(ask.id, choice, choice ? remember : false)
    setAsk(null)
  }

  useEffect(() => {
    if (!ask) return
    first.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      answer(null)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [ask])

  useDimTitleBar(0.25, !!ask)
  if (!ask) return null
  return (
    <div className="dialog-backdrop fixed inset-0 z-[950] flex items-center justify-center bg-black/25 p-6 backdrop-blur-[2px]" onMouseDown={(e) => e.target === e.currentTarget && answer(null)}>
      <div role="alertdialog" aria-modal="true" aria-label="退出 CC Shell" className="dialog-card w-full max-w-[460px] rounded-lg border border-border bg-surface p-5 shadow-[0_20px_60px_#0000002e,0_2px_8px_#00000014]">
        <h2 className="text-[15px] font-semibold text-text">仍有 {ask.count} 个 Claude Code 会话在运行</h2>
        <div className="mt-3 flex flex-col gap-2.5 text-[13px] leading-relaxed text-text-2">
          <p>
            <span className="font-medium text-text">分离到终端</span>
            ：每个会话转入独立终端窗口继续运行，任务不中断；再次打开 CC Shell 时可在列表中收回。关闭终端窗口即结束该会话。
          </p>
          <p>
            <span className="font-medium text-text">全部结束</span>
            ：保留对话记录，之后可基于该对话重新启动。
          </p>
        </div>
        <button
          role="checkbox"
          aria-checked={remember}
          onClick={() => setRemember(!remember)}
          className="mt-4 flex items-center gap-2 text-[12.5px] text-text-2 hover:text-text"
        >
          <span
            className={
              'flex size-4 items-center justify-center rounded-[4px] border transition-colors duration-100 ' +
              (remember ? 'border-brand bg-brand text-white' : 'border-border-strong bg-bg-raised')
            }
          >
            {remember && <Check size={11} strokeWidth={3} />}
          </span>
          不再询问（可在 设置 › 外观与启动 中修改）
        </button>
        <div className="mt-5 flex justify-end gap-2">
          <button className="btn btn-secondary h-8 px-4 text-[13px]" onClick={() => answer(null)}>
            取消
          </button>
          <button className="btn btn-secondary h-8 px-4 text-[13px]" onClick={() => answer('end')}>
            全部结束
          </button>
          <button ref={first} className="btn btn-primary h-8 px-4 text-[13px]" onClick={() => answer('detach')}>
            分离到终端继续运行
          </button>
        </div>
      </div>
    </div>
  )
}
