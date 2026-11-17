import type { Money } from './ccshell'

export type UsageRange = '5h' | 'today' | '7d' | '30d'

export interface UsageRow {
  model: string
  source: 'code' | 'chat'
  requests: number
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  cost?: Money
}

export interface UsageSummary {
  range: UsageRange
  from: number
  rows: UsageRow[]
  days: { day: string; tokens: number }[]
  totalCost?: Money
  files: number
  ms: number
}

export interface CleanupItem {
  id: string
  label: string
  desc: string
  defaultOn: boolean
  daily: boolean
  count: number
  bytes: number
}

export interface CleanupResult {
  count: number
  bytes: number
  skipped: number
}

export interface EnvCheck {
  id: string
  group: '本机' | 'Claude Code' | '账号' | '客户端'
  label: string
  status: 'ok' | 'info' | 'warn' | 'error'
  detail: string
  fix?: string
}

export interface LogFileInfo {
  name: string
  about: string
  size: number
  modified: number
}
