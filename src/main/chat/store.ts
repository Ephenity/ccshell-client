import { randomUUID } from 'node:crypto'
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import { DEFAULT_SETTINGS, type ChatSettings, type Conversation } from '../../shared/chat'

export class ConversationStore {
  private readonly dir = join(app.getPath('userData'), 'chats')
  private readonly cache = new Map<string, Conversation>()
  private loaded = false

  constructor() {
    mkdirSync(this.dir, { recursive: true })
  }

  all(): Conversation[] {
    if (!this.loaded) {
      for (const name of readdirSync(this.dir)) {
        if (!name.endsWith('.json') || name === 'settings.json') continue
        try {
          const conv = JSON.parse(readFileSync(join(this.dir, name), 'utf8')) as Conversation
          conv.settings = { ...DEFAULT_SETTINGS, ...conv.settings }
          for (const m of conv.messages) {
            if (m.status === 'streaming') m.status = 'stopped'
            for (const t of m.tools ?? []) if (t.status === 'approval' || t.status === 'running') t.status = 'stopped'
          }
          this.cache.set(conv.id, conv)
        } catch {
        }
      }
      this.loaded = true
    }
    return [...this.cache.values()].sort((a, b) => b.updatedAt - a.updatedAt)
  }

  get(id: string): Conversation {
    this.all()
    const conv = this.cache.get(id)
    if (!conv) throw new Error('对话不存在或已删除')
    return conv
  }

  create(settings: ChatSettings): Conversation {
    const now = Date.now()
    const conv: Conversation = { id: randomUUID(), title: '新对话', createdAt: now, updatedAt: now, settings, messages: [] }
    this.cache.set(conv.id, conv)
    this.save(conv)
    return conv
  }

  save(conv: Conversation): void {
    const file = join(this.dir, `${conv.id}.json`)
    writeFileSync(file + '.tmp', JSON.stringify(conv))
    renameSync(file + '.tmp', file)
  }

  delete(id: string): Conversation | undefined {
    this.all()
    const conv = this.cache.get(id)
    if (!conv) return undefined
    this.cache.delete(id)
    rmSync(join(this.dir, `${id}.json`), { force: true })
    return conv
  }

  lastSettings(): ChatSettings {
    try {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(readFileSync(join(this.dir, 'settings.json'), 'utf8')) }
    } catch {
      return { ...DEFAULT_SETTINGS }
    }
  }

  rememberSettings(settings: ChatSettings): void {
    writeFileSync(join(this.dir, 'settings.json'), JSON.stringify(settings))
  }
}
