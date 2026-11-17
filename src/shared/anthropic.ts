export interface AnthropicStatus {
  method: 'subscription' | 'apikey'
  model: string
  loggedIn: boolean
  apiKeyHint: string | null
  configDir: string
  ready: boolean
}

export const ANTHROPIC_MODEL_ALIASES: [string, string][] = [
  ['', '默认（由 Claude Code 决定）'],
  ['opus', 'opus'],
  ['sonnet', 'sonnet'],
  ['haiku', 'haiku']
]
