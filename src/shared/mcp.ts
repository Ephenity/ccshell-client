export type McpTransport = 'stdio' | 'http' | 'sse'

export interface McpServerConfig {
  id: string
  name: string
  transport: McpTransport
  enabled: boolean
  command: string
  args: string[]
  env: Record<string, string>
  cwd: string
  url: string
  headers: Record<string, string>
  alwaysAllow: boolean
  allowedTools: string[]
  disabledTools: string[]
  createdAt: number
}

export type McpServerInput = Omit<McpServerConfig, 'id' | 'createdAt'>

export const EMPTY_SERVER: McpServerInput = {
  name: '',
  transport: 'stdio',
  enabled: true,
  command: '',
  args: [],
  env: {},
  cwd: '',
  url: '',
  headers: {},
  alwaysAllow: false,
  allowedTools: [],
  disabledTools: []
}

export type McpStatus = 'stopped' | 'connecting' | 'connected' | 'error'

export interface McpToolInfo {
  name: string
  title?: string
  description: string
  inputSchema: Record<string, unknown>
}

export interface McpServerState {
  status: McpStatus
  error?: string
  tools: McpToolInfo[]
  transportUsed?: McpTransport
  serverInfo?: string
  log: string[]
}

export interface McpServer {
  config: McpServerConfig
  state: McpServerState
}

export interface McpImportResult {
  added: string[]
  updated: string[]
}

export type ApprovalDecision = 'allow' | 'deny' | 'always-tool' | 'always-server'
