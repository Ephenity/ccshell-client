import { testEnv } from './testhooks'
import { app, BrowserWindow, ipcMain, Menu, shell } from 'electron'
import type { Result } from '../shared/ccshell'
import type { AppSettings, MenuItemSpec, SettingsPatch } from '../shared/settings'
import { isQuitting } from './desktop'
import { settings } from './settings'

function handle<A extends unknown[], T>(channel: string, fn: (event: Electron.IpcMainInvokeEvent, ...args: A) => Promise<T> | T) {
  ipcMain.handle(channel, async (event, ...args): Promise<Result<T>> => {
    try {
      return { ok: true, data: await fn(event, ...(args as A)) }
    } catch (e) {
      return { ok: false, error: (e as Error).message || '操作失败' }
    }
  })
}

const isSandboxProfile = () => !!(testEnv('CCSHELL_PROFILE') || testEnv('CCSHELL_SELFTEST') || testEnv('CCSHELL_SCREENSHOT'))

function applyLoginItem(s: AppSettings): void {
  if (isSandboxProfile()) return
  app.setLoginItemSettings({ openAtLogin: s.appearance.openAtLogin, path: process.execPath, args: app.isPackaged ? [] : [app.getAppPath()] })
}

export function attachCloseToTray(win: BrowserWindow): void {
  win.on('close', (e) => {
    if (!isQuitting() && settings.get().appearance.closeToTray) {
      e.preventDefault()
      win.hide()
    }
  })
}

export function registerAppShell(): void {
  handle('settings:get', () => settings.get())
  handle('settings:update', (_e, patch: SettingsPatch) => settings.update(patch))
  handle('app:open-external', (_e, url: string) => {
    if (/^https:\/\//.test(url)) return shell.openExternal(url)
  })
  handle('app:sandbox-profile', () => isSandboxProfile())
  handle('ui:context-menu', (e, items: MenuItemSpec[]) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    return new Promise<string | null>((resolve) => {
      let picked: string | null = null
      const template: Electron.MenuItemConstructorOptions[] = []
      for (const it of items) {
        if (it.separatorBefore && template.length) template.push({ type: 'separator' })
        template.push({
          label: it.label,
          enabled: it.enabled !== false,
          ...(it.checked !== undefined ? { type: 'checkbox' as const, checked: it.checked } : {}),
          click: () => (picked = it.id)
        })
      }
      Menu.buildFromTemplate(template).popup({ window: win ?? undefined, callback: () => setTimeout(() => resolve(picked), 0) })
    })
  })
  const apply = (s: AppSettings) => applyLoginItem(s)
  settings.on('changed', (s) => {
    apply(s)
    for (const w of BrowserWindow.getAllWindows()) w.webContents.send('settings:changed', s)
  })
  apply(settings.get())
}
