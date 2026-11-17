import { AccountDock } from '../components/AccountDock'
import { MAIN_ASIDE, ResizableAside } from '../components/ResizableAside'
import { SideNewButton } from '../components/SideNewButton'
import { LayoutGrid, LoaderCircle, Pencil, Search, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { confirmDialog } from '../components/Dialog'
import type { ConversationSummary } from '../../../shared/chat'
import { dropChatDraft } from './Composer'

const DAY = 86_400_000

function group(t: number): string {
  const start = new Date().setHours(0, 0, 0, 0)
  if (t >= start) return '今天'
  if (t >= start - DAY) return '昨天'
  if (t >= start - 6 * DAY) return '近 7 天'
  return '更早'
}

interface Props {
  list: ConversationSummary[]
  activeId: string | null
  onSelect: (id: string) => void
  onNew: () => void
  libraryActive: boolean
  onOpenLibrary: () => void
}

export function ConversationList({ list, activeId, onSelect, onNew, libraryActive, onOpenLibrary }: Props) {
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<{ id: string; title: string } | null>(null)
  const shown = list.filter((c) => c.title.toLowerCase().includes(query.trim().toLowerCase()))

  const commitRename = async () => {
    if (!editing) return
    await window.ccshell.chat.rename(editing.id, editing.title)
    setEditing(null)
  }

  const remove = async (c: ConversationSummary) => {
    if (!(await confirmDialog({ title: '删除对话', message: `“${c.title}”将被永久删除，此操作无法撤销。`, confirmText: '删除', danger: true }))) return
    await window.ccshell.chat.delete(c.id)
    dropChatDraft(c.id)
    if (c.id === activeId) onSelect('')
  }

  let lastGroup = ''
  return (
    <ResizableAside {...MAIN_ASIDE}>
      <SideNewButton label="新对话" active={!activeId && !libraryActive} onClick={onNew} />
      <label className="mx-3 flex h-8 items-center gap-2 rounded-sm bg-surface px-2.5 text-text-3">
        <Search size={14} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索对话"
          className="min-w-0 flex-1 bg-transparent text-[13px] text-text outline-none placeholder:text-text-3"
        />
      </label>
      <div className="mx-2 mt-2">
        <button
          data-guide="library"
          onClick={onOpenLibrary}
          aria-current={libraryActive ? 'page' : undefined}
          className={'nav-item w-full ' + (libraryActive ? 'nav-item-active' : '')}
        >
          <LayoutGrid size={15} strokeWidth={1.8} />
          <span className="flex-1 text-left">资源库</span>
        </button>
      </div>
      <div className="mx-4 mt-2 border-t border-border" />
      <div className="mt-1 min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {shown.length === 0 && (
          <div className="px-4 py-10 text-center text-xs text-text-3">{list.length ? '无匹配的对话' : '暂无对话'}</div>
        )}
        {shown.map((c) => {
          const g = group(c.updatedAt)
          const header = g !== lastGroup ? ((lastGroup = g), <div className="px-2 pt-3 pb-1 text-xs text-text-3">{g}</div>) : null
          const active = c.id === activeId
          return (
            <div key={c.id}>
              {header}
              {editing?.id === c.id ? (
                <input
                  autoFocus
                  value={editing.title}
                  onChange={(e) => setEditing({ ...editing, title: e.target.value })}
                  onBlur={() => void commitRename()}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void commitRename()
                    if (e.key === 'Escape') setEditing(null)
                  }}
                  className="h-9 w-full rounded-sm border border-brand bg-bg-raised px-2 text-[13px] outline-none"
                />
              ) : (
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => onSelect(c.id)}
                  onKeyDown={(e) => e.key === 'Enter' && onSelect(c.id)}
                  className={
                    'nav-item group cursor-pointer gap-1 ' + (active ? 'nav-item-active' : '')
                  }
                >
                  {c.streaming && <LoaderCircle size={13} className="shrink-0 animate-spin text-brand-text" />}
                  <span className="min-w-0 flex-1 truncate">{c.title}</span>
                  <span className="hidden gap-0.5 group-hover:flex">
                    <button
                      title="重命名"
                      className="flex size-6 items-center justify-center rounded-sm hover:bg-bg"
                      onClick={(e) => {
                        e.stopPropagation()
                        setEditing({ id: c.id, title: c.title })
                      }}
                    >
                      <Pencil size={13} />
                    </button>
                    <button
                      title="删除"
                      className="flex size-6 items-center justify-center rounded-sm hover:bg-bg hover:text-danger"
                      onClick={(e) => {
                        e.stopPropagation()
                        void remove(c)
                      }}
                    >
                      <Trash2 size={13} />
                    </button>
                  </span>
                </div>
              )}
            </div>
          )
        })}
      </div>
      <AccountDock />
    </ResizableAside>
  )
}
