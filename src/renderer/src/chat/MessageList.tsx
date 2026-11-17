import { AlertCircle, AlertTriangle, Brain, Check, ChevronRight, Copy, FileText, LoaderCircle, RotateCcw, Workflow, Wrench } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { attachmentUrl, type Attachment, type ChatMessage, type ToolCallRecord, type ToolCallStatus } from '../../../shared/chat'
import type { ApprovalDecision } from '../../../shared/mcp'
import { formatMoney } from '../account'
import { Markdown } from './Markdown'

type OnApprove = (callId: string, decision: ApprovalDecision) => void

export function MessageList({
  messages,
  onRegenerate,
  onApprove,
  onOpenPeer,
  onScrollable
}: {
  messages: ChatMessage[]
  onRegenerate: () => void
  onApprove: OnApprove
  onOpenPeer?: (id: string) => void
  onScrollable?: (scrollable: boolean) => void
}) {
  const box = useRef<HTMLDivElement>(null)
  const inner = useRef<HTMLDivElement>(null)
  const stick = useRef(true)

  useLayoutEffect(() => {
    const el = box.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  })

  useEffect(() => {
    const el = box.current
    if (!el || !onScrollable) return
    const check = () => onScrollable(el.scrollHeight > el.clientHeight + 1)
    check()
    const ro = new ResizeObserver(check)
    ro.observe(el)
    if (inner.current) ro.observe(inner.current)
    return () => {
      ro.disconnect()
      onScrollable(false)
    }
  }, [onScrollable])

  const lastAssistant = messages.map((m) => m.role).lastIndexOf('assistant')
  const busy = messages.at(-1)?.status === 'streaming'

  return (
    <div
      ref={box}
      className="min-h-0 flex-1 overflow-y-auto"
      onScroll={(e) => {
        const el = e.currentTarget
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
      }}
    >
      <div ref={inner} className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-6">
        {messages.map((m, i) =>
          m.role === 'user' ? (
            <UserMessage key={m.id} message={m} onOpenPeer={onOpenPeer} />
          ) : (
            <AssistantMessage key={m.id} message={m} canRegenerate={i === lastAssistant && !busy} onRegenerate={onRegenerate} onApprove={onApprove} />
          )
        )}
      </div>
    </div>
  )
}

const peerBody = (t: string) => t.split('\n\n').slice(1, -1).join('\n\n').trim() || t

function UserMessage({ message, onOpenPeer }: { message: ChatMessage; onOpenPeer?: (id: string) => void }) {
  const from = message.from
  return (
    <div className="anim-rise flex flex-col items-end gap-2">
      {!!message.attachments?.length && <Attachments items={message.attachments} />}
      {from && (
        <button
          title={`来自其他会话的消息（会话协作）。点击打开「${from.title}」`}
          onClick={() => onOpenPeer?.(from.id)}
          className="flex items-center gap-1 rounded-sm bg-surface-2 px-1.5 py-0.5 text-[11.5px] text-text-2 hover:text-brand"
        >
          <Workflow size={11} />
          来自「{from.title}」
        </button>
      )}
      {message.text && (
        <div
          title={from ? message.text : undefined}
          className={
            'max-w-[85%] whitespace-pre-wrap rounded-lg rounded-tr-sm px-4 py-2.5 text-[15px] leading-relaxed select-text ' +
            (from ? 'border border-dashed border-border-strong bg-surface' : 'bg-user-bubble')
          }
        >
          {from ? peerBody(message.text) : message.text}
        </div>
      )}
    </div>
  )
}

export function Attachments({ items, onRemove }: { items: Attachment[]; onRemove?: (id: string) => void }) {
  return (
    <div className="flex flex-wrap justify-end gap-2">
      {items.map((a) => (
        <div key={a.id} className="group relative">
          {a.kind === 'image' ? (
            <img src={attachmentUrl(a.id)} alt={a.name} title={a.name} className="h-20 max-w-40 rounded-md border border-border object-cover" />
          ) : (
            <div className="flex h-11 max-w-52 items-center gap-2 rounded-md border border-border bg-surface px-3 text-[13px]" title={a.name}>
              <FileText size={16} className="shrink-0 text-brand-text" />
              <span className="truncate">{a.name}</span>
              <span className="shrink-0 text-xs text-text-3">{formatSize(a.size)}</span>
            </div>
          )}
          {onRemove && (
            <button
              onClick={() => onRemove(a.id)}
              className="absolute -top-1.5 -right-1.5 hidden size-5 items-center justify-center rounded-full bg-text text-bg text-xs group-hover:flex"
              title="移除"
            >
              ×
            </button>
          )}
        </div>
      ))}
    </div>
  )
}

function AssistantMessage(props: { message: ChatMessage; canRegenerate: boolean; onRegenerate: () => void; onApprove: OnApprove }) {
  const m = props.message
  const streaming = m.status === 'streaming'
  const [copied, setCopied] = useState(false)

  return (
    <div className="anim-rise group flex flex-col gap-2">
      {!!m.reasoning && <Reasoning text={m.reasoning} live={streaming && !m.text && !m.tools?.length} />}
      {m.notices?.map((n) => (
        <div key={n} className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-[13px] text-text">
          <AlertTriangle size={15} className="mt-0.5 shrink-0 text-warning" />
          {n}
        </div>
      ))}
      {m.text || m.tools?.length ? (
        segments(m).map((seg, i, all) =>
          typeof seg === 'string' ? (
            <Markdown key={i} text={seg} streaming={streaming && i === all.length - 1} />
          ) : (
            <ToolCall key={seg.id} call={seg} onApprove={props.onApprove} />
          )
        )
      ) : streaming && !m.reasoning ? (
        <div className="flex h-6 items-center gap-1">
          {[0, 1, 2].map((i) => (
            <span key={i} className="size-1.5 animate-pulse rounded-full bg-text-3" style={{ animationDelay: `${i * 150}ms` }} />
          ))}
        </div>
      ) : null}
      {m.status === 'error' && (
        <div className="flex items-start gap-2 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-[13px] text-danger select-text">
          <AlertCircle size={15} className="mt-0.5 shrink-0" />
          {m.error}
        </div>
      )}
      {!streaming && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-3">
          <span className="font-mono">{m.model}</span>
          {m.status === 'stopped' && <span className="text-warning">已停止</span>}
          {m.usage && (
            <span className="font-mono" title={usageTitle(m)}>
              ↑{m.usage.input + m.usage.cacheRead + m.usage.cacheWrite} ↓{m.usage.output}
            </span>
          )}
          {m.cost && <span>约 <span className="font-mono">{formatCost(m.cost)}</span></span>}
          {m.durationMs !== undefined && <span className="font-mono">{(m.durationMs / 1000).toFixed(1)}s</span>}
          <span className="flex-1" />
          <span className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
            {m.text && (
              <IconButton
                title="复制"
                onClick={() => {
                  void navigator.clipboard.writeText(m.text)
                  setCopied(true)
                  setTimeout(() => setCopied(false), 1500)
                }}
              >
                {copied ? <Check size={14} /> : <Copy size={14} />}
              </IconButton>
            )}
            {props.canRegenerate && (
              <IconButton title="重新生成" onClick={props.onRegenerate}>
                <RotateCcw size={14} />
              </IconButton>
            )}
          </span>
        </div>
      )}
    </div>
  )
}

function segments(m: ChatMessage): (string | ToolCallRecord)[] {
  const out: (string | ToolCallRecord)[] = []
  let pos = 0
  for (const call of [...(m.tools ?? [])].sort((a, b) => a.at - b.at)) {
    const seg = m.text.slice(pos, call.at)
    if (seg.trim()) out.push(seg)
    pos = Math.max(pos, call.at)
    out.push(call)
  }
  const rest = m.text.slice(pos)
  if (rest.trim()) out.push(rest)
  return out
}

const CALL_STATUS: Record<ToolCallStatus, { text: string; cls: string }> = {
  approval: { text: '等待确认', cls: 'text-warning' },
  running: { text: '运行中', cls: 'text-text-2' },
  done: { text: '完成', cls: 'text-success' },
  error: { text: '出错', cls: 'text-danger' },
  denied: { text: '已拒绝', cls: 'text-text-3' },
  stopped: { text: '已中止', cls: 'text-text-3' }
}

function ToolCall({ call, onApprove }: { call: ToolCallRecord; onApprove: OnApprove }) {
  const waiting = call.status === 'approval'
  const [open, setOpen] = useState(false)
  const st = CALL_STATUS[call.status]
  const args = JSON.stringify(call.input ?? {}, null, 2)
  return (
    <div className={'rounded-md border bg-surface/60 ' + (waiting ? 'border-warning/60' : 'border-border')}>
      <button className="flex w-full items-center gap-2 px-3 py-1.5 text-[13px]" onClick={() => setOpen(!open)}>
        {call.status === 'running' ? <LoaderCircle size={14} className="animate-spin text-brand-text" /> : <Wrench size={14} className="text-brand-text" />}
        <span className="truncate font-mono">
          <span className="text-text-3">{call.serverName} / </span>
          {call.tool}
        </span>
        <span className={'shrink-0 text-xs ' + st.cls}>{st.text}</span>
        {call.durationMs !== undefined && call.status !== 'denied' && <span className="shrink-0 font-mono text-xs text-text-3">{(call.durationMs / 1000).toFixed(1)}s</span>}
        <ChevronRight size={14} className={'ml-auto shrink-0 text-text-3 transition-transform ' + (open || waiting ? 'rotate-90' : '')} />
      </button>
      {(open || waiting) && (
        <div className="flex flex-col gap-2 border-t border-border px-3 py-2">
          <div>
            <div className="mb-1 text-xs text-text-3">参数</div>
            <pre className="max-h-60 overflow-auto rounded-sm bg-bg px-2 py-1.5 font-mono text-xs whitespace-pre-wrap select-text">{args}</pre>
          </div>
          {call.output !== undefined && (
            <div>
              <div className="mb-1 text-xs text-text-3">结果</div>
              <pre className={'max-h-80 overflow-auto rounded-sm bg-bg px-2 py-1.5 font-mono text-xs whitespace-pre-wrap select-text ' + (call.status === 'error' ? 'text-danger' : '')}>
                {call.output || '（无输出）'}
              </pre>
            </div>
          )}
          {waiting && (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button className="btn btn-primary h-8 px-3 text-[13px]" onClick={() => onApprove(call.id, 'allow')}>
                允许
              </button>
              <button className="btn btn-secondary h-8 px-3 text-[13px]" onClick={() => onApprove(call.id, 'deny')}>
                拒绝
              </button>
              <span className="flex-1" />
              <button className="btn btn-ghost h-8 px-2 text-xs" onClick={() => onApprove(call.id, 'always-tool')} title="此后调用该工具不再询问">
                始终允许此工具
              </button>
              <button className="btn btn-ghost h-8 px-2 text-xs" onClick={() => onApprove(call.id, 'always-server')} title={`此后 ${call.serverName} 的全部工具不再询问`}>
                始终允许此服务器
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function Reasoning({ text, live }: { text: string; live: boolean }) {
  const [open, setOpen] = useState(live)
  useEffect(() => {
    if (!live) setOpen(false)
  }, [live])
  return (
    <div className="rounded-md border border-border bg-surface/60">
      <button className="flex w-full items-center gap-1.5 px-3 py-1.5 text-[13px] text-text-2 hover:text-text" onClick={() => setOpen(!open)}>
        <Brain size={14} className={live ? 'animate-pulse text-brand-text' : ''} />
        {live ? '正在思考…' : '思考过程'}
        <ChevronRight size={14} className={'ml-auto transition-transform ' + (open ? 'rotate-90' : '')} />
      </button>
      {open && <div className="max-h-80 overflow-y-auto border-t border-border px-3 py-2 text-[13px] leading-relaxed whitespace-pre-wrap text-text-2 select-text">{text}</div>}
    </div>
  )
}

function IconButton(props: { title: string; onClick: () => void; children: ReactNode }) {
  return (
    <button title={props.title} onClick={props.onClick} className="flex size-7 items-center justify-center rounded-sm hover:bg-surface-2 hover:text-text">
      {props.children}
    </button>
  )
}

function usageTitle(m: ChatMessage): string {
  const u = m.usage!
  return [`输入 ${u.input}`, `缓存读取 ${u.cacheRead}`, `缓存写入 ${u.cacheWrite}`, `输出 ${u.output}`, u.reasoning ? `其中思考 ${u.reasoning}` : '']
    .filter(Boolean)
    .join('\n')
}

function formatCost(m: { amount: number; symbol: string }): string {
  return m.amount >= 0.01 ? formatMoney(m) : `${m.symbol}${m.amount.toFixed(4)}`
}

function formatSize(n: number): string {
  return n < 1024 ? `${n} B` : n < 1 << 20 ? `${(n / 1024).toFixed(0)} KB` : `${(n / (1 << 20)).toFixed(1)} MB`
}
