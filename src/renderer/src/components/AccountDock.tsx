import { LogIn, Settings } from 'lucide-react'
import { formatMoney, useAccount } from '../account'
import { LogoLoader } from './LogoLoader'

export function AccountDock({ active, onClick }: { active?: boolean; onClick?: () => void }) {
  const account = useAccount()
  const name = account.user ? account.user.displayName || account.user.username : ''
  const open = onClick ?? (() => window.dispatchEvent(new CustomEvent('ccshell-go', { detail: 'account' })))
  return (
    <div className="shrink-0 border-t border-border p-2">
      <button
        data-guide="account"
        onClick={open}
        aria-current={active ? 'page' : undefined}
        title="账户与设置"
        data-tip-place="right"
        className={
          'group flex w-full items-center gap-2.5 rounded-lg border px-2 py-1.5 text-left transition-colors ' +
          (active ? 'border-border bg-surface shadow-[var(--shadow-card)]' : 'border-transparent hover:bg-surface-2')
        }
      >
        {account.restoring ? (
          <span className="flex size-8 shrink-0 items-center justify-center">
            <LogoLoader size={18} />
          </span>
        ) : name ? (
          <span
            className={
              'flex size-8 shrink-0 items-center justify-center rounded-full text-[13.5px] font-semibold transition-colors ' +
              (active ? 'bg-brand text-on-brand' : 'bg-brand-soft text-brand-text')
            }
          >
            {name.slice(0, 1).toUpperCase()}
          </span>
        ) : (
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-surface-2 text-text-3">
            <LogIn size={15} />
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium text-text">{account.restoring ? '正在恢复登录' : name || '未登录'}</span>
          <span className="block truncate text-[11.5px] text-text-3">
            {account.user ? <span className="font-mono">{formatMoney(account.balance)}</span> : account.restoring ? '' : '登录 CC Shell'}
          </span>
        </span>
        <Settings size={15} strokeWidth={1.8} className={'shrink-0 transition-colors ' + (active ? 'text-brand-text' : 'text-text-3 group-hover:text-text-2')} />
      </button>
    </div>
  )
}
