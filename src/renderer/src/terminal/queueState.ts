import { useEffect, useState } from 'react'
import type { PromptItem } from '../../../shared/prompts'
import { emptyQueue, type QueueItemStatus, type QueueMap, type SessionQueue } from '../../../shared/queue'

export function useQueues(): QueueMap {
  const [map, setMap] = useState<QueueMap>({})
  useEffect(() => {
    void window.ccshell.queue.all().then((r) => r.ok && setMap(Object.fromEntries(r.data.map((q) => [q.sessionId, q]))))
    return window.ccshell.queue.onChanged((q) => setMap((m) => ({ ...m, [q.sessionId]: q })))
  }, [])
  return map
}

export const queueOf = (map: QueueMap, id: string): SessionQueue => map[id] ?? emptyQueue(id)

export const pendingCount = (q: SessionQueue) => q.items.filter((x) => x.status === 'pending' || x.status === 'waiting' || x.status === 'sending' || x.status === 'running').length

export function usePrompts(): PromptItem[] {
  const [list, setList] = useState<PromptItem[]>([])
  useEffect(() => {
    void window.ccshell.prompts.list().then((r) => r.ok && setList(r.data))
    return window.ccshell.prompts.onChanged(setList)
  }, [])
  return list
}

export const STATUS_TEXT: Record<QueueItemStatus, string> = {
  pending: '待发送',
  sending: '发送中',
  running: '处理中',
  waiting: '等待中',
  done: '完成',
  failed: '失败',
  skipped: '已中断'
}

export const STATUS_STYLE: Record<QueueItemStatus, string> = {
  pending: 'text-text-3',
  sending: 'text-[#5b8fd1]',
  running: 'text-[#5b8fd1]',
  waiting: 'text-warning',
  done: 'text-success',
  failed: 'text-danger',
  skipped: 'text-warning'
}

export const hm = (t: number) => new Date(t).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
