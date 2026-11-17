import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { DEFAULT_SETTINGS, type Attachment, type ChatSettings } from '../../../shared/chat'
import { useAccount } from '../account'
import { LogoMark } from '../components/LogoMark'
import { ChatHeader, ModelPicker, ParamsPicker } from '../chat/ChatHeader'
import { TopStrip } from '../components/TitleBar'
import { Composer } from '../chat/Composer'
import { ConversationList } from '../chat/ConversationList'
import { ThinkingPicker } from '../chat/ThinkingPicker'
import { MessageList } from '../chat/MessageList'
import { ToolPicker } from '../chat/ToolPicker'
import { useChat } from '../chat/useChat'
import { useAssistants } from '../stage6'
import { parseQueueText } from '../../../shared/queue'
import { QueueBar } from '../terminal/QueueBar'
import { queueOf, useQueues } from '../terminal/queueState'
import { takeChatInsert, useChatInsert } from '../chat/insert'
import type { PageId } from '../pages'
import { Bot, Plus } from 'lucide-react'
import { greeting } from '../chat/greetings'

export function ChatPage(props: {
  onOpenAccount: () => void
  onOpenPage: (page: PageId) => void
  openConversation: string | null
  onOpened: () => void
  onOpenPeer?: (id: string) => void
  library?: ReactNode
  onOpenLibrary: () => void
  onCloseLibrary: () => void
}) {
  const { onOpenAccount } = props
  const account = useAccount()
  const chat = useChat()
  const { conv } = chat
  const assistants = useAssistants()
  const assistant = conv?.settings.assistantId ? assistants.find((a) => a.id === conv.settings.assistantId) : undefined

  useEffect(() => {
    if (!props.openConversation) return
    void chat.select(props.openConversation)
    props.onOpened()
  }, [props.openConversation])
  const [error, setError] = useState<string | null>(null)
  const [scrollable, setScrollable] = useState(false)
  const [base, setBase] = useState<ChatSettings>(DEFAULT_SETTINGS)

  useEffect(() => {
    if (!conv) void window.ccshell.chat.lastSettings().then((r) => r.ok && setBase(r.data))
  }, [conv])

  const settings: ChatSettings = conv?.settings ?? base
  const busy = conv?.messages.at(-1)?.status === 'streaming'
  const queues = useQueues()
  const queueKey = conv ? 'chat:' + conv.id : ''
  const queue = conv ? queueOf(queues, queueKey) : null
  const [queueOpen, setQueueOpen] = useState(true)
  const hasPending = !!queue && !queue.paused && queue.items.some((x) => x.status === 'pending' || x.status === 'waiting' || x.status === 'running')
  const [insert, setInsert] = useState<{ text: string; n: number } | undefined>()
  const insertTick = useChatInsert()
  useEffect(() => {
    if (!conv) return
    const t = takeChatInsert(conv.id)
    if (t !== null) setInsert({ text: t, n: Date.now() })
  }, [conv?.id, insertTick])

  const enqueue = async (text: string, attachments: Attachment[]): Promise<boolean> => {
    if (!conv) return false
    setError(null)
    const r = await window.ccshell.queue.add(queueKey, text, undefined, attachments)
    if (!r.ok) setError(r.error)
    else setQueueOpen(true)
    return r.ok
  }

  const changeSettings = async (patch: Partial<ChatSettings>) => {
    if (!conv) {
      setBase((b) => ({ ...b, ...patch }))
      const r = await window.ccshell.chat.rememberSettings(patch)
      if (r.ok) setBase(r.data)
      else setError(r.error)
      return
    }
    const r = await window.ccshell.chat.updateSettings(conv.id, patch)
    if (r.ok) chat.setConv(r.data)
    else setError(r.error)
  }

  const send = async (text: string, attachments: Attachment[]): Promise<boolean> => {
    setError(null)
    if (conv && !attachments.length && ['wait', 'at', 'pause', 'clear', 'bad'].includes(parseQueueText(text).kind)) return enqueue(text, attachments)
    try {
      let target = conv
      if (!target) {
        target = await chat.create()
      }
      const r = await window.ccshell.chat.send(target.id, text, attachments)
      if (!r.ok) setError(r.error)
      return r.ok
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      return false
    }
  }

  const startAssistant = async (id: string) => {
    setError(null)
    const r = await window.ccshell.assistant.start(id)
    if (r.ok) void chat.select(r.data.id)
    else setError(r.error)
  }

  const newChat = () => {
    void chat.select(null)
    setError(null)
  }

  const disabledHint = !account.user ? (
    <>
      登录 CC Shell 后即可开始对话。
      <button className="ml-1 text-brand-text hover:underline" onClick={onOpenAccount}>
        前往登录
      </button>
    </>
  ) : !chat.hasKey ? (
    <>
      暂无可用的 API 密钥。
      <button className="ml-1 text-brand-text hover:underline" onClick={onOpenAccount}>
        前往账户设置
      </button>
    </>
  ) : null

  const empty = !conv || conv.messages.length === 0
  const userName = account.user ? account.user.displayName || account.user.username : undefined
  const hello = useMemo(() => greeting({ name: userName }), [conv?.id, empty, userName])

  return (
    <div className="flex h-full">
      <ConversationList
        list={chat.list}
        activeId={props.library ? null : (conv?.id ?? null)}
        libraryActive={!!props.library}
        onOpenLibrary={props.onOpenLibrary}
        onSelect={(id) => {
          setError(null)
          props.onCloseLibrary()
          void chat.select(id || null)
        }}
        onNew={() => {
          props.onCloseLibrary()
          void newChat()
        }}
      />

      {props.library ? (
        <section className="anim-fade flex min-w-0 flex-1 flex-col">
          <TopStrip />
          <div className="min-h-0 flex-1">{props.library}</div>
        </section>
      ) : (
      <section className="flex min-w-0 flex-1 flex-col" style={empty ? { background: 'var(--hero-glow)' } : undefined}>
        <ChatHeader
          title={conv?.title ?? '新对话'}
          assistant={assistant ? `${assistant.icon} ${assistant.name}` : undefined}
          line={!empty && scrollable}
        />

        {empty ? (
          <div className="anim-stagger flex flex-1 flex-col items-center justify-center gap-3 overflow-y-auto px-8">
            <LogoMark size={60} />
            <h1 key={hello} className="font-serif text-[26px] font-semibold" style={{ '--i': 1 } as CSSProperties}>
              {hello}
            </h1>
            {disabledHint && <p className="text-text-2">{disabledHint}</p>}
            {!disabledHint && !conv && (
              <div className="mt-4 flex w-full max-w-3xl flex-wrap justify-center gap-2" aria-label="以助手开始">
                {assistants.slice(0, 6).map((a) => (
                  <button
                    key={a.id}
                    onClick={() => void startAssistant(a.id)}
                    title={a.description || a.settings.systemPrompt || a.name}
                    className="flex h-9 max-w-56 items-center gap-2 rounded-full border border-border bg-surface/70 px-3.5 text-[13px] text-text-2 shadow-[var(--shadow-card)] transition-colors hover:border-border-strong hover:text-text"
                  >
                    <span className="text-[15px] leading-none">{a.icon || <Bot size={14} />}</span>
                    <span className="truncate">{a.name}</span>
                    {a.settings.workspace && <span className="rounded-sm bg-brand-soft px-1 text-[10.5px] text-brand-text">Agent</span>}
                  </button>
                ))}
                <button
                  onClick={() => props.onOpenPage('agent')}
                  className="flex h-9 items-center gap-1.5 rounded-full border border-dashed border-border-strong px-3.5 text-[13px] text-text-3 transition-colors hover:text-text"
                >
                  <Plus size={14} />
                  {assistants.length ? '管理助手' : '新建助手'}
                </button>
              </div>
            )}
          </div>
        ) : (
          <MessageList
            messages={conv.messages}
            onOpenPeer={props.onOpenPeer}
            onScrollable={setScrollable}
            onRegenerate={() => void window.ccshell.chat.regenerate(conv.id)}
            onApprove={async (callId, decision) => {
              const r = await window.ccshell.chat.approveTool(callId, decision)
              if (!r.ok) setError(r.error)
            }}
          />
        )}

        {error && <p className="mx-auto w-full max-w-3xl px-7 pb-2 text-[13px] text-danger">{error}</p>}
        {queue && !!queue.items.length && (
          <div className="mx-auto w-full max-w-3xl px-6 pb-2">
            <QueueBar chat session={{ id: queueKey, status: 'running' }} queue={queue} open={queueOpen} onToggle={() => setQueueOpen((o) => !o)} onOpenSession={props.onOpenPeer} />
          </div>
        )}
        <Composer
          conversationId={conv?.id ?? null}
          disabled={!!disabledHint}
          disabledHint={empty ? undefined : disabledHint}
          busy={busy}
          modelName={settings.model}
          modelPicker={
            <ModelPicker
              value={settings.model}
              models={chat.models.filter((m) => !m.embedding)}
              error={chat.modelError}
              disabled={!!disabledHint}
              onChange={(model) => void changeSettings({ model })}
            />
          }
          toolPicker={
            <ToolPicker
              value={settings}
              disabled={!!disabledHint}
              onChange={(patch) => void changeSettings(patch)}
              onManage={props.onOpenPage}
            />
          }
          thinkingPicker={<ThinkingPicker value={settings} disabled={!!disabledHint} onChange={(patch) => void changeSettings(patch)} />}
          paramsPicker={<ParamsPicker settings={settings} disabled={!!disabledHint} onChange={(patch) => void changeSettings(patch)} />}
          onSend={send}
          queueMode={busy || hasPending}
          onQueue={enqueue}
          insert={insert}
          onPromptUsed={(id) => conv && void window.ccshell.prompts.use(id, { action: 'insert', sessionId: queueKey })}
          assistants={assistants}
          onStartAssistant={(id) => void startAssistant(id)}
          onManage={props.onOpenPage}
          onStop={() => conv && void window.ccshell.chat.stop(conv.id)}
        />
      </section>
      )}
    </div>
  )
}
