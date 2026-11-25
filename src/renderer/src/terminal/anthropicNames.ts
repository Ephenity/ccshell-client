import { useEffect, useState } from 'react'
import { DEFAULT_ANTHROPIC_ID } from '../../../shared/anthropic'

let names: Record<string, string> = {}
let loading: Promise<void> | null = null
const listeners = new Set<() => void>()

function load(): void {
  loading ??= window.ccshell.anthropic
    .state()
    .then((r) => {
      if (r.ok) names = Object.fromEntries(r.data.accounts.map((a) => [a.id, a.name]))
    })
    .finally(() => {
      loading = null
      for (const fn of listeners) fn()
    })
}

export function reloadAnthropicNames(): void {
  load()
}

export function useAnthropicNames(): Record<string, string> {
  const [, bump] = useState(0)
  useEffect(() => {
    const fn = () => bump((n) => n + 1)
    listeners.add(fn)
    if (!Object.keys(names).length) load()
    return () => {
      listeners.delete(fn)
    }
  }, [])
  return names
}

export function anthropicLabel(map: Record<string, string>, id?: string): string {
  const ids = Object.keys(map)
  if (ids.length <= 1) return 'Anthropic'
  return `Anthropic · ${map[id ?? DEFAULT_ANTHROPIC_ID] ?? '已移除的账户'}`
}
