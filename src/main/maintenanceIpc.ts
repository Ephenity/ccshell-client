import { clipboard, ipcMain, shell } from 'electron'
import { app } from 'electron'
import type { Result } from '../shared/ccshell'
import type { UsageRange } from '../shared/maintenance'
import type { CcShellService } from './ccshell/service'
import type { ChatService } from './chat/service'
import type { Cleaner } from './cleanup'
import { envCheck, reportText } from './envcheck'
import { listLogs, readLog } from './log'
import type { ClaudeInstaller } from './terminal/installer'
import type { TerminalService } from './terminal/service'
import { usageSummary } from './usage'

function handle<A extends unknown[], T>(channel: string, fn: (...args: A) => Promise<T> | T) {
  ipcMain.handle(channel, async (_e, ...args): Promise<Result<T>> => {
    try {
      return { ok: true, data: await fn(...(args as A)) }
    } catch (e) {
      return { ok: false, error: (e as Error).message || '操作失败' }
    }
  })
}

export function registerMaintenanceIpc(d: {
  ccshell: CcShellService
  chat: ChatService
  term: TerminalService
  installer: ClaudeInstaller
  cleaner: Cleaner
  hotkeyError: () => string | null
}): void {
  handle('usage:summary', (range: UsageRange) => usageSummary(range, d.ccshell.getApiKey() ? (m, u) => d.chat.cost(m, u) : undefined))
  handle('cleanup:scan', () => d.cleaner.scan())
  handle('cleanup:run', (ids: string[]) => d.cleaner.clean(ids))
  handle('logs:list', () => listLogs())
  handle('logs:read', (name: string) => readLog(name))
  handle('logs:open-dir', () => shell.openPath(app.getPath('logs')))
  handle('env:check', () => envCheck(d))
  handle('env:copy-report', async () => {
    const text = reportText(await envCheck(d))
    clipboard.writeText(text)
    return text
  })
  handle('term:continue', (id: string) => d.term.continueNow(id))
}
