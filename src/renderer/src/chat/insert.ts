import { useEffect, useState } from 'react'

const pending = new Map<string, string>()
const listeners = new Set<() => void>()

export function putChatInsert(convId: string, text: string): void {
  pending.set(convId, text)
  listeners.forEach((l) => l())
}

export function takeChatInsert(convId: string): string | null {
  const t = pending.get(convId)
  pending.delete(convId)
  return t ?? null
}

export function useChatInsert(): number {
  const [n, setN] = useState(0)
  useEffect(() => {
    const l = () => setN((x) => x + 1)
    listeners.add(l)
    return () => void listeners.delete(l)
  }, [])
  return n
}
