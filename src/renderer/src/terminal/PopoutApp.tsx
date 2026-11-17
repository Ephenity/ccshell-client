import { confirmDialog } from '../components/Dialog'
import { useEffect, useState } from 'react'
import type { TerminalSession } from '../../../shared/terminal'
import { useTheme } from '../theme'
import { SessionView } from '../views/TerminalPage'
import { queueOf, useQueues } from './queueState'
import { setTerminalTheme } from './xterm'

export function PopoutApp({ id }: { id: string }) {
  const [sessions, setSessions] = useState<TerminalSession[] | null>(null)
  const [favorites, setFavorites] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const queues = useQueues()
  const { theme } = useTheme()

  useEffect(() => setTerminalTheme(theme), [theme])
  useEffect(() => {
    const loadFav = () => void window.ccshell.terminal.info().then((r) => r.ok && setFavorites(r.data.favorites.map((f) => f.conversationId)))
    void window.ccshell.terminal.list().then((r) => r.ok && setSessions(r.data))
    loadFav()
    return window.ccshell.terminal.onList((list) => {
      setSessions(list)
      loadFav()
    })
  }, [])

  const s = sessions?.find((x) => x.id === id)
  useEffect(() => {
    if (s) document.title = `${s.title} — CC Shell`
  }, [s?.title])

  const run = async (p: Promise<{ ok: true } | { ok: false; error: string }>) => {
    setError(null)
    const r = await p
    if (!r.ok) setError(r.error)
  }

  if (!sessions) return null
  if (!s)
    return (
      <div className="flex h-full items-center justify-center bg-bg-raised text-[13px] text-text-2">
        该会话已从列表移除。
        <button className="btn btn-secondary ml-3 h-8 px-3" onClick={() => window.close()}>
          关闭窗口
        </button>
      </div>
    )
  const favorite = !!s.conversationId && favorites.includes(s.conversationId)
  return (
    <div className="flex h-full flex-col bg-bg-raised">
      {error && (
        <div className="flex items-center gap-2 border-b border-border bg-danger/10 px-4 py-1.5 text-xs text-danger">
          <span className="flex-1">{error}</span>
          <button onClick={() => setError(null)}>关闭</button>
        </div>
      )}
      <SessionView
        inPopout
        session={s}
        queue={queueOf(queues, id)}
        visible
        favorite={favorite}
        onRestart={() => void run(window.ccshell.terminal.restart(id))}
        onEnd={async () => {
          if (await confirmDialog({ title: `结束“${s.title}”`, message: '对话记录将保留，可随时重新启动。', confirmText: '结束' })) void run(window.ccshell.terminal.end(id))
        }}
        onDetach={() => void run(window.ccshell.terminal.detach(id))}
        onReclaim={() => void run(window.ccshell.terminal.reclaim(id))}
        onPopout={() => undefined}
        onPopoutClose={() => window.close()}
        onRename={(t) => void run(window.ccshell.terminal.rename(id, t))}
        onFavorite={(on) => void run(window.ccshell.terminal.favorite({ sessionId: id }, on))}
        onOpenPrompts={() => void window.ccshell.terminal.focusMain()}
        onOpenSession={(other) => window.ccshell.float.openSession(other)}
      />
    </div>
  )
}
