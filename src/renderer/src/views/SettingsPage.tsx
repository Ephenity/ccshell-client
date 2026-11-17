import { Segmented as Seg } from '../components/Segmented'
import { Info } from 'lucide-react'
import { Select } from '../components/Select'
import { useEffect, useState, type ReactNode } from 'react'
import type { ModelInfo } from '../../../shared/chat'
import { PERMISSION_MODES, REGISTRIES, type AppSettings, type PermissionMode, type QuitAction, type SettingsPatch } from '../../../shared/settings'
import type { TerminalInfo } from '../../../shared/terminal'
import { useAccount } from '../account'
import { InstallPanel } from '../terminal/InstallPanel'
import { useInstallInfo, useSettings } from '../terminal/state'
import { useTheme } from '../theme'

export function Section({ id, title, desc, children }: { id: string; title: string; desc?: string; children: ReactNode }) {
  return (
    <section id={id} aria-label={title} className="rounded-lg border border-border bg-surface p-5 shadow-[var(--shadow-card)]">
      <h2 className="flex items-center gap-1.5 text-[14px] font-semibold text-text">
        {title}
        {desc && <InfoTip text={desc} />}
      </h2>
      <div className="mt-4 flex flex-col gap-4">{children}</div>
    </section>
  )
}

function InfoTip({ text }: { text: string }) {
  return (
    <span title={text} tabIndex={0} aria-label={text} className="inline-flex cursor-help text-text-3 transition-colors outline-none hover:text-text-2 focus-visible:text-text-2">
      <Info size={13} strokeWidth={1.9} />
    </span>
  )
}

export function Row({ label, hint, alert, children }: { label: string; hint?: string; alert?: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-6">
      <div className="min-w-0 pt-1.5">
        <div className="flex items-center gap-1.5 text-[13px] text-text">
          {label}
          {hint && <InfoTip text={hint} />}
        </div>
        {alert && <div className="mt-0.5 text-xs text-warning">{alert}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={'relative mt-1 h-5 w-9 rounded-full transition-colors ' + (checked ? 'bg-brand' : 'bg-border-strong')}
    >
      <span className={'absolute top-0.5 size-4 rounded-full bg-white shadow transition-all ' + (checked ? 'left-[18px]' : 'left-0.5')} />
    </button>
  )
}

export function TextSetting({ value, onSave, placeholder, mono = true, width = 'w-72' }: { value: string; onSave: (v: string) => void; placeholder?: string; mono?: boolean; width?: string }) {
  const [v, setV] = useState(value)
  useEffect(() => setV(value), [value])
  return (
    <input
      value={v}
      placeholder={placeholder}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => v !== value && onSave(v)}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      className={`h-8 ${width} rounded-md border border-border-strong bg-bg-raised px-2.5 text-[13px] text-text outline-none focus:border-brand ${mono ? 'font-mono' : ''}`}
    />
  )
}

function Segmented<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return <Seg value={value} onChange={onChange} options={options.map(([v, label]) => ({ value: v, label }))} />
}

export type SettingsPane = 'claude-code' | 'appearance' | 'notify' | 'network'

export function SettingsPage({ pane }: { pane: SettingsPane }) {
  const s = useSettings()
  const [install] = useInstallInfo()
  const { theme, set: setTheme } = useTheme()
  const account = useAccount()
  const [term, setTerm] = useState<TerminalInfo | null>(null)
  const [models, setModels] = useState<ModelInfo[]>([])
  const [error, setError] = useState<string | null>(null)
  const [sandbox, setSandbox] = useState(false)

  useEffect(() => {
    void window.ccshell.app.sandboxProfile().then((r) => r.ok && setSandbox(r.data))
  }, [])
  useEffect(() => {
    void window.ccshell.terminal.info().then((r) => r.ok && setTerm(r.data))
  }, [install?.own?.version, install?.own?.path, s?.claudeCode.binary, s?.claudeCode.binaryPath])
  useEffect(() => {
    if (!account.activeKey) return
    void window.ccshell.chat.models().then((r) => r.ok && setModels(r.data.filter((m) => m.protocol === 'anthropic')))
  }, [account.activeKey])

  if (!s) return null
  const save = async (patch: SettingsPatch) => {
    setError(null)
    const r = await window.ccshell.settings.update(patch)
    if (!r.ok) setError(r.error)
  }
  const cc = s.claudeCode
  const net = s.network
  const modelOptions = (value: string, allowEmpty: boolean) => (
    <>
      {allowEmpty && <option value="">（未设置，使用 Claude Code 默认值）</option>}
      {value && !models.some((m) => m.id === value) && <option value={value}>{value}</option>}
      {models.map((m) => (
        <option key={m.id} value={m.id}>
          {m.id}
        </option>
      ))}
    </>
  )
  const select = 'h-8 w-72 rounded-md border border-border-strong bg-bg-raised px-2 font-mono text-[13px] text-text outline-none focus:border-brand disabled:opacity-50'
  const mapKeys: [keyof AppSettings['claudeCode']['modelMap'], string][] = [
    ['opus', 'opus 别名'],
    ['sonnet', 'sonnet 别名'],
    ['haiku', 'haiku 别名 / 后台模型'],
    ['subagent', '子代理']
  ]

  return (
    <div className="h-full overflow-y-auto">
      <div className="flex max-w-4xl flex-col gap-5 px-8 py-6">
        {error && <p className="text-[13px] text-danger select-text">{error}</p>}

        {pane === 'claude-code' && (
        <>
        <Section id="claude-code" title="安装与版本" desc="客户端安装的 Claude Code 位于客户端数据目录。">
          <Row label="使用" hint="自动：优先使用客户端安装的版本，其次使用本机已安装的版本（官方安装程序、npm 全局安装或 PATH）。本机已安装：只使用本机已安装的版本。指定文件：使用选定的 claude.exe">
            <Segmented
              value={cc.binary}
              options={[
                ['auto', '自动'],
                ['system', '本机已安装'],
                ['custom', '指定文件']
              ]}
              onChange={(v) => void save({ claudeCode: { binary: v } })}
            />
          </Row>
          <div className="flex items-center gap-4 rounded-lg border border-border bg-bg-raised px-4 py-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px]">
                <span className="text-text-3">当前使用</span>
                {term?.claudePath ? (
                  <>
                    <span className="font-mono font-medium text-text">{term.version ?? '版本未知'}</span>
                    <span className="rounded-full border border-border bg-surface px-2 py-px text-[11.5px] text-text-2">{term.claudeSource}</span>
                  </>
                ) : (
                  <span className="text-warning">{term?.claudeSource ?? '未找到'}</span>
                )}
              </div>
              {(term?.claudePath || (cc.binary === 'custom' && cc.binaryPath)) && (
                <div className="mt-1 truncate font-mono text-[11.5px] text-text-3" title={term?.claudePath || cc.binaryPath}>
                  {term?.claudePath || cc.binaryPath}
                </div>
              )}
            </div>
            {cc.binary === 'custom' && (
              <button
                className="btn btn-secondary h-8 shrink-0 px-3 text-[13px]"
                onClick={async () => {
                  const r = await window.ccshell.terminal.pickClaude()
                  if (r.ok && r.data) void save({ claudeCode: { binary: 'custom', binaryPath: r.data } })
                }}
              >
                {cc.binaryPath ? '更换文件…' : '选择 claude.exe…'}
              </button>
            )}
          </div>
          <InstallPanel />
        </Section>

        <Section id="launch" title="启动参数" desc="对之后启动的会话生效，不影响正在运行的会话。">
          <Row label="默认模型" hint="新会话的默认模型；在新会话页中更改时同步更新">
            <Select className={select} value={cc.model} onChange={(e) => void save({ claudeCode: { model: e.target.value } })}>
              {modelOptions(cc.model, false)}
            </Select>
          </Row>
          <Row label="其他模型统一使用默认模型" hint="子代理、后台模型及 opus / sonnet / haiku 别名均使用默认模型。密钥仅开通部分模型时建议开启">
            <Toggle label="其他模型统一使用默认模型" checked={cc.allModels} onChange={(v) => void save({ claudeCode: { allModels: v } })} />
          </Row>
          <div className={'flex flex-col gap-2.5 rounded-md border border-border px-3 py-3 ' + (cc.allModels ? 'opacity-50' : '')}>
            <p className="text-xs text-text-3">模型映射（关闭上一项时生效）</p>
            {mapKeys.map(([k, label]) => (
              <Row key={k} label={label}>
                <Select disabled={cc.allModels} className={select} value={cc.modelMap[k]} onChange={(e) => void save({ claudeCode: { modelMap: { ...cc.modelMap, [k]: e.target.value } } })}>
                  {modelOptions(cc.modelMap[k], true)}
                </Select>
              </Row>
            ))}
          </div>
          <Row label="权限模式" hint={(PERMISSION_MODES.find((m) => m[0] === cc.permissionMode)?.[2] ?? '') + '。对新启动或重新启动的会话生效；会话中可按 Shift+Tab 临时切换'}>
            <Select className={select} value={cc.permissionMode} onChange={(e) => void save({ claudeCode: { permissionMode: e.target.value as PermissionMode } })}>
              {PERMISSION_MODES.map(([v, label]) => (
                <option key={v} value={v}>
                  {label}
                </option>
              ))}
            </Select>
          </Row>
          <Row label="额外参数" hint="追加到 claude 命令之后，例如 --verbose；含空格的值请使用双引号">
            <TextSetting value={cc.extraArgs} placeholder="（无）" onSave={(v) => void save({ claudeCode: { extraArgs: v } })} />
          </Row>
        </Section>
        </>
        )}

        {pane === 'appearance' && (
        <Section id="appearance" title="主题与窗口">
          <Row label="主题">
            <Segmented
              value={theme}
              options={[
                ['light', '浅色'],
                ['dark', '深色']
              ]}
              onChange={setTheme}
            />
          </Row>
          <Row label="开机启动" hint={sandbox ? '演示 / 测试环境仅保存设置，不注册开机启动' : '登录 Windows 后自动启动 CC Shell'}>
            <Toggle label="开机启动" checked={s.appearance.openAtLogin} onChange={(v) => void save({ appearance: { openAtLogin: v } })} />
          </Row>
          <Row label="关闭窗口时最小化到托盘" hint="点击 × 仅隐藏窗口，会话继续运行；可通过托盘菜单退出">
            <Toggle label="关闭窗口时最小化到托盘" checked={s.appearance.closeToTray} onChange={(v) => void save({ appearance: { closeToTray: v } })} />
          </Row>
          <Row
            label="退出时仍有会话运行"
            hint={
              s.appearance.onQuit === 'detach'
                ? '每个会话转入独立的终端窗口继续运行；再次打开 CC Shell 时可收回。关闭终端窗口将正常结束该会话'
                : s.appearance.onQuit === 'end'
                  ? '结束全部会话（保留对话记录，之后可基于该对话重新启动）'
                  : '退出时询问：分离到终端窗口继续运行，或全部结束'
            }
          >
            <Select className={select} value={s.appearance.onQuit} onChange={(e) => void save({ appearance: { onQuit: e.target.value as QuitAction } })}>
              <option value="ask">每次询问</option>
              <option value="detach">分离到终端窗口继续运行</option>
              <option value="end">全部结束</option>
            </Select>
          </Row>
        </Section>
        )}

        {(pane === 'appearance' || pane === 'notify') && <NotifySections s={s} save={save} pane={pane} />}

        {pane === 'network' && (
        <Section id="network" title="npm 源和代理" desc="安装、更新 Claude Code 时 npm 使用的源和代理。对话与 Claude Code 的请求使用系统代理，不受此处影响。">
          <Row label="npm 源">
            <Segmented
              value={net.registry}
              options={[
                ['official', '官方'],
                ['npmmirror', '国内镜像'],
                ['custom', '自定义']
              ]}
              onChange={(v) => void save({ network: { registry: v } })}
            />
          </Row>
          {net.registry === 'custom' ? (
            <Row label="自定义源地址">
              <TextSetting value={net.customRegistry} placeholder="https://registry.example.com/" onSave={(v) => void save({ network: { customRegistry: v } })} />
            </Row>
          ) : (
            <p className="-mt-2 text-right font-mono text-[11px] text-text-3">{REGISTRIES[net.registry]}</p>
          )}
          <Row label="代理" hint={net.proxy === 'system' ? '使用 Windows 系统代理；未设置时直接连接' : undefined}>
            <Segmented
              value={net.proxy}
              options={[
                ['system', '跟随系统'],
                ['none', '不使用'],
                ['custom', '自定义']
              ]}
              onChange={(v) => void save({ network: { proxy: v } })}
            />
          </Row>
          {net.proxy === 'custom' && (
            <Row label="代理地址" hint="HTTP 代理，例如 http://127.0.0.1:7890">
              <TextSetting value={net.customProxy} placeholder="http://127.0.0.1:7890" onSave={(v) => void save({ network: { customProxy: v } })} />
            </Row>
          )}
        </Section>
        )}
      </div>
    </div>
  )
}

const MINUTES = [1, 2, 3, 5, 10, 15, 30]

const showKey = (k: string) => k.replace(/Control/g, 'Ctrl').replace(/\+/g, ' + ')

function accelerator(e: React.KeyboardEvent): string | null {
  const mods = [e.ctrlKey && 'Control', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Super'].filter(Boolean) as string[]
  const k = e.key
  if (['Control', 'Alt', 'Shift', 'Meta'].includes(k)) return null
  const key = /^[a-z0-9]$/i.test(k) ? k.toUpperCase() : /^F\d{1,2}$/.test(k) ? k : k === ' ' ? 'Space' : null
  if (!key || !mods.length) return null
  return [...mods, key].join('+')
}

function HotkeyInput({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [recording, setRecording] = useState(false)
  return (
    <button
      onClick={() => setRecording(true)}
      onBlur={() => setRecording(false)}
      onKeyDown={(e) => {
        if (!recording) return
        e.preventDefault()
        if (e.key === 'Escape') return setRecording(false)
        const acc = accelerator(e)
        if (acc) {
          setRecording(false)
          onSave(acc)
        }
      }}
      className={'h-8 w-48 rounded-md border px-2.5 text-left font-mono text-[13px] ' + (recording ? 'border-brand text-text-3' : 'border-border-strong bg-bg-raised text-text')}
    >
      {recording ? '请按下组合键…' : value ? showKey(value) : '（未设置）'}
    </button>
  )
}

function NotifySections({ s, save, pane }: { s: AppSettings; save: (p: SettingsPatch) => Promise<void>; pane: 'appearance' | 'notify' }) {
  const [hotkeyErr, setHotkeyErr] = useState<string | null>(null)
  useEffect(() => {
    void window.ccshell.maintenance.hotkeyStatus().then((r) => r.ok && setHotkeyErr(r.data.error))
  }, [s.hotkey.global])
  const minuteSelect = (value: number, onChange: (v: number) => void, withOff: boolean, disabled = false) => (
    <Select
      disabled={disabled}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="h-8 w-36 rounded-md border border-border-strong bg-bg-raised px-2 text-[13px] text-text outline-none focus:border-brand disabled:opacity-50"
    >
      {withOff && <option value={0}>关闭</option>}
      {!MINUTES.includes(value) && value > 0 && <option value={value}>{value} 分钟</option>}
      {MINUTES.map((m) => (
        <option key={m} value={m}>
          {m} 分钟
        </option>
      ))}
    </Select>
  )
  if (pane === 'appearance')
    return (
      <Section id="float" title="悬浮窗与快捷键">
        <Row label="悬浮窗" hint="置顶显示各会话的状态与持续时间，点击可跳转。也可从托盘菜单或 Ctrl+K 开启">
          <Toggle label="悬浮窗" checked={s.float.enabled} onChange={(v) => void save({ float: { enabled: v } })} />
        </Row>
        <Row label="全局热键" hint="在任意程序中唤出客户端，客户端已在前台时将其隐藏。点击输入框后按下新组合键" alert={hotkeyErr ?? undefined}>
          <div className="flex items-center gap-2">
            <HotkeyInput value={s.hotkey.global} onSave={(v) => void save({ hotkey: { global: v } })} />
            {s.hotkey.global && (
              <button className="text-xs text-text-3 hover:text-text" onClick={() => void save({ hotkey: { global: '' } })}>
                清除
              </button>
            )}
          </div>
        </Row>
        <div className="rounded-md border border-border px-3 py-2.5 text-xs leading-relaxed text-text-2">
          <div className="grid grid-cols-[220px_1fr] gap-y-1">
            <span className="font-mono">Ctrl+K / Ctrl+Shift+P</span>
            <span>搜索与跳转（焦点位于终端时请使用 Ctrl+Shift+P）</span>
            <span className="font-mono">Ctrl+Tab / Ctrl+Shift+Tab</span>
            <span>切换至下一个 / 上一个会话</span>
            <span className="font-mono">Ctrl+1 … Ctrl+9</span>
            <span>切换至对应序号的会话（与会话列表顺序一致）</span>
            <span className="font-mono">Ctrl+Shift+N</span>
            <span>新会话</span>
            <span className="font-mono">Ctrl+,</span>
            <span>打开设置</span>
          </div>
        </div>
      </Section>
    )
  return (
    <>
      <Section id="notify" title="桌面通知" desc="通知显示在屏幕右下角，不进入 Windows 通知中心；点击可返回对应会话。需保持客户端运行（可在托盘中）。">
        <Row label="回答完成" hint="Claude 完成一轮回答时通知；正在查看该会话时不通知，15 秒内多次完成仅通知一次">
          <Toggle label="回答完成" checked={s.notify.done} onChange={(v) => void save({ notify: { done: v } })} />
        </Row>
        <Row label="需要处理" hint="权限确认、Claude 提问、疑似停滞">
          <Toggle label="需要处理" checked={s.notify.attention} onChange={(v) => void save({ notify: { attention: v } })} />
        </Row>
        <Row label="异常" hint="回答出错、会话异常退出、自动继续未完成">
          <Toggle label="异常" checked={s.notify.problem} onChange={(v) => void save({ notify: { problem: v } })} />
        </Row>
        <Row label="提示音" hint="三类通知各有对应提示音">
          <Toggle label="提示音" checked={s.notify.sound} onChange={(v) => void save({ notify: { sound: v } })} />
        </Row>
      </Section>

      <Section id="stuck" title="停滞提醒与自动继续" desc="会话长时间处于“处理中”且无新输出（如请求挂起、命令等待输入）时发出提醒，或自动中断后继续。长时间无输出的构建、测试同样会被计入。">
        <Row label="提醒" hint="会话状态标为橙色、托盘图标显示提示，并发送“需要处理”通知">
          {minuteSelect(s.stuck.remindMinutes, (v) => void save({ stuck: { remindMinutes: v } }), true)}
        </Row>
        <Row label="停滞时自动继续" hint={`发送 Esc 中断当前回合，确认停止后发送下方文本；同一对话连续 3 次未正常结束则不再自动处理`}>
          <Toggle label="停滞时自动继续" checked={s.stuck.autoContinue} onChange={(v) => void save({ stuck: { autoContinue: v } })} />
        </Row>
        <Row label="判定停滞的时长">{minuteSelect(s.stuck.autoMinutes, (v) => void save({ stuck: { autoMinutes: v } }), false, !s.stuck.autoContinue)}</Row>
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between text-[13px] text-text">
            继续时发送的文本（手动“续跑”同样使用）
            <button className="text-xs text-text-3 hover:text-text" onClick={() => void save({ stuck: { continueText: '' } })}>
              恢复默认
            </button>
          </div>
          <TextArea value={s.stuck.continueText} onSave={(v) => void save({ stuck: { continueText: v } })} />
        </div>
      </Section>

      <Section id="queue" title="队列" desc="会话下方的队列：每轮回答结束、空闲约 2 秒后发送下一条。遇到错误、Esc 中断或 /pause 时暂停。">
        <Row label="额度耗尽时自动继续" hint="队列消息遇到额度耗尽时，在其后追加下方文本，于额度重置时（时间未知则每 15 分钟）自动继续，最多 6 次；服务器临时错误按 2、5、10 分钟间隔重试">
          <Toggle label="额度耗尽时自动继续" checked={s.queue.autoResume} onChange={(v) => void save({ queue: { autoResume: v } })} />
        </Row>
        <Row label="自动继续时发送的文本">
          <TextSetting value={s.queue.continueText} mono={false} onSave={(v) => void save({ queue: { continueText: v } })} />
        </Row>
      </Section>
    </>
  )
}

function TextArea({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [v, setV] = useState(value)
  useEffect(() => setV(value), [value])
  return (
    <textarea
      value={v}
      rows={3}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => v !== value && onSave(v)}
      className="w-full resize-y rounded-md border border-border-strong bg-bg-raised px-2.5 py-2 text-[13px] text-text outline-none focus:border-brand"
    />
  )
}
