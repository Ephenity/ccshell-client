export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export const EFFORT_LABEL: Record<Effort, string> = { low: '低', medium: '中', high: '高', xhigh: '超高', max: '最高' }

export interface ModelCaps {
  thinking: 'always' | 'toggle' | 'budget' | 'none'
  efforts: Effort[] | null
  defaultEffort: Effort | null
  offMaxHigh: boolean
  sampling: boolean
  maxOutput: number
}

const ALL: Effort[] = ['low', 'medium', 'high', 'xhigh', 'max']

export const AUTO_OUTPUT = 32000

export function modelCaps(model: string): ModelCaps {
  const m = model.toLowerCase()
  if (!m.includes('claude')) return { thinking: 'none', efforts: null, defaultEffort: null, offMaxHigh: false, sampling: true, maxOutput: 128000 }
  const has = (re: RegExp) => re.test(m)
  const caps = (thinking: ModelCaps['thinking'], efforts: Effort[] | null, defaultEffort: Effort | null, sampling: boolean, maxOutput = 128000, offMaxHigh = false): ModelCaps => ({
    thinking,
    efforts,
    defaultEffort,
    offMaxHigh,
    sampling,
    maxOutput
  })
  if (has(/fable|mythos/)) return caps('always', ALL, 'high', false)
  if (has(/opus-5-5/)) return caps('always', ALL, 'medium', false)
  if (has(/sonnet-5-5/)) return caps('always', ALL, 'high', false)
  if (has(/haiku-5-5/)) return caps('toggle', ALL, 'medium', false, 128000, true)
  if (has(/opus-5(?!\d)/)) return caps('toggle', ALL, 'high', false, 128000, true)
  if (has(/sonnet-5(?!\d)|opus-4-[78]/)) return caps('toggle', ALL, 'high', false)
  if (has(/(opus|sonnet)-4-6/)) return caps('toggle', ['low', 'medium', 'high', 'max'], 'high', true)
  if (has(/opus-4-5/)) return caps('budget', ['low', 'medium', 'high'], 'high', true, 64000)
  if (has(/4-5|sonnet-4|opus-4|3-7/)) return caps('budget', null, null, true, has(/opus-4/) ? 32000 : 64000)
  return caps('always', null, null, false)
}

export function resolveMaxOutput(setting: number, caps: ModelCaps): number | undefined {
  if (setting <= 0 && caps.thinking === 'none') return undefined
  return Math.min(setting > 0 ? setting : AUTO_OUTPUT, caps.maxOutput)
}

export function thinkingActive(caps: ModelCaps, mode: 'off' | 'adaptive' | 'budget'): boolean {
  return caps.thinking === 'always' || (caps.thinking !== 'none' && mode !== 'off')
}

export function resolveEffort(effort: Effort | null | undefined, caps: ModelCaps, active: boolean): Effort | null {
  if (!caps.efforts || !effort || !caps.efforts.includes(effort)) return null
  if (!active && caps.offMaxHigh && (effort === 'xhigh' || effort === 'max')) return 'high'
  return effort
}
