import { QuitDialog } from './components/QuitDialog'
import { Announcements } from './components/Announcements'
import { UpdateDialog } from './components/UpdateDialog'
import { Intro, QUIET } from './components/Intro'
import { Onboarding } from './components/Onboarding'
import { Guide } from './components/Guide'
import { useAccount } from './account'
import { useSettings } from './terminal/state'
import { useReplay } from './components/anim'
import { useEffect, useRef, useState } from 'react'
import { Palette } from './desktop/Palette'
import { TitleBar } from './components/TitleBar'
import { TooltipLayer } from './components/TooltipLayer'
import { resolve, type AccountPane, type PageId, type Route } from './pages'
import { AccountCenter } from './views/AccountCenter'
import { ChatPage } from './views/ChatPage'
import { LibraryPage } from './views/LibraryPage'
import { TerminalPage } from './views/TerminalPage'

export function App() {
  const [route, setRoute] = useState<Route>({ module: 'chat', library: 'agent', account: 'overview' })
  const routeRef = useRef(route)
  routeRef.current = route
  const page = route.module
  const [settingsPane, setSettingsPane] = useState<AccountPane | null>(null)
  const go = (to: PageId) => {
    const next = resolve(routeRef.current, to)
    if (next.module === 'account') {
      setSettingsPane(next.account)
      return
    }
    setSettingsPane(null)
    routeRef.current = next
    setRoute(next)
  }
  const [codeMounted, setCodeMounted] = useState(false)
  const [openConv, setOpenConv] = useState<string | null>(null)
  const [codeRequest, setCodeRequest] = useState<CodeRequest | null>(null)
  const [palette, setPalette] = useState(false)
  const settings = useSettings()
  const [onboardClosed, setOnboardClosed] = useState(false)
  const onboarding = !QUIET && !!settings && !settings.appearance.onboarded && !onboardClosed
  const [guide, setGuide] = useState(false)
  const guideRef = useRef(false)
  guideRef.current = guide
  const account = useAccount()
  const finishGuide = () => {
    setGuide(false)
    go('chat')
    const key = account.user ? `${account.baseUrl}#${account.user.id}` : null
    const done = settings?.appearance.guidedUsers ?? []
    if (key && !done.includes(key)) void window.ccshell.settings.update({ appearance: { guidedUsers: [...done, key] } })
  }
  useEffect(() => {
    if (page === 'code') setCodeMounted(true)
  }, [page])

  const toCode = (r: Omit<CodeRequest, 'n'>) => {
    go('code')
    setCodeRequest({ ...r, n: Date.now() })
  }

  const openPeer = (id: string) => {
    if (id.startsWith('chat:')) {
      setOpenConv(id.slice(5))
      go('chat')
    } else toCode({ open: id })
  }
  const openConversation = (id: string) => {
    setOpenConv(id)
    go('chat')
  }

  useEffect(() => window.ccshell.ui.onOpenSession(openPeer), [])
  useEffect(() => {
    const on = (e: Event) => toCode({ open: (e as CustomEvent<string>).detail })
    const onGo = (e: Event) => go((e as CustomEvent<PageId>).detail)
    const onGuide = () => {
      setSettingsPane(null)
      go('chat')
      setGuide(true)
    }
    window.addEventListener('ccshell-open-session', on)
    window.addEventListener('ccshell-go', onGo)
    window.addEventListener('ccshell-guide', onGuide)
    return () => {
      window.removeEventListener('ccshell-open-session', on)
      window.removeEventListener('ccshell-go', onGo)
      window.removeEventListener('ccshell-guide', onGuide)
    }
  }, [])
  useEffect(() => {
    if (__TEST_HOOKS__) (window as unknown as { __ccshellGo?: (to: PageId) => void }).__ccshellGo = go
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.altKey || e.metaKey || guideRef.current) return
      const inTerminal = !!(e.target as HTMLElement | null)?.closest?.('.xterm')
      const k = e.key.toLowerCase()
      let handled = true
      if ((k === 'k' && !e.shiftKey && !inTerminal) || (k === 'p' && e.shiftKey)) setPalette((v) => !v)
      else if (k === 'n' && e.shiftKey) toCode({ open: '__new__' })
      else if (e.key === 'Tab') toCode({ delta: e.shiftKey ? -1 : 1 })
      else if (/^[1-9]$/.test(e.key) && !e.shiftKey) toCode({ index: Number(e.key) - 1 })
      else if (e.key === ',' && !e.shiftKey) go('settings')
      else handled = false
      if (handled) {
        e.preventDefault()
        e.stopPropagation()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  const codeRef = useReplay(page === 'code' ? 'code' : null, 'anim-page')

  return (
    <div className="relative flex h-full flex-col bg-bg-raised">
      <TitleBar workspace={page === 'code' ? 'code' : 'chat'} onWorkspace={go} />
      <div className="flex min-h-0 flex-1">
        <main className="min-w-0 flex-1 overflow-hidden bg-bg-raised">
          {(codeMounted || page === 'code') && (
            <div ref={codeRef} className={page === 'code' ? 'h-full' : 'hidden'}>
              <TerminalPage visible={page === 'code'} request={codeRequest} onOpenAccount={() => go('account')} onOpenPrompts={() => go('prompts')} onOpenChat={openPeer} />
            </div>
          )}
          {page === 'code' ? null : (
            <div className="anim-page h-full">
            <ChatPage
              onOpenAccount={() => go('account')}
              onOpenPage={go}
              openConversation={openConv}
              onOpened={() => setOpenConv(null)}
              onOpenPeer={openPeer}
              library={page === 'library' ? <LibraryPage tab={route.library} onTab={go} onStartConversation={openConversation} onOpenSession={openPeer} /> : undefined}
              onOpenLibrary={() => go('library')}
              onCloseLibrary={() => page === 'library' && go('chat')}
            />
            </div>
          )}
        </main>
      </div>
      <TooltipLayer />
      <Announcements />
      <UpdateDialog />
      <QuitDialog />
      {guide && <Guide onModule={go} onFinish={finishGuide} />}
      {settingsPane && <AccountCenter pane={settingsPane} onPane={go} onClose={() => setSettingsPane(null)} />}
      {onboarding && (
        <Onboarding
          onFinish={() => {
            setOnboardClosed(true)
            void window.ccshell.settings.update({ appearance: { onboarded: true } })
          }}
          onLogin={() => go('account')}
        />
      )}
      <Intro enabled={settings && !onboarding ? true : null} />
      {palette && <Palette onClose={() => setPalette(false)} onPage={go} onOpenSession={(id) => toCode({ open: id })} onPrompt={(id) => toCode({ prompt: id })} />}
    </div>
  )
}

export interface CodeRequest {
  open?: string
  prompt?: string
  delta?: number
  index?: number
  n: number
}
