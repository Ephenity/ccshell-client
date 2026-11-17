import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { AccountState, Money } from '../../shared/ccshell'

const initial: AccountState = { baseUrl: '', restoring: true, user: null, balance: null, activeKey: null }
const AccountContext = createContext<AccountState>(initial)

export function AccountProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AccountState>(initial)
  useEffect(() => {
    const off = window.ccshell.account.onChanged(setState)
    void window.ccshell.account.state().then((r) => r.ok && setState(r.data))
    return off
  }, [])
  return <AccountContext.Provider value={state}>{children}</AccountContext.Provider>
}

export const useAccount = () => useContext(AccountContext)

export function formatMoney(m: Money | null | undefined): string {
  if (!m) return '—'
  return `${m.symbol}${m.amount.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
