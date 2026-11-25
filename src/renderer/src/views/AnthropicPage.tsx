import { Check, FolderOpen, LogIn, LogOut, MoreHorizontal, Plus } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { ANTHROPIC_MAX, ANTHROPIC_MODEL_ALIASES, type AnthropicAccountStatus, type AnthropicState } from '../../../shared/anthropic'
import { confirmOption } from '../components/Dialog'
import { Loading } from '../components/Loading'
import { Segmented } from '../components/Segmented'
import { Select } from '../components/Select'
import { reloadAnthropicNames } from '../terminal/anthropicNames'
import { Row, Section, TextSetting } from './SettingsPage'

export function openCodeSession(id: string): void {
  window.dispatchEvent(new CustomEvent('ccshell-open-session', { detail: id }))
}

const CUSTOM = '__custom__'

type Reply = { ok: true; data: AnthropicState } | { ok: false; error: string }

export function AnthropicPage() {
  const [st, setSt] = useState<AnthropicState | null>(null)
  const [selId, setSelId] = useState<string | null>(null)
  const [key, setKey] = useState('')
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  const [custom, setCustom] = useState(false)
  const [renaming, setRenaming] = useState<string | null>(null)
  const renameInput = useRef<HTMLInputElement>(null)

  const load = () => void window.ccshell.anthropic.state().then((r) => r.ok && setSt(r.data))
  useEffect(() => {
    load()
    const t = setInterval(load, 3000)
    return () => clearInterval(t)
  }, [])
  useEffect(() => {
    if (renaming) renameInput.current?.select()
  }, [renaming])

  const apply = (r: Reply, ok?: string) => {
    if (r.ok) {
      setSt(r.data)
      reloadAnthropicNames()
      if (ok) setMsg({ text: ok })
    } else setMsg({ text: r.error, error: true })
    return r.ok
  }

  if (!st) return <Loading />
  const sel = st.accounts.find((a) => a.id === selId) ?? st.accounts.find((a) => a.id === st.currentId) ?? st.accounts[0]
  const save = (patch: Partial<Pick<AnthropicAccountStatus, 'method' | 'model'>>) => void window.ccshell.anthropic.update(sel.id, patch).then((r) => apply(r))

  const add = async () => {
    const r = await window.ccshell.anthropic.add()
    if (!apply(r)) return
    const added = r.ok ? r.data.accounts[r.data.accounts.length - 1] : null
    if (added) {
      setSelId(added.id)
      setRenaming(added.id)
    }
  }

  const rename = async (id: string, name: string) => {
    setRenaming(null)
    const cur = st.accounts.find((a) => a.id === id)
    if (!name.trim() || name.trim() === cur?.name) return
    apply(await window.ccshell.anthropic.rename(id, name))
  }

  const remove = async (a: AnthropicAccountStatus) => {
    const r = await confirmOption({
      title: `移除账户“${a.name}”`,
      message: '移除后，新建会话时不再能选到它。',
      option: { label: '同时删除它在本机的数据：登录凭据、设置和这个账户的对话记录' },
      confirmText: '移除',
      danger: true
    })
    if (!r.ok) return
    if (apply(await window.ccshell.anthropic.remove(a.id, r.checked), r.checked ? '已移除账户并删除本机数据' : '已移除账户（本机数据保留）')) setSelId(null)
  }

  const menu = async (a: AnthropicAccountStatus) => {
    const r = await window.ccshell.app.contextMenu([
      { id: 'default', label: '设为新会话默认', enabled: a.id !== st.currentId },
      { id: 'rename', label: '重命名' },
      { id: 'dir', label: '打开配置目录' },
      { id: 'remove', label: '移除账户', danger: true, enabled: st.accounts.length > 1, separatorBefore: true }
    ])
    if (!r.ok || !r.data) return
    if (r.data === 'default') apply(await window.ccshell.anthropic.select(a.id))
    if (r.data === 'rename') (setSelId(a.id), setRenaming(a.id))
    if (r.data === 'dir') await window.ccshell.terminal.openConfigDir('anthropic', a.id)
    if (r.data === 'remove') await remove(a)
  }

  const login = async () => {
    setBusy(true)
    setMsg(null)
    const dir = await window.ccshell.anthropic.loginDir()
    if (!dir.ok) return (setBusy(false), setMsg({ text: dir.error, error: true }))
    const r = await window.ccshell.terminal.create({ cwd: dir.data, account: 'anthropic', anthropicId: sel.id, model: sel.model, allModels: false, title: `${sel.name} 登录` })
    setBusy(false)
    if (!r.ok) return setMsg({ text: r.error, error: true })
    openCodeSession(r.data.id)
  }

  const logout = async () => {
    const r = await confirmOption({
      title: `退出“${sel.name}”的订阅账户`,
      message: '删除本机保存的 Claude Code 登录凭据。之后使用这个账户需要重新登录。',
      confirmText: '退出登录',
      danger: true
    })
    if (!r.ok) return
    apply(await window.ccshell.anthropic.logout(sel.id), '已退出订阅账户')
  }

  const saveKey = async () => {
    if (apply(await window.ccshell.anthropic.setApiKey(sel.id, key), '已保存 API 密钥')) setKey('')
  }

  const clearKey = async () => {
    const r = await confirmOption({ title: '清除 API 密钥', message: `删除本机为“${sel.name}”保存的 Anthropic API 密钥。`, confirmText: '清除', danger: true })
    if (!r.ok) return
    apply(await window.ccshell.anthropic.clearApiKey(sel.id), '已清除 API 密钥')
  }

  const showCustom = custom || !ANTHROPIC_MODEL_ALIASES.some(([v]) => v === sel.model)
  const select = 'h-8 w-72 rounded-md border border-border-strong bg-bg-raised px-2 font-mono text-[13px] text-text outline-none focus:border-brand'

  return (
    <div className="h-full overflow-y-auto">
      <div className="flex max-w-4xl flex-col gap-5 px-8 py-6">
        <Section
          id="anthropic-accounts"
          title="账户"
          desc="每个账户有自己的配置目录、登录凭据、设置和对话记录，互不影响。新建 Claude Code 会话时选择“Anthropic”并挑一个账户；下面的设置针对选中的账户。"
        >
          <div className="-mt-1 flex flex-col">
            {st.accounts.map((a) => (
              <div
                key={a.id}
                onClick={() => (setSelId(a.id), setCustom(false))}
                onDoubleClick={() => (setSelId(a.id), setRenaming(a.id))}
                onContextMenu={(e) => (e.preventDefault(), void menu(a))}
                className={
                  'flex cursor-default items-center gap-2.5 rounded-md border px-3 py-2 text-[13px] ' +
                  (a.id === sel.id ? 'border-brand/50 bg-surface-2' : 'border-transparent hover:bg-surface-2')
                }
              >
                <span className={'size-2 shrink-0 rounded-full ' + (a.ready ? 'bg-success' : 'bg-border-strong')} title={a.ready ? '可以使用' : '尚未配置'} />
                {renaming === a.id ? (
                  <input
                    ref={renameInput}
                    defaultValue={a.name}
                    aria-label="账户名称"
                    onBlur={(e) => void rename(a.id, e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                      if (e.key === 'Escape') setRenaming(null)
                    }}
                    className="h-7 min-w-0 flex-1 rounded-md border border-border-strong bg-bg-raised px-2 text-[13px] text-text outline-none focus:border-brand"
                  />
                ) : (
                  <span className="min-w-0 flex-1 truncate text-text">{a.name}</span>
                )}
                <span className="shrink-0 text-xs text-text-3">{a.method === 'apikey' ? (a.apiKeyHint ? `API 密钥 …${a.apiKeyHint}` : 'API 密钥') : a.loggedIn ? '订阅账户' : '订阅账户 · 未登录'}</span>
                {a.id === st.currentId && (
                  <span className="flex shrink-0 items-center gap-1 rounded-sm bg-brand/12 px-1.5 py-0.5 text-[11px] text-brand-text" title="新建会话时默认选中">
                    <Check size={11} />
                    默认
                  </span>
                )}
                <button className="btn btn-ghost size-7 shrink-0 p-0" aria-label="更多" title="更多" onClick={(e) => (e.stopPropagation(), void menu(a))}>
                  <MoreHorizontal size={15} />
                </button>
              </div>
            ))}
          </div>
          <Row label="添加账户" hint={`最多 ${ANTHROPIC_MAX} 个。新账户的登录和对话记录与现有账户完全分开。`}>
            <button className="btn btn-secondary h-8 gap-1.5 px-3 text-[12.5px]" disabled={st.accounts.length >= ANTHROPIC_MAX} onClick={() => void add()}>
              <Plus size={14} />
              新建
            </button>
          </Row>
        </Section>

        <Section id="anthropic-method" title={`${sel.name} · 使用方式`} desc="两种方式都配置时，只使用这里选中的一种。对话模块不受影响，始终使用 CC Shell。">
          <Row label="这个账户使用">
            <Segmented
              value={sel.method}
              options={[
                { value: 'subscription', label: '订阅账户' },
                { value: 'apikey', label: 'API 密钥' }
              ]}
              onChange={(v) => save({ method: v })}
            />
          </Row>
          <Row label="状态">
            <span className="flex h-8 items-center gap-2 text-[13px]">
              <span className={'size-2 rounded-full ' + (sel.ready ? 'bg-success' : 'bg-border-strong')} />
              {sel.ready ? '可以使用' : sel.method === 'apikey' ? '尚未设置 API 密钥' : '订阅账户尚未登录'}
            </span>
          </Row>
        </Section>

        <Section id="anthropic-subscription" title="订阅账户" desc="Claude Pro / Max 等订阅。登录由 Claude Code 自己完成：会打开一个 Claude Code 会话，在其中输入 /login，按提示在浏览器中授权。凭据由 Claude Code 保存在这个账户的配置目录中。">
          <Row label={sel.loggedIn ? '已登录' : '未登录'}>
            {sel.loggedIn ? (
              <button className="btn btn-secondary h-8 gap-1.5 px-3 text-[12.5px]" onClick={() => void logout()}>
                <LogOut size={14} />
                退出登录
              </button>
            ) : (
              <button className="btn btn-primary h-8 gap-1.5 px-3 text-[12.5px]" disabled={busy} onClick={() => void login()}>
                <LogIn size={14} />
                {busy ? '正在打开…' : '登录'}
              </button>
            )}
          </Row>
          {!sel.loggedIn && <p className="-mt-1 text-xs text-text-3">打开会话后，在终端中输入 /login 并按回车。</p>}
        </Section>

        <Section id="anthropic-key" title="API 密钥" desc="Anthropic Console 中创建的密钥（sk-ant- 开头）。使用系统加密保存在本机，仅在启动这个账户的会话时交给 Claude Code。客户端不会联网验证密钥。">
          <Row label={sel.apiKeyHint ? `已保存 · …${sel.apiKeyHint}` : '未设置'}>
            <div className="flex items-center gap-2">
              <input
                type="password"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && key.trim() && void saveKey()}
                placeholder={sel.apiKeyHint ? '输入新密钥以替换' : 'sk-ant-…'}
                aria-label="Anthropic API 密钥"
                autoComplete="off"
                spellCheck={false}
                className="h-8 w-60 rounded-md border border-border-strong bg-bg-raised px-2.5 font-mono text-[13px] text-text outline-none focus:border-brand"
              />
              <button className="btn btn-primary h-8 px-3 text-[12.5px]" disabled={!key.trim()} onClick={() => void saveKey()}>
                保存
              </button>
              {sel.apiKeyHint && (
                <button className="btn btn-ghost h-8 px-2.5 text-[12.5px]" onClick={() => void clearKey()}>
                  清除
                </button>
              )}
            </div>
          </Row>
        </Section>

        <Section id="anthropic-model" title="模型" desc="别名由 Claude Code 指向官方当前版本；也可以填写完整的模型名。新建会话时可再更改。">
          <Row label="默认模型">
            <div className="flex flex-col items-end gap-2">
              <Select
                className={select}
                value={showCustom ? CUSTOM : sel.model}
                onChange={(e) => {
                  if (e.target.value === CUSTOM) return setCustom(true)
                  setCustom(false)
                  save({ model: e.target.value })
                }}
              >
                {ANTHROPIC_MODEL_ALIASES.map(([v, label]) => (
                  <option key={v} value={v}>
                    {label}
                  </option>
                ))}
                <option value={CUSTOM}>自定义模型名…</option>
              </Select>
              {showCustom && <TextSetting value={sel.model} onSave={(v) => save({ model: v.trim() })} placeholder="完整模型名" />}
            </div>
          </Row>
        </Section>

        <Section id="anthropic-dir" title="配置目录" desc="这个账户的登录凭据、设置与对话记录，与其他 Anthropic 账户和 CC Shell 账户完全分开。">
          <Row label="位置">
            <div className="flex items-center gap-2">
              <span className="max-w-[340px] truncate font-mono text-[12px] text-text-2" title={sel.configDir}>
                {sel.configDir}
              </span>
              <button className="btn btn-ghost h-8 w-8 p-0" aria-label="打开配置目录" title="打开配置目录" onClick={() => void window.ccshell.terminal.openConfigDir('anthropic', sel.id)}>
                <FolderOpen size={15} />
              </button>
            </div>
          </Row>
        </Section>

        {msg && <p className={'anim-rise text-[13px] ' + (msg.error ? 'text-danger' : 'text-text-2')}>{msg.text}</p>}
      </div>
    </div>
  )
}
