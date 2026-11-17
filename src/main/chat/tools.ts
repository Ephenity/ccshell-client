export interface ChatTool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  serverId: string
  serverName: string
  tool: string
  needsApproval(): boolean
  allowAlways(scope: 'tool' | 'server'): void
  call(input: unknown, signal: AbortSignal): Promise<{ text: string; isError: boolean }>
}

export const MAX_TOOL_RESULT = 100_000

export function capResult(text: string): string {
  return text.length > MAX_TOOL_RESULT ? text.slice(0, MAX_TOOL_RESULT) + `\n…（结果太长，已截断，原长 ${text.length} 字）` : text
}
