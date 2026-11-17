import { Segmented } from '../components/Segmented'
import { Check, ChevronDown, Minus, Plus, SlidersHorizontal, X } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { ChatSettings, ModelInfo, ModelPrice } from '../../../shared/chat'
import { AUTO_OUTPUT, EFFORT_LABEL, modelCaps, resolveEffort, thinkingActive } from '../../../shared/modelCaps'
import { TopStrip } from '../components/TitleBar'

export function ChatHeader({ title, assistant, line }: { title: string; assistant?: string; line: boolean }) {
  return (
    <TopStrip line={line}>
      {assistant && <span className="shrink-0 rounded-sm bg-brand-soft px-2 py-0.5 text-xs text-brand-text">{assistant}</span>}
      <h2 className="min-w-0 flex-1 truncate font-serif text-[14.5px] font-semibold">{title}</h2>
    </TopStrip>
  )
}

export function ParamsPicker({ settings, disabled, onChange }: { settings: ChatSettings; disabled?: boolean; onChange: (patch: Partial<ChatSettings>) => void }) {
  const [panel, setPanel] = useState(false)
  return (
    <div className="relative">
      <button
        className={'btn h-8 px-2 ' + (panel ? 'bg-surface-2 text-text' : 'btn-ghost text-text-2')}
        title="对话参数：系统提示词、思考、温度、最大输出"
        aria-label="对话参数"
        disabled={disabled}
        onClick={() => setPanel(!panel)}
      >
        <SlidersHorizontal size={15} />
      </button>
      {panel && <SettingsPanel settings={settings} onChange={onChange} onClose={() => setPanel(false)} />}
    </div>
  )
}

export function useClickOutside(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && close()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, close])
  return ref
}

const per = (p: ModelPrice, n: number) => `${p.symbol}${n < 1 ? n.toFixed(3) : n.toFixed(2)}`

function priceLine(m: ModelInfo): string {
  const p = m.price
  if (!p) return '价格未知'
  if (p.perRequest !== undefined) return `${per(p, p.perRequest)} / 次`
  return `输入 ${per(p, p.input)} · 输出 ${per(p, p.output)} / 百万 token${p.tiered ? '（分档）' : ''}`
}

export function ModelPicker(props: { value: string; models: ModelInfo[]; error: string | null; disabled?: boolean; onChange: (m: string) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useClickOutside(open, () => setOpen(false))
  const known = props.models.some((m) => m.id === props.value)
  return (
    <div ref={ref} className="relative">
      <button
        className="btn btn-ghost h-8 gap-1 px-2 font-mono text-xs"
        disabled={props.disabled}
        onClick={() => setOpen(!open)}
        title={known || !props.models.length ? '选择模型' : '当前密钥未开通此模型'}
      >
        <span className={known || !props.models.length ? '' : 'text-warning'}>{props.value}</span>
        <ChevronDown size={14} />
      </button>
      {open && (
        <div className="anim-pop-up absolute bottom-full left-0 z-20 mb-1 w-[26rem] rounded-md border border-border-strong bg-surface p-1 shadow-[var(--shadow-card)]">
          {props.error && <p className="px-3 py-2 text-xs text-danger">{props.error}</p>}
          {!props.error && !props.models.length && <p className="px-3 py-2 text-xs text-text-3">登录后显示可用模型</p>}
          {props.models.map((m) => (
            <button
              key={m.id}
              onClick={() => {
                props.onChange(m.id)
                setOpen(false)
              }}
              className="flex w-full items-start gap-2 rounded-sm px-3 py-2 text-left hover:bg-surface-2"
            >
              <span className="mt-0.5 w-4 shrink-0 text-brand-text">{m.id === props.value && <Check size={14} />}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-mono text-[13px]">{m.id}</span>
                <span className="block text-xs text-text-3">
                  {m.protocol === 'anthropic' ? 'Anthropic 接口' : 'OpenAI 兼容接口'} · {priceLine(m)}
                </span>
              </span>
            </button>
          ))}
          <p className="border-t border-border px-3 pt-2 pb-1 text-xs text-text-3">仅列出当前密钥已开通的模型</p>
        </div>
      )}
    </div>
  )
}

function SettingsPanel(props: { settings: ChatSettings; onChange: (p: Partial<ChatSettings>) => void; onClose: () => void }) {
  const s = props.settings
  const ref = useClickOutside(true, props.onClose)
  const [prompt, setPrompt] = useState(s.systemPrompt)
  const caps = modelCaps(s.model)
  const thinkingOn = thinkingActive(caps, s.thinking)
  const effort = resolveEffort(s.effort, caps, thinkingOn) ?? caps.defaultEffort
  const tempHint = !caps.sampling ? '此模型不支持调整温度' : thinkingOn ? '开启思考时温度不生效' : '数值越低越稳定，越高越多样'
  const tempOff = !caps.sampling || thinkingOn

  return (
    <div ref={ref} className="anim-pop-up absolute right-0 bottom-full z-20 mb-2 flex max-h-[70vh] w-96 overflow-y-auto flex-col gap-4 rounded-lg border border-border-strong bg-surface p-4 shadow-[var(--shadow-card)]">
      <div className="flex items-center justify-between">
        <h3 className="text-[14px] font-semibold text-text">对话参数</h3>
        <button className="text-text-3 hover:text-text" onClick={props.onClose} title="关闭">
          <X size={16} />
        </button>
      </div>

      <Field label="系统提示词" hint="对此对话的全部回复生效">
        <textarea
          value={prompt}
          rows={4}
          placeholder="例如：你是一名资深前端工程师，回答简洁，代码用 TypeScript。"
          onChange={(e) => setPrompt(e.target.value)}
          onBlur={() => prompt !== s.systemPrompt && props.onChange({ systemPrompt: prompt })}
          className="w-full resize-y rounded-md border border-border-strong bg-bg-raised px-3 py-2 text-[13px] outline-none focus:border-brand"
        />
      </Field>

      {caps.thinking !== 'none' && (
        <Field label="思考" hint={caps.thinking === 'always' ? '此模型始终先思考，可调整思考强度' : undefined}>
          {caps.thinking !== 'always' && (
            <Segmented
              block
              size="sm"
              value={thinkingOn ? 'on' : 'off'}
              onChange={(v) => props.onChange({ thinking: v === 'on' ? (caps.thinking === 'budget' ? 'budget' : 'adaptive') : 'off' })}
              options={[
                { value: 'off', label: '关闭', title: '直接回答' },
                { value: 'on', label: caps.thinking === 'budget' ? '固定预算' : '自适应', title: caps.thinking === 'budget' ? '按预算思考' : '由模型决定思考深度' }
              ]}
            />
          )}
          {caps.efforts && effort && (
            <Segmented
              block
              size="sm"
              value={effort}
              onChange={(v) => props.onChange({ effort: v === caps.defaultEffort ? null : v })}
              options={caps.efforts.map((e) => ({
                value: e,
                label: EFFORT_LABEL[e],
                title: e === caps.defaultEffort ? '模型默认' : undefined,
                disabled: !thinkingOn && caps.offMaxHigh && (e === 'xhigh' || e === 'max')
              }))}
            />
          )}
          {caps.thinking === 'budget' && thinkingOn && (
            <NumberInput label="思考预算（token）" value={s.thinkingBudget} min={1024} max={caps.maxOutput - 1024} step={1024} onChange={(v) => props.onChange({ thinkingBudget: v })} />
          )}
        </Field>
      )}

      <Field label="温度" hint={tempHint}>
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            disabled={tempOff || s.temperature === null}
            value={s.temperature ?? 1}
            onChange={(e) => props.onChange({ temperature: Number(e.target.value) })}
            className="flex-1 accent-[var(--brand)]"
          />
          <span className="w-10 text-right font-mono text-xs">{s.temperature === null ? '默认' : s.temperature.toFixed(2)}</span>
          <label className="flex items-center gap-1 text-xs text-text-2">
            <input
              type="checkbox"
              checked={s.temperature === null}
              disabled={tempOff}
              onChange={(e) => props.onChange({ temperature: e.target.checked ? null : 1 })}
              className="accent-[var(--brand)]"
            />
            默认
          </label>
        </div>
      </Field>

      <Field label="最大输出（token）" hint={s.maxOutputTokens > 0 ? `此模型最多 ${caps.maxOutput.toLocaleString()}` : caps.thinking === 'none' ? '由服务端决定' : `自动：${Math.min(AUTO_OUTPUT, caps.maxOutput).toLocaleString()}（含思考）`}>
        <div className="flex items-center gap-3">
          {s.maxOutputTokens > 0 ? (
            <NumberInput label="" value={Math.min(s.maxOutputTokens, caps.maxOutput)} min={256} max={caps.maxOutput} step={1024} onChange={(v) => props.onChange({ maxOutputTokens: v })} />
          ) : (
            <span className="flex-1 font-mono text-xs text-text-2">自动</span>
          )}
          <label className="flex shrink-0 items-center gap-1 text-xs text-text-2">
            <input
              type="checkbox"
              checked={s.maxOutputTokens <= 0}
              onChange={(e) => props.onChange({ maxOutputTokens: e.target.checked ? 0 : Math.min(AUTO_OUTPUT, caps.maxOutput) })}
              className="accent-[var(--brand)]"
            />
            自动
          </label>
        </div>
      </Field>
      <p className="-mt-2 text-xs text-text-3">新对话沿用最近一次的参数</p>
    </div>
  )
}

function Field(props: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between">
        <span className="text-[13px] text-text-2">{props.label}</span>
        {props.hint && <span className="text-xs text-text-3">{props.hint}</span>}
      </div>
      {props.children}
    </div>
  )
}

function NumberInput(props: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void }) {
  const [text, setText] = useState(String(props.value))
  useEffect(() => setText(String(props.value)), [props.value])
  const clamp = (n: number) => Math.min(props.max, Math.max(props.min, n))
  const set = (v: number) => {
    setText(String(v))
    if (v !== props.value) props.onChange(v)
  }
  const commit = () => {
    const n = Math.round(Number(text.replace(/[,\s]/g, '')))
    if (!text.trim() || !Number.isFinite(n)) return setText(String(props.value))
    set(clamp(n))
  }
  const nudge = (dir: 1 | -1) => {
    const cur = clamp(Math.round(Number(text)) || props.value)
    const next = dir > 0 ? Math.floor(cur / props.step) * props.step + props.step : Math.ceil(cur / props.step) * props.step - props.step
    set(clamp(next))
  }
  const stepBtn = 'flex h-full w-8 shrink-0 items-center justify-center text-text-3 transition-colors hover:bg-surface-2 hover:text-text disabled:pointer-events-none disabled:opacity-35'
  return (
    <label className={'flex items-center justify-between gap-3 text-[13px] text-text-2' + (props.label ? '' : ' min-w-0 flex-1')}>
      {props.label}
      <div className={'flex h-8 items-stretch overflow-hidden rounded-sm border border-border-strong bg-bg-raised focus-within:border-brand ' + (props.label ? 'w-40' : 'min-w-0 flex-1')}>
        <button type="button" tabIndex={-1} aria-label="减少" disabled={props.value <= props.min} onClick={() => nudge(-1)} className={stepBtn + ' border-r border-border'}>
          <Minus size={13} />
        </button>
        <input
          type="text"
          inputMode="numeric"
          value={text}
          onChange={(e) => setText(e.target.value.replace(/[^\d]/g, ''))}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit()
            else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
              e.preventDefault()
              nudge(e.key === 'ArrowUp' ? 1 : -1)
            }
          }}
          className="min-w-0 flex-1 bg-transparent px-2 text-center font-mono text-[13px] text-text outline-none"
        />
        <button type="button" tabIndex={-1} aria-label="增加" disabled={props.value >= props.max} onClick={() => nudge(1)} className={stepBtn + ' border-l border-border'}>
          <Plus size={13} />
        </button>
      </div>
    </label>
  )
}
