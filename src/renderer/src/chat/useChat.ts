import { useCallback, useEffect, useRef, useState } from 'react'
import type { Conversation, ConversationSummary, ModelInfo } from '../../../shared/chat'
import { useAccount } from '../account'

let lastActive: string | null = null

export function useChat() {
  const account = useAccount()
  const [list, setList] = useState<ConversationSummary[]>([])
  const [conv, setConv] = useState<Conversation | null>(null)
  const [models, setModels] = useState<ModelInfo[]>([])
  const [modelError, setModelError] = useState<string | null>(null)
  const activeId = useRef<string | null>(null)

  useEffect(() => {
    void window.ccshell.chat.list().then((r) => r.ok && setList(r.data))
    if (lastActive && !activeId.current) void select(lastActive)
    const offs = [
      window.ccshell.chat.onList(setList),
      window.ccshell.chat.onConversation((c) => {
        if (c.id === activeId.current) setConv(c)
      }),
      window.ccshell.chat.onDelta((d) => {
        if (d.conversationId !== activeId.current) return
        setConv((prev) => {
          if (!prev) return prev
          const messages = prev.messages.map((m) =>
            m.id === d.messageId
              ? { ...m, text: m.text + (d.text ?? ''), reasoning: (m.reasoning ?? '') + (d.reasoning ?? '') }
              : m
          )
          return { ...prev, messages }
        })
      })
    ]
    return () => offs.forEach((off) => off())
  }, [])

  const keyId = account.activeKey?.id
  useEffect(() => {
    if (!keyId) {
      setModels([])
      return
    }
    void window.ccshell.chat.models().then((r) => {
      if (r.ok) {
        setModels(r.data)
        setModelError(null)
      } else setModelError(r.error)
    })
  }, [keyId])

  const select = useCallback(async (id: string | null) => {
    activeId.current = id
    lastActive = id
    if (!id) return setConv(null)
    const r = await window.ccshell.chat.get(id)
    if (r.ok && activeId.current === id) setConv(r.data)
    else if (!r.ok && activeId.current === id) {
      activeId.current = lastActive = null
      setConv(null)
    }
  }, [])

  const create = useCallback(async () => {
    const r = await window.ccshell.chat.create()
    if (!r.ok) throw new Error(r.error)
    activeId.current = lastActive = r.data.id
    setConv(r.data)
    return r.data
  }, [])

  return { list, conv, setConv, models, modelError, select, create, hasKey: !!keyId }
}
