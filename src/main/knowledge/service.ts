import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, join, relative, sep } from 'node:path'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { embedMany } from 'ai'
import { app } from 'electron'
import type { KnowledgeBase, KnowledgeHit, KnowledgeItem, KnowledgeItemType } from '../../shared/knowledge'
import type { CcShellService } from '../ccshell/service'
import type { ChatTool } from '../chat/tools'
import { electronFetch } from '../electronFetch'
import { isSupported, readDocument, readUrl } from './readers'
import { buildBm25, chunkText, cosine, fuseRanks, searchBm25, type Bm25Index } from './search'

interface StoredChunks {
  docs: string[]
  chunks: { doc: number; text: string }[]
  model: string
  dim: number
}

interface LoadedBase {
  entries: { itemId: string; doc: string; chunk: number; text: string; vector: Float32Array | null }[]
  bm25: Bm25Index
}

const SKIP_DIRS = new Set(['node_modules', '.git', '.svn', 'dist', 'out', 'build', '.cache', '__pycache__', '.venv', 'venv'])
const MAX_FOLDER_FILES = 5000
const EMBED_BATCH = 64

export class KnowledgeService extends EventEmitter<{ changed: [KnowledgeBase[]] }> {
  private readonly root = join(app.getPath('userData'), 'knowledge')
  private readonly bases = new Map<string, KnowledgeBase>()
  private readonly loaded = new Map<string, LoadedBase>()
  private chain: Promise<void> = Promise.resolve()

  constructor(private readonly ccshell: CcShellService) {
    super()
    mkdirSync(this.root, { recursive: true })
    for (const id of readdirSync(this.root)) {
      try {
        const base = JSON.parse(readFileSync(join(this.root, id, 'base.json'), 'utf8')) as KnowledgeBase
        this.bases.set(base.id, base)
      } catch {
      }
    }
  }

  init(): void {
    for (const base of this.bases.values())
      for (const item of base.items) if (item.status === 'pending' || item.status === 'indexing') this.enqueue(base.id, item.id)
  }

  list(): KnowledgeBase[] {
    return [...this.bases.values()].sort((a, b) => a.createdAt - b.createdAt)
  }

  whenIdle(): Promise<void> {
    return this.chain
  }

  create(input: Pick<KnowledgeBase, 'name' | 'description' | 'embeddingModel'>): KnowledgeBase {
    const name = input.name.trim()
    if (!name) throw new Error('请填写知识库名称')
    const base: KnowledgeBase = { id: randomUUID(), name, description: input.description.trim(), embeddingModel: input.embeddingModel.trim(), createdAt: Date.now(), items: [] }
    mkdirSync(join(this.root, base.id, 'chunks'), { recursive: true })
    this.bases.set(base.id, base)
    this.save(base)
    return base
  }

  update(id: string, patch: Partial<Pick<KnowledgeBase, 'name' | 'description' | 'embeddingModel'>>): KnowledgeBase {
    const base = this.require(id)
    const oldModel = base.embeddingModel
    if (patch.name !== undefined) base.name = patch.name.trim() || base.name
    if (patch.description !== undefined) base.description = patch.description.trim()
    if (patch.embeddingModel !== undefined) base.embeddingModel = patch.embeddingModel.trim()
    this.save(base)
    if (base.embeddingModel !== oldModel) for (const item of base.items) this.refreshItem(id, item.id)
    return base
  }

  remove(id: string): void {
    this.require(id)
    this.bases.delete(id)
    this.loaded.delete(id)
    rmSync(join(this.root, id), { recursive: true, force: true })
    this.emitChanged()
  }

  addPaths(baseId: string, paths: string[]): KnowledgeItem[] {
    return paths.map((p) => {
      const dir = statSync(p).isDirectory()
      if (!dir && !isSupported(p)) throw new Error(`不支持的文件类型：${basename(p)}`)
      return this.addItem(baseId, dir ? 'folder' : 'file', p, basename(p))
    })
  }

  addUrl(baseId: string, url: string): KnowledgeItem {
    const u = url.trim()
    if (!/^https?:\/\/\S+$/i.test(u)) throw new Error('网址要以 http:// 或 https:// 开头')
    return this.addItem(baseId, 'url', u, u)
  }

  removeItem(baseId: string, itemId: string): void {
    const base = this.require(baseId)
    this.requireItem(baseId, itemId)
    base.items = base.items.filter((i) => i.id !== itemId)
    rmSync(this.chunkFile(baseId, itemId), { force: true })
    rmSync(this.vectorFile(baseId, itemId), { force: true })
    this.loaded.delete(baseId)
    this.save(base)
  }

  refreshItem(baseId: string, itemId: string): void {
    const item = this.requireItem(baseId, itemId)
    item.status = 'pending'
    item.error = undefined
    this.save(this.require(baseId))
    this.enqueue(baseId, itemId)
  }

  private addItem(baseId: string, type: KnowledgeItemType, source: string, name: string): KnowledgeItem {
    const base = this.require(baseId)
    const dup = base.items.find((i) => i.source === source)
    if (dup) {
      this.refreshItem(baseId, dup.id)
      return dup
    }
    const item: KnowledgeItem = { id: randomUUID().slice(0, 8), type, source, name, status: 'pending', docCount: 0, chunkCount: 0, updatedAt: Date.now() }
    base.items.push(item)
    this.save(base)
    this.enqueue(baseId, item.id)
    return item
  }

  private enqueue(baseId: string, itemId: string): void {
    this.chain = this.chain.then(() => this.index(baseId, itemId)).catch(() => {})
  }

  private async index(baseId: string, itemId: string): Promise<void> {
    const base = this.bases.get(baseId)
    const item = base?.items.find((i) => i.id === itemId)
    if (!base || !item) return
    item.status = 'indexing'
    item.skipped = undefined
    this.save(base)
    try {
      const docs: { name: string; text: string }[] = []
      const skipped: string[] = []
      if (item.type === 'file') docs.push({ name: basename(item.source), text: await readDocument(item.source) })
      else if (item.type === 'url') {
        const page = await readUrl(item.source)
        item.name = page.title
        docs.push({ name: page.title, text: page.text })
      } else {
        if (!existsSync(item.source)) throw new Error('文件夹不存在了')
        for (const file of walkSupported(item.source)) {
          const name = relative(item.source, file).split(sep).join('/')
          try {
            docs.push({ name, text: await readDocument(file) })
          } catch (e) {
            skipped.push(`${name}：${(e as Error).message}`)
          }
        }
      }
      const stored: StoredChunks = { docs: docs.map((d) => d.name), chunks: [], model: '', dim: 0 }
      docs.forEach((d, i) => {
        for (const text of chunkText(d.text)) stored.chunks.push({ doc: i, text })
      })
      if (!stored.chunks.length) throw new Error(item.type === 'folder' ? '文件夹里没有能读出文字的文件' : '没有读到文字')

      let vectors: Float32Array | null = null
      if (base.embeddingModel) {
        const embeddings = await this.embed(
          base.embeddingModel,
          stored.chunks.map((c) => `${stored.docs[c.doc]}\n${c.text}`)
        )
        stored.model = base.embeddingModel
        stored.dim = embeddings[0]?.length ?? 0
        vectors = new Float32Array(embeddings.length * stored.dim)
        embeddings.forEach((v, i) => vectors!.set(v, i * stored.dim))
      }
      if (!this.bases.has(baseId) || !base.items.includes(item)) return
      mkdirSync(join(this.root, baseId, 'chunks'), { recursive: true })
      writeAtomic(this.chunkFile(baseId, itemId), JSON.stringify(stored))
      if (vectors) {
        mkdirSync(join(this.root, baseId, 'vectors'), { recursive: true })
        writeAtomic(this.vectorFile(baseId, itemId), Buffer.from(vectors.buffer))
      } else rmSync(this.vectorFile(baseId, itemId), { force: true })
      item.status = 'ready'
      item.error = undefined
      item.docCount = docs.length
      item.chunkCount = stored.chunks.length
      if (skipped.length) item.skipped = skipped.slice(0, 100)
    } catch (e) {
      item.status = 'error'
      item.error = (e as Error).message
    }
    item.updatedAt = Date.now()
    this.loaded.delete(baseId)
    if (this.bases.has(baseId)) this.save(base)
  }

  private async embed(model: string, values: string[]): Promise<number[][]> {
    const key = this.ccshell.getApiKey()
    if (!key) throw new Error('还没有可用的密钥，生成向量需要先登录')
    const provider = createOpenAICompatible({ name: 'ccshell', baseURL: `${this.ccshell.getBaseUrl()}/v1`, apiKey: key, fetch: electronFetch })
    const out: number[][] = []
    for (let i = 0; i < values.length; i += EMBED_BATCH) {
      try {
        const r = await embedMany({ model: provider.embeddingModel(model), values: values.slice(i, i + EMBED_BATCH), maxRetries: 1 })
        out.push(...r.embeddings)
      } catch (e) {
        throw new Error(`生成向量失败（${model}）：${(e as Error).message}`)
      }
    }
    return out
  }

  async search(baseIds: string[], query: string, limit = 6): Promise<KnowledgeHit[]> {
    const q = query.trim()
    if (!q) throw new Error('搜索内容是空的')
    const queryVectors = new Map<string, number[] | null>()
    const hits: KnowledgeHit[] = []
    for (const id of baseIds) {
      const base = this.bases.get(id)
      if (!base) continue
      const idx = this.load(base)
      if (!idx.entries.length) continue
      const lists: [number, number][][] = [searchBm25(idx.bm25, q).slice(0, 30)]
      const model = base.embeddingModel
      if (model && idx.entries.some((e) => e.vector)) {
        if (!queryVectors.has(model)) queryVectors.set(model, (await this.embed(model, [q]).catch(() => [null]))[0])
        const qv = queryVectors.get(model)
        if (qv)
          lists.push(
            idx.entries
              .map((e, i): [number, number] => [i, e.vector && e.vector.length === qv.length ? cosine(e.vector, qv) : 0])
              .filter(([, s]) => s > 0.2)
              .sort((a, b) => b[1] - a[1])
              .slice(0, 30)
          )
      }
      for (const r of fuseRanks(lists)) {
        const e = idx.entries[r.id]
        hits.push({
          baseId: id,
          baseName: base.name,
          itemId: e.itemId,
          doc: e.doc,
          chunk: e.chunk,
          text: e.text,
          score: r.score,
          via: r.from.map((f) => (f === 0 ? 'keyword' : 'vector'))
        })
      }
    }
    return hits.sort((a, b) => b.score - a.score).slice(0, limit)
  }

  readAround(baseIds: string[], ref: string, before: number, after: number): string {
    const m = /^([\w-]+)#(\d+)$/.exec(ref.trim())
    if (!m) throw new Error('片段编号的格式是 条目#序号，例如 a1b2c3d4#3')
    for (const id of baseIds) {
      const base = this.bases.get(id)
      if (!base?.items.some((i) => i.id === m[1])) continue
      const idx = this.load(base)
      const own = idx.entries.filter((e) => e.itemId === m[1])
      const at = own.findIndex((e) => e.chunk === Number(m[2]))
      if (at < 0) break
      const target = own[at]
      const range = own.slice(Math.max(0, at - before), at + after + 1).filter((e) => e.doc === target.doc)
      return `《${target.doc}》（知识库 ${base.name}）\n\n` + range.map((e) => `[${e.itemId}#${e.chunk}]\n${e.text}`).join('\n\n')
    }
    throw new Error(`没有找到片段 ${ref}`)
  }

  private load(base: KnowledgeBase): LoadedBase {
    const cached = this.loaded.get(base.id)
    if (cached) return cached
    const entries: LoadedBase['entries'] = []
    for (const item of base.items) {
      if (item.status !== 'ready') continue
      let stored: StoredChunks
      try {
        stored = JSON.parse(readFileSync(this.chunkFile(base.id, item.id), 'utf8'))
      } catch {
        continue
      }
      let vec: Float32Array | null = null
      if (stored.dim && stored.model === base.embeddingModel) {
        try {
          const buf = readFileSync(this.vectorFile(base.id, item.id))
          vec = new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))
        } catch {}
      }
      stored.chunks.forEach((c, i) =>
        entries.push({ itemId: item.id, doc: stored.docs[c.doc], chunk: i, text: c.text, vector: vec ? vec.subarray(i * stored.dim, (i + 1) * stored.dim) : null })
      )
    }
    const loaded = { entries, bm25: buildBm25(entries.map((e) => `${e.doc}\n${e.text}`)) }
    this.loaded.set(base.id, loaded)
    return loaded
  }

  toolset(ids: string[]): { tools: ChatTool[]; prompt: string; missing: string[] } {
    const bases = ids.map((id) => this.bases.get(id)).filter((b): b is KnowledgeBase => !!b)
    const missing = ids.filter((id) => !this.bases.has(id)).map((id) => id.slice(0, 8))
    if (!bases.length) return { tools: [], prompt: '', missing }
    const names = bases.map((b) => b.name)
    const pick = (name: unknown) => {
      if (!name) return bases.map((b) => b.id)
      const b = bases.find((x) => x.name === String(name))
      if (!b) throw new Error(`没有叫“${name}”的知识库，可用的有：${names.join('、')}`)
      return [b.id]
    }
    const common = { serverId: 'knowledge', serverName: '知识库', needsApproval: () => false, allowAlways: () => {} }
    const tools: ChatTool[] = [
      {
        ...common,
        name: 'knowledge_search',
        tool: '搜索',
        description: `在用户的知识库里搜索相关片段（关键词${bases.some((b) => b.embeddingModel) ? ' + 语义' : ''}检索）。可用的知识库：${names.join('、')}。query 用文档里可能出现的词，搜不到时换几种说法再试。`,
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: '要搜的内容' },
            base: { type: 'string', enum: names, description: '只搜这个知识库（不填则全部）' },
            limit: { type: 'number', description: '返回几段，默认 6，最多 20' }
          },
          required: ['query']
        },
        call: async (input) => {
          const a = (input ?? {}) as { query?: string; base?: string; limit?: number }
          try {
            const hits = await this.search(pick(a.base), String(a.query ?? ''), Math.min(20, Math.max(1, Number(a.limit) || 6)))
            if (!hits.length) return { text: '没有找到相关内容。', isError: false }
            const text = hits
              .map((h, i) => `[${i + 1}] 《${h.doc}》 知识库：${h.baseName}  片段：${h.itemId}#${h.chunk}  （${h.via.map((v) => (v === 'keyword' ? '关键词' : '语义')).join('+')}）\n${h.text}`)
              .join('\n\n---\n\n')
            return { text: `找到 ${hits.length} 段：\n\n${text}`, isError: false }
          } catch (e) {
            return { text: (e as Error).message, isError: true }
          }
        }
      },
      {
        ...common,
        name: 'knowledge_read',
        tool: '读片段',
        description: '读知识库里某个片段及它前后的内容（搜索结果里的“片段”编号，如 a1b2c3d4#3），想看更完整的上下文时用。',
        inputSchema: {
          type: 'object',
          properties: {
            ref: { type: 'string', description: '片段编号，如 a1b2c3d4#3' },
            before: { type: 'number', description: '再往前读几段，默认 1' },
            after: { type: 'number', description: '再往后读几段，默认 1' }
          },
          required: ['ref']
        },
        call: async (input) => {
          const a = (input ?? {}) as { ref?: string; before?: number; after?: number }
          try {
            const n = (x: unknown) => Math.min(10, Math.max(0, x === undefined ? 1 : Number(x) || 0))
            return { text: this.readAround(bases.map((b) => b.id), String(a.ref ?? ''), n(a.before), n(a.after)), isError: false }
          } catch (e) {
            return { text: (e as Error).message, isError: true }
          }
        }
      }
    ]
    const prompt = [
      '可以用 knowledge_search 搜索用户的这些知识库：',
      ...bases.map((b) => `- ${b.name}${b.description ? `：${b.description}` : ''}`),
      '问题可能和知识库有关时先搜索；回答用到知识库内容时注明出自哪个文档。搜不到就换几个关键词再试，仍然没有就如实说明。'
    ].join('\n')
    return { tools, prompt, missing }
  }

  private chunkFile(baseId: string, itemId: string) {
    return join(this.root, baseId, 'chunks', `${itemId}.json`)
  }

  private vectorFile(baseId: string, itemId: string) {
    return join(this.root, baseId, 'vectors', `${itemId}.f32`)
  }

  private require(id: string): KnowledgeBase {
    const base = this.bases.get(id)
    if (!base) throw new Error('知识库不存在或已删除')
    return base
  }

  private requireItem(baseId: string, itemId: string): KnowledgeItem {
    const item = this.require(baseId).items.find((i) => i.id === itemId)
    if (!item) throw new Error('条目不存在或已删除')
    return item
  }

  private save(base: KnowledgeBase): void {
    mkdirSync(join(this.root, base.id), { recursive: true })
    writeAtomic(join(this.root, base.id, 'base.json'), JSON.stringify(base, null, 2))
    this.emitChanged()
  }

  private emitChanged(): void {
    this.emit('changed', this.list())
  }
}

function writeAtomic(file: string, data: string | Buffer): void {
  writeFileSync(file + '.tmp', data)
  renameSync(file + '.tmp', file)
}

function* walkSupported(dir: string, count = { n: 0 }): Generator<string> {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    if (count.n >= MAX_FOLDER_FILES) return
    const full = join(dir, e.name)
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name) && !e.name.startsWith('.')) yield* walkSupported(full, count)
    } else if (e.isFile() && isSupported(e.name)) {
      count.n++
      yield full
    }
  }
}
