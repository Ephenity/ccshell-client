import { BrowserWindow, dialog, ipcMain } from 'electron'
import type { Result } from '../../shared/ccshell'
import type { Attachment, ChatSettings } from '../../shared/chat'
import type { ApprovalDecision } from '../../shared/mcp'
import { saveAttachment, saveAttachmentFromPath } from './attachments'
import type { ChatService } from './service'

function handle<A extends unknown[], T>(channel: string, fn: (event: Electron.IpcMainInvokeEvent, ...args: A) => Promise<T> | T) {
  ipcMain.handle(channel, async (event, ...args): Promise<Result<T>> => {
    try {
      return { ok: true, data: await fn(event, ...(args as A)) }
    } catch (e) {
      return { ok: false, error: (e as Error).message || '操作失败' }
    }
  })
}

export function registerChatIpc(chat: ChatService): void {
  handle('chat:list', () => chat.list())
  handle('chat:get', (_e, id: string) => chat.get(id))
  handle('chat:create', () => chat.create())
  handle('chat:rename', (_e, id: string, title: string) => chat.rename(id, title))
  handle('chat:delete', (_e, id: string) => chat.delete(id))
  handle('chat:update-settings', (_e, id: string, patch: Partial<ChatSettings>) => chat.updateSettings(id, patch))
  handle('chat:models', () => chat.models())
  handle('chat:last-settings', () => chat.lastSettings())
  handle('chat:remember-settings', (_e, patch: Partial<ChatSettings>) => chat.rememberSettings(patch))
  handle('chat:send', (_e, id: string, text: string, attachments: Attachment[]) => chat.send(id, text, attachments))
  handle('chat:regenerate', (_e, id: string) => chat.regenerate(id))
  handle('chat:stop', (_e, id: string) => chat.stop(id))
  handle('chat:approve-tool', (_e, callId: string, decision: ApprovalDecision) => chat.approveTool(callId, decision))

  handle('chat:attach-data', (_e, name: string, data: Uint8Array, mediaType: string) => saveAttachment(name, data, mediaType))
  handle('chat:attach-paths', (_e, paths: string[]) => paths.map(saveAttachmentFromPath))
  handle('chat:pick-files', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const opts: Electron.OpenDialogOptions = {
      title: '添加附件',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: '图片、PDF、文本', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'pdf', 'txt', 'md', 'json', 'csv', 'log', '*'] }
      ]
    }
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    return r.canceled ? [] : r.filePaths.map(saveAttachmentFromPath)
  })

  const broadcast = (channel: string, payload: unknown) => {
    for (const win of BrowserWindow.getAllWindows()) win.webContents.send(channel, payload)
  }
  chat.on('list', (list) => broadcast('chat:list-changed', list))
  chat.on('conversation', (conv) => broadcast('chat:conversation-changed', conv))
  chat.on('delta', (delta) => broadcast('chat:delta', delta))
}
