import { TITLE_BAR_HEIGHT } from '../../../shared/theme'
import { LogoMark } from './LogoMark'
import { MAIN_ASIDE, useAsideWidth } from './ResizableAside'
import { WorkspaceSwitch } from './WorkspaceSwitch'

const SWITCH_WIDTH = 74
const SWITCH_GAP = 10

export function TitleBar({ workspace, onWorkspace }: { workspace: 'chat' | 'code' | null; onWorkspace: (w: 'chat' | 'code') => void }) {
  const aside = useAsideWidth(MAIN_ASIDE.id, MAIN_ASIDE.defaultWidth, MAIN_ASIDE.min, MAIN_ASIDE.max)
  const left = Math.max(16 + 22 + 14, aside - SWITCH_WIDTH - SWITCH_GAP)
  return (
    <header className="drag absolute top-0 left-0 z-20 flex items-center pl-4" style={{ height: TITLE_BAR_HEIGHT, width: aside - 1 }}>
      <LogoMark size={22} />
      <div data-guide="switch" className="absolute top-1/2 -translate-y-1/2" style={{ left }}>
        <WorkspaceSwitch value={workspace} onChange={onWorkspace} />
      </div>
    </header>
  )
}

export const TITLE_RESERVE = 150

export function TopStrip({ children, line = true, className = '' }: { children?: React.ReactNode; line?: boolean; className?: string }) {
  return (
    <div
      className={'drag flex shrink-0 items-center gap-2 border-b pl-5 transition-colors duration-150 ' + (line ? 'border-border ' : 'border-transparent ') + className}
      style={{ height: TITLE_BAR_HEIGHT, paddingRight: TITLE_RESERVE }}
    >
      {children}
    </div>
  )
}
