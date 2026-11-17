import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useAccount } from '../account'
import { useSettings } from '../terminal/state'
import { LogoLoader } from '../components/LogoLoader'
import { AccountDashboard } from './account/AccountDashboard'
import { LoginView, preloadLoginMode } from './account/LoginView'

const WELCOME_MS = 2400
const LEAVE_MS = 220
const BYE_MS = 1100

export function AccountPage() {
  const account = useAccount()
  const sawLogin = useRef(false)
  const [welcome, setWelcome] = useState<string | null>(null)
  const user = account.user
  const [leaving, setLeaving] = useState<'out' | 'bye' | null>(null)
  const logout = () => {
    if (leaving) return
    setLeaving('out')
    setTimeout(() => {
      setLeaving('bye')
      void Promise.all([window.ccshell.account.logout(), preloadLoginMode(account.baseUrl), new Promise((r) => setTimeout(r, BYE_MS))]).finally(() => setLeaving(null))
    }, LEAVE_MS)
  }
  useLayoutEffect(() => {
    if (!user || !sawLogin.current) return
    sawLogin.current = false
    setWelcome(user.displayName || user.username)
  }, [user])
  const settings = useSettings()
  const pendingGuide = useRef(false)
  useEffect(() => {
    if (!welcome || !user) return
    pendingGuide.current = !!settings && !settings.appearance.guidedUsers.includes(`${account.baseUrl}#${user.id}`)
  }, [welcome])
  const startGuide = () => {
    if (!pendingGuide.current) return
    pendingGuide.current = false
    window.dispatchEvent(new Event('ccshell-guide'))
  }
  useEffect(() => startGuide, [])
  useEffect(() => {
    if (!welcome) return
    const t = setTimeout(() => {
      setWelcome(null)
      startGuide()
    }, WELCOME_MS)
    return () => clearTimeout(t)
  }, [welcome])

  if (account.restoring)
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4" style={{ background: 'var(--hero-glow)' }}>
        <LogoLoader size={64} state="loading" />
        <p className="anim-fade text-[13px] text-text-3">正在恢复登录</p>
      </div>
    )
  if (leaving === 'bye')
    return (
      <div className="anim-fade flex h-full flex-col items-center justify-center gap-3" style={{ background: 'var(--hero-glow)' }}>
        <LogoLoader size={64} state="idle" />
        <p className="anim-rise mt-1 text-[13px] text-text-2" style={{ animationDelay: '120ms' }}>
          已退出登录
        </p>
      </div>
    )
  if (welcome)
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3" style={{ background: 'var(--hero-glow)' }}>
        <LogoLoader size={72} state="done" />
        <h1 className="anim-rise mt-2 font-serif text-[22px] font-semibold" style={{ animationDelay: '1.5s' }}>
          登录成功
        </h1>
        <p className="anim-rise text-[13px] text-text-2" style={{ animationDelay: '1.6s' }}>
          欢迎回来，{welcome}
        </p>
      </div>
    )
  if (!user) sawLogin.current = true
  if (user)
    return (
      <div className={'h-full ' + (leaving === 'out' ? 'anim-leave' : '')}>
        <AccountDashboard onLogout={logout} />
      </div>
    )
  return (
    <div className="anim-page h-full">
      <LoginView />
    </div>
  )
}
