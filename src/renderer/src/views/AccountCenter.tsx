import { X } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { AnthropicPage } from './AnthropicPage'
import { ACCOUNT_GROUPS, type AccountPane } from '../pages'
import { AccountPage } from './AccountPage'
import { SettingsPage } from './SettingsPage'
import { ToolsPage } from './ToolsPage'
import { UsagePage } from './UsagePage'
import { UpdatePage } from './UpdatePage'
import { useDimTitleBar } from '../components/anim'

export function AccountCenter({ pane, onPane, onClose }: { pane: AccountPane; onPane: (p: AccountPane) => void; onClose: () => void }) {
  const info = ACCOUNT_GROUPS.flatMap((g) => g.items).find((i) => i.id === pane)!
  const card = useRef<HTMLDivElement>(null)
  useDimTitleBar(0.25)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      if (document.querySelector('[role=alertdialog], [role=listbox]')) return
      onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => card.current?.focus(), [])

  return (
    <div
      data-settings
      className="dialog-backdrop fixed inset-0 z-[700] flex items-center justify-center bg-black/25 p-10 backdrop-blur-[2px]"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={card}
        tabIndex={-1}
        role="dialog"
        aria-label="设置"
        className="dialog-card flex h-full max-h-[820px] w-full max-w-[1100px] overflow-hidden rounded-2xl border border-border bg-bg-raised shadow-[0_24px_80px_#00000040] outline-none"
      >
        <aside className="flex w-[232px] shrink-0 flex-col border-r border-border bg-bg" aria-label="设置分组">
          <div className="px-5 pt-5 pb-1 font-serif text-[19px] font-semibold text-text">设置</div>
          <nav className="min-h-0 flex-1 overflow-y-auto px-3 pt-2 pb-3">
            {ACCOUNT_GROUPS.map((g) => (
              <div key={g.title} className="mt-3 first:mt-1">
                <div className="px-2.5 pb-1 text-[11.5px] font-medium tracking-wide text-text-3">{g.title}</div>
                {g.items.map((it) => {
                  const Icon = it.icon
                  const active = it.id === pane
                  return (
                    <button
                      key={it.id}
                      onClick={() => onPane(it.id)}
                      aria-current={active ? 'page' : undefined}
                      className={'nav-item w-full text-left ' + (active ? 'nav-item-active' : '')}
                    >
                      <Icon size={15} strokeWidth={1.8} className={active ? '' : 'text-text-3'} />
                      {it.label}
                    </button>
                  )
                })}
              </div>
            ))}
          </nav>
        </aside>

        <section className="relative flex min-w-0 flex-1 flex-col">
          <button
            className="btn btn-ghost absolute top-3 right-3 z-10 size-8 p-0 text-text-3 hover:text-text"
            title="关闭（Esc）"
            aria-label="关闭设置"
            onClick={onClose}
          >
            <X size={17} />
          </button>
          {pane !== 'overview' && (
            <header className="shrink-0 border-b border-border">
              <div className="flex min-h-[68px] max-w-4xl items-center gap-4 py-3 pr-14 pl-8">
                <h1 key={pane} className="anim-fade min-w-0 flex-1 font-serif text-[21px] leading-tight font-semibold">{info.label}</h1>
                <div id="page-actions" key={'a-' + pane} className="anim-fade flex shrink-0 items-center gap-2" />
              </div>
            </header>
          )}
          <div key={pane} className="anim-fade min-h-0 flex-1">
            {pane === 'overview' ? (
              <AccountPage />
            ) : pane === 'usage' ? (
              <UsagePage />
            ) : pane === 'anthropic' ? (
              <AnthropicPage />
            ) : pane === 'update' ? (
              <UpdatePage />
            ) : pane === 'claude-code' || pane === 'appearance' || pane === 'notify' || pane === 'network' ? (
              <SettingsPage pane={pane} />
            ) : (
              <ToolsPage tab={pane} />
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
