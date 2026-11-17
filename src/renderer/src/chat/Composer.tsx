import { ArrowUp, BookMarked, Bot, ListPlus, Paperclip, Plus, Square } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent, type ReactNode } from 'react'
import type { Assistant } from '../../../shared/assistant'
import type { Attachment } from '../../../shared/chat'
import { matches } from '../../../shared/fuzzy'
import { promptLabel } from '../../../shared/prompts'
import { usePrompts } from '../terminal/queueState'
import { Attachments } from './MessageList'
import { useClickOutside } from './ChatHeader'

export const CHAT_QUEUE_COMMANDS: { name: string; insert: string; desc: string }[] = [
  { name: '/wait', insert: '/wait 5m', desc: '等待指定时长后发送下一条：/wait 30s、/wait 5m、/wait 1h' },
  { name: '/at', insert: '/at 02:30', desc: '等待至指定时刻再发送下一条（已过则顺延至次日）' },
  { name: '/pause', insert: '/pause', desc: '在此暂停队列，手动继续后再发送' }
]

const DRAFT_PREFIX = 'chat-draft:'
interface Draft {
  text: string
  attachments: Attachment[]
}
const draftKey = (conversationId: string | null | undefined) => DRAFT_PREFIX + (conversationId || 'new')
function readDraft(key: string): Draft {
  try {
    const d = JSON.parse(localStorage.getItem(key) ?? 'null') as Partial<Draft> | null
    return { text: typeof d?.text === 'string' ? d.text : '', attachments: Array.isArray(d?.attachments) ? d.attachments : [] }
  } catch {
    return { text: '', attachments: [] }
  }
}
function writeDraft(key: string, d: Draft): void {
  try {
    if (!d.text && !d.attachments.length) localStorage.removeItem(key)
    else localStorage.setItem(key, JSON.stringify(d))
  } catch {
  }
}
export function dropChatDraft(conversationId: string): void {
  try {
    localStorage.removeItem(draftKey(conversationId))
  } catch {
  }
}

interface Props {
  conversationId?: string | null
  disabled: boolean
  disabledHint?: ReactNode
  modelPicker?: ReactNode
  toolPicker?: ReactNode
  modelName: string
  busy: boolean
  thinkingPicker?: ReactNode
  paramsPicker?: ReactNode
  onSend: (text: string, attachments: Attachment[]) => Promise<boolean>
  onStop: () => void
  queueMode?: boolean
  onQueue?: (text: string, attachments: Attachment[]) => Promise<boolean>
  insert?: { text: string; n: number }
  onPromptUsed?: (id: string) => void
  assistants?: Assistant[]
  onStartAssistant?: (id: string) => void
  onManage?: (tab: 'agent' | 'prompts') => void
}

export function Composer(props: Props) {
  const key = draftKey(props.conversationId)
  const [draft, setDraftState] = useState<Draft>(() => readDraft(key))
  const { text, attachments } = draft
  const keyRef = useRef(key)
  useEffect(() => {
    if (keyRef.current === key) return
    keyRef.current = key
    setDraftState(readDraft(key))
  }, [key])
  const update = (fn: (d: Draft) => Draft) =>
    setDraftState((d) => {
      const next = fn(d)
      writeDraft(keyRef.current, next)
      return next
    })
  const setText = (t: string) => update((d) => ({ ...d, text: t }))
  const setAttachments = (fn: (a: Attachment[]) => Attachment[]) => update((d) => ({ ...d, attachments: fn(d.attachments) }))
  const [error, setError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const area = useRef<HTMLTextAreaElement>(null)
  const [menuSel, setMenuSel] = useState(0)
  const prompts = usePrompts()

  useEffect(() => {
    if (!props.insert) return
    setText(props.insert.text)
    area.current?.focus()
  }, [props.insert?.n])

  const slash = /^\/(\S*)$/.exec(text.trim()) && !text.includes('\n') ? text.trim().slice(1) : null
  const menu = useMemo(() => {
    if (slash === null) return []
    const cmds = CHAT_QUEUE_COMMANDS.filter((c) => c.name.slice(1).startsWith(slash.toLowerCase())).map((c) => ({ key: c.name, label: c.name, sub: c.desc, apply: () => setText(c.insert) }))
    const ps = prompts
      .filter((p) => p.text.trim() && (!slash || matches(`${p.title} ${p.text}`, slash)))
      .map((p) => ({
        key: p.id,
        label: promptLabel(p),
        sub: '提示词 · ' + p.text.replace(/\s+/g, ' ').slice(0, 80),
        apply: () => {
          setText(p.text)
          props.onPromptUsed?.(p.id)
        }
      }))
    return [...cmds, ...ps]
  }, [slash, prompts])
  useEffect(() => setMenuSel(0), [slash])

  useEffect(() => {
    const el = area.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`
  }, [text])

  const addResult = (r: { ok: true; data: Attachment | Attachment[] } | { ok: false; error: string }) => {
    if (!r.ok) return setError(r.error)
    setError(null)
    setAttachments((prev) => [...prev, ...(Array.isArray(r.data) ? r.data : [r.data])])
  }

  const send = async (toQueue = !!props.queueMode) => {
    if (props.disabled || (!text.trim() && !attachments.length)) return
    if (toQueue && !props.onQueue) return
    if (!toQueue && props.busy) return
    const sentKey = keyRef.current
    const ok = toQueue ? await props.onQueue!(text, attachments) : await props.onSend(text, attachments)
    if (ok) {
      writeDraft(sentKey, { text: '', attachments: [] })
      if (keyRef.current === sentKey || sentKey === draftKey(null)) setDraftState({ text: '', attachments: [] })
      setError(null)
    }
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (menu.length && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault()
      setMenuSel((i) => (i + (e.key === 'ArrowDown' ? 1 : -1) + menu.length) % menu.length)
      return
    }
    if (menu.length && (e.key === 'Tab' || (e.key === 'Enter' && !e.nativeEvent.isComposing && !CHAT_QUEUE_COMMANDS.some((c) => c.insert === text.trim())))) {
      e.preventDefault()
      menu[menuSel]?.apply()
      return
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      void send()
    }
  }

  const onPaste = async (e: ClipboardEvent) => {
    const files = [...e.clipboardData.files]
    if (!files.length) return
    e.preventDefault()
    for (const f of files) {
      const data = new Uint8Array(await f.arrayBuffer())
      addResult(await window.ccshell.chat.attachData(f.name || `粘贴图片.${f.type.split('/')[1] ?? 'png'}`, data, f.type))
    }
  }

  const onDrop = async (e: DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const files = [...e.dataTransfer.files]
    if (files.length) addResult(await window.ccshell.chat.attachFiles(files))
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-6 pb-5">
      {error && <p className="mb-2 text-[13px] text-danger">{error}</p>}
      <div
        data-guide="composer"
        className={
          'relative rounded-lg border bg-surface p-3 shadow-[var(--shadow-card)] transition-colors ' +
          (dragging ? 'border-brand' : 'border-border-strong focus-within:border-brand/60')
        }
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => void onDrop(e)}
      >
        {!!menu.length && (
          <div className="anim-pop-up absolute bottom-full left-0 z-30 mb-1 max-h-72 w-[min(560px,100%)] overflow-y-auto rounded-md border border-border bg-bg-raised p-1 shadow-[0_8px_28px_rgba(0,0,0,0.25)]">
            {menu.map((m, i) => (
              <button
                key={m.key}
                onMouseDown={(e) => {
                  e.preventDefault()
                  m.apply()
                }}
                onMouseMove={() => setMenuSel(i)}
                ref={i === menuSel ? (el) => el?.scrollIntoView({ block: 'nearest' }) : undefined}
                className={'flex w-full items-baseline gap-2 rounded-sm px-2 py-1 text-left ' + (i === menuSel ? 'bg-surface-2' : '')}
              >
                <span className={'shrink-0 text-[13px] text-text ' + (m.label.startsWith('/') ? 'font-mono' : '')}>{m.label}</span>
                <span className="min-w-0 truncate text-[11.5px] text-text-3">{m.sub}</span>
              </button>
            ))}
          </div>
        )}
        {!!attachments.length && (
          <div className="mb-2 [&>div]:justify-start">
            <Attachments items={attachments} onRemove={(id) => setAttachments((prev) => prev.filter((a) => a.id !== id))} />
          </div>
        )}
        <textarea
          ref={area}
          rows={2}
          value={text}
          disabled={props.disabled}
          placeholder={
            props.disabled
              ? ''
              : props.queueMode
                ? `${props.busy ? '正在回答 · ' : ''}Enter 加入队列，按顺序发送 · / 提示词与队列命令`
                : `向 ${props.modelName} 发送消息，输入 / 选择提示词`
          }
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          onPaste={(e) => void onPaste(e)}
          className="w-full resize-none bg-transparent px-1 text-[15px] leading-relaxed outline-none placeholder:text-text-3 disabled:cursor-not-allowed"
        />
        {props.disabled && props.disabledHint && <div className="px-1 pb-1 text-[13px] text-text-3">{props.disabledHint}</div>}
        <div className="flex items-center gap-1">
          <PlusMenu
            disabled={props.disabled}
            onAttach={async () => addResult(await window.ccshell.chat.pickFiles())}
            onPrompt={(id, t) => {
              setText(t)
              props.onPromptUsed?.(id)
              area.current?.focus()
            }}
            assistants={props.assistants ?? []}
            onStartAssistant={props.onStartAssistant}
            onManage={props.onManage}
          />
          {props.modelPicker}
          {props.thinkingPicker}
          {props.toolPicker}
          <div className="flex-1" />
          {props.paramsPicker}
          {props.queueMode && props.onQueue && (
            <button
              className="btn btn-secondary h-8 gap-1 px-2.5 text-[12.5px]"
              title="加入队列，本轮结束后按顺序发送（Enter）"
              disabled={props.disabled || (!text.trim() && !attachments.length)}
              onClick={() => void send(true)}
            >
              <ListPlus size={14} />
              加入队列
            </button>
          )}
          {props.busy ? (
            <button className="btn btn-secondary size-8 p-0" title="停止生成" onClick={props.onStop}>
              <Square size={13} fill="currentColor" />
            </button>
          ) : (
            <button
              className="btn btn-primary size-8 p-0"
              title="发送"
              disabled={props.disabled || (!text.trim() && !attachments.length)}
              onClick={() => void send(false)}
            >
              <ArrowUp size={16} />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function PlusMenu(props: {
  disabled: boolean
  onAttach: () => void
  onPrompt: (id: string, text: string) => void
  assistants: Assistant[]
  onStartAssistant?: (id: string) => void
  onManage?: (tab: 'agent' | 'prompts') => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useClickOutside(open, () => setOpen(false))
  const prompts = usePrompts()
  const [query, setQuery] = useState('')
  const usable = prompts.filter((p) => p.text.trim())
  const empty = prompts.length - usable.length
  const shown = query ? usable.filter((p) => matches(`${p.title} ${p.text}`, query)) : usable
  useEffect(() => {
    if (!open) setQuery('')
  }, [open])
  const close = (f: () => void) => () => {
    setOpen(false)
    f()
  }
  const manage = (tab: 'agent' | 'prompts') => (props.onManage ? close(() => props.onManage!(tab)) : undefined)
  return (
    <div ref={ref} className="relative">
      <button
        className={'btn size-8 p-0 ' + (open ? 'bg-surface-2 text-text' : 'btn-ghost')}
        disabled={props.disabled}
        title="添加文件、提示词或助手"
        aria-label="添加"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <Plus size={17} className={'transition-transform ' + (open ? 'rotate-45' : '')} />
      </button>
      {open && (
        <div className="anim-pop-up absolute bottom-full left-0 z-30 mb-1 max-h-[70vh] w-80 overflow-y-auto rounded-md border border-border-strong bg-surface p-1 shadow-[var(--shadow-card)]">
          <MenuButton icon={<Paperclip size={15} />} label="上传文件或图片" sub="图片、PDF、文本，也可粘贴或拖放" onClick={close(props.onAttach)} />
          <MenuSection title={usable.length > 6 ? `提示词 · ${usable.length}` : '提示词'} onManage={manage('prompts')}>
            {usable.length > 6 && (
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== 'Escape') return
                  e.stopPropagation()
                  setOpen(false)
                }}
                placeholder="搜索提示词"
                className="mx-2 mt-0.5 mb-1 h-7 w-[calc(100%-16px)] rounded-sm border border-border bg-bg px-2 text-[12.5px] text-text outline-none placeholder:text-text-3 focus:border-border-strong"
              />
            )}
            {!usable.length && <p className="px-3 py-1.5 text-xs text-text-3">{empty ? `暂无可用的提示词（${empty} 条内容为空）。` : '暂无提示词。'}</p>}
            {!!usable.length && !shown.length && <p className="px-3 py-1.5 text-xs text-text-3">没有匹配的提示词。</p>}
            <div className="max-h-[220px] overflow-y-auto">
              {shown.map((p) => (
                <MenuButton key={p.id} icon={<BookMarked size={14} />} label={promptLabel(p)} sub={p.text.replace(/\s+/g, ' ').slice(0, 60)} onClick={close(() => props.onPrompt(p.id, p.text))} />
              ))}
            </div>
            {!!usable.length && !!empty && <p className="px-3 pt-0.5 pb-1 text-[11.5px] text-text-3">另有 {empty} 条内容为空，未列出</p>}
          </MenuSection>
          <MenuSection title="以助手新建对话" onManage={manage('agent')}>
            {!props.assistants.length && <p className="px-3 py-1.5 text-xs text-text-3">暂无助手。</p>}
            <div className="max-h-[180px] overflow-y-auto">
              {props.assistants.map((a) => (
                <MenuButton
                  key={a.id}
                  icon={a.icon ? <span className="text-[14px] leading-none">{a.icon}</span> : <Bot size={14} />}
                  label={a.name}
                  sub={a.description || a.settings.model}
                  onClick={close(() => props.onStartAssistant?.(a.id))}
                />
              ))}
            </div>
          </MenuSection>
        </div>
      )}
    </div>
  )
}

function MenuSection(props: { title: string; onManage?: () => void; children: ReactNode }) {
  return (
    <div className="mt-1 border-t border-border pt-1">
      <div className="flex items-center px-3 pt-1 pb-0.5 text-xs text-text-3">
        <span className="flex-1">{props.title}</span>
        {props.onManage && (
          <button className="text-brand-text hover:underline" onClick={props.onManage}>
            管理
          </button>
        )}
      </div>
      {props.children}
    </div>
  )
}

function MenuButton(props: { icon: ReactNode; label: string; sub?: string; onClick: () => void }) {
  return (
    <button onClick={props.onClick} className="flex w-full items-center gap-2.5 rounded-sm px-3 py-1.5 text-left hover:bg-surface-2">
      <span className="flex w-4 shrink-0 justify-center text-text-3">{props.icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px]">{props.label}</span>
        {props.sub && <span className="block truncate text-[11.5px] text-text-3">{props.sub}</span>}
      </span>
    </button>
  )
}
