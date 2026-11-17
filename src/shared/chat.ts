import type { Money } from './ccshell'

export type Protocol = 'anthropic' | 'openai'

export interface ModelPrice {
  symbol: string
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  perRequest?: number
  tiered: boolean
}

export interface ModelInfo {
  id: string
  protocol: Protocol
  embedding: boolean
  price: ModelPrice | null
}

export type ThinkingMode = 'off' | 'adaptive' | 'budget'
import type { Effort } from './modelCaps'

export interface ChatSettings {
  model: string
  systemPrompt: string
  temperature: number | null
  maxOutputTokens: number
  thinking: ThinkingMode
  thinkingBudget: number
  effort?: Effort | null
  mcpServers: string[]
  knowledgeBases: string[]
  workspace: string
  allowCommands: boolean
  peers?: boolean
  assistantId?: string
}

export const DEFAULT_SETTINGS: ChatSettings = {
  model: 'claude-opus-5-5',
  systemPrompt: '',
  temperature: null,
  maxOutputTokens: 0,
  thinking: 'adaptive',
  thinkingBudget: 8000,
  mcpServers: [],
  knowledgeBases: [],
  workspace: '',
  allowCommands: false
}

export type ToolCallStatus = 'approval' | 'running' | 'done' | 'error' | 'denied' | 'stopped'

export interface ToolCallRecord {
  id: string
  name: string
  serverId: string
  serverName: string
  tool: string
  input: unknown
  output?: string
  status: ToolCallStatus
  at: number
  durationMs?: number
}

export type AttachmentKind = 'image' | 'pdf' | 'text'

export interface Attachment {
  id: string
  name: string
  mediaType: string
  size: number
  kind: AttachmentKind
}

export interface TokenUsage {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  reasoning: number
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  createdAt: number
  attachments?: Attachment[]
  from?: { id: string; title: string }
  reasoning?: string
  tools?: ToolCallRecord[]
  model?: string
  status?: 'streaming' | 'done' | 'stopped' | 'error'
  error?: string
  notices?: string[]
  usage?: TokenUsage
  cost?: Money
  durationMs?: number
}

export interface Conversation {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  settings: ChatSettings
  messages: ChatMessage[]
}

export interface ConversationSummary {
  id: string
  title: string
  updatedAt: number
  model: string
  streaming: boolean
}

export interface ChatDelta {
  conversationId: string
  messageId: string
  text?: string
  reasoning?: string
}

export const attachmentUrl = (id: string) => `ccfile://attachment/${encodeURIComponent(id)}`
