import { BookOpen, Bot, FolderOpen, Workflow, Wrench, X } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import type { ChatSettings } from '../../../shared/chat'
import { STATUS_DOT, STATUS_TEXT, useMcp } from '../mcp/useMcp'
import { shortPath, useKnowledge } from '../stage6'
import { useClickOutside } from './ChatHeader'

type Picked = Pick<ChatSettings, 'mcpServers' | 'knowledgeBases' | 'workspace' | 'allowCommands' | 'peers'>

export function ToolPicker(props: {
  value: Picked
  disabled?: boolean
  onChange: (patch: Partial<Picked>) => void
  onManage: (page: 'mcp' | 'knowledge') => void
}) {
  const servers = useMcp().filter((s) => s.config.enabled)
  const bases = useKnowledge()
  const [open, setOpen] = useState(false)
  const ref = useClickOutside(open, () => setOpen(false))
  const v = props.value
  const toggle = (list: string[], id: string, on: boolean) => (on ? [...list, id] : list.filter((x) => x !== id))

  const mcpOn = servers.filter((s) => v.mcpServers.includes(s.config.id)).length
  const kbOn = bases.filter((b) => v.knowledgeBases.includes(b.id)).length
  const count = mcpOn + kbOn + (v.workspace ? 1 : 0) + (v.peers ? 1 : 0)

  const pickDir = async () => {
    const r = await window.ccshell.agent.pickDir()
    if (r.ok && r.data) props.onChange({ workspace: r.data })
  }

  return (
    <div ref={ref} className="relative">
      <button
        className={'btn h-8 gap-1 px-2 text-xs ' + (count ? 'bg-brand-soft text-brand-text' : 'btn-ghost')}
        disabled={props.disabled}
        title="此对话中模型可使用的工具：MCP 服务器、知识库与 Agent 工作目录"
        onClick={() => setOpen(!open)}
      >
        {v.workspace ? <Bot size={15} /> : <Wrench size={15} />}
        {v.workspace ? 'Agent' : '工具'}
        {count ? `（${count}）` : ''}
      </button>
      {open && (
        <div className="anim-pop-up absolute bottom-full left-0 z-20 mb-1 max-h-[70vh] w-96 overflow-y-auto rounded-md border border-border-strong bg-surface p-1 shadow-[var(--shadow-card)]">
          <Section title="Agent 工作目录" icon={<Bot size={13} />}>
            {v.workspace ? (
              <div className="flex flex-col gap-1.5 px-3 py-1.5">
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate font-mono text-xs" title={v.workspace}>
                    {v.workspace}
                  </span>
                  <button className="text-text-3 hover:text-text" title="更换目录" onClick={() => void pickDir()}>
                    <FolderOpen size={14} />
                  </button>
                  <button className="text-text-3 hover:text-danger" title="停用 Agent 工具" onClick={() => props.onChange({ workspace: '' })}>
                    <X size={14} />
                  </button>
                </div>
                <label className="flex items-center gap-2 text-xs text-text-2">
                  <input type="checkbox" className="accent-[var(--brand)]" checked={v.allowCommands} onChange={(e) => props.onChange({ allowCommands: e.target.checked })} />
                  允许运行命令（PowerShell）
                </label>
              </div>
            ) : (
              <button className="w-full rounded-sm px-3 py-2 text-left text-[13px] text-text-2 hover:bg-surface-2" onClick={() => void pickDir()}>
                选择工作目录，允许模型读写其中的文件…
              </button>
            )}
          </Section>

          <Section title="会话协作" icon={<Workflow size={13} />}>
            <Row
              checked={!!v.peers}
              onChange={(on) => props.onChange({ peers: on })}
              label="与 Claude Code 会话协作"
              right="4 个工具"
            />
            <p className="px-3 pb-1.5 text-xs leading-relaxed text-text-3">
              可查看并读取 Claude Code 会话及其他已启用协作的对话，向其发送消息或新建会话分派任务；其他会话也可向此对话发送消息并获得自动回复。发送消息与新建会话前需确认。
            </p>
          </Section>

          <Section title="知识库" icon={<BookOpen size={13} />} onManage={() => (setOpen(false), props.onManage('knowledge'))}>
            {!bases.length && <p className="px-3 py-1.5 text-xs text-text-3">暂无知识库。</p>}
            {bases.map((b) => (
              <Row
                key={b.id}
                checked={v.knowledgeBases.includes(b.id)}
                onChange={(on) => props.onChange({ knowledgeBases: toggle(v.knowledgeBases, b.id, on) })}
                label={b.name}
                right={`${b.items.reduce((n, i) => n + i.chunkCount, 0)} 段`}
              />
            ))}
          </Section>

          <Section title="MCP 服务器" icon={<Wrench size={13} />} onManage={() => (setOpen(false), props.onManage('mcp'))}>
            {!servers.length && <p className="px-3 py-1.5 text-xs text-text-3">暂无已启用的 MCP 服务器。</p>}
            {servers.map((s) => {
              const n = s.state.tools.filter((t) => !s.config.disabledTools.includes(t.name)).length
              return (
                <Row
                  key={s.config.id}
                  checked={v.mcpServers.includes(s.config.id)}
                  onChange={(on) => props.onChange({ mcpServers: toggle(v.mcpServers, s.config.id, on) })}
                  label={s.config.name}
                  right={
                    <>
                      <span className={'size-1.5 rounded-full ' + STATUS_DOT[s.state.status]} />
                      {s.state.status === 'connected' ? `${n} 个工具` : STATUS_TEXT[s.state.status]}
                    </>
                  }
                />
              )
            })}
          </Section>
          {v.workspace && <p className="px-3 pt-1 pb-1.5 text-xs text-text-3">工作目录：{shortPath(v.workspace)}。写入、修改文件与运行命令前需确认。</p>}
        </div>
      )}
    </div>
  )
}

function Section(props: { title: string; icon: ReactNode; onManage?: () => void; children: ReactNode }) {
  return (
    <div className="border-b border-border py-1 last:border-0">
      <div className="flex items-center gap-1.5 px-3 pt-1 pb-0.5 text-xs text-text-3">
        {props.icon}
        <span className="flex-1">{props.title}</span>
        {props.onManage && (
          <button className="text-brand-text hover:underline" onClick={props.onManage}>
            管理
          </button>
        )}
      </div>
      {props.children}
    </div>
  )
}

function Row(props: { checked: boolean; onChange: (on: boolean) => void; label: string; right: ReactNode }) {
  return (
    <label className="flex cursor-pointer items-center gap-2.5 rounded-sm px-3 py-1.5 hover:bg-surface-2">
      <input type="checkbox" className="accent-[var(--brand)]" checked={props.checked} onChange={(e) => props.onChange(e.target.checked)} />
      <span className="min-w-0 flex-1 truncate text-[13px]">{props.label}</span>
      <span className="flex shrink-0 items-center gap-1.5 text-xs text-text-3">{props.right}</span>
    </label>
  )
}
