export const PEER_SERVER = 'ccshell'
export const PEER_TOOLS = ['sessions_list', 'session_read', 'session_send', 'session_start'] as const
export type PeerTool = (typeof PEER_TOOLS)[number]
export const PEER_READONLY: PeerTool[] = ['sessions_list']
export const peerToolName = (t: PeerTool) => `mcp__${PEER_SERVER}__${t}`

export const PEER_LIMITS = {
  maxText: 12_000,
  sendsPerHour: 40,
  pairPer10Min: 12,
  startsPerHour: 4,
  maxRunning: 12,
  maxRead: 24_000
} as const

export type PeerMode = 'queue' | 'now' | 'interrupt'

export interface PeerEntry {
  id: string
  at: number
  kind: 'send' | 'start' | 'read'
  from: string
  fromTitle: string
  to: string
  toTitle: string
  mode?: PeerMode
  text?: string
  ok: boolean
  error?: string
  delivery?: string
}

export interface OpenedBy {
  id: string
  title: string
}

export const CHAT_PEER_PREFIX = 'chat:'
export const isChatPeer = (id: string) => id.startsWith(CHAT_PEER_PREFIX)
