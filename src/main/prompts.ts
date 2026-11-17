import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import { sortPrompts, type PromptItem, type PromptPatch } from '../shared/prompts'
import { log } from './log'

export class PromptStore extends EventEmitter<{ changed: [PromptItem[]] }> {
  private cache: PromptItem[] | null = null
  constructor(private readonly file = join(app.getPath('userData'), 'prompts.json')) {
    super()
  }

  list(): PromptItem[] {
    if (this.cache) return sortPrompts(this.cache)
    let items: PromptItem[] = []
    if (existsSync(this.file)) {
      try {
        const raw = JSON.parse(readFileSync(this.file, 'utf8')) as { prompts?: PromptItem[] }
        if (!Array.isArray(raw.prompts)) throw new Error('格式不对')
        items = raw.prompts.filter((p) => p && typeof p.id === 'string' && typeof p.text === 'string')
      } catch (e) {
        const stamp = new Date().toISOString().replace(/[:.]/g, '-')
        try {
          renameSync(this.file, `${this.file}.broken-${stamp}`)
        } catch {
        }
        log('提示词', `prompts.json 读不出来（${(e as Error).message}），已另存为 .broken-${stamp}，从空库开始`)
      }
    }
    this.cache = items
    return sortPrompts(items)
  }

  get(id: string): PromptItem {
    const p = this.list().find((x) => x.id === id)
    if (!p) throw new Error('提示词不存在')
    return p
  }

  private write(items: PromptItem[]): void {
    this.cache = items
    writeFileSync(this.file + '.tmp', JSON.stringify({ prompts: items }, null, 2))
    renameSync(this.file + '.tmp', this.file)
    this.emit('changed', sortPrompts(items))
  }

  create(patch: PromptPatch = {}): PromptItem {
    const now = Date.now()
    const p: PromptItem = { id: randomUUID(), title: patch.title ?? '', text: patch.text ?? '', pinned: !!patch.pinned, createdAt: now, updatedAt: now, useCount: 0 }
    this.write([...this.list(), p])
    return p
  }

  update(id: string, patch: PromptPatch): PromptItem {
    const items = this.list()
    const i = items.findIndex((x) => x.id === id)
    if (i < 0) throw new Error('提示词不存在')
    const next = { ...items[i], ...patch, updatedAt: Date.now() }
    items[i] = next
    this.write(items)
    return next
  }

  duplicate(id: string): PromptItem {
    const src = this.get(id)
    return this.create({ title: src.title ? `${src.title}（副本）` : '', text: src.text })
  }

  remove(id: string): void {
    this.write(this.list().filter((x) => x.id !== id))
  }

  touch(id: string): void {
    const items = this.list()
    const p = items.find((x) => x.id === id)
    if (!p) return
    p.usedAt = Date.now()
    p.useCount++
    this.write(items)
  }
}
