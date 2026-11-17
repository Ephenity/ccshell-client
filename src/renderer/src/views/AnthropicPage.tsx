import { FolderOpen, LogIn, LogOut } from 'lucide-react'
import { useEffect, useState } from 'react'
import { ANTHROPIC_MODEL_ALIASES, type AnthropicStatus } from '../../../shared/anthropic'
import { confirmDialog } from '../components/Dialog'
import { Loading } from '../components/Loading'
import { Segmented } from '../components/Segmented'
import { Select } from '../components/Select'
import { Row, Section, TextSetting } from './SettingsPage'

export function openCodeSession(id: string): void {
  window.dispatchEvent(new CustomEvent('ccshell-open-session', { detail: id }))
}

const CUSTOM = '__custom__'

export function AnthropicPage() {
  const [st, setSt] = useState<AnthropicStatus | null>(null)
  const [key, setKey] = useState('')
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  const [custom, setCustom] = useState(false)

  const load = () => void window.ccshell.anthropic.status().then((r) => r.ok && setSt(r.data))
  useEffect(() => {
    load()
    const t = setInterval(load, 3000)
    return () => clearInterval(t)
  }, [])

  const apply = (r: { ok: true; data: AnthropicStatus } | { ok: false; error: string }, ok?: string) => {
    if (r.ok) {
      setSt(r.data)
      if (ok) setMsg({ text: ok })
    } else setMsg({ text: r.error, error: true })
  }

  const save = (patch: Partial<Pick<AnthropicStatus, 'method' | 'model'>>) =>
    void window.ccshell.settings.update({ claudeCode: { anthropic: patch } }).then(load)

  const login = async () => {
    setBusy(true)
    setMsg(null)
    const dir = await window.ccshell.anthropic.loginDir()
    if (!dir.ok) return (setBusy(false), apply(dir as { ok: false; error: string }))
    const r = await window.ccshell.terminal.create({ cwd: dir.data, account: 'anthropic', model: st?.model ?? '', allModels: false, title: 'Anthropic 登录' })
    setBusy(false)
    if (!r.ok) return setMsg({ text: r.error, error: true })
    openCodeSession(r.data.id)
  }

  const logout = async () => {
    if (!(await confirmDialog({ title: '退出订阅账户', message: '删除本机保存的 Claude Code 登录凭据。之后使用订阅账户需要重新登录。', confirmText: '退出登录', danger: true }))) return
    apply(await window.ccshell.anthropic.logout(), '已退出订阅账户')
  }

  const saveKey = async () => {
    const r = await window.ccshell.anthropic.setApiKey(key)
    apply(r, '已保存 API 密钥')
    if (r.ok) setKey('')
  }

  const clearKey = async () => {
    if (!(await confirmDialog({ title: '清除 API 密钥', message: '删除本机保存的 Anthropic API 密钥。', confirmText: '清除', danger: true }))) return
    apply(await window.ccshell.anthropic.clearApiKey(), '已清除 API 密钥')
  }

  if (!st) return <Loading />
  const showCustom = custom || !ANTHROPIC_MODEL_ALIASES.some(([v]) => v === st.model)
  const select = 'h-8 w-72 rounded-md border border-border-strong bg-bg-raised px-2 font-mono text-[13px] text-text outline-none focus:border-brand'

  return (
    <div className="h-full overflow-y-auto">
      <div className="flex max-w-4xl flex-col gap-5 px-8 py-6">
        <Section id="anthropic-method" title="使用方式" desc="在新建 Claude Code 会话时选择“Anthropic”账户即使用这里的设置。对话模块不受影响，始终使用 CC Shell。">
          <Row label="Anthropic 会话使用" hint="两种方式都配置时，只使用这里选中的一种">
            <Segmented
              value={st.method}
              options={[
                { value: 'subscription', label: '订阅账户' },
                { value: 'apikey', label: 'API 密钥' }
              ]}
              onChange={(v) => save({ method: v })}
            />
          </Row>
          <Row label="状态">
            <span className="flex h-8 items-center gap-2 text-[13px]">
              <span className={'size-2 rounded-full ' + (st.ready ? 'bg-success' : 'bg-border-strong')} />
              {st.ready ? '可以使用' : st.method === 'apikey' ? '尚未设置 API 密钥' : '订阅账户尚未登录'}
            </span>
          </Row>
        </Section>

        <Section id="anthropic-subscription" title="订阅账户" desc="Claude Pro / Max 等订阅。登录由 Claude Code 自己完成：会打开一个 Claude Code 会话，在其中输入 /login，按提示在浏览器中授权。凭据由 Claude Code 保存在独立的配置目录中。">
          <Row label={st.loggedIn ? '已登录' : '未登录'}>
            {st.loggedIn ? (
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
          {!st.loggedIn && <p className="-mt-1 text-xs text-text-3">打开会话后，在终端中输入 /login 并按回车。</p>}
        </Section>

        <Section id="anthropic-key" title="API 密钥" desc="Anthropic Console 中创建的密钥（sk-ant- 开头）。使用系统加密保存在本机，仅在启动 Anthropic 会话时交给 Claude Code。客户端不会联网验证密钥。">
          <Row label={st.apiKeyHint ? `已保存 · …${st.apiKeyHint}` : '未设置'}>
            <div className="flex items-center gap-2">
              <input
                type="password"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && key.trim() && void saveKey()}
                placeholder={st.apiKeyHint ? '输入新密钥以替换' : 'sk-ant-…'}
                aria-label="Anthropic API 密钥"
                autoComplete="off"
                spellCheck={false}
                className="h-8 w-60 rounded-md border border-border-strong bg-bg-raised px-2.5 font-mono text-[13px] text-text outline-none focus:border-brand"
              />
              <button className="btn btn-primary h-8 px-3 text-[12.5px]" disabled={!key.trim()} onClick={() => void saveKey()}>
                保存
              </button>
              {st.apiKeyHint && (
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
              <Select className={select} value={showCustom ? CUSTOM : st.model}
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
              {showCustom && <TextSetting value={st.model} onSave={(v) => save({ model: v.trim() })} placeholder="完整模型名" />}
            </div>
          </Row>
        </Section>

        <Section id="anthropic-dir" title="配置目录" desc="Anthropic 会话的登录凭据、设置与对话记录，与 CC Shell 账户完全分开。">
          <Row label="位置">
            <div className="flex items-center gap-2">
              <span className="max-w-[340px] truncate font-mono text-[12px] text-text-2" title={st.configDir}>
                {st.configDir}
              </span>
              <button className="btn btn-ghost h-8 w-8 p-0" aria-label="打开配置目录" title="打开配置目录" onClick={() => void window.ccshell.terminal.openConfigDir('anthropic')}>
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
