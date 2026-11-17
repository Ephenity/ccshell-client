import { ResizableAside } from '../components/ResizableAside'
import { Segmented } from '../components/Segmented'
import { confirmDialog } from '../components/Dialog'
import { ChevronRight, FileJson, Plug, Plus, RefreshCw, Share2, Trash2, X } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { EMPTY_SERVER, type McpServer, type McpServerInput, type McpTransport } from '../../../shared/mcp'
import { STATUS_DOT, STATUS_TEXT, TRANSPORT_TEXT, useMcp } from '../mcp/useMcp'

export const input =
  'h-9 w-full min-w-0 rounded-md border border-border-strong bg-bg-raised px-3 font-mono text-[13px] text-text outline-none focus:border-brand'
export const area =
  'w-full min-w-0 resize-y rounded-md border border-border-strong bg-bg-raised px-3 py-2 font-mono text-[13px] leading-relaxed text-text outline-none focus:border-brand'

export function McpPage() {
  const servers = useMcp()
  const [selected, setSelected] = useState<string | 'new' | null>(null)
  const [dialog, setDialog] = useState<'import' | 'sync' | null>(null)
  const current = servers.find((s) => s.config.id === selected) ?? null

  useEffect(() => {
    if (selected === null && servers.length) setSelected(servers[0].config.id)
    if (selected && selected !== 'new' && !servers.some((s) => s.config.id === selected)) setSelected(servers[0]?.config.id ?? null)
  }, [servers, selected])

  return (
    <div className="flex h-full">
      <ResizableAside id="mcp" defaultWidth={288}>
        <div className="flex h-12 shrink-0 items-center gap-1 border-b border-border px-3">
          <h2 className="flex-1 text-[14px] font-semibold text-text">服务器</h2>
          <button className="btn btn-ghost h-8 px-2" title="导入 JSON（Claude Desktop / Claude Code 格式）" onClick={() => setDialog('import')}>
            <FileJson size={16} />
          </button>
          <button className="btn btn-ghost h-8 px-2" title="同步到 Claude Code" onClick={() => setDialog('sync')} disabled={!servers.length}>
            <Share2 size={16} />
          </button>
          <button className="btn btn-ghost h-8 px-2" title="添加服务器" onClick={() => setSelected('new')}>
            <Plus size={16} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {servers.map((s) => (
            <button
              key={s.config.id}
              onClick={() => setSelected(s.config.id)}
              className={
                'flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left ' +
                (s.config.id === selected ? 'bg-surface-2' : 'hover:bg-surface-2/60')
              }
            >
              <span className={'size-2 shrink-0 rounded-full ' + (s.config.enabled ? STATUS_DOT[s.state.status] : 'bg-border-strong')} />
              <span className="min-w-0 flex-1">
                <span className={'block truncate text-[14px] ' + (s.config.enabled ? '' : 'text-text-3')}>{s.config.name}</span>
                <span className="block truncate text-xs text-text-3">
                  {TRANSPORT_TEXT[s.config.transport]} · {s.config.enabled ? STATUS_TEXT[s.state.status] : '已停用'}
                  {s.state.status === 'connected' && ` · ${s.state.tools.length} 个工具`}
                </span>
              </span>
            </button>
          ))}
          {selected === 'new' && (
            <div className="flex items-center gap-2.5 rounded-md bg-surface-2 px-3 py-2 text-[14px] text-text-2">
              <Plus size={14} /> 新服务器
            </div>
          )}
        </div>
      </ResizableAside>

      <section className="min-w-0 flex-1 overflow-y-auto">
        {selected === 'new' ? (
          <ServerEditor key="new" onDone={(id) => setSelected(id)} onCancel={() => setSelected(servers[0]?.config.id ?? null)} />
        ) : current ? (
          <ServerDetail key={current.config.id} server={current} />
        ) : (
          <Empty onAdd={() => setSelected('new')} onImport={() => setDialog('import')} />
        )}
      </section>

      {dialog === 'import' && <ImportDialog onClose={() => setDialog(null)} />}
      {dialog === 'sync' && <SyncDialog servers={servers} onClose={() => setDialog(null)} />}
    </div>
  )
}

function Empty(props: { onAdd: () => void; onImport: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
      <Plug size={36} className="text-brand-text" />
      <h1 className="font-serif text-[22px] font-semibold">暂无 MCP 服务器</h1>
      <p className="max-w-md text-text-2">
        MCP 服务器为模型提供工具，例如读取文件、检索网页、操作数据库。添加后在对话输入框的“工具”中启用即可调用。
      </p>
      <div className="mt-2 flex gap-2">
        <button className="btn btn-primary" onClick={props.onAdd}>
          <Plus size={16} /> 添加服务器
        </button>
        <button className="btn btn-secondary" onClick={props.onImport}>
          <FileJson size={16} /> 导入 JSON
        </button>
      </div>
    </div>
  )
}

function ServerDetail({ server }: { server: McpServer }) {
  const { config, state } = server
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [showLog, setShowLog] = useState(false)

  const run = async (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setBusy(true)
    setError(null)
    const r = await fn()
    setBusy(false)
    if (!r.ok) setError(r.error ?? '操作失败')
  }
  const patch = (p: Partial<McpServerInput>) => run(() => window.ccshell.mcp.update(config.id, p))
  const toggleIn = (list: string[], name: string, on: boolean) => (on ? [...new Set([...list, name])] : list.filter((x) => x !== name))

  if (editing) return <ServerEditor server={server} onDone={() => setEditing(false)} onCancel={() => setEditing(false)} />

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5 px-8 py-6">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-serif text-[22px] font-semibold">{config.name}</h1>
          <p className="mt-1 truncate font-mono text-xs text-text-3" title={endpoint(server)}>
            {TRANSPORT_TEXT[config.transport]} · {endpoint(server)}
          </p>
        </div>
        <label className="flex shrink-0 items-center gap-2 text-[13px] text-text-2">
          <input type="checkbox" className="accent-[var(--brand)]" checked={config.enabled} disabled={busy} onChange={(e) => void patch({ enabled: e.target.checked })} />
          启用
        </label>
        <button className="btn btn-secondary h-8 px-3 text-[13px]" onClick={() => setEditing(true)}>
          编辑
        </button>
        <button
          className="btn btn-ghost h-8 px-2 hover:text-danger"
          title="删除"
          onClick={async () => (await confirmDialog({ title: `删除服务器“${config.name}”`, confirmText: '删除', danger: true })) && void run(() => window.ccshell.mcp.remove(config.id))}
        >
          <Trash2 size={16} />
        </button>
      </div>

      {error && <p className="text-[13px] text-danger select-text">{error}</p>}

      <Card>
        <div className="flex items-center gap-2.5">
          <span className={'size-2.5 rounded-full ' + (config.enabled ? STATUS_DOT[state.status] : 'bg-border-strong')} />
          <span className="text-[14px]">{config.enabled ? STATUS_TEXT[state.status] : '已停用'}</span>
          {state.serverInfo && <span className="font-mono text-xs text-text-3">{state.serverInfo}</span>}
          {state.transportUsed && state.transportUsed !== config.transport && (
            <span className="text-xs text-warning">（{TRANSPORT_TEXT[config.transport]} 不可用，已改用 {TRANSPORT_TEXT[state.transportUsed]}）</span>
          )}
          <span className="flex-1" />
          {config.enabled && (
            <button className="btn btn-ghost h-8 gap-1.5 px-2 text-[13px]" disabled={busy || state.status === 'connecting'} onClick={() => void run(() => window.ccshell.mcp.restart(config.id))}>
              <RefreshCw size={14} className={state.status === 'connecting' ? 'animate-spin' : ''} /> 重新连接
            </button>
          )}
        </div>
        {state.status === 'error' && state.error && (
          <pre className="mt-3 max-h-40 overflow-auto rounded-md bg-danger/10 px-3 py-2 font-mono text-xs whitespace-pre-wrap text-danger select-text">{state.error}</pre>
        )}
        {!!state.log.length && (
          <div className="mt-3">
            <button className="flex items-center gap-1 text-xs text-text-3 hover:text-text" onClick={() => setShowLog(!showLog)}>
              <ChevronRight size={13} className={'transition-transform ' + (showLog ? 'rotate-90' : '')} /> 日志（{state.log.length} 行）
            </button>
            {showLog && (
              <pre className="mt-2 max-h-60 overflow-auto rounded-md bg-bg px-3 py-2 font-mono text-xs whitespace-pre-wrap text-text-2 select-text">{state.log.join('\n')}</pre>
            )}
          </div>
        )}
      </Card>

      <Card>
        <div className="mb-3 flex items-center gap-3">
          <h3 className="flex-1 text-[14px] font-semibold text-text">工具</h3>
          <label className="flex items-center gap-2 text-[13px] text-text-2" title="该服务器的全部工具调用均无需确认">
            <input type="checkbox" className="accent-[var(--brand)]" checked={config.alwaysAllow} disabled={busy} onChange={(e) => void patch({ alwaysAllow: e.target.checked })} />
            全部无需确认
          </label>
        </div>
        {state.status !== 'connected' ? (
          <p className="text-[13px] text-text-3">连接成功后将列出该服务器提供的工具。</p>
        ) : !state.tools.length ? (
          <p className="text-[13px] text-text-3">该服务器未提供工具。</p>
        ) : (
          <div className="flex flex-col divide-y divide-border">
            {state.tools.map((t) => {
              const on = !config.disabledTools.includes(t.name)
              const free = config.alwaysAllow || config.allowedTools.includes(t.name)
              return (
                <div key={t.name} className="flex items-start gap-3 py-2.5">
                  <input
                    type="checkbox"
                    className="mt-1 accent-[var(--brand)]"
                    title="提供给模型"
                    checked={on}
                    disabled={busy}
                    onChange={(e) => void patch({ disabledTools: toggleIn(config.disabledTools, t.name, !e.target.checked) })}
                  />
                  <div className={'min-w-0 flex-1 ' + (on ? '' : 'opacity-50')}>
                    <div className="font-mono text-[13px]">
                      {t.name}
                      {t.title && t.title !== t.name && <span className="ml-2 font-sans text-text-3">{t.title}</span>}
                    </div>
                    {t.description && <p className="mt-0.5 line-clamp-2 text-xs text-text-3" title={t.description}>{t.description}</p>}
                  </div>
                  <label className="flex shrink-0 items-center gap-1.5 text-xs text-text-3" title="调用此工具时无需确认">
                    <input
                      type="checkbox"
                      className="accent-[var(--brand)]"
                      checked={free}
                      disabled={busy || config.alwaysAllow || !on}
                      onChange={(e) => void patch({ allowedTools: toggleIn(config.allowedTools, t.name, e.target.checked) })}
                    />
                    无需确认
                  </label>
                </div>
              )
            })}
          </div>
        )}
        <p className="mt-3 text-xs text-text-3">未勾选的工具不会提供给模型</p>
      </Card>
    </div>
  )
}

function endpoint(s: McpServer): string {
  const c = s.config
  return c.transport === 'stdio' ? [c.command, ...c.args.map((a) => (/\s/.test(a) ? `"${a}"` : a))].join(' ') : c.url
}

export function Card({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-border bg-surface p-4 shadow-[var(--shadow-card)]">{children}</div>
}

const toLines = (m: Record<string, string>, sep: string) => Object.entries(m).map(([k, v]) => `${k}${sep}${v}`).join('\n')
function fromLines(text: string, sep: '=' | ':'): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const i = line.indexOf(sep)
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim()
  }
  return out
}

function ServerEditor(props: { server?: McpServer; onDone: (id: string) => void; onCancel: () => void }) {
  const base = props.server?.config ?? EMPTY_SERVER
  const [name, setName] = useState(base.name)
  const [transport, setTransport] = useState<McpTransport>(base.transport)
  const [command, setCommand] = useState(base.command)
  const [args, setArgs] = useState(base.args.join('\n'))
  const [env, setEnv] = useState(toLines(base.env, '='))
  const [cwd, setCwd] = useState(base.cwd)
  const [url, setUrl] = useState(base.url)
  const [headers, setHeaders] = useState(toLines(base.headers, ': '))
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const save = async () => {
    setSaving(true)
    setError(null)
    const input: Partial<McpServerInput> = {
      name,
      transport,
      command,
      args: args.split('\n').map((a) => a.trim()).filter(Boolean),
      env: fromLines(env, '='),
      cwd,
      url,
      headers: fromLines(headers, ':')
    }
    const r = props.server
      ? await window.ccshell.mcp.update(props.server.config.id, input)
      : await window.ccshell.mcp.add({ ...EMPTY_SERVER, ...input })
    setSaving(false)
    if (r.ok) props.onDone(r.data.config.id)
    else setError(r.error)
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5 px-8 py-6">
      <h1 className="font-serif text-[22px] font-semibold">{props.server ? `编辑 ${base.name}` : '添加 MCP 服务器'}</h1>
      <Card>
        <div className="flex flex-col gap-4">
          <Field label="名称" hint="作为工具名前缀提供给模型，建议使用英文、数字和短横线">
            <input className={input} value={name} onChange={(e) => setName(e.target.value)} placeholder="filesystem" autoFocus />
          </Field>
          <Field label="连接方式">
            <Segmented block value={transport} onChange={setTransport} options={(['stdio', 'http', 'sse'] as const).map((t) => ({ value: t, label: TRANSPORT_TEXT[t] }))} />
          </Field>
          {transport === 'stdio' ? (
            <>
              <Field label="命令" hint="例如 npx、uvx、node，或可执行文件的完整路径">
                <input className={input} value={command} onChange={(e) => setCommand(e.target.value)} placeholder="npx" />
              </Field>
              <Field label="参数" hint="每行一项">
                <textarea className={area} rows={3} value={args} onChange={(e) => setArgs(e.target.value)} placeholder={'-y\n@modelcontextprotocol/server-filesystem\nD:\\projects'} />
              </Field>
              <Field label="环境变量" hint="每行一项，格式：名称=值">
                <textarea className={area} rows={2} value={env} onChange={(e) => setEnv(e.target.value)} placeholder="API_KEY=xxx" />
              </Field>
              <Field label="工作目录" hint="可选，默认为用户目录">
                <input className={input} value={cwd} onChange={(e) => setCwd(e.target.value)} />
              </Field>
            </>
          ) : (
            <>
              <Field label="地址" hint={transport === 'http' ? '连接失败时自动改用 SSE 重试' : '连接失败时自动改用 Streamable HTTP 重试'}>
                <input className={input} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/mcp" />
              </Field>
              <Field label="请求头" hint="每行一项，格式：名称: 值。认证信息可在此填写，例如 Authorization: Bearer xxx（暂不支持 OAuth）">
                <textarea className={area} rows={2} value={headers} onChange={(e) => setHeaders(e.target.value)} placeholder="Authorization: Bearer xxx" />
              </Field>
            </>
          )}
          {error && <p className="text-[13px] text-danger select-text">{error}</p>}
          <div className="flex justify-end gap-2">
            <button className="btn btn-secondary" onClick={props.onCancel}>
              取消
            </button>
            <button className="btn btn-primary" disabled={saving} onClick={() => void save()}>
              {saving ? '正在连接…' : '保存并连接'}
            </button>
          </div>
        </div>
      </Card>
    </div>
  )
}

export function Field(props: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[13px] text-text-2">
        {props.label}
        {props.hint && <span className="ml-2 text-xs text-text-3">{props.hint}</span>}
      </span>
      {props.children}
    </div>
  )
}

export function Dialog(props: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && props.onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [props])
  return (
    <div className="dialog-backdrop fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-6" onMouseDown={(e) => e.target === e.currentTarget && props.onClose()}>
      <div className="dialog-card flex max-h-full w-full max-w-xl flex-col gap-4 overflow-y-auto rounded-lg border border-border-strong bg-surface p-5 shadow-[var(--shadow-card)]">
        <div className="flex items-center">
          <h3 className="flex-1 text-[14px] font-semibold text-text">{props.title}</h3>
          <button className="text-text-3 hover:text-text" onClick={props.onClose} title="关闭">
            <X size={16} />
          </button>
        </div>
        {props.children}
      </div>
    </div>
  )
}

const IMPORT_EXAMPLE = `{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "D:\\\\projects"]
    },
    "remote": { "type": "http", "url": "https://example.com/mcp" }
  }
}`

function ImportDialog({ onClose }: { onClose: () => void }) {
  const [text, setText] = useState('')
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    setBusy(true)
    const r = await window.ccshell.mcp.importJson(text)
    setBusy(false)
    if (!r.ok) return setMsg({ ok: false, text: r.error })
    const parts = [r.data.added.length && `新增 ${r.data.added.join('、')}`, r.data.updated.length && `覆盖 ${r.data.updated.join('、')}`].filter(Boolean)
    setMsg({ ok: true, text: `已导入：${parts.join('；')}` })
    setText('')
  }
  return (
    <Dialog title="导入 JSON" onClose={onClose}>
      <p className="text-[13px] text-text-2">
        粘贴 Claude Desktop（claude_desktop_config.json）、Claude Code（.mcp.json）或 Cursor 的 <code className="font-mono">mcpServers</code> 配置。同名服务器将被覆盖。
      </p>
      <textarea className={area} rows={12} value={text} onChange={(e) => setText(e.target.value)} placeholder={IMPORT_EXAMPLE} spellCheck={false} autoFocus />
      {msg && <p className={'text-[13px] select-text ' + (msg.ok ? 'text-success' : 'text-danger')}>{msg.text}</p>}
      <div className="flex justify-end gap-2">
        <button className="btn btn-secondary" onClick={onClose}>
          关闭
        </button>
        <button className="btn btn-primary" disabled={busy || !text.trim()} onClick={() => void submit()}>
          {busy ? '正在导入并连接…' : '导入'}
        </button>
      </div>
    </Dialog>
  )
}

function SyncDialog({ servers, onClose }: { servers: McpServer[]; onClose: () => void }) {
  const [checked, setChecked] = useState<Set<string> | null>(null)
  const [others, setOthers] = useState<string[]>([])
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    void window.ccshell.mcp.claudeServers().then((r) => {
      const names = r.ok ? r.data : []
      setChecked(new Set(servers.filter((s) => names.includes(s.config.name)).map((s) => s.config.id)))
      setOthers(names.filter((n) => !servers.some((s) => s.config.name === n)))
    })
  }, [])

  const submit = async () => {
    const r = await window.ccshell.mcp.syncClaude([...(checked ?? [])])
    setMsg(r.ok ? { ok: true, text: `已写入。Claude Code 当前包含：${r.data.join('、') || '（无）'}` } : { ok: false, text: r.error })
  }

  return (
    <Dialog title="同步到 Claude Code" onClose={onClose}>
      <p className="text-[13px] text-text-2">
        勾选的服务器将写入内嵌 Claude Code 的用户级配置，未勾选的将从中移除。已打开的 Claude Code 会话需重新启动后生效。
      </p>
      {checked && (
        <div className="flex flex-col gap-1">
          {servers.map((s) => (
            <label key={s.config.id} className="flex items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-surface-2">
              <input
                type="checkbox"
                className="accent-[var(--brand)]"
                checked={checked.has(s.config.id)}
                onChange={(e) => {
                  const next = new Set(checked)
                  if (e.target.checked) next.add(s.config.id)
                  else next.delete(s.config.id)
                  setChecked(next)
                }}
              />
              <span className="text-[14px]">{s.config.name}</span>
              <span className="text-xs text-text-3">{TRANSPORT_TEXT[s.config.transport]}</span>
              {s.config.transport === 'stdio' && s.config.cwd && <span className="text-xs text-warning">工作目录不会同步</span>}
            </label>
          ))}
        </div>
      )}
      {!!others.length && <p className="text-xs text-text-3">Claude Code 中的其他服务器（不受影响）：{others.join('、')}</p>}
      {msg && <p className={'text-[13px] select-text ' + (msg.ok ? 'text-success' : 'text-danger')}>{msg.text}</p>}
      <div className="flex justify-end gap-2">
        <button className="btn btn-secondary" onClick={onClose}>
          关闭
        </button>
        <button className="btn btn-primary" disabled={!checked} onClick={() => void submit()}>
          写入 Claude Code
        </button>
      </div>
    </Dialog>
  )
}
