import { useEffect, useState } from 'react'
import type { Assistant } from '../../shared/assistant'
import type { KnowledgeBase } from '../../shared/knowledge'

export function useKnowledge(): KnowledgeBase[] {
  const [list, setList] = useState<KnowledgeBase[]>([])
  useEffect(() => {
    void window.ccshell.knowledge.list().then((r) => r.ok && setList(r.data))
    return window.ccshell.knowledge.onChanged(setList)
  }, [])
  return list
}

export function useAssistants(): Assistant[] {
  const [list, setList] = useState<Assistant[]>([])
  useEffect(() => {
    void window.ccshell.assistant.list().then((r) => r.ok && setList(r.data))
    return window.ccshell.assistant.onChanged(setList)
  }, [])
  return list
}

export const shortPath = (p: string) => {
  const parts = p.split(/[\\/]/).filter(Boolean)
  return parts.length > 2 ? '…\\' + parts.slice(-2).join('\\') : p
}
