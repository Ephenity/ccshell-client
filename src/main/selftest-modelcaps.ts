import { DEFAULT_SETTINGS, type ChatSettings } from '../shared/chat'
import { modelCaps } from '../shared/modelCaps'
import { requestOptions } from './chat/service'

type Check = (name: string, pass: boolean, detail?: string) => void

export function modelCapsSelfTest(check: Check): void {
  const opts = (patch: Partial<ChatSettings>) => requestOptions({ ...DEFAULT_SETTINGS, ...patch }) as {
    maxOutputTokens?: number
    temperature?: number
    providerOptions?: { anthropic: { thinking?: { type: string; budgetTokens?: number }; effort?: string } }
  }
  const j = (o: unknown) => JSON.stringify(o)

  let o = opts({ model: 'claude-opus-5-5', thinking: 'off', temperature: 0.3, effort: 'xhigh' })
  check(
    '模型能力：Opus 5.5 思考关不掉、不发温度、发强度',
    o.providerOptions?.anthropic.thinking?.type === 'adaptive' && o.temperature === undefined && o.providerOptions.anthropic.effort === 'xhigh',
    j(o)
  )
  check('模型能力：最大输出自动 = 32000', o.maxOutputTokens === 32000, j(o))

  o = opts({ model: 'claude-sonnet-5-5', effort: null })
  check('模型能力：没选强度时不发 effort', o.providerOptions?.anthropic.effort === undefined, j(o))

  o = opts({ model: 'claude-opus-5', thinking: 'off', effort: 'max' })
  check('模型能力：Opus 5 关闭思考时强度降到 high', o.providerOptions?.anthropic.thinking?.type === 'disabled' && o.providerOptions.anthropic.effort === 'high', j(o))

  o = opts({ model: 'claude-haiku-4-5', thinking: 'adaptive', thinkingBudget: 8000, effort: 'high', maxOutputTokens: 100000 })
  check(
    '模型能力：Haiku 4.5 用固定预算、不发强度、输出不超过 64000',
    o.providerOptions?.anthropic.thinking?.type === 'enabled' && o.providerOptions.anthropic.thinking.budgetTokens === 8000 && !o.providerOptions.anthropic.effort && o.maxOutputTokens === 64000,
    j(o)
  )
  o = opts({ model: 'claude-haiku-4-5', thinking: 'off', temperature: 0.3 })
  check('模型能力：旧款不思考时发温度', o.temperature === 0.3 && !o.providerOptions?.anthropic.thinking, j(o))

  o = opts({ model: 'claude-sonnet-4-6', effort: 'xhigh' })
  check('模型能力：Sonnet 4.6 不支持的强度不发', o.providerOptions?.anthropic.effort === undefined && modelCaps('claude-sonnet-4-6').efforts?.includes('max') === true, j(o))

  o = opts({ model: 'gpt-5', temperature: 0.5 })
  check('模型能力：非 Claude 模型自动时不发输出上限', o.maxOutputTokens === undefined && o.temperature === 0.5 && !o.providerOptions, j(o))

  o = opts({ model: 'claude-newmodel-9', thinking: 'off' })
  check('模型能力：认不出的 Claude 不发“关闭思考”和温度', o.providerOptions?.anthropic.thinking?.type === 'adaptive' && o.temperature === undefined, j(o))
}
