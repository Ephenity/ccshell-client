import { useEffect, useState } from 'react'
import type { McpServer } from '../../../shared/mcp'

export function useMcp(): McpServer[] {
  const [list, setList] = useState<McpServer[]>([])
  useEffect(() => {
    void window.ccshell.mcp.list().then((r) => r.ok && setList(r.data))
    return window.ccshell.mcp.onChanged(setList)
  }, [])
  return list
}

export const STATUS_TEXT = { stopped: '未连接', connecting: '连接中', connected: '已连接', error: '出错' } as const
export const STATUS_DOT = {
  stopped: 'bg-text-3',
  connecting: 'bg-warning animate-pulse',
  connected: 'bg-success',
  error: 'bg-danger'
} as const
export const TRANSPORT_TEXT = { stdio: '本机命令', http: 'Streamable HTTP', sse: 'SSE' } as const
