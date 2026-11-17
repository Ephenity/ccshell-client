export type ClaudeState = 'starting' | 'idle' | 'busy' | 'waiting' | 'error' | 'running' | 'exited'

import type { OpenedBy } from './peers'

export type ClaudeAccount = 'ccshell' | 'anthropic'

export interface TerminalSession {
  id: string
  title: string
  cwd: string
  model: string
  account?: ClaudeAccount
  createdAt: number
  status: 'running' | 'exited'
  state: ClaudeState
  stateDetail?: string
  stateAt: number
  exitCode?: number
  conversationId?: string
  restored?: boolean
  detached?: boolean
  popout?: boolean
  activity?: string
  busySince?: number
  progressAt?: number
  stuck?: boolean
  continuing?: boolean
  openedBy?: OpenedBy
}

export interface Notice {
  id: string
  kind: 'done' | 'attention' | 'problem' | 'info'
  sessionId?: string
  title: string
  body: string
  at: number
}

export interface TerminalOptions {
  cwd: string
  account?: ClaudeAccount
  model: string
  allModels: boolean
  continueLast?: boolean
  resumeId?: string
  title?: string
  openedBy?: OpenedBy
}

export interface FavoriteConversation {
  conversationId: string
  cwd: string
  title: string
  addedAt: number
}

export interface TerminalInfo {
  claudePath: string | null
  claudeSource: string
  version: string | null
  systemClaude: { path: string; source: string }[]
  configDir: string
  recentDirs: string[]
  pinnedDirs: string[]
  favorites: FavoriteConversation[]
  lastOptions: Omit<TerminalOptions, 'cwd' | 'continueLast' | 'resumeId' | 'title'>
}

export interface TerminalData {
  id: string
  data: string
}

export interface HistoryItem {
  id: string
  cwd: string
  title: string
  firstPrompt: string
  messages: number
  model: string | null
  startedAt: number
  updatedAt: number
  size: number
  account?: ClaudeAccount
  openIn?: string
}

export interface HistoryMessage {
  role: 'user' | 'assistant'
  text: string
  tools: string[]
  at: number
}

export interface ClaudeInstallInfo {
  own: { path: string; version: string | null } | null
  node: { path: string; version: string } | null
  npm: string | null
  nodeProblem: string | null
  registry: string
  running: 'install' | 'update' | 'uninstall' | 'check' | null
  latest: string | null
  checkedAt: number | null
  log: string
  error: string | null
  inUse: number
}

export const NODE_DOWNLOAD_URL = 'https://nodejs.org/zh-cn/download'
