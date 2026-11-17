import { BrowserWindow, dialog, ipcMain } from 'electron'
import type { AgentToolName, AssistantInput } from '../shared/assistant'
import type { Result } from '../shared/ccshell'
import type { KnowledgeBase } from '../shared/knowledge'
import type { AgentService } from './agent/service'
import type { AssistantStore } from './assistant/store'
import type { ChatService } from './chat/service'
import type { KnowledgeService } from './knowledge/service'

function handle<A extends unknown[], T>(channel: string, fn: (event: Electron.IpcMainInvokeEvent, ...args: A) => Promise<T> | T) {
  ipcMain.handle(channel, async (event, ...args): Promise<Result<T>> => {
    try {
      return { ok: true, data: await fn(event, ...(args as A)) }
    } catch (e) {
      return { ok: false, error: (e as Error).message || '操作失败' }
    }
  })
}

const broadcast = (channel: string, payload: unknown) => {
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send(channel, payload)
}

async function pick(e: Electron.IpcMainInvokeEvent, opts: Electron.OpenDialogOptions): Promise<string[]> {
  const win = BrowserWindow.fromWebContents(e.sender)
  const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
  return r.canceled ? [] : r.filePaths
}

export function registerStage6Ipc(knowledge: KnowledgeService, assistants: AssistantStore, agent: AgentService, chat: ChatService): void {
  type BaseInput = Pick<KnowledgeBase, 'name' | 'description' | 'embeddingModel'>
  handle('kb:list', () => knowledge.list())
  handle('kb:create', (_e, input: BaseInput) => knowledge.create(input))
  handle('kb:update', (_e, id: string, patch: Partial<BaseInput>) => knowledge.update(id, patch))
  handle('kb:remove', (_e, id: string) => knowledge.remove(id))
  handle('kb:add-paths', (_e, id: string, paths: string[]) => knowledge.addPaths(id, paths))
  handle('kb:add-url', (_e, id: string, url: string) => knowledge.addUrl(id, url))
  handle('kb:pick-files', async (e, id: string) => {
    const paths = await pick(e, {
      title: '添加文件到知识库',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: '文本、Markdown、代码、PDF、Word', extensions: ['txt', 'md', 'pdf', 'docx', 'html', 'csv', 'json', '*'] }]
    })
    return knowledge.addPaths(id, paths)
  })
  handle('kb:pick-folder', async (e, id: string) => knowledge.addPaths(id, await pick(e, { title: '添加文件夹到知识库', properties: ['openDirectory'] })))
  handle('kb:remove-item', (_e, id: string, itemId: string) => knowledge.removeItem(id, itemId))
  handle('kb:refresh-item', (_e, id: string, itemId: string) => knowledge.refreshItem(id, itemId))
  handle('kb:search', (_e, ids: string[], query: string) => knowledge.search(ids, query, 8))
  knowledge.on('changed', (list) => broadcast('kb:changed', list))

  handle('assistant:list', () => assistants.list())
  handle('assistant:create', (_e, input: AssistantInput) => assistants.create(input))
  handle('assistant:update', (_e, id: string, input: AssistantInput) => assistants.update(id, input))
  handle('assistant:remove', (_e, id: string) => assistants.remove(id))
  handle('assistant:start', (_e, id: string) => {
    const a = assistants.get(id)
    const conv = chat.create()
    return chat.updateSettings(conv.id, { ...a.settings, assistantId: a.id }, false)
  })
  assistants.on('changed', (list) => broadcast('assistant:changed', list))

  handle('agent:pick-dir', async (e) => (await pick(e, { title: '选择 Agent 的工作目录', properties: ['openDirectory'] }))[0] ?? null)
  handle('agent:permissions', () => agent.alwaysAllowed())
  handle('agent:set-permissions', (_e, tools: AgentToolName[]) => agent.setAlwaysAllowed(tools))
}
