import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { AUTO_OUTPUT, modelCaps, resolveEffort, resolveMaxOutput, thinkingActive } from '../../shared/modelCaps'
import { APICallError, jsonSchema, stepCountIs, streamText, tool, type ModelMessage, type ToolSet, type UserContent } from 'ai'
import type {
  Attachment,
  ChatDelta,
  ChatMessage,
  ChatSettings,
  Conversation,
  ConversationSummary,
  ModelInfo,
  Protocol,
  TokenUsage,
  ToolCallRecord
} from '../../shared/chat'
import { DEFAULT_SETTINGS } from '../../shared/chat'
import type { ApprovalDecision } from '../../shared/mcp'
import type { CcShellService } from '../ccshell/service'
import { electronFetch } from '../electronFetch'
import type { AgentService } from '../agent/service'
import type { KnowledgeService } from '../knowledge/service'
import type { McpService } from '../mcp/service'
import type { PeerMode } from '../../shared/peers'
import type { PeerChat, PeerChatInfo, PeerService } from '../terminal/peers'
import { deleteAttachments, readAttachment } from './attachments'
import { displayPrice, estimateCost, parsePrice, type ParsedPrice, type RawPricing } from './pricing'
import { ChatQueue, type ChatQueueHost, type ChatTurn } from './queue'
import { ConversationStore } from './store'
import type { ChatTool } from './tools'

export const protocolOf = (model: string): Protocol => (/claude/i.test(model) ? 'anthropic' : 'openai')
export const isEmbeddingModel = (model: string) => /embed|bge-|m3e|^e5-|gte-/i.test(model)

interface Events {
  list: [ConversationSummary[]]
  conversation: [Conversation]
  delta: [ChatDelta]
  turn: [ChatTurn]
}

export class ChatService extends EventEmitter<Events> implements PeerChat, ChatQueueHost {
  private peers: PeerService | null = null
  private readonly store = new ConversationStore()
  readonly queue = new ChatQueue(this)
  private readonly running = new Map<string, AbortController>()
  private pricing: { at: number; prices: Map<string, ParsedPrice>; groupRatio: Record<string, number> } | null = null
  private readonly approvals = new Map<
    string,
    { tool: ChatTool; done: (d: ApprovalDecision | 'stopped') => void }
  >()

  constructor(
    private readonly ccshell: CcShellService,
    private readonly mcp: McpService,
    private readonly extras: { knowledge?: KnowledgeService; agent?: AgentService } = {}
  ) {
    super()
  }

  setPeers(peers: PeerService): void {
    this.peers = peers
    peers.attachChat(this)
  }

  private peerInfo(c: Conversation): PeerChatInfo {
    return {
      id: c.id,
      title: c.title,
      workspace: c.settings.workspace ?? '',
      model: c.settings.model,
      state: this.running.has(c.id) ? 'busy' : 'idle',
      updatedAt: c.updatedAt,
      lastText: c.messages.findLast((m) => m.role === 'assistant' && m.text.trim())?.text ?? '',
      pending: this.queue.pendingCount(c.id)
    }
  }

  peerChats(): PeerChatInfo[] {
    return this.store
      .all()
      .filter((c) => c.settings.peers)
      .map((c) => this.peerInfo(c))
  }

  closedChats(): string[] {
    return this.store
      .all()
      .filter((c) => !c.settings.peers && c.messages.length)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((c) => c.title)
  }

  peerChat(id: string): PeerChatInfo | null {
    const c = this.store.all().find((x) => x.id === id)
    return c?.settings.peers ? this.peerInfo(c) : null
  }

  peerMessages(id: string): { role: 'user' | 'assistant'; text: string; tools: string[] }[] {
    return this.store.get(id).messages.map((m) => ({
      role: m.role,
      text: m.text + (m.attachments?.length ? `\n（附件：${m.attachments.map((a) => a.name).join('、')}）` : ''),
      tools: (m.tools ?? []).map((t) => `${t.serverName} · ${t.tool}`)
    }))
  }

  deliverPeer(id: string, text: string, from: { id: string; title: string }, mode: PeerMode): string {
    const conv = this.store.get(id)
    if (!conv.settings.peers) throw new Error('该对话未启用“会话协作”')
    this.requireKey()
    return this.queue.deliver(id, text, from, mode)
  }

  runningCount(): number {
    return this.running.size
  }

  exists(id: string): boolean {
    return this.store.all().some((c) => c.id === id)
  }

  isRunning(id: string): boolean {
    return this.running.has(id)
  }

  workspaceOf(id: string): string {
    return this.store.all().find((c) => c.id === id)?.settings.workspace ?? ''
  }

  titleOf(id: string): string {
    return this.store.all().find((c) => c.id === id)?.title ?? id
  }

  sendQueued(id: string, text: string, attachments: Attachment[], from?: { id: string; title: string }): void {
    const conv = this.store.get(id)
    if (this.running.has(id)) throw new Error('上一条回复尚未结束')
    this.requireKey()
    conv.messages.push({ id: randomUUID(), role: 'user', text, attachments: attachments.length ? attachments : undefined, ...(from ? { from } : {}), createdAt: Date.now() })
    if (conv.title === '新对话' && !from) conv.title = titleFrom(text, attachments)
    this.startReply(conv)
  }

  list(): ConversationSummary[] {
    return this.store.all().map((c) => ({
      id: c.id,
      title: c.title,
      updatedAt: c.updatedAt,
      model: c.settings.model,
      streaming: this.running.has(c.id)
    }))
  }

  get(id: string): Conversation {
    return this.store.get(id)
  }

  lastSettings(): ChatSettings {
    return this.store.lastSettings()
  }

  rememberSettings(patch: Partial<ChatSettings>): ChatSettings {
    const next = { ...this.store.lastSettings(), ...patch }
    delete next.assistantId
    this.store.rememberSettings(next)
    return next
  }

  create(): Conversation {
    const conv = this.store.create(this.store.lastSettings())
    this.emitList()
    return conv
  }

  rename(id: string, title: string): void {
    const conv = this.store.get(id)
    conv.title = title.trim().slice(0, 80) || conv.title
    this.touch(conv, false)
  }

  delete(id: string): void {
    if (!this.exists(id)) return
    this.running.get(id)?.abort()
    this.queue.drop(id)
    const conv = this.store.delete(id)
    if (conv) deleteAttachments(conv.messages.flatMap((m) => m.attachments?.map((a) => a.id) ?? []))
    this.emitList()
  }

  updateSettings(id: string, patch: Partial<ChatSettings>, remember = true): Conversation {
    const conv = this.store.get(id)
    conv.settings = { ...conv.settings, ...patch }
    if (remember && !conv.settings.assistantId) this.store.rememberSettings(conv.settings)
    this.touch(conv, false)
    return conv
  }

  async models(): Promise<ModelInfo[]> {
    const key = this.requireKey()
    const res = await electronFetch(`${this.ccshell.getBaseUrl()}/v1/models`, {
      headers: { Authorization: `Bearer ${key}` }
    })
    if (!res.ok) throw new Error(`读取模型列表失败（HTTP ${res.status}）`)
    const body = (await res.json()) as { data?: { id?: string }[] }
    const ids = [...new Set((body.data ?? []).map((m) => m.id).filter((x): x is string => !!x))]
    const [pricing, status] = await Promise.all([this.loadPricing().catch(() => null), this.ccshell.siteStatus()])
    const ratio = pricing?.groupRatio[this.ccshell.getUserGroup()] ?? 1
    return ids
      .map((id) => {
        const p = pricing?.prices.get(id)
        return { id, protocol: protocolOf(id), embedding: isEmbeddingModel(id), price: p ? displayPrice(p, ratio, status) : null }
      })
      .sort((a, b) => Number(b.protocol === 'anthropic') - Number(a.protocol === 'anthropic') || a.id.localeCompare(b.id))
  }

  send(id: string, text: string, attachments: Attachment[]): void {
    const conv = this.store.get(id)
    if (this.running.has(id)) throw new Error('上一条回复尚未结束')
    if (!text.trim() && attachments.length === 0) throw new Error('消息为空')
    this.requireKey()
    conv.messages.push({ id: randomUUID(), role: 'user', text, attachments, createdAt: Date.now() })
    if (conv.title === '新对话') conv.title = titleFrom(text, attachments)
    this.startReply(conv)
  }

  regenerate(id: string): void {
    const conv = this.store.get(id)
    if (this.running.has(id)) throw new Error('上一条回复尚未结束')
    const lastUser = conv.messages.map((m) => m.role).lastIndexOf('user')
    if (lastUser < 0) throw new Error('无可重新生成的消息')
    conv.messages = conv.messages.slice(0, lastUser + 1)
    this.startReply(conv)
  }

  stop(id: string): void {
    this.running.get(id)?.abort()
  }

  approveTool(callId: string, decision: ApprovalDecision): void {
    const entry = this.approvals.get(callId)
    if (!entry) throw new Error('该调用已结束')
    if (decision === 'always-tool') entry.tool.allowAlways('tool')
    if (decision === 'always-server') entry.tool.allowAlways('server')
    entry.done(decision)
    for (const other of [...this.approvals.values()]) if (!other.tool.needsApproval()) other.done('allow')
  }

  private waitApproval(callId: string, t: ChatTool, signal: AbortSignal): Promise<ApprovalDecision | 'stopped'> {
    return new Promise((resolve) => {
      const done = (d: ApprovalDecision | 'stopped') => {
        this.approvals.delete(callId)
        signal.removeEventListener('abort', onAbort)
        resolve(d)
      }
      const onAbort = () => done('stopped')
      if (signal.aborted) return done('stopped')
      signal.addEventListener('abort', onAbort)
      this.approvals.set(callId, { tool: t, done })
    })
  }

  private startReply(conv: Conversation): void {
    const reply: ChatMessage = {
      id: randomUUID(),
      role: 'assistant',
      text: '',
      reasoning: '',
      model: conv.settings.model,
      status: 'streaming',
      createdAt: Date.now()
    }
    const history = conv.messages.slice()
    conv.messages.push(reply)
    const controller = new AbortController()
    this.running.set(conv.id, controller)
    this.touch(conv)
    void this.stream(conv, history, reply, controller)
  }

  private async stream(conv: Conversation, history: ChatMessage[], reply: ChatMessage, controller: AbortController) {
    const started = Date.now()
    const settings: ChatSettings = { ...DEFAULT_SETTINGS, ...conv.settings }
    let pending: { text: string; reasoning: string } = { text: '', reasoning: '' }
    let timer: NodeJS.Timeout | null = null
    const flush = () => {
      timer = null
      if (!pending.text && !pending.reasoning) return
      this.emit('delta', {
        conversationId: conv.id,
        messageId: reply.id,
        text: pending.text || undefined,
        reasoning: pending.reasoning || undefined
      })
      pending = { text: '', reasoning: '' }
    }
    const queue = (kind: 'text' | 'reasoning', chunk: string) => {
      reply[kind] = (reply[kind] ?? '') + chunk
      pending[kind] += chunk
      timer ??= setTimeout(flush, 40)
    }

    const sync = () => {
      if (timer) clearTimeout(timer)
      flush()
      this.touch(conv, false)
    }
    const record = (id: string, init: Omit<ToolCallRecord, 'id' | 'status' | 'at'>): ToolCallRecord => {
      let rec = reply.tools?.find((r) => r.id === id)
      if (!rec) {
        rec = { id, ...init, status: 'running', at: reply.text.length }
        ;(reply.tools ??= []).push(rec)
      }
      return rec
    }
    const execute = async (t: ChatTool, input: unknown, callId: string, signal: AbortSignal): Promise<string> => {
      const rec = record(callId, { name: t.name, serverId: t.serverId, serverName: t.serverName, tool: t.tool, input })
      rec.input = input
      if (t.needsApproval()) {
        rec.status = 'approval'
        sync()
        const decision = await this.waitApproval(callId, t, signal)
        if (decision === 'stopped' || decision === 'deny') {
          rec.status = decision === 'deny' ? 'denied' : 'stopped'
          rec.output = decision === 'deny' ? DENIED : STOPPED
          sync()
          return rec.output
        }
      }
      rec.status = 'running'
      sync()
      const begun = Date.now()
      try {
        const r = await t.call(input, signal)
        rec.output = r.text
        rec.status = r.isError ? 'error' : 'done'
        return r.isError ? `工具返回了错误：${r.text}` : r.text
      } catch (e) {
        rec.status = signal.aborted ? 'stopped' : 'error'
        rec.output = signal.aborted ? STOPPED : (e as Error).message
        return `调用失败：${rec.output}`
      } finally {
        rec.durationMs = Date.now() - begun
        sync()
      }
    }

    try {
      const { tools, failed } = settings.mcpServers.length
        ? await this.mcp.toolset(settings.mcpServers)
        : { tools: [] as ChatTool[], failed: [] as string[] }
      const notices = failed.length ? [`以下 MCP 服务器连接失败，本次不可用：${failed.join('、')}`] : []
      const extraPrompt: string[] = []
      if (settings.knowledgeBases.length && this.extras.knowledge) {
        const kb = this.extras.knowledge.toolset(settings.knowledgeBases)
        tools.push(...kb.tools)
        if (kb.prompt) extraPrompt.push(kb.prompt)
        if (kb.missing.length) notices.push(`以下知识库已被删除：${kb.missing.join('、')}`)
      }
      if (settings.workspace && this.extras.agent) {
        try {
          const ag = this.extras.agent.toolset(settings.workspace, settings.allowCommands)
          tools.push(...ag.tools)
          extraPrompt.push(ag.prompt)
        } catch (e) {
          notices.push((e as Error).message)
        }
      }
      if (settings.peers && this.peers) {
        const pc = this.peers.chatTools(conv.id)
        tools.push(...pc.tools)
        extraPrompt.push(pc.prompt)
      }
      if (notices.length) {
        reply.notices = notices
        sync()
      }
      const system = [settings.systemPrompt.trim(), ...extraPrompt].filter(Boolean).join('\n\n')
      const toolSet: ToolSet = {}
      for (const t of tools)
        toolSet[t.name] = tool({
          description: t.description,
          inputSchema: jsonSchema(t.inputSchema as Parameters<typeof jsonSchema>[0]),
          execute: (input, opts) => execute(t, input, opts.toolCallId, opts.abortSignal ?? controller.signal)
        })
      const result = streamText({
        model: this.languageModel(settings.model),
        system: system || undefined,
        messages: toModelMessages(history, tools.length > 0),
        ...requestOptions(settings),
        ...(tools.length ? { tools: toolSet, stopWhen: stepCountIs(MAX_STEPS) } : {}),
        abortSignal: controller.signal,
        maxRetries: 0
      })
      let streamedText = ''
      for await (const part of result.fullStream) {
        if (part.type === 'text-delta') {
          streamedText += part.text
          queue('text', part.text)
        }
        else if (part.type === 'reasoning-delta') queue('reasoning', part.text)
        else if (part.type === 'tool-call') {
          const t = tools.find((x) => x.name === part.toolName)
          const rec = record(part.toolCallId, {
            name: part.toolName,
            serverId: t?.serverId ?? '',
            serverName: t?.serverName ?? '?',
            tool: t?.tool ?? part.toolName,
            input: part.input
          })
          rec.at = reply.text.length
          if (!t) {
            rec.status = 'error'
            rec.output = '模型调用了一个不存在的工具'
          }
          sync()
        } else if (part.type === 'tool-error') {
          const rec = reply.tools?.find((r) => r.id === part.toolCallId)
          if (rec && rec.status !== 'error') {
            rec.status = 'error'
            rec.output = describeError(part.error, settings.model)
            sync()
          }
        } else if (part.type === 'error') throw part.error
        else if (part.type === 'finish') reply.usage = toUsage(part.totalUsage)
        else if (part.type === 'abort') break
      }
      reply.status = controller.signal.aborted ? 'stopped' : 'done'
      if (tools.length && !reply.tools?.length && /<invoke\s+name=|<function_calls>|<tool_use>/i.test(streamedText)) {
        reply.notices = [...(reply.notices ?? []), '模型把工具调用写成了文字，没有真正调用。当前分组的渠道可能不支持工具调用，可换一个分组的密钥，或在“工具”里关闭后重试。']
      }
    } catch (e) {
      if (controller.signal.aborted) reply.status = 'stopped'
      else {
        reply.status = 'error'
        reply.error = describeError(e, settings.model)
      }
    } finally {
      if (timer) clearTimeout(timer)
      flush()
      for (const t of reply.tools ?? []) if (t.status === 'approval' || t.status === 'running') t.status = 'stopped'
      reply.durationMs = Date.now() - started
      if (!reply.reasoning) delete reply.reasoning
      this.running.delete(conv.id)
      this.emit('turn', { convId: conv.id, status: reply.status === 'done' ? 'done' : reply.status === 'error' ? 'error' : 'stopped', error: reply.error })
      if (reply.usage) reply.cost = await this.cost(settings.model, reply.usage).catch(() => undefined)
      if (this.store.all().some((c) => c.id === conv.id)) this.touch(conv)
      void this.ccshell.refreshBalance().catch(() => {})
    }
  }

  private languageModel(model: string) {
    const baseURL = `${this.ccshell.getBaseUrl()}/v1`
    const key = this.requireKey()
    return protocolOf(model) === 'anthropic'
      ? createAnthropic({ baseURL, authToken: key, fetch: electronFetch })(model)
      : createOpenAICompatible({ name: 'ccshell', baseURL, apiKey: key, includeUsage: true, fetch: electronFetch })(model)
  }

  async cost(model: string, usage: TokenUsage) {
    const pricing = await this.loadPricing()
    const price = pricing.prices.get(model)
    if (!price) return undefined
    return estimateCost(price, usage, pricing.groupRatio[this.ccshell.getUserGroup()] ?? 1, await this.ccshell.siteStatus())
  }

  private async loadPricing() {
    if (this.pricing && Date.now() - this.pricing.at < 10 * 60_000) return this.pricing
    const raw = await this.ccshell.publicGet<RawPricing>('/api/pricing', true)
    const prices = new Map<string, ParsedPrice>()
    for (const item of raw.data ?? []) {
      const p = item.model_name ? parsePrice(item) : null
      if (p) prices.set(item.model_name!, p)
    }
    this.pricing = { at: Date.now(), prices, groupRatio: raw.group_ratio ?? {} }
    return this.pricing
  }

  private requireKey(): string {
    const key = this.ccshell.getApiKey()
    if (!key) throw new Error('尚无可用密钥，请先登录账户')
    return key
  }

  private touch(conv: Conversation, bumpTime = true): void {
    if (bumpTime) conv.updatedAt = Date.now()
    this.store.save(conv)
    this.emit('conversation', conv)
    this.emitList()
  }

  private emitList(): void {
    this.emit('list', this.list())
  }
}

function titleFrom(text: string, attachments: Attachment[]): string {
  const line = text.trim().split('\n')[0].trim()
  if (line) return line.length > 30 ? line.slice(0, 30) + '…' : line
  return attachments[0]?.name ?? '新对话'
}

export function requestOptions(s: ChatSettings) {
  const caps = modelCaps(s.model)
  const maxOutputTokens = resolveMaxOutput(s.maxOutputTokens, caps)
  if (protocolOf(s.model) !== 'anthropic') return { maxOutputTokens, temperature: s.temperature ?? undefined }
  const active = thinkingActive(caps, s.thinking)
  const effort = resolveEffort(s.effort, caps, active)
  const thinking =
    caps.thinking === 'budget'
      ? active
        ?
          { type: 'enabled' as const, budgetTokens: Math.max(1024, Math.min(s.thinkingBudget, (maxOutputTokens ?? AUTO_OUTPUT) - 1024)) }
        : undefined
      : active
        ? { type: 'adaptive' as const, display: 'summarized' as const }
        : caps.thinking === 'toggle'
          ? { type: 'disabled' as const }
          : undefined
  return {
    maxOutputTokens,
    temperature: caps.sampling && !active ? (s.temperature ?? undefined) : undefined,
    providerOptions: { anthropic: { ...(thinking ? { thinking } : {}), ...(effort ? { effort } : {}) } }
  }
}

const MAX_STEPS = 20
const DENIED = '用户拒绝了这次工具调用。'
const STOPPED = '这次工具调用被中止了。'

const toolOutput = (c: ToolCallRecord) =>
  c.output || (c.status === 'denied' ? DENIED : c.status === 'done' ? '（没有输出）' : STOPPED)

function toModelMessages(history: ChatMessage[], withTools: boolean): ModelMessage[] {
  const out: ModelMessage[] = []
  for (const m of history) {
    if (m.role === 'assistant') {
      const calls = m.tools ?? []
      if (!calls.length || !withTools) {
        const summary = calls
          .map((c) => `[调用了工具 ${c.serverName}/${c.tool}，结果：${toolOutput(c).slice(0, 2000)}]`)
          .join('\n')
        const text = [m.text.trim(), summary].filter(Boolean).join('\n\n')
        if (text) out.push({ role: 'assistant', content: text })
        continue
      }
      let pos = 0
      const offsets = [...new Set(calls.map((c) => c.at))].sort((a, b) => a - b)
      for (const at of offsets) {
        const group = calls.filter((c) => c.at === at)
        const seg = m.text.slice(pos, at)
        pos = at
        out.push({
          role: 'assistant',
          content: [
            ...(seg.trim() ? [{ type: 'text' as const, text: seg }] : []),
            ...group.map((c) => ({ type: 'tool-call' as const, toolCallId: c.id, toolName: c.name, input: c.input ?? {} }))
          ]
        })
        out.push({
          role: 'tool',
          content: group.map((c) => ({
            type: 'tool-result' as const,
            toolCallId: c.id,
            toolName: c.name,
            output: { type: c.status === 'done' ? ('text' as const) : ('error-text' as const), value: toolOutput(c) }
          }))
        })
      }
      const rest = m.text.slice(pos)
      if (rest.trim()) out.push({ role: 'assistant', content: rest })
      continue
    }
    const content: UserContent = []
    for (const a of m.attachments ?? []) {
      const data = readAttachment(a.id)
      if (a.kind === 'image') content.push({ type: 'image', image: data, mediaType: a.mediaType })
      else if (a.kind === 'pdf') content.push({ type: 'file', data, mediaType: 'application/pdf', filename: a.name })
      else content.push({ type: 'text', text: `文件 ${a.name}：\n\`\`\`\n${data.toString('utf8')}\n\`\`\`` })
    }
    if (m.text.trim()) content.push({ type: 'text', text: m.text })
    if (content.length) out.push({ role: 'user', content })
  }
  return out
}

function toUsage(u: {
  inputTokens?: number
  outputTokens?: number
  inputTokenDetails?: { noCacheTokens?: number; cacheReadTokens?: number; cacheWriteTokens?: number }
  outputTokenDetails?: { reasoningTokens?: number }
}): TokenUsage {
  const cacheRead = u.inputTokenDetails?.cacheReadTokens ?? 0
  const cacheWrite = u.inputTokenDetails?.cacheWriteTokens ?? 0
  return {
    input: u.inputTokenDetails?.noCacheTokens ?? Math.max(0, (u.inputTokens ?? 0) - cacheRead - cacheWrite),
    output: u.outputTokens ?? 0,
    cacheRead,
    cacheWrite,
    reasoning: u.outputTokenDetails?.reasoningTokens ?? 0
  }
}

function describeError(e: unknown, model: string): string {
  if (APICallError.isInstance(e)) {
    let detail = ''
    try {
      const body = JSON.parse(e.responseBody ?? '') as { error?: { message?: string }; message?: string }
      detail = body.error?.message ?? body.message ?? ''
    } catch {}
    const status = e.statusCode
    if (status === 401) return `密钥无效或已被删除（HTTP 401）${detail ? '：' + detail : ''}`
    if (status === 403) return `当前密钥未开通 ${model}，或余额不足（HTTP 403）${detail ? '：' + detail : ''}`
    if (status === 429) return `请求过于频繁，请稍后重试（HTTP 429）${detail ? '：' + detail : ''}`
    return `请求失败（HTTP ${status ?? '?'}）${detail ? '：' + detail : '：' + e.message}`
  }
  const msg = e instanceof Error ? e.message : String(e)
  return /fetch failed|ECONN|ENOTFOUND|network/i.test(msg) ? `网络连接失败：${msg}` : msg
}
