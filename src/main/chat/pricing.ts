import type { Money } from '../../shared/ccshell'
import type { ModelPrice, TokenUsage } from '../../shared/chat'
import type { RawStatus } from '../ccshell/mapping'

export interface RawPricingItem {
  model_name?: string
  quota_type?: number
  model_ratio?: number
  model_price?: number
  completion_ratio?: number
  cache_ratio?: number
  create_cache_ratio?: number
  billing_mode?: string
  billing_expr?: string
  enable_groups?: string[]
}

export interface RawPricing {
  data?: RawPricingItem[]
  group_ratio?: Record<string, number>
}

interface Tier {
  maxInput?: number
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

export interface ParsedPrice {
  perRequest?: number
  tiers: Tier[]
}

const num = (v: unknown, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d)

export function parseBillingExpr(expr: string): Tier[] {
  const cond = /^\s*len\s*<=\s*(\d+)\s*\?\s*/.exec(expr)
  const tiers = [...expr.matchAll(/tier\("([^"]+)",\s*([^()]+)\)/g)]
  const shape = expr.replace(/tier\("[^"]+",\s*[^()]+\)/g, 'T').replace(/\s/g, '')
  if (cond ? shape !== `len<=${cond[1]}?T:T` || tiers.length !== 2 : shape !== 'T' || tiers.length !== 1) return []

  const result: Tier[] = []
  for (const [index, match] of tiers.entries()) {
    const terms: Record<string, number> = {}
    for (const term of match[2].split('+')) {
      const m = /^\s*(p|cr|cc|cc1h|c)\s*\*\s*(\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\s*$/.exec(term)
      if (!m || terms[m[1]] !== undefined) return []
      terms[m[1]] = Number(m[2])
    }
    if (['p', 'cr', 'cc', 'c'].some((k) => terms[k] === undefined)) return []
    result.push({
      maxInput: cond && index === 0 ? Number(cond[1]) : undefined,
      input: terms.p,
      output: terms.c,
      cacheRead: terms.cr,
      cacheWrite: terms.cc
    })
  }
  return result
}

export function parsePrice(item: RawPricingItem): ParsedPrice | null {
  if (num(item.quota_type) === 1) return { perRequest: num(item.model_price), tiers: [] }
  if (item.billing_mode === 'tiered_expr') {
    const tiers = parseBillingExpr(item.billing_expr ?? '')
    return tiers.length ? { tiers } : null
  }
  const input = num(item.model_ratio) * 2
  return {
    tiers: [
      {
        input,
        output: input * num(item.completion_ratio, 1),
        cacheRead: input * num(item.cache_ratio, 1),
        cacheWrite: input * num(item.create_cache_ratio, 1)
      }
    ]
  }
}

export function currency(status: RawStatus) {
  const t = status.quota_display_type
  const symbol = t === 'USD' ? '$' : t === 'CUSTOM' ? (status.custom_currency_symbol ?? '') : '¥'
  const rate = t === 'USD' ? 1 : t === 'CUSTOM' ? num(status.custom_currency_exchange_rate, 1) : num(status.usd_exchange_rate, 6.7)
  return { symbol, rate }
}

export function displayPrice(price: ParsedPrice, groupRatio: number, status: RawStatus): ModelPrice {
  const { symbol, rate } = currency(status)
  const k = rate * groupRatio
  const t = price.tiers[0]
  return {
    symbol,
    input: (t?.input ?? 0) * k,
    output: (t?.output ?? 0) * k,
    cacheRead: (t?.cacheRead ?? 0) * k,
    cacheWrite: (t?.cacheWrite ?? 0) * k,
    perRequest: price.perRequest !== undefined ? price.perRequest * k : undefined,
    tiered: price.tiers.length > 1
  }
}

export function estimateCost(price: ParsedPrice, usage: TokenUsage, groupRatio: number, status: RawStatus): Money {
  const { symbol, rate } = currency(status)
  if (price.perRequest !== undefined) return { symbol, amount: price.perRequest * groupRatio * rate }
  const totalInput = usage.input + usage.cacheRead + usage.cacheWrite
  const tier = price.tiers.find((t) => t.maxInput === undefined || totalInput <= t.maxInput) ?? price.tiers[0]
  const units =
    (usage.input * tier.input + usage.cacheRead * tier.cacheRead + usage.cacheWrite * tier.cacheWrite + usage.output * tier.output) /
    1_000_000
  return { symbol, amount: units * groupRatio * rate }
}
