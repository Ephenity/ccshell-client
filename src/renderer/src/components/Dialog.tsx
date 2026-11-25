import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { useDimTitleBar } from './anim'

export interface ConfirmOptions {
  title: string
  message?: string
  confirmText?: string
  cancelText?: string
  danger?: boolean
  option?: { label: string; defaultChecked?: boolean }
}

export function confirmDialog(opts: ConfirmOptions): Promise<boolean> {
  return confirmOption(opts).then((r) => r.ok)
}

export function confirmOption(opts: ConfirmOptions): Promise<{ ok: boolean; checked: boolean }> {
  return new Promise((resolve) => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    const prevFocus = document.activeElement as HTMLElement | null
    const close = (v: boolean, checked = false) => {
      root.unmount()
      host.remove()
      prevFocus?.focus?.()
      resolve({ ok: v, checked })
    }
    root.render(<ConfirmBox {...opts} onClose={close} />)
  })
}

function ConfirmBox({ title, message, confirmText = '确定', cancelText = '取消', danger, option, onClose }: ConfirmOptions & { onClose: (v: boolean, checked?: boolean) => void }) {
  useDimTitleBar(0.25)
  const ok = useRef<HTMLButtonElement>(null)
  const [checked, setChecked] = useState(!!option?.defaultChecked)
  useEffect(() => {
    ok.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onClose(false)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])
  return (
    <div className="dialog-backdrop fixed inset-0 z-[900] flex items-center justify-center bg-black/25 p-6 backdrop-blur-[2px]" onMouseDown={(e) => e.target === e.currentTarget && onClose(false)}>
      <div role="alertdialog" aria-modal="true" aria-label={title} className="dialog-card w-full max-w-[400px] rounded-lg border border-border bg-surface p-5 shadow-[0_20px_60px_#0000002e,0_2px_8px_#00000014]">
        <h2 className="text-[15px] font-semibold text-text">{title}</h2>
        {message && <p className="mt-2 text-[13px] leading-relaxed whitespace-pre-line text-text-2">{message}</p>}
        {option && (
          <label className="mt-3 flex items-start gap-2 text-[13px] text-text-2">
            <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} className="mt-0.5 accent-[var(--brand)]" />
            <span>{option.label}</span>
          </label>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button className="btn btn-secondary h-8 px-4 text-[13px]" onClick={() => onClose(false)}>
            {cancelText}
          </button>
          <button ref={ok} className={'btn h-8 px-4 text-[13px] ' + (danger ? 'btn-danger' : 'btn-primary')} onClick={() => onClose(true, checked)}>
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  )
}
