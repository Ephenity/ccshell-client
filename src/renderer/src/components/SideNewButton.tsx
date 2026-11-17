import { Plus } from 'lucide-react'
import type { ReactNode } from 'react'

export function SideNewButton(props: { label: string; active?: boolean; onClick: () => void; extra?: ReactNode; guide?: string }) {
  return (
    <div className="flex gap-1.5 p-3">
      <button
        data-guide={props.guide}
        aria-current={props.active ? 'page' : undefined}
        onClick={props.onClick}
        className={'btn h-9 min-w-0 flex-1 justify-start px-3 ' + (props.active ? SIDE_ACTIVE : 'btn-secondary')}
      >
        <Plus size={16} className="shrink-0" />
        <span className="truncate">{props.label}</span>
      </button>
      {props.extra}
    </div>
  )
}

export function SideIconButton(props: { label: string; active?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      title={props.label}
      aria-label={props.label}
      aria-current={props.active ? 'page' : undefined}
      onClick={props.onClick}
      className={'btn h-9 w-9 shrink-0 px-0 ' + (props.active ? SIDE_ACTIVE : 'btn-secondary')}
    >
      {props.children}
    </button>
  )
}

const SIDE_ACTIVE = 'side-active'
