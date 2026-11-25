import { basename } from 'node:path'
import { BrowserWindow, clipboard, ipcMain } from 'electron'
import { anthropicAccount } from './anthropic'
import type { Result } from '../shared/ccshell'
import { promptLabel, type PromptPatch, type PromptUse } from '../shared/prompts'
import { fillPlaceholders, type QueueItem } from '../shared/queue'
import type { Attachment } from '../shared/chat'
import { isChatPeer } from '../shared/peers'
import type { ChatQueue } from './chat/queue'
import type { PromptStore } from './prompts'
import type { PeerService } from './terminal/peers'
import { settings } from './settings'
import type { QueueService } from './terminal/queue'
import type { TerminalService } from './terminal/service'

function handle<A extends unknown[], T>(channel: string, fn: (...args: A) => Promise<T> | T) {
  ipcMain.handle(channel, async (_event, ...args): Promise<Result<T>> => {
    try {
      return { ok: true, data: await fn(...(args as A)) }
    } catch (e) {
      return { ok: false, error: (e as Error).message || '操作失败' }
    }
  })
}

export function registerQueueIpc(queue: QueueService, prompts: PromptStore, term: TerminalService, peers: PeerService, chatQueue: ChatQueue): void {
  const q = (id: string): QueueService | ChatQueue => (isChatPeer(id) ? chatQueue : queue)
  handle('queue:all', () => [...queue.all(), ...chatQueue.all()])
  handle('queue:add', (id: string, text: string, index?: number, attachments?: Attachment[]) => (isChatPeer(id) ? chatQueue.add(id, text, { index, attachments }) : queue.add(id, text, { index })))
  handle('queue:update', (id: string, itemId: string, text: string) => q(id).update(id, itemId, text))
  handle('queue:remove', (id: string, itemId: string) => q(id).remove(id, itemId))
  handle('queue:move', (id: string, itemId: string, delta: -1 | 1) => q(id).move(id, itemId, delta))
  handle('queue:requeue', (id: string, itemId: string) => q(id).requeue(id, itemId))
  handle('queue:clear', (id: string, what: 'finished' | 'pending' | 'all') => q(id).clear(id, what))
  handle('queue:pause', (id: string) => q(id).pause(id, '手动暂停'))
  handle('queue:resume', (id: string) => q(id).resume(id))
  handle('queue:cancel-auto', (id: string) => q(id).cancelAutoResume(id))
  handle('queue:send-next', (id: string) => q(id).sendNext(id))
  handle('queue:send-direct', (id: string, text: string) => queue.sendDirect(id, text))

  handle('prompts:list', () => prompts.list())
  handle('prompts:create', (patch?: PromptPatch) => prompts.create(patch))
  handle('prompts:update', (id: string, patch: PromptPatch) => prompts.update(id, patch))
  handle('prompts:duplicate', (id: string) => prompts.duplicate(id))
  handle('prompts:remove', (id: string) => prompts.remove(id))
  handle('prompts:use', async (promptId: string, use: PromptUse): Promise<string | null> => {
    const p = prompts.get(promptId)
    if (!p.text.trim()) throw new Error('这条提示词是空的')
    const source: QueueItem['source'] = 'prompt'
    const note = `提示词：${promptLabel(p)}`
    let result: string | null = null
    if ((use.action === 'insert' || use.action === 'queue') && isChatPeer(use.sessionId)) {
      if (use.action === 'queue') chatQueue.add(use.sessionId, p.text, { source, note })
      else result = fillPlaceholders(p.text, '{project}')
    } else if (use.action === 'insert') {
      const s = term.peek(use.sessionId)
      if (!s?.running) throw new Error('会话没有在运行')
      await term.typeText(use.sessionId, fillPlaceholders(p.text, basename(s.info.cwd)))
    } else if (use.action === 'queue') {
      queue.add(use.sessionId, p.text, { source, note })
    } else if (use.action === 'new') {
      const cc = settings.get().claudeCode
      const s =
        use.account === 'anthropic'
          ? await term.create({ cwd: use.cwd, account: 'anthropic', anthropicId: use.anthropicId, model: use.model ?? anthropicAccount(use.anthropicId).model, allModels: false, title: use.title })
          : await term.create({ cwd: use.cwd, model: use.model || cc.model, allModels: use.allModels ?? cc.allModels, title: use.title })
      queue.add(s.id, p.text, { source, note })
      result = s.id
    } else {
      const s = use.sessionId ? term.peek(use.sessionId) : null
      clipboard.writeText(fillPlaceholders(p.text, s ? basename(s.info.cwd) : '{project}'))
    }
    prompts.touch(promptId)
    return result
  })

  const broadcast = (channel: string, payload: unknown) => {
    for (const win of BrowserWindow.getAllWindows()) win.webContents.send(channel, payload)
  }
  queue.on('changed', (x) => broadcast('queue:changed', x))
  chatQueue.on('changed', (x) => broadcast('queue:changed', x))
  prompts.on('changed', (list) => broadcast('prompts:changed', list))
  peers.on('changed', (list) => broadcast('peers:changed', list))
  handle('peers:list', () => peers.list())
  handle('peers:clear', () => peers.clear())
}
