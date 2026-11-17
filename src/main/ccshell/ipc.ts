import { BrowserWindow, ipcMain, shell } from 'electron'
import type { Result } from '../../shared/ccshell'
import type { CcShellService } from './service'

const SITE_PAGES = new Set(['/wallet', '/keys', '/usage-logs', '/dashboard/overview', '/security', '/sign-up'])

function handle<A extends unknown[], T>(channel: string, fn: (event: Electron.IpcMainInvokeEvent, ...args: A) => Promise<T> | T) {
  ipcMain.handle(channel, async (event, ...args): Promise<Result<T>> => {
    try {
      return { ok: true, data: await fn(event, ...(args as A)) }
    } catch (e) {
      const err = e as { message?: string; code?: string }
      return { ok: false, error: err.message || '操作失败', code: err.code }
    }
  })
}

export function registerCcShellIpc(service: CcShellService): void {
  handle('ccshell:state', () => service.state())
  handle('ccshell:login-mode', () => service.loginMode())
  handle('ccshell:login',(_e, account: string, password: string) => service.login(account, password))
  handle('ccshell:verify', (_e, code: string) => service.verifyTwoFactor(code))
  handle('ccshell:web-login', (e) => service.webLogin(BrowserWindow.fromWebContents(e.sender)))
  handle('ccshell:logout', () => service.logout())
  handle('ccshell:set-base-url', (_e, url: string) => service.setBaseUrl(url))
  handle('ccshell:overview', () => service.overview())
  handle('ccshell:refresh-balance', () => service.refreshBalance())
  handle('ccshell:due-announcements', () => service.dueAnnouncements())
  handle('ccshell:open-home', () => shell.openExternal(service.getBaseUrl()))
  handle('ccshell:ensure-key', () => service.ensureKey())
  handle('ccshell:select-key', (_e, id: string) => service.selectKey(id))
  handle('ccshell:copy-key', () => service.copyKey())
  handle('ccshell:open-site', (_e, path: string) => {
    if (!SITE_PAGES.has(path)) throw new Error('不支持打开这个页面')
    return shell.openExternal(service.getBaseUrl() + path)
  })

  service.on('changed', (state) => {
    for (const win of BrowserWindow.getAllWindows()) win.webContents.send('ccshell:changed', state)
  })
}
