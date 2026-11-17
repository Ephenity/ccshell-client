import { useEffect, useState } from 'react'
import type { AppSettings } from '../../../shared/settings'
import type { ClaudeInstallInfo, ClaudeState, TerminalSession } from '../../../shared/terminal'

export const STATE_STYLE: Record<ClaudeState, { dot: string; label: string }> = {
  starting: { dot: 'bg-text-3 animate-pulse', label: '启动中' },
  idle: { dot: 'bg-success', label: '空闲' },
  busy: { dot: 'bg-[#5b8fd1] animate-pulse', label: '处理中' },
  waiting: { dot: 'bg-warning', label: '等待确认' },
  error: { dot: 'bg-danger', label: '出错' },
  running: { dot: 'bg-success/60', label: '运行中' },
  exited: { dot: 'bg-text-3/50', label: '已结束' }
}

export function stateText(s: TerminalSession): string {
  if (s.state === 'exited') return s.restored ? '已结束（上次运行）' : s.exitCode ? `已结束（代码 ${s.exitCode}）` : '已结束'
  return STATE_STYLE[s.state].label
}

export function useInstallInfo(): [ClaudeInstallInfo | null, (recheck?: boolean) => void] {
  const [info, setInfo] = useState<ClaudeInstallInfo | null>(null)
  const load = (recheck?: boolean) => void window.ccshell.claudeCode.info(recheck).then((r) => r.ok && setInfo(r.data))
  useEffect(() => {
    load()
    return window.ccshell.claudeCode.onChanged(setInfo)
  }, [])
  return [info, load]
}

export function useSettings(): AppSettings | null {
  const [s, setS] = useState<AppSettings | null>(null)
  useEffect(() => {
    void window.ccshell.settings.get().then((r) => r.ok && setS(r.data))
    return window.ccshell.settings.onChanged(setS)
  }, [])
  return s
}

export function when(t: number): string {
  const d = Date.now() - t
  if (d < 60_000) return '刚刚'
  if (d < 3_600_000) return `${Math.floor(d / 60_000)} 分钟前`
  const date = new Date(t)
  const hm = date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
  if (new Date().toDateString() === date.toDateString()) return `今天 ${hm}`
  const md = `${date.getMonth() + 1}-${String(date.getDate()).padStart(2, '0')}`
  return date.getFullYear() === new Date().getFullYear() ? `${md} ${hm}` : `${date.getFullYear()}-${md}`
}

export const dirName = (p: string) => p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p
