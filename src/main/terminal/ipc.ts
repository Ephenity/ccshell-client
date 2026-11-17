import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { statSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import type { Result } from '../../shared/ccshell'
import type { ClaudeAccount, TerminalOptions } from '../../shared/terminal'
import { anthropicLoginDir, anthropicStatus, clearAnthropicApiKey, logoutAnthropic, setAnthropicApiKey } from '../anthropic'
import { configDir } from './claude'
import { exportMarkdown, historyItem, historyMessages } from './history'
import type { Popouts } from './popout'
import type { ClaudeInstaller } from './installer'
import type { TerminalService } from './service'
import { savePastedImage } from './pasted'

export async function openFolder(dir: unknown): Promise<void> {
  let ok = false
  try {
    ok = typeof dir === 'string' && isAbsolute(dir) && statSync(dir).isDirectory()
  } catch {
    ok = false
  }
  if (!ok) throw new Error('文件夹不存在')
  const err = await shell.openPath(dir as string)
  if (err) throw new Error(err)
}

function handle<A extends unknown[], T>(channel: string, fn: (event: Electron.IpcMainInvokeEvent, ...args: A) => Promise<T> | T) {
  ipcMain.handle(channel, async (event, ...args): Promise<Result<T>> => {
    try {
      return { ok: true, data: await fn(event, ...(args as A)) }
    } catch (e) {
      return { ok: false, error: (e as Error).message || '操作失败' }
    }
  })
}

export function registerTerminalIpc(term: TerminalService, installer: ClaudeInstaller, popouts: Popouts): void {
  handle('term:info', () => term.info())
  handle('term:list', () => term.list())
  handle('term:buffer', (_e, id: string) => term.buffer(id))
  handle('term:create', (_e, options: TerminalOptions) => term.create(options))
  handle('term:restart', (_e, id: string) => term.restart(id))
  handle('term:rename', (_e, id: string, title: string) => term.rename(id, title))
  handle('term:end', (_e, id: string) => term.end(id))
  handle('term:remove', (_e, id: string) => term.remove(id))
  handle('term:detach', (_e, id: string) => term.detach(id))
  handle('term:reclaim', (_e, id: string) => term.reclaim(id))
  handle('term:popout', (_e, id: string) => popouts.open(id))
  handle('term:popout-close', (_e, id: string) => popouts.close(id))
  handle('term:focus-main', () => popouts.focusMain())
  handle('term:clear-exited', () => term.clearExited())
  handle('term:pin-dir', (_e, dir: string, pinned: boolean) => term.pinDir(dir, pinned))
  handle('term:forget-dir', (_e, dir: string) => term.forgetDir(dir))
  handle('term:open-dir', (_e, dir: string) => openFolder(dir))
  handle('term:favorite', (_e, target: { sessionId?: string; conversationId?: string }, on: boolean) => term.setFavorite(target, on))
  handle('term:history', () => term.history())
  handle('term:save-pasted-image', (_e, data: Uint8Array, mediaType: string) => savePastedImage(data, mediaType))
  handle('term:history-messages', (_e, id: string) => historyMessages(id))
  handle('term:history-delete', (_e, id: string) => term.deleteHistory(id))
  handle('term:history-export', async (e, id: string) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const name = (historyItem(id)?.title ?? id).replace(/[\\/:*?"<>|\r\n]+/g, ' ').trim().slice(0, 60) || id
    const opts: Electron.SaveDialogOptions = { title: '导出为 Markdown', defaultPath: `${name}.md`, filters: [{ name: 'Markdown', extensions: ['md'] }] }
    const r = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
    if (r.canceled || !r.filePath) return null
    exportMarkdown(id, r.filePath)
    return r.filePath
  })
  handle('cc:info', (_e, recheck?: boolean) => installer.info(!!recheck))
  handle('cc:install', () => installer.install())
  handle('cc:check-update', () => installer.checkUpdate())
  handle('cc:uninstall', () => installer.uninstall())
  handle('cc:cancel', () => installer.cancel())
  handle('term:open-config-dir', (_e, account?: ClaudeAccount) => shell.openPath(configDir(account === 'anthropic' ? 'anthropic' : 'ccshell')))
  handle('anthropic:status', () => anthropicStatus())
  handle('anthropic:set-key', (_e, key: string) => (setAnthropicApiKey(key), anthropicStatus()))
  handle('anthropic:clear-key', () => (clearAnthropicApiKey(), anthropicStatus()))
  handle('anthropic:logout', () => (logoutAnthropic(), anthropicStatus()))
  handle('anthropic:login-dir', () => anthropicLoginDir())
  handle('term:pick-dir', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const opts: Electron.OpenDialogOptions = { title: '选择工作目录', properties: ['openDirectory'] }
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    return r.canceled ? null : r.filePaths[0]
  })
  handle('term:pick-claude', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const opts: Electron.OpenDialogOptions = { title: '选择 claude.exe', properties: ['openFile'], filters: [{ name: 'Claude Code', extensions: ['exe'] }] }
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    return r.canceled ? null : r.filePaths[0]
  })
  ipcMain.on('term:write', (_e, id: string, data: string) => {
    try {
      term.write(id, data)
    } catch {
    }
  })
  ipcMain.on('term:resize', (e, id: string, cols: number, rows: number) => {
    if (!popouts.resizeAllowed(id, e.sender)) return
    try {
      term.resize(id, cols, rows)
    } catch {
    }
  })

  const broadcast = (channel: string, payload: unknown) => {
    for (const win of BrowserWindow.getAllWindows()) win.webContents.send(channel, payload)
  }
  term.on('list', (list) => broadcast('term:list-changed', list))
  term.on('data', (d) => broadcast('term:data', d))
  installer.on('changed', (info) => broadcast('cc:changed', info))
}
