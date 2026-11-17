import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { app } from 'electron'
import type { Assistant, AssistantInput } from '../../shared/assistant'
import { DEFAULT_SETTINGS } from '../../shared/chat'

export class AssistantStore extends EventEmitter<{ changed: [Assistant[]] }> {
  private readonly file = join(app.getPath('userData'), 'assistants.json')
  private items: Assistant[]

  constructor() {
    super()
    try {
      this.items = (JSON.parse(readFileSync(this.file, 'utf8')) as Assistant[]).map((a) => ({ ...a, settings: { ...DEFAULT_SETTINGS, ...a.settings } }))
    } catch {
      this.items = []
    }
  }

  list(): Assistant[] {
    return this.items
  }

  get(id: string): Assistant {
    const a = this.items.find((x) => x.id === id)
    if (!a) throw new Error('助手不存在或已删除')
    return a
  }

  create(input: AssistantInput): Assistant {
    const now = Date.now()
    const a: Assistant = { ...clean(input), id: randomUUID(), createdAt: now, updatedAt: now }
    this.items.push(a)
    this.save()
    return a
  }

  update(id: string, input: AssistantInput): Assistant {
    const a = this.get(id)
    Object.assign(a, clean(input), { updatedAt: Date.now() })
    this.save()
    return a
  }

  remove(id: string): void {
    this.items = this.items.filter((a) => a.id !== id)
    this.save()
  }

  private save(): void {
    mkdirSync(dirname(this.file), { recursive: true })
    writeFileSync(this.file + '.tmp', JSON.stringify(this.items, null, 2))
    renameSync(this.file + '.tmp', this.file)
    this.emit('changed', this.list())
  }
}

function clean(input: AssistantInput): AssistantInput {
  const name = input.name.trim()
  if (!name) throw new Error('请填写助手名称')
  const { assistantId: _, ...settings } = { ...DEFAULT_SETTINGS, ...input.settings } as typeof DEFAULT_SETTINGS & { assistantId?: string }
  return { name, icon: input.icon.trim() || name.slice(0, 1), description: input.description.trim(), settings }
}
