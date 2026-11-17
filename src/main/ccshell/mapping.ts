import type { AccountUser, ApiKeyInfo, KeyStatus, Money, UsageLog } from '../../shared/ccshell'

export interface RawStatus {
  quota_per_unit?: number
  quota_display_type?: 'CNY' | 'USD' | 'CUSTOM' | string
  usd_exchange_rate?: number
  custom_currency_symbol?: string
  custom_currency_exchange_rate?: number
  turnstile_check?: boolean
  announcements_enabled?: boolean
  announcements?: { id?: number; content?: string; publishDate?: string; type?: string; extra?: string }[]
}

export interface RawUser {
  id: number
  username?: string
  display_name?: string
  email?: string
  group?: string
  quota?: number
  used_quota?: number
  request_count?: number
}

export interface RawToken {
  id: number
  name?: string
  key?: string
  status?: number
  expired_time?: number
  used_quota?: number
  remain_quota?: number
  unlimited_quota?: boolean
  model_limits_enabled?: boolean
  model_limits?: string
  group?: string
  created_time?: number
  accessed_time?: number
}

export interface RawLog {
  id: number
  created_at?: number
  type?: number
  model_name?: string
  token_name?: string
  is_stream?: boolean
  prompt_tokens?: number
  completion_tokens?: number
  quota?: number
  use_time?: number
  other?: string
}

const num = (v: unknown, fallback = 0) => (Number.isFinite(Number(v)) ? Number(v) : fallback)
const str = (v: unknown) => (typeof v === 'string' ? v : '')

export function makeMoney(status: RawStatus) {
  const symbol =
    status.quota_display_type === 'USD'
      ? '$'
      : status.quota_display_type === 'CUSTOM'
        ? str(status.custom_currency_symbol)
        : '¥'
  const rate =
    status.quota_display_type === 'USD'
      ? 1
      : status.quota_display_type === 'CUSTOM'
        ? num(status.custom_currency_exchange_rate, 1)
        : num(status.usd_exchange_rate, 6.7)
  const perUnit = num(status.quota_per_unit, 500000) || 500000
  return (quota: unknown): Money => ({ amount: (num(quota) / perUnit) * rate, symbol })
}

export function mapUser(raw: RawUser): AccountUser {
  return {
    id: raw.id,
    username: str(raw.username),
    displayName: str(raw.display_name),
    email: str(raw.email),
    group: str(raw.group) || 'default'
  }
}

export function maskKey(key: string): string {
  return key ? `sk-${key.replace(/^sk-/, '')}` : '••••••••'
}

export function mapToken(raw: RawToken, money: (q: unknown) => Money): ApiKeyInfo {
  const expires = num(raw.expired_time)
  const used = num(raw.used_quota)
  const remain = num(raw.remain_quota)
  const statusCode = num(raw.status)
  const status: KeyStatus =
    statusCode === 2
      ? 'disabled'
      : statusCode === 3 || (expires > 0 && expires * 1000 < Date.now())
        ? 'expired'
        : statusCode === 4 || (!raw.unlimited_quota && remain <= 0)
          ? 'exhausted'
          : 'active'
  const created = num(raw.created_time)
  const accessed = num(raw.accessed_time)
  return {
    id: String(raw.id),
    name: str(raw.name),
    masked: maskKey(str(raw.key)),
    status,
    quota: raw.unlimited_quota ? null : money(remain + used),
    used: money(used),
    expiresAt: expires > 0 ? expires * 1000 : null,
    models: raw.model_limits_enabled ? str(raw.model_limits).split(',').filter(Boolean) : [],
    group: str(raw.group) || 'default',
    createdAt: created * 1000,
    lastUsedAt: accessed > created ? accessed * 1000 : null
  }
}

export function mapLog(raw: RawLog, money: (q: unknown) => Money): UsageLog {
  return {
    id: String(raw.id),
    time: num(raw.created_at) * 1000,
    model: str(raw.model_name),
    keyName: str(raw.token_name),
    status: num(raw.type) === 5 ? 'error' : 'success',
    stream: !!raw.is_stream,
    inputTokens: num(raw.prompt_tokens),
    outputTokens: num(raw.completion_tokens),
    cost: money(raw.quota),
    durationMs: num(raw.use_time) * 1000
  }
}

const DAY = 86_400_000
const UTC8 = 8 * 3_600_000
export const startOfDayUtc8 = (t = Date.now()) => Math.floor((t + UTC8) / DAY) * DAY - UTC8
export const DAY_MS = DAY
