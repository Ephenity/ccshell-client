import { Brain, Check } from 'lucide-react'
import { useState } from 'react'
import type { ChatSettings } from '../../../shared/chat'
import { EFFORT_LABEL, modelCaps, resolveEffort, thinkingActive, type Effort } from '../../../shared/modelCaps'
import { useClickOutside } from './ChatHeader'

type Picked = Pick<ChatSettings, 'model' | 'thinking' | 'thinkingBudget' | 'effort'>

const EFFORT_DESC: Record<Effort, string> = {
  low: '最快、最省，适合简单问答',
  medium: '速度与质量兼顾',
  high: '复杂问题、写代码',
  xhigh: '更深入，适合长任务与编程',
  max: '不计成本，追求最好结果'
}

export function ThinkingPicker(props: { value: Picked; disabled?: boolean; onChange: (patch: Partial<Picked>) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useClickOutside(open, () => setOpen(false))
  const v = props.value
  const caps = modelCaps(v.model)
  if (caps.thinking === 'none') return null
  const active = thinkingActive(caps, v.thinking)
  const effort = resolveEffort(v.effort, caps, active) ?? caps.defaultEffort
  const canToggle = caps.thinking !== 'always'
  const label = !active ? '思考' : effort && caps.efforts ? `思考 · ${EFFORT_LABEL[effort]}` : '思考'

  return (
    <div ref={ref} className="relative">
      <button
        className={'btn h-8 gap-1 px-2 text-xs ' + (active ? 'bg-brand-soft text-brand-text' : 'btn-ghost')}
        disabled={props.disabled}
        title="思考与思考强度"
        onClick={() => setOpen(!open)}
      >
        <Brain size={15} />
        {label}
      </button>
      {open && (
        <div className="anim-pop-up absolute bottom-full left-0 z-20 mb-1 w-52 rounded-md border border-border-strong bg-surface p-1 shadow-[var(--shadow-card)]">
          {canToggle && (
            <button
              className="flex w-full items-center gap-2 rounded-sm px-3 py-2 text-left text-[13px] hover:bg-surface-2"
              onClick={() => props.onChange({ thinking: active ? 'off' : caps.thinking === 'budget' ? 'budget' : 'adaptive' })}
            >
              <span className="flex-1">先思考再回答</span>
              <Switch on={active} />
            </button>
          )}
          {caps.efforts && (
            <>
              {canToggle && <div className="mx-2 my-1 border-t border-border" />}
              <div className="px-3 pt-1.5 pb-1 text-[11.5px] font-medium text-text-3">思考强度</div>
              {caps.efforts.map((e) => {
                const blocked = !active && caps.offMaxHigh && (e === 'xhigh' || e === 'max')
                const on = e === effort
                return (
                  <button
                    key={e}
                    disabled={blocked}
                    title={blocked ? '开启思考后可用' : EFFORT_DESC[e]}
                    data-tip-place="right"
                    className="flex w-full items-center gap-2 rounded-sm px-3 py-1.5 text-left hover:bg-surface-2 disabled:opacity-40 disabled:hover:bg-transparent"
                    onClick={() => {
                      props.onChange({ effort: e === caps.defaultEffort ? null : e })
                      setOpen(false)
                    }}
                  >
                    <span className={'min-w-0 flex-1 text-[13px] ' + (on ? 'font-medium text-text' : 'text-text-2')}>
                      {EFFORT_LABEL[e]}
                      {e === caps.defaultEffort && <span className="ml-1.5 text-[11.5px] font-normal text-text-3">默认</span>}
                    </span>
                    {on && <Check size={14} className="shrink-0 text-brand-text" />}
                  </button>
                )
              })}
            </>
          )}
          {caps.thinking === 'budget' && active && (
            <p className="px-3 pt-1 pb-2 text-[11.5px] text-text-3">思考预算 {v.thinkingBudget.toLocaleString()} token，可在对话参数中修改</p>
          )}
        </div>
      )}
    </div>
  )
}

function Switch({ on }: { on: boolean }) {
  return (
    <span className={'relative inline-flex h-[18px] w-8 shrink-0 rounded-full transition-colors ' + (on ? 'bg-brand' : 'bg-border-strong')}>
      <span className={'absolute top-[2px] left-[2px] size-[14px] rounded-full bg-white shadow transition-transform ' + (on ? 'translate-x-[14px]' : '')} />
    </span>
  )
}
