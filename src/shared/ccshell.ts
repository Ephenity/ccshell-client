export const DEFAULT_BASE_URL = 'https://ccshell.dev'

export type Result<T> = { ok: true; data: T } | { ok: false; error: string; code?: string }

export interface Money {
  amount: number
  symbol: string
}

export interface AccountUser {
  id: number
  username: string
  displayName: string
  email: string
  group: string
}

export interface Announcement {
  id: number
  content: string
  publishedAt: number
  type: string
  extra?: string
}

export interface AccountState {
  baseUrl: string
  restoring: boolean
  user: AccountUser | null
  balance: Money | null
  activeKey: { id: string; masked: string } | null
}

export type LoginOutcome =
  | { kind: 'done' }
  | { kind: 'two-factor'; expiresAt: number }
  | { kind: 'web-login' }

export type KeyStatus = 'active' | 'disabled' | 'expired' | 'exhausted'

export interface ApiKeyInfo {
  id: string
  name: string
  masked: string
  status: KeyStatus
  quota: Money | null
  used: Money
  expiresAt: number | null
  models: string[]
  group: string
  createdAt: number
  lastUsedAt: number | null
}

export interface UsageLog {
  id: string
  time: number
  model: string
  keyName: string
  status: 'success' | 'error'
  stream: boolean
  inputTokens: number
  outputTokens: number
  cost: Money
  durationMs: number
}

export interface AccountOverview {
  user: AccountUser
  balance: Money
  totalSpent: Money
  requestCount: number
  last30Days: { model: string; cost: Money; requests: number }[]
  keys: ApiKeyInfo[]
  recentLogs: UsageLog[]
}
