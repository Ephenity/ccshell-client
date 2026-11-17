import { useEffect, useState } from 'react'
import type { UpdateState } from '../../shared/update'

export function useUpdate(): UpdateState | null {
  const [s, setS] = useState<UpdateState | null>(null)
  useEffect(() => {
    let alive = true
    void window.ccshell.update.state().then((r) => alive && r.ok && setS(r.data))
    const off = window.ccshell.update.onChanged((next) => setS(next))
    return () => {
      alive = false
      off()
    }
  }, [])
  return s
}

export const fmtSize = (n?: number) => (n ? `${(n / 1048576).toFixed(0)} MB` : '')

export function busyText(s: UpdateState): string {
  const parts: string[] = []
  if (s.busy?.sessions) parts.push(`${s.busy.sessions} 个正在运行的 Claude Code 会话`)
  if (s.busy?.chats) parts.push(`${s.busy.chats} 个正在输出的对话`)
  return parts.join('和')
}

export async function startUpdate(s: UpdateState): Promise<string | null> {
  const r = s.status === 'downloaded' ? await window.ccshell.update.install() : await window.ccshell.update.download()
  return r.ok ? null : r.error
}
