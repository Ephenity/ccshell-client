import { ResizableAside } from '../components/ResizableAside'
import { Select } from '../components/Select'
import { confirmDialog } from '../components/Dialog'
import { AlertCircle, BookOpen, FileText, Folder, Globe, LoaderCircle, Plus, RefreshCw, Search, Trash2 } from 'lucide-react'
import { useEffect, useState, type DragEvent } from 'react'
import type { ModelInfo } from '../../../shared/chat'
import type { KnowledgeBase, KnowledgeHit, KnowledgeItem } from '../../../shared/knowledge'
import { useAccount } from '../account'
import { useKnowledge } from '../stage6'
import { Card, Field, area, input } from './McpPage'

export function KnowledgePage() {
  const bases = useKnowledge()
  const [selected, setSelected] = useState<string | 'new' | null>(null)
  const current = bases.find((b) => b.id === selected) ?? null

  useEffect(() => {
    if (selected === null && bases.length) setSelected(bases[0].id)
    if (selected && selected !== 'new' && !bases.some((b) => b.id === selected)) setSelected(bases[0]?.id ?? null)
  }, [bases, selected])

  return (
    <div className="flex h-full">
      <ResizableAside id="knowledge" defaultWidth={288}>
        <div className="flex h-12 shrink-0 items-center gap-1 border-b border-border px-3">
          <h2 className="flex-1 text-[14px] font-semibold text-text">全部知识库</h2>
          <button className="btn btn-ghost h-8 px-2" title="新建知识库" onClick={() => setSelected('new')}>
            <Plus size={16} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {bases.map((b) => {
            const busy = b.items.some((i) => i.status === 'pending' || i.status === 'indexing')
            return (
              <button
                key={b.id}
                onClick={() => setSelected(b.id)}
                className={'flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left ' + (b.id === selected ? 'bg-surface-2' : 'hover:bg-surface-2/60')}
              >
                <BookOpen size={15} className="shrink-0 text-brand-text" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px]">{b.name}</span>
                  <span className="block truncate text-xs text-text-3">
                    {b.items.length} 个来源 · {b.items.reduce((n, i) => n + i.chunkCount, 0)} 段{b.embeddingModel ? ' · 向量' : ''}
                  </span>
                </span>
                {busy && <LoaderCircle size={14} className="shrink-0 animate-spin text-text-3" />}
              </button>
            )
          })}
          {selected === 'new' && (
            <div className="flex items-center gap-2.5 rounded-md bg-surface-2 px-3 py-2 text-[14px] text-text-2">
              <Plus size={14} /> 新建知识库
            </div>
          )}
        </div>
      </ResizableAside>
      <section className="min-w-0 flex-1 overflow-y-auto">
        {selected === 'new' ? (
          <BaseEditor key="new" onDone={(id) => setSelected(id)} onCancel={() => setSelected(bases[0]?.id ?? null)} />
        ) : current ? (
          <BaseDetail key={current.id} base={current} />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
            <BookOpen size={36} className="text-brand-text" />
            <h1 className="font-serif text-[22px] font-semibold">暂无知识库</h1>
            <p className="max-w-md text-text-2">可导入文档、代码、PDF、Word 与网页。在对话的“工具”中启用后，模型将按需检索。</p>
            <button className="btn btn-primary mt-2" onClick={() => setSelected('new')}>
              <Plus size={16} /> 新建知识库
            </button>
          </div>
        )}
      </section>
    </div>
  )
}

function useEmbeddingModels(): ModelInfo[] {
  const account = useAccount()
  const [models, setModels] = useState<ModelInfo[]>([])
  const keyId = account.activeKey?.id
  useEffect(() => {
    if (!keyId) return setModels([])
    void window.ccshell.chat.models().then((r) => r.ok && setModels(r.data.filter((m) => m.embedding)))
  }, [keyId])
  return models
}

function EmbeddingSelect(props: { value: string; onChange: (v: string) => void }) {
  const models = useEmbeddingModels()
  return (
    <Field label="向量检索" hint={models.length ? '选择 embedding 模型后按用量计费；更换模型将重建索引' : '当前密钥无可用的 embedding 模型，仅使用关键词检索'}>
      <Select className={input} value={props.value} onChange={(e) => props.onChange(e.target.value)}>
        <option value="">不使用（仅关键词）</option>
        {props.value && !models.some((m) => m.id === props.value) && <option value={props.value}>{props.value}（当前密钥不可用）</option>}
        {models.map((m) => (
          <option key={m.id} value={m.id}>
            {m.id}
          </option>
        ))}
      </Select>
    </Field>
  )
}

function BaseEditor(props: { base?: KnowledgeBase; onDone: (id: string) => void; onCancel: () => void }) {
  const [name, setName] = useState(props.base?.name ?? '')
  const [description, setDescription] = useState(props.base?.description ?? '')
  const [embeddingModel, setEmbeddingModel] = useState(props.base?.embeddingModel ?? '')
  const [error, setError] = useState<string | null>(null)
  const save = async () => {
    const input = { name, description, embeddingModel }
    const r = props.base ? await window.ccshell.knowledge.update(props.base.id, input) : await window.ccshell.knowledge.create(input)
    if (r.ok) props.onDone(r.data.id)
    else setError(r.error)
  }
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5 px-8 py-6">
      <h1 className="font-serif text-[22px] font-semibold">{props.base ? `设置 ${props.base.name}` : '新建知识库'}</h1>
      <Card>
        <div className="flex flex-col gap-4">
          <Field label="名称">
            <input className={input} value={name} onChange={(e) => setName(e.target.value)} placeholder="产品文档" autoFocus />
          </Field>
          <Field label="说明" hint="描述知识库内容，模型据此判断何时检索">
            <textarea className={area} rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="公司产品的使用手册和常见问题" />
          </Field>
          <EmbeddingSelect value={embeddingModel} onChange={setEmbeddingModel} />
          {error && <p className="text-[13px] text-danger">{error}</p>}
          <div className="flex justify-end gap-2">
            <button className="btn btn-secondary" onClick={props.onCancel}>
              取消
            </button>
            <button className="btn btn-primary" onClick={() => void save()}>
              保存
            </button>
          </div>
        </div>
      </Card>
    </div>
  )
}

const STATUS: Record<KnowledgeItem['status'], string> = { pending: '排队中', indexing: '正在索引', ready: '就绪', error: '失败' }
const ITEM_ICON = { file: FileText, folder: Folder, url: Globe }

function BaseDetail({ base }: { base: KnowledgeBase }) {
  const [editing, setEditing] = useState(false)
  const [url, setUrl] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<KnowledgeHit[] | null>(null)

  const run = async (p: Promise<{ ok: boolean; error?: string }>) => {
    const r = await p
    setError(r.ok ? null : (r.error ?? '操作失败'))
    return r.ok
  }
  const onDrop = async (e: DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const files = [...e.dataTransfer.files]
    if (files.length) await run(window.ccshell.knowledge.addFiles(base.id, files))
  }
  const search = async () => {
    if (!query.trim()) return
    const r = await window.ccshell.knowledge.search([base.id], query)
    if (r.ok) setHits(r.data)
    else setError(r.error)
  }

  if (editing) return <BaseEditor base={base} onDone={() => setEditing(false)} onCancel={() => setEditing(false)} />

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5 px-8 py-6">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-serif text-[22px] font-semibold">{base.name}</h1>
          <p className="mt-1 text-[13px] text-text-3">
            {base.description || '无说明'} · {base.embeddingModel ? `关键词 + 向量（${base.embeddingModel}）` : '关键词检索'}
          </p>
        </div>
        <button className="btn btn-secondary h-8 px-3 text-[13px]" onClick={() => setEditing(true)}>
          设置
        </button>
        <button
          className="btn btn-ghost h-8 px-2 hover:text-danger"
          title="删除知识库"
          onClick={async () => (await confirmDialog({ title: `删除知识库“${base.name}”`, message: '仅删除索引，原文件不受影响。', confirmText: '删除', danger: true })) && void run(window.ccshell.knowledge.remove(base.id))}
        >
          <Trash2 size={16} />
        </button>
      </div>
      {error && <p className="text-[13px] text-danger select-text">{error}</p>}

      <div
        className={'rounded-lg border bg-surface p-4 shadow-[var(--shadow-card)] transition-colors ' + (dragging ? 'border-brand' : 'border-border')}
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => void onDrop(e)}
      >
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h3 className="flex-1 text-[14px] font-semibold text-text">来源</h3>
          <button className="btn btn-secondary h-8 gap-1.5 px-3 text-[13px]" onClick={() => void run(window.ccshell.knowledge.pickFiles(base.id))}>
            <FileText size={14} /> 添加文件
          </button>
          <button className="btn btn-secondary h-8 gap-1.5 px-3 text-[13px]" onClick={() => void run(window.ccshell.knowledge.pickFolder(base.id))}>
            <Folder size={14} /> 添加文件夹
          </button>
        </div>
        <div className="mb-3 flex gap-2">
          <input className={input} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://… 网页地址" onKeyDown={(e) => e.key === 'Enter' && url.trim() && void run(window.ccshell.knowledge.addUrl(base.id, url)).then((ok) => ok && setUrl(''))} />
          <button className="btn btn-secondary h-9 shrink-0 gap-1.5 px-3 text-[13px]" disabled={!url.trim()} onClick={() => void run(window.ccshell.knowledge.addUrl(base.id, url)).then((ok) => ok && setUrl(''))}>
            <Globe size={14} /> 添加网页
          </button>
        </div>
        {!base.items.length ? (
          <p className="py-6 text-center text-[13px] text-text-3">拖放文件或文件夹至此</p>
        ) : (
          <div className="flex flex-col divide-y divide-border">
            {base.items.map((item) => (
              <ItemRow key={item.id} base={base} item={item} onError={setError} />
            ))}
          </div>
        )}
      </div>

      <Card>
        <h3 className="mb-3 text-[14px] font-semibold text-text">检索测试</h3>
        <div className="flex gap-2">
          <input className={input} value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void search()} placeholder="输入检索内容" />
          <button className="btn btn-secondary h-9 shrink-0 px-3" onClick={() => void search()} title="搜索">
            <Search size={15} />
          </button>
        </div>
        {hits && (
          <div className="mt-3 flex flex-col gap-2">
            {!hits.length && <p className="text-[13px] text-text-3">无检索结果。</p>}
            {hits.map((h, i) => (
              <div key={i} className="rounded-md border border-border bg-bg px-3 py-2">
                <div className="mb-1 flex items-center gap-2 text-xs text-text-3">
                  <span className="truncate font-mono text-text-2">{h.doc}</span>
                  <span className="shrink-0">#{h.chunk}</span>
                  <span className="flex-1" />
                  <span className="shrink-0">{h.via.map((v) => (v === 'keyword' ? '关键词' : '语义')).join(' + ')}</span>
                </div>
                <p className="line-clamp-4 text-[13px] whitespace-pre-wrap select-text">{h.text}</p>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}

function ItemRow({ base, item, onError }: { base: KnowledgeBase; item: KnowledgeItem; onError: (e: string | null) => void }) {
  const Icon = ITEM_ICON[item.type]
  const busy = item.status === 'pending' || item.status === 'indexing'
  const act = async (p: Promise<{ ok: boolean; error?: string }>) => {
    const r = await p
    onError(r.ok ? null : (r.error ?? '操作失败'))
  }
  return (
    <div className="group flex items-start gap-3 py-2.5">
      <Icon size={16} className="mt-0.5 shrink-0 text-text-3" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[14px]" title={item.source}>
          {item.name}
        </div>
        <div className="truncate text-xs text-text-3" title={item.source}>
          {item.source}
        </div>
        {item.status === 'error' && (
          <div className="mt-1 flex items-start gap-1.5 text-xs text-danger select-text">
            <AlertCircle size={13} className="mt-px shrink-0" /> {item.error}
          </div>
        )}
        {!!item.skipped?.length && (
          <details className="mt-1 text-xs text-warning">
            <summary className="cursor-pointer">已跳过 {item.skipped.length} 个无法读取的文件</summary>
            <ul className="mt-1 list-disc pl-5 text-text-3 select-text">
              {item.skipped.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          </details>
        )}
      </div>
      <span className={'shrink-0 text-xs ' + (item.status === 'error' ? 'text-danger' : busy ? 'text-warning' : 'text-text-3')}>
        {busy && <LoaderCircle size={12} className="mr-1 inline animate-spin" />}
        {item.status === 'ready' ? `${item.type === 'folder' ? `${item.docCount} 个文件 · ` : ''}${item.chunkCount} 段` : STATUS[item.status]}
      </span>
      <span className="flex shrink-0 gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
        <button className="flex size-7 items-center justify-center rounded-sm text-text-3 hover:bg-surface-2 hover:text-text" title="重新读取" disabled={busy} onClick={() => void act(window.ccshell.knowledge.refreshItem(base.id, item.id))}>
          <RefreshCw size={14} />
        </button>
        <button className="flex size-7 items-center justify-center rounded-sm text-text-3 hover:bg-surface-2 hover:text-danger" title="移除" onClick={() => void act(window.ccshell.knowledge.removeItem(base.id, item.id))}>
          <Trash2 size={14} />
        </button>
      </span>
    </div>
  )
}
