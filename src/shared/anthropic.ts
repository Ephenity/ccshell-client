export const DEFAULT_ANTHROPIC_ID = 'default'

export const ANTHROPIC_MAX = 12

export interface AnthropicAccount {
  id: string
  name: string
  method: 'subscription' | 'apikey'
  model: string
  createdAt: number
}

export interface AnthropicAccountStatus extends AnthropicAccount {
  loggedIn: boolean
  apiKeyHint: string | null
  configDir: string
  ready: boolean
}

export interface AnthropicState {
  accounts: AnthropicAccountStatus[]
  currentId: string
}

export const ANTHROPIC_MODEL_ALIASES: [string, string][] = [
  ['', '默认（由 Claude Code 决定）'],
  ['opus', 'opus'],
  ['sonnet', 'sonnet'],
  ['haiku', 'haiku']
]
