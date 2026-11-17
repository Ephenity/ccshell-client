import { Segmented } from '../components/Segmented'
import { LIBRARY_TABS, type LibraryTab } from '../pages'
import { AgentPage } from './AgentPage'
import { KnowledgePage } from './KnowledgePage'
import { McpPage } from './McpPage'
import { PromptsPage } from './PromptsPage'

export function LibraryPage(props: {
  tab: LibraryTab
  onTab: (t: LibraryTab) => void
  onStartConversation: (id: string) => void
  onOpenSession: (id: string) => void
}) {
  const { tab, onTab } = props
  return (
    <div className="flex h-full flex-col">
      <header className="flex h-12 shrink-0 items-center gap-1 border-b border-border px-4">
        <h1 className="mr-3 font-serif text-[15px] font-semibold">资源库</h1>
        <Segmented aria-label="资源库" value={tab} onChange={onTab} options={LIBRARY_TABS.map((t) => ({ value: t.id, label: t.label, icon: t.icon }))} />
      </header>
      <div key={tab} className="anim-fade min-h-0 flex-1">
        {tab === 'agent' ? (
          <AgentPage onOpenPage={onTab} onStart={props.onStartConversation} />
        ) : tab === 'prompts' ? (
          <PromptsPage onOpenSession={props.onOpenSession} />
        ) : tab === 'knowledge' ? (
          <KnowledgePage />
        ) : (
          <McpPage />
        )}
      </div>
    </div>
  )
}
