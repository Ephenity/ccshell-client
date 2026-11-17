import { BrowserWindow, ipcMain } from 'electron'
import type { Result } from '../../shared/ccshell'
import type { McpServerInput } from '../../shared/mcp'
import type { McpService } from './service'

function handle<A extends unknown[], T>(channel: string, fn: (...args: A) => Promise<T> | T) {
  ipcMain.handle(channel, async (_event, ...args): Promise<Result<T>> => {
    try {
      return { ok: true, data: await fn(...(args as A)) }
    } catch (e) {
      return { ok: false, error: (e as Error).message || '操作失败' }
    }
  })
}

export function registerMcpIpc(mcp: McpService): void {
  handle('mcp:list', () => mcp.list())
  handle('mcp:add', (input: McpServerInput) => mcp.add(input))
  handle('mcp:update', (id: string, patch: Partial<McpServerInput>) => mcp.update(id, patch))
  handle('mcp:remove', (id: string) => mcp.remove(id))
  handle('mcp:restart', (id: string) => mcp.restart(id))
  handle('mcp:import', (text: string) => mcp.importJson(text))
  handle('mcp:claude-servers', () => mcp.claudeCodeServers())
  handle('mcp:sync-claude', (ids: string[]) => mcp.syncToClaudeCode(ids))

  mcp.on('changed', (list) => {
    for (const win of BrowserWindow.getAllWindows()) win.webContents.send('mcp:changed', list)
  })
}
