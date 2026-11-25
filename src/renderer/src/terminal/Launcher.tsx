import { Select } from '../components/Select'
import { FolderOpen, Play, ShieldCheck, Star } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { ModelInfo } from '../../../shared/chat'
import type { ClaudeAccount, TerminalInfo, TerminalSession } from '../../../shared/terminal'
import { ANTHROPIC_MODEL_ALIASES, type AnthropicAccountStatus, type AnthropicState } from '../../../shared/anthropic'
import { Segmented } from '../components/Segmented'
import { useAccount } from '../account'
import { InstallPanel } from './InstallPanel'
import { usePrompts } from './queueState'
import { promptLabel } from '../../../shared/prompts'

const MANAGE = '__manage__'

export function Launcher(props: {
  info: TerminalInfo | null
  reloadInfo: () => void
  initialCwd?: string
  onOpenAccount: () => void
  onStarted: (s: TerminalSession) => void
  onManagePrompts?: () => void
}) {
  const { info } = props
  const account = useAccount()
  const prompts = usePrompts()
  const [models, setModels] = useState<ModelInfo[]>([])
  const [cwd, setCwd] = useState(props.initialCwd ?? '')
  const [title, setTitle] = useState('')
  const [model, setModel] = useState('claude-opus-5-5')
  const [allModels, setAllModels] = useState(true)
  const [continueLast, setContinueLast] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [acct, setAcct] = useState<ClaudeAccount>('ccshell')
  const [anth, setAnth] = useState<AnthropicState | null>(null)
  const [anId, setAnId] = useState('')
  const [anModel, setAnModel] = useState('')
  const [anCustom, setAnCustom] = useState(false)
  const hasKey = !!account.activeKey
  const isAnth = acct === 'anthropic'
  const anAccount: AnthropicAccountStatus | null = anth ? (anth.accounts.find((a) => a.id === anId) ?? anth.accounts[0]) : null
  const remember = (cc: { account?: ClaudeAccount; model?: string; allModels?: boolean }) =>
    void window.ccshell.settings.update({ claudeCode: cc }).then(() => props.reloadInfo())
  const saveAnModel = (m: string) => {
    if (anAccount) void window.ccshell.anthropic.update(anAccount.id, { model: m }).then((r) => r.ok && setAnth(r.data))
  }

  useEffect(() => {
    if (!info || loaded) return
    setLoaded(true)
    setCwd((c) => c || info.pinnedDirs[0] || info.recentDirs[0] || '')
    setModel(info.lastOptions.model)
    setAllModels(info.lastOptions.allModels)
    if (info.lastOptions.account === 'anthropic') setAcct('anthropic')
  }, [info, loaded])

  useEffect(() => {
    void window.ccshell.anthropic.state().then((r) => {
      if (!r.ok) return
      setAnth(r.data)
      setAnId((id) => (r.data.accounts.some((a) => a.id === id) ? id : r.data.currentId))
    })
  }, [acct])

  useEffect(() => {
    if (!anAccount) return
    setAnModel(anAccount.model)
    setAnCustom(!ANTHROPIC_MODEL_ALIASES.some(([v]) => v === anAccount.model))
  }, [anAccount?.id])

  const pickAnthropic = (id: string) => {
    setAnId(id)
    void window.ccshell.anthropic.select(id).then((r) => r.ok && setAnth(r.data))
  }

  useEffect(() => {
    if (!hasKey) return
    void window.ccshell.chat.models().then((r) => r.ok && setModels(r.data.filter((m) => m.protocol === 'anthropic')))
  }, [hasKey])

  const pick = async () => {
    const r = await window.ccshell.terminal.pickDir()
    if (r.ok && r.data) setCwd(r.data)
  }

  const start = async (dir = cwd) => {
    setBusy(true)
    setError(null)
    const r = await window.ccshell.terminal.create(
      isAnth
        ? { cwd: dir, account: 'anthropic', anthropicId: anAccount?.id, model: anModel.trim(), allModels: false, continueLast, title: title.trim() || undefined }
        : { cwd: dir, model, allModels, continueLast, title: title.trim() || undefined }
    )
    setBusy(false)
    if (r.ok) {
      setTitle('')
      props.onStarted(r.data)
    } else setError(r.error)
  }

  const startWith = async (promptId: string) => {
    setBusy(true)
    setError(null)
    const r = await window.ccshell.prompts.use(
      promptId,
      isAnth
        ? { action: 'new', cwd, title: title.trim() || undefined, model: anModel.trim(), account: 'anthropic', anthropicId: anAccount?.id }
        : { action: 'new', cwd, title: title.trim() || undefined, model, allModels }
    )
    setBusy(false)
    if (!r.ok) return setError(r.error)
    setTitle('')
    const list = await window.ccshell.terminal.list()
    const s = list.ok ? list.data.find((x) => x.id === r.data) : undefined
    if (s) props.onStarted(s)
  }

  const dirMenu = async (d: string, pinned: boolean) => {
    const r = await window.ccshell.app.contextMenu([
      { id: 'start', label: '在此目录开始' },
      { id: 'pin', label: pinned ? '取消固定' : '固定为常用目录' },
      { id: 'open', label: '打开文件夹' },
      { id: 'forget', label: '从列表移除', separatorBefore: true }
    ])
    if (!r.ok || !r.data) return
    if (r.data === 'start') return void start(d)
    if (r.data === 'pin') await window.ccshell.terminal.pinDir(d, !pinned)
    if (r.data === 'open') await window.ccshell.terminal.openDir(d)
    if (r.data === 'forget') await window.ccshell.terminal.forgetDir(d)
    props.reloadInfo()
  }

  const blocked = isAnth ? (anAccount && !anAccount.ready ? 'anthropic' : info && !info.claudePath ? 'claude' : null) : !account.user || !hasKey ? 'account' : info && !info.claudePath ? 'claude' : null
  const dirs = info ? [...info.pinnedDirs.map((d) => ({ d, pinned: true })), ...info.recentDirs.map((d) => ({ d, pinned: false }))] : []

  return (
    <div className="flex min-h-0 flex-1 justify-center overflow-y-auto" style={{ background: 'var(--hero-glow)' }}>
      <div className="flex w-full max-w-xl flex-col gap-5 px-6 py-12">
        <div>
          <h1 className="font-serif text-[22px] font-semibold">新的 Claude Code 会话</h1>
        </div>

        {blocked === 'account' && (
          <div className="rounded-md border border-border bg-surface px-4 py-3 text-[13px] text-text-2">
            需登录 CC Shell 并拥有可用密钥。
            <button className="ml-1 text-brand-text hover:underline" onClick={props.onOpenAccount}>
              前往账户
            </button>
          </div>
        )}
        {blocked === 'anthropic' && anAccount && (
          <div className="rounded-md border border-border bg-surface px-4 py-3 text-[13px] text-text-2">
            {anAccount.method === 'apikey' ? `账户“${anAccount.name}”尚未设置 Anthropic API 密钥。` : `账户“${anAccount.name}”的订阅尚未登录。`}
            <button className="ml-1 text-brand-text hover:underline" onClick={() => window.dispatchEvent(new CustomEvent('ccshell-go', { detail: 'anthropic' }))}>
              前往设置
            </button>
          </div>
        )}
        {info && !info.claudePath && (
          <div className="flex flex-col gap-3 rounded-lg border border-warning/40 bg-surface p-5">
            <div>
              <h2 className="text-[14px] font-semibold">未安装 Claude Code</h2>
              <p className="mt-1 text-[13px] text-text-2">安装至客户端数据目录，不影响系统中已有的版本。</p>
            </div>
            <InstallPanel compact onInstalled={props.reloadInfo} />
          </div>
        )}

        <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-5 shadow-[var(--shadow-card)]">
          <div className="flex items-center justify-between gap-3 text-[13px] text-text-2">
            账户
            <Segmented
              value={acct}
              options={[
                { value: 'ccshell', label: 'CC Shell' },
                { value: 'anthropic', label: 'Anthropic', title: anAccount ? (anAccount.ready ? (anAccount.method === 'apikey' ? 'API 密钥' : '订阅账户') : '尚未配置') : undefined }
              ]}
              onChange={(v) => {
                setAcct(v)
                remember({ account: v })
              }}
            />
          </div>
          {isAnth && anth && (
            <label className="flex items-center justify-between gap-3 text-[13px] text-text-2">
              <span className="flex items-center gap-1.5">
                Anthropic 账户
                {anAccount && <span className={'size-2 rounded-full ' + (anAccount.ready ? 'bg-success' : 'bg-border-strong')} title={anAccount.ready ? '可以使用' : '尚未配置'} />}
              </span>
              <Select
                value={anAccount?.id ?? ''}
                onChange={(e) => (e.target.value === MANAGE ? window.dispatchEvent(new CustomEvent('ccshell-go', { detail: 'anthropic' })) : pickAnthropic(e.target.value))}
                className="h-9 w-64 rounded-md border border-border-strong bg-bg-raised px-2 text-[13px] text-text outline-none focus:border-brand"
              >
                {anth.accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                    {a.ready ? '' : '（尚未配置）'}
                  </option>
                ))}
                <option value={MANAGE}>管理账户…</option>
              </Select>
            </label>
          )}
          <div className="flex flex-col gap-1.5">
            <span className="text-[13px] text-text-2">项目目录</span>
            <div className="flex gap-2">
              <input
                value={cwd}
                onChange={(e) => setCwd(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !blocked && cwd.trim() && void start()}
                placeholder="X:\path\to\project"
                className="h-9 min-w-0 flex-1 rounded-md border border-border-strong bg-bg-raised px-3 font-mono text-[13px] outline-none focus:border-brand"
              />
              <button className="btn btn-secondary h-9 px-3" onClick={() => void pick()} title="选择文件夹">
                <FolderOpen size={16} />
              </button>
            </div>
            {!!dirs.length && (
              <div className="mt-1 flex flex-col" aria-label="常用目录">
                {dirs.map(({ d, pinned }) => (
                  <button
                    key={d}
                    onClick={() => setCwd(d)}
                    onDoubleClick={() => !blocked && void start(d)}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      void dirMenu(d, pinned)
                    }}
                    className={
                      'flex items-center gap-1.5 rounded-sm px-2 py-1 text-left font-mono text-xs ' +
                      (d === cwd ? 'bg-surface-2 text-text' : 'text-text-3 hover:bg-surface-2 hover:text-text')
                    }
                    title={`${d}\n单击选择，双击开始，右键可固定、打开或移除`}
                  >
                    <Star size={11} className={'shrink-0 ' + (pinned ? 'fill-current text-warning' : 'opacity-0')} />
                    <span className="truncate">{d}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <label className="flex items-center justify-between gap-3 text-[13px] text-text-2">
            名称
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !blocked && cwd.trim() && void start()}
              placeholder="可选，默认为目录名"
              className="h-9 w-64 rounded-md border border-border-strong bg-bg-raised px-3 text-[13px] text-text outline-none focus:border-brand"
            />
          </label>

          {isAnth ? (
            <div className="flex flex-col gap-2">
              <label className="flex items-center justify-between gap-3 text-[13px] text-text-2">
                模型
                <Select
                  value={anCustom ? '__custom__' : anModel}
                  onChange={(e) => {
                    if (e.target.value === '__custom__') return setAnCustom(true)
                    setAnCustom(false)
                    setAnModel(e.target.value)
                    saveAnModel(e.target.value)
                  }}
                  className="h-9 w-64 rounded-md border border-border-strong bg-bg-raised px-2 font-mono text-[13px] text-text outline-none focus:border-brand"
                >
                  {ANTHROPIC_MODEL_ALIASES.map(([v, label]) => (
                    <option key={v} value={v}>
                      {label}
                    </option>
                  ))}
                  <option value="__custom__">自定义模型名…</option>
                </Select>
              </label>
              {anCustom && (
                <input
                  value={anModel}
                  onChange={(e) => setAnModel(e.target.value)}
                  onBlur={(e) => saveAnModel(e.target.value.trim())}
                  placeholder="完整模型名"
                  aria-label="自定义模型名"
                  className="h-9 w-64 self-end rounded-md border border-border-strong bg-bg-raised px-3 font-mono text-[13px] text-text outline-none focus:border-brand"
                />
              )}
            </div>
          ) : (
          <>
          <label className="flex items-center justify-between gap-3 text-[13px] text-text-2">
            模型
            <Select
              value={model}
              onChange={(e) => {
                setModel(e.target.value)
                remember({ model: e.target.value })
              }}
              className="h-9 w-64 rounded-md border border-border-strong bg-bg-raised px-2 font-mono text-[13px] text-text outline-none focus:border-brand"
            >
              {!models.some((m) => m.id === model) && <option value={model}>{model}</option>}
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.id}
                </option>
              ))}
            </Select>
          </label>

          <label className="flex items-start gap-2 text-[13px] text-text-2" title="子代理、后台模型及 opus / sonnet / haiku 别名均使用此模型。密钥仅开通部分模型时请开启，否则将返回 403">
            <input type="checkbox" checked={allModels} onChange={(e) => {
                setAllModels(e.target.checked)
                remember({ allModels: e.target.checked })
              }} className="mt-1 accent-[var(--brand)]" />
            <span>
              其他模型统一使用此模型
            </span>
          </label>
          </>
          )}

          <label className="flex items-start gap-2 text-[13px] text-text-2" title="等同于 claude --continue；更早的对话请从“历史对话”打开">
            <input type="checkbox" checked={continueLast} onChange={(e) => setContinueLast(e.target.checked)} className="mt-1 accent-[var(--brand)]" />
            <span>
              继续此目录最近的对话
            </span>
          </label>

          {error && <p className="text-[13px] text-danger select-text">{error}</p>}

          <button className="btn btn-primary h-10" disabled={!!blocked || busy || !cwd.trim()} onClick={() => void start()}>
            <Play size={16} />
            {busy ? '正在启动…' : '开始对话'}
          </button>
        </div>

        {!!prompts.length && (
          <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4 shadow-[var(--shadow-card)]">
            <div className="flex items-center justify-between">
              <h2 className="text-[13.5px] font-semibold">以提示词开始</h2>
              {props.onManagePrompts && (
                <button className="text-xs text-text-3 hover:text-text" onClick={props.onManagePrompts}>
                  管理
                </button>
              )}
            </div>
            <div className="flex flex-col">
              {prompts.slice(0, 8).map((p) => (
                <div key={p.id} className="group flex items-center gap-2 rounded-sm px-2 py-1.5 hover:bg-surface-2">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] text-text">{promptLabel(p)}</span>
                    <span className="block truncate text-[11px] text-text-3">{p.text.replace(/\s+/g, ' ').slice(0, 90)}</span>
                  </span>
                  <button className="btn btn-secondary h-7 shrink-0 gap-1 px-2.5 text-[12px]" disabled={!!blocked || busy || !cwd.trim()} onClick={() => void startWith(p.id)}>
                    <Play size={12} />
                    开始
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex items-center justify-center gap-2 text-xs text-text-3">
          <span
            className="flex items-center gap-1"
            title={
              isAnth
                ? '使用 Anthropic 账户运行；每个账户的登录凭据、设置与对话记录保存在各自的配置目录，与其他账户和系统中的 Claude Code 互不影响'
                : '使用 CC Shell 密钥运行；配置与对话记录独立于 Anthropic 账户和系统中的 Claude Code'
            }
          >
            <ShieldCheck size={13} className="text-success" />
            独立配置
          </span>
          {info && (
            <>
              <span className="text-border-strong">·</span>
              <span title={info.claudePath ?? undefined}>Claude Code {info.claudePath ? (info.version ?? '版本未知') : '未安装'}</span>
              <span className="text-border-strong">·</span>
              <button className="hover:text-text hover:underline" title={isAnth ? anAccount?.configDir : info.configDir} onClick={() => void window.ccshell.terminal.openConfigDir(acct, anAccount?.id)}>
                配置目录
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
