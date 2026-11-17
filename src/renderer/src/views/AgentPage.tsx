import { Select } from '../components/Select'
import { confirmDialog } from '../components/Dialog'
import { Bot, FolderOpen, MessageSquarePlus, Pencil, Plus, Trash2, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { AGENT_TOOLS, type AgentToolName, type Assistant, type AssistantInput } from '../../../shared/assistant'
import { DEFAULT_SETTINGS, type ChatSettings, type ModelInfo } from '../../../shared/chat'
import { useAccount } from '../account'
import { useMcp } from '../mcp/useMcp'
import { shortPath, useAssistants, useKnowledge } from '../stage6'
import { Card, Field, area, input } from './McpPage'

export function AgentPage(props: { onStart: (conversationId: string) => void; onOpenPage: (page: 'mcp' | 'knowledge') => void }) {
  const assistants = useAssistants()
  const [editing, setEditing] = useState<Assistant | 'new' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const start = async (id: string) => {
    const r = await window.ccshell.assistant.start(id)
    if (r.ok) props.onStart(r.data.id)
    else setError(r.error)
  }

  if (editing) return <AssistantEditor assistant={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} onOpenPage={props.onOpenPage} />

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-4xl flex-col gap-5 px-8 py-6">
        <div className="flex items-center gap-3">
          <div className="flex-1">
            <h1 className="font-serif text-[22px] font-semibold">助手与 Agent</h1>
          </div>
          <button className="btn btn-primary" onClick={() => setEditing('new')}>
            <Plus size={16} /> 新建助手
          </button>
        </div>
        {error && <p className="text-[13px] text-danger">{error}</p>}

        {!assistants.length ? (
          <Card>
            <div className="flex flex-col items-center gap-2 py-8 text-center">
              <Bot size={32} className="text-brand-text" />
              <p className="text-text-2">暂无助手。可创建如“翻译”“代码审查”等助手，或为项目目录创建 Agent。</p>
            </div>
          </Card>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3">
            {assistants.map((a) => (
              <div key={a.id} className="group flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 shadow-[var(--shadow-card)]">
                <div className="flex items-start gap-3">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-brand-soft text-[18px] text-brand-text">{a.icon}</span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[15px] font-medium">{a.name}</div>
                    <div className="line-clamp-2 text-xs text-text-3">{a.description || a.settings.systemPrompt || '无说明'}</div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5 text-xs">
                  <Tag>{a.settings.model}</Tag>
                  {a.settings.workspace && <Tag strong>Agent · {shortPath(a.settings.workspace)}</Tag>}
                  {!!a.settings.knowledgeBases.length && <Tag>知识库 {a.settings.knowledgeBases.length}</Tag>}
                  {!!a.settings.mcpServers.length && <Tag>MCP {a.settings.mcpServers.length}</Tag>}
                </div>
                <div className="mt-auto flex items-center gap-1">
                  <button className="btn btn-primary h-8 gap-1.5 px-3 text-[13px]" onClick={() => void start(a.id)}>
                    <MessageSquarePlus size={14} /> 开始对话
                  </button>
                  <span className="flex-1" />
                  <button className="btn btn-ghost h-8 px-2" title="编辑" onClick={() => setEditing(a)}>
                    <Pencil size={14} />
                  </button>
                  <button className="btn btn-ghost h-8 px-2 hover:text-danger" title="删除" onClick={async () => (await confirmDialog({ title: `删除助手“${a.name}”`, message: '已有对话不受影响。', confirmText: '删除', danger: true })) && void window.ccshell.assistant.remove(a.id)}>
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <Permissions />
      </div>
    </div>
  )
}

function Tag(props: { children: React.ReactNode; strong?: boolean }) {
  return <span className={'max-w-full truncate rounded-sm px-1.5 py-0.5 ' + (props.strong ? 'bg-brand-soft text-brand-text' : 'bg-surface-2 text-text-2')}>{props.children}</span>
}

function Permissions() {
  const [allowed, setAllowed] = useState<AgentToolName[] | null>(null)
  useEffect(() => {
    void window.ccshell.agent.permissions().then((r) => r.ok && setAllowed(r.data))
  }, [])
  if (!allowed) return null
  const writeTools = (Object.keys(AGENT_TOOLS) as AgentToolName[]).filter((t) => AGENT_TOOLS[t].write)
  const set = (t: AgentToolName, on: boolean) => {
    const next = on ? [...allowed, t] : allowed.filter((x) => x !== t)
    setAllowed(next)
    void window.ccshell.agent.setPermissions(next)
  }
  return (
    <Card>
      <h3 className="text-[14px] font-semibold text-text">Agent 权限</h3>
      <p className="mt-1 mb-3 text-xs text-text-3">勾选的操作在所有 Agent 对话中不再询问；读取与搜索始终无需确认。</p>
      <div className="flex flex-wrap gap-x-6 gap-y-2">
        {writeTools.map((t) => (
          <label key={t} className="flex items-center gap-2 text-[13px] text-text-2">
            <input type="checkbox" className="accent-[var(--brand)]" checked={allowed.includes(t)} onChange={(e) => set(t, e.target.checked)} />
            {AGENT_TOOLS[t].label}无需确认
            <span className="font-mono text-xs text-text-3">{t}</span>
          </label>
        ))}
      </div>
    </Card>
  )
}

function useChatModels(): ModelInfo[] {
  const account = useAccount()
  const [models, setModels] = useState<ModelInfo[]>([])
  const keyId = account.activeKey?.id
  useEffect(() => {
    if (!keyId) return setModels([])
    void window.ccshell.chat.models().then((r) => r.ok && setModels(r.data.filter((m) => !m.embedding)))
  }, [keyId])
  return models
}

function AssistantEditor(props: { assistant?: Assistant; onClose: () => void; onOpenPage: (page: 'mcp' | 'knowledge') => void }) {
  const a = props.assistant
  const [name, setName] = useState(a?.name ?? '')
  const [icon, setIcon] = useState(a?.icon ?? '')
  const [description, setDescription] = useState(a?.description ?? '')
  const [s, setS] = useState<Omit<ChatSettings, 'assistantId'>>(a?.settings ?? DEFAULT_SETTINGS)
  const [error, setError] = useState<string | null>(null)
  const models = useChatModels()
  const servers = useMcp()
  const bases = useKnowledge()

  useEffect(() => {
    if (!a) void window.ccshell.chat.lastSettings().then((r) => r.ok && setS({ ...r.data, systemPrompt: '', workspace: '', allowCommands: false }))
  }, [a])

  const patch = (p: Partial<ChatSettings>) => setS((prev) => ({ ...prev, ...p }))
  const toggle = (list: string[], id: string, on: boolean) => (on ? [...list, id] : list.filter((x) => x !== id))

  const save = async () => {
    const input: AssistantInput = { name, icon, description, settings: s }
    const r = a ? await window.ccshell.assistant.update(a.id, input) : await window.ccshell.assistant.create(input)
    if (r.ok) props.onClose()
    else setError(r.error)
  }

  const pickDir = async () => {
    const r = await window.ccshell.agent.pickDir()
    if (r.ok && r.data) patch({ workspace: r.data })
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-3xl flex-col gap-5 px-8 py-6">
        <h1 className="font-serif text-[22px] font-semibold">{a ? `编辑 ${a.name}` : '新建助手'}</h1>
        <Card>
          <div className="flex flex-col gap-4">
            <div className="flex gap-3">
              <div className="w-20">
                <Field label="图标">
                  <input className={input + ' text-center'} value={icon} onChange={(e) => setIcon(e.target.value)} placeholder="🤖" maxLength={4} />
                </Field>
              </div>
              <div className="flex-1">
                <Field label="名称">
                  <input className={input} value={name} onChange={(e) => setName(e.target.value)} placeholder="代码审查" autoFocus />
                </Field>
              </div>
            </div>
            <Field label="说明" hint="仅自己可见">
              <input className={input} value={description} onChange={(e) => setDescription(e.target.value)} />
            </Field>
            <Field label="系统提示词">
              <textarea className={area} rows={5} value={s.systemPrompt} onChange={(e) => patch({ systemPrompt: e.target.value })} placeholder="你是一位严谨的代码审查员。" />
            </Field>
            <div className="flex gap-3">
              <div className="flex-1">
                <Field label="模型">
                  <Select className={input} value={s.model} onChange={(e) => patch({ model: e.target.value })}>
                    {!models.some((m) => m.id === s.model) && <option value={s.model}>{s.model}</option>}
                    {models.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.id}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              <div className="w-44">
                <Field label="思考">
                  <Select className={input} value={s.thinking} onChange={(e) => patch({ thinking: e.target.value as ChatSettings['thinking'] })} disabled={!/claude/i.test(s.model)}>
                    <option value="off">关闭</option>
                    <option value="adaptive">自适应</option>
                    <option value="budget">固定预算</option>
                  </Select>
                </Field>
              </div>
            </div>
          </div>
        </Card>

        <Card>
          <h3 className="text-[14px] font-semibold text-text">Agent 工作目录</h3>
          <p className="mt-1 mb-3 text-xs text-text-3">助手可在此目录中读取与修改文件，写入前需确认。</p>
          {s.workspace ? (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate rounded-md border border-border-strong bg-bg-raised px-3 py-2 font-mono text-[13px]" title={s.workspace}>
                  {s.workspace}
                </span>
                <button className="btn btn-secondary h-9 px-3" title="更换目录" onClick={() => void pickDir()}>
                  <FolderOpen size={15} />
                </button>
                <button className="btn btn-ghost h-9 px-2" title="移除工作目录" onClick={() => patch({ workspace: '' })}>
                  <X size={15} />
                </button>
              </div>
              <label className="flex items-center gap-2 text-[13px] text-text-2">
                <input type="checkbox" className="accent-[var(--brand)]" checked={s.allowCommands} onChange={(e) => patch({ allowCommands: e.target.checked })} />
                允许运行命令（PowerShell，每次运行前确认）
              </label>
            </div>
          ) : (
            <button className="btn btn-secondary gap-1.5" onClick={() => void pickDir()}>
              <FolderOpen size={15} /> 选择工作目录
            </button>
          )}
        </Card>

        <Card>
          <div className="mb-2 flex items-center">
            <h3 className="flex-1 text-[14px] font-semibold text-text">知识库</h3>
            <button className="text-xs text-brand-text hover:underline" onClick={() => props.onOpenPage('knowledge')}>
              管理知识库
            </button>
          </div>
          {!bases.length && <p className="text-[13px] text-text-3">暂无知识库。</p>}
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {bases.map((b) => (
              <label key={b.id} className="flex items-center gap-2 text-[13px]">
                <input type="checkbox" className="accent-[var(--brand)]" checked={s.knowledgeBases.includes(b.id)} onChange={(e) => patch({ knowledgeBases: toggle(s.knowledgeBases, b.id, e.target.checked) })} />
                {b.name}
              </label>
            ))}
          </div>
          <div className="mt-4 mb-2 flex items-center">
            <h3 className="flex-1 text-[14px] font-semibold text-text">MCP 服务器</h3>
            <button className="text-xs text-brand-text hover:underline" onClick={() => props.onOpenPage('mcp')}>
              管理 MCP
            </button>
          </div>
          {!servers.length && <p className="text-[13px] text-text-3">暂无 MCP 服务器。</p>}
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {servers.map((sv) => (
              <label key={sv.config.id} className={'flex items-center gap-2 text-[13px] ' + (sv.config.enabled ? '' : 'text-text-3')}>
                <input type="checkbox" className="accent-[var(--brand)]" checked={s.mcpServers.includes(sv.config.id)} onChange={(e) => patch({ mcpServers: toggle(s.mcpServers, sv.config.id, e.target.checked) })} />
                {sv.config.name}
                {!sv.config.enabled && '（已停用）'}
              </label>
            ))}
          </div>
        </Card>

        {error && <p className="text-[13px] text-danger">{error}</p>}
        <div className="flex justify-end gap-2 pb-4">
          <button className="btn btn-secondary" onClick={props.onClose}>
            取消
          </button>
          <button className="btn btn-primary" onClick={() => void save()}>
            保存
          </button>
        </div>
      </div>
    </div>
  )
}
