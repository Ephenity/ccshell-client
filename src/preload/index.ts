import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { AccountOverview, AccountState, Announcement, LoginOutcome, Result } from '../shared/ccshell'
import type { Attachment, ChatDelta, ChatSettings, Conversation, ConversationSummary, ModelInfo } from '../shared/chat'
import type { AgentToolName, Assistant, AssistantInput } from '../shared/assistant'
import type { KnowledgeBase, KnowledgeHit, KnowledgeItem } from '../shared/knowledge'
import type { ApprovalDecision, McpImportResult, McpServer, McpServerInput } from '../shared/mcp'
import type { CleanupItem, CleanupResult, EnvCheck, LogFileInfo, UsageRange, UsageSummary } from '../shared/maintenance'
import type { ClaudeInstallInfo, Notice, FavoriteConversation, HistoryItem, HistoryMessage, TerminalData, TerminalInfo, TerminalOptions, TerminalSession } from '../shared/terminal'
import type { AppSettings, MenuItemSpec, SettingsPatch } from '../shared/settings'
import type { ThemeName } from '../shared/theme'
import type { PromptItem, PromptPatch, PromptUse } from '../shared/prompts'
import type { PeerEntry } from '../shared/peers'
import type { SessionQueue } from '../shared/queue'
import type { AnthropicStatus } from '../shared/anthropic'
import type { UpdateState } from '../shared/update'

type KbInput = Pick<KnowledgeBase, 'name' | 'description' | 'embeddingModel'>

const invoke =<T>(channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args) as Promise<Result<T>>

function subscribe<T>(channel: string, listener: (payload: T) => void) {
  const wrapped = (_: unknown, payload: T) => listener(payload)
  ipcRenderer.on(channel, wrapped)
  return () => void ipcRenderer.removeListener(channel, wrapped)
}

const api = {
  platform: process.platform,
  setTheme: (theme: ThemeName) => ipcRenderer.send('theme:set', theme),

  account: {
    state: () => invoke<AccountState>('ccshell:state'),
    loginMode: () => invoke<'password' | 'web'>('ccshell:login-mode'),
    login: (account: string, password: string) => invoke<LoginOutcome>('ccshell:login', account, password),
    verify: (code: string) => invoke<void>('ccshell:verify', code),
    webLogin: () => invoke<boolean>('ccshell:web-login'),
    logout: () => invoke<void>('ccshell:logout'),
    setBaseUrl: (url: string) => invoke<void>('ccshell:set-base-url', url),
    overview: () => invoke<AccountOverview>('ccshell:overview'),
    refreshBalance: () => invoke<void>('ccshell:refresh-balance'),
    dueAnnouncements: () => invoke<Announcement[] | null>('ccshell:due-announcements'),
    openHome: () => invoke<void>('ccshell:open-home'),
    ensureKey: () => invoke<void>('ccshell:ensure-key'),
    selectKey: (id: string) => invoke<void>('ccshell:select-key', id),
    copyKey: () => invoke<void>('ccshell:copy-key'),
    openSite: (path: string) => invoke<void>('ccshell:open-site', path),
    onChanged: (listener: (state: AccountState) => void) => subscribe('ccshell:changed', listener)
  },

  chat: {
    list: () => invoke<ConversationSummary[]>('chat:list'),
    get: (id: string) => invoke<Conversation>('chat:get', id),
    create: () => invoke<Conversation>('chat:create'),
    rename: (id: string, title: string) => invoke<void>('chat:rename', id, title),
    delete: (id: string) => invoke<void>('chat:delete', id),
    updateSettings: (id: string, patch: Partial<ChatSettings>) => invoke<Conversation>('chat:update-settings', id, patch),
    models: () => invoke<ModelInfo[]>('chat:models'),
    lastSettings: () => invoke<ChatSettings>('chat:last-settings'),
    rememberSettings: (patch: Partial<ChatSettings>) => invoke<ChatSettings>('chat:remember-settings', patch),
    send: (id: string, text: string, attachments: Attachment[]) => invoke<void>('chat:send', id, text, attachments),
    regenerate: (id: string) => invoke<void>('chat:regenerate', id),
    stop: (id: string) => invoke<void>('chat:stop', id),
    approveTool: (callId: string, decision: ApprovalDecision) => invoke<void>('chat:approve-tool', callId, decision),
    attachData: (name: string, data: Uint8Array, mediaType: string) => invoke<Attachment>('chat:attach-data', name, data, mediaType),
    attachFiles: (files: File[]) => invoke<Attachment[]>('chat:attach-paths', files.map((f) => webUtils.getPathForFile(f))),
    pickFiles: () => invoke<Attachment[]>('chat:pick-files'),
    onList: (listener: (list: ConversationSummary[]) => void) => subscribe('chat:list-changed', listener),
    onConversation: (listener: (conv: Conversation) => void) => subscribe('chat:conversation-changed', listener),
    onDelta: (listener: (delta: ChatDelta) => void) => subscribe('chat:delta', listener)
  },

  mcp: {
    list: () => invoke<McpServer[]>('mcp:list'),
    add: (input: McpServerInput) => invoke<McpServer>('mcp:add', input),
    update: (id: string, patch: Partial<McpServerInput>) => invoke<McpServer>('mcp:update', id, patch),
    remove: (id: string) => invoke<void>('mcp:remove', id),
    restart: (id: string) => invoke<void>('mcp:restart', id),
    importJson: (text: string) => invoke<McpImportResult>('mcp:import', text),
    claudeServers: () => invoke<string[]>('mcp:claude-servers'),
    syncClaude: (ids: string[]) => invoke<string[]>('mcp:sync-claude', ids),
    onChanged: (listener: (list: McpServer[]) => void) => subscribe('mcp:changed', listener)
  },

  knowledge: {
    list: () => invoke<KnowledgeBase[]>('kb:list'),
    create: (input: KbInput) => invoke<KnowledgeBase>('kb:create', input),
    update: (id: string, patch: Partial<KbInput>) => invoke<KnowledgeBase>('kb:update', id, patch),
    remove: (id: string) => invoke<void>('kb:remove', id),
    addFiles: (id: string, files: File[]) => invoke<KnowledgeItem[]>('kb:add-paths', id, files.map((f) => webUtils.getPathForFile(f))),
    addPaths: (id: string, paths: string[]) => invoke<KnowledgeItem[]>('kb:add-paths', id, paths),
    addUrl: (id: string, url: string) => invoke<KnowledgeItem>('kb:add-url', id, url),
    pickFiles: (id: string) => invoke<KnowledgeItem[]>('kb:pick-files', id),
    pickFolder: (id: string) => invoke<KnowledgeItem[]>('kb:pick-folder', id),
    removeItem: (id: string, itemId: string) => invoke<void>('kb:remove-item', id, itemId),
    refreshItem: (id: string, itemId: string) => invoke<void>('kb:refresh-item', id, itemId),
    search: (ids: string[], query: string) => invoke<KnowledgeHit[]>('kb:search', ids, query),
    onChanged: (listener: (list: KnowledgeBase[]) => void) => subscribe('kb:changed', listener)
  },

  assistant: {
    list: () => invoke<Assistant[]>('assistant:list'),
    create: (input: AssistantInput) => invoke<Assistant>('assistant:create', input),
    update: (id: string, input: AssistantInput) => invoke<Assistant>('assistant:update', id, input),
    remove: (id: string) => invoke<void>('assistant:remove', id),
    start: (id: string) => invoke<Conversation>('assistant:start', id),
    onChanged: (listener: (list: Assistant[]) => void) => subscribe('assistant:changed', listener)
  },

  agent: {
    pickDir: () => invoke<string | null>('agent:pick-dir'),
    permissions: () => invoke<AgentToolName[]>('agent:permissions'),
    setPermissions: (tools: AgentToolName[]) => invoke<void>('agent:set-permissions', tools)
  },

  terminal: {
    info: () => invoke<TerminalInfo>('term:info'),
    list: () => invoke<TerminalSession[]>('term:list'),
    buffer: (id: string) => invoke<string>('term:buffer', id),
    create: (options: TerminalOptions) => invoke<TerminalSession>('term:create', options),
    restart: (id: string) => invoke<TerminalSession>('term:restart', id),
    rename: (id: string, title: string) => invoke<void>('term:rename', id, title),
    end: (id: string) => invoke<void>('term:end', id),
    remove: (id: string) => invoke<void>('term:remove', id),
    detach: (id: string) => invoke<void>('term:detach', id),
    reclaim: (id: string) => invoke<void>('term:reclaim', id),
    popout: (id: string) => invoke<void>('term:popout', id),
    popoutClose: (id: string) => invoke<void>('term:popout-close', id),
    focusMain: () => invoke<void>('term:focus-main'),
    clearExited: () => invoke<void>('term:clear-exited'),
    pinDir: (dir: string, pinned: boolean) => invoke<void>('term:pin-dir', dir, pinned),
    forgetDir: (dir: string) => invoke<void>('term:forget-dir', dir),
    openDir: (dir: string) => invoke<void>('term:open-dir', dir),
    favorite: (target: { sessionId?: string; conversationId?: string }, on: boolean) => invoke<FavoriteConversation[]>('term:favorite', target, on),
    history: () => invoke<HistoryItem[]>('term:history'),
    historyMessages: (id: string) => invoke<HistoryMessage[]>('term:history-messages', id),
    deleteHistory: (id: string) => invoke<void>('term:history-delete', id),
    exportHistory: (id: string) => invoke<string | null>('term:history-export', id),
    continueNow: (id: string) => invoke<string>('term:continue', id),
    pickDir: () => invoke<string | null>('term:pick-dir'),
    pickClaude: () => invoke<string | null>('term:pick-claude'),
    openConfigDir: (account?: 'ccshell' | 'anthropic') => invoke<string>('term:open-config-dir', account),
    pathOf: (file: File) => webUtils.getPathForFile(file),
    savePastedImage: (data: Uint8Array, mediaType: string) => invoke<string>('term:save-pasted-image', data, mediaType),
    write: (id: string, data: string) => ipcRenderer.send('term:write', id, data),
    resize: (id: string, cols: number, rows: number) => ipcRenderer.send('term:resize', id, cols, rows),
    onList: (listener: (list: TerminalSession[]) => void) => subscribe('term:list-changed', listener),
    onData: (listener: (d: TerminalData) => void) => subscribe('term:data', listener)
  },

  anthropic: {
    status: () => invoke<AnthropicStatus>('anthropic:status'),
    setApiKey: (key: string) => invoke<AnthropicStatus>('anthropic:set-key', key),
    clearApiKey: () => invoke<AnthropicStatus>('anthropic:clear-key'),
    logout: () => invoke<AnthropicStatus>('anthropic:logout'),
    loginDir: () => invoke<string>('anthropic:login-dir')
  },
  queue: {
    all: () => invoke<SessionQueue[]>('queue:all'),
    add: (id: string, text: string, index?: number, attachments?: Attachment[]) => invoke<SessionQueue>('queue:add', id, text, index, attachments),
    update: (id: string, itemId: string, text: string) => invoke<SessionQueue>('queue:update', id, itemId, text),
    remove: (id: string, itemId: string) => invoke<SessionQueue>('queue:remove', id, itemId),
    move: (id: string, itemId: string, delta: -1 | 1) => invoke<SessionQueue>('queue:move', id, itemId, delta),
    requeue: (id: string, itemId: string) => invoke<SessionQueue>('queue:requeue', id, itemId),
    clear: (id: string, what: 'finished' | 'pending' | 'all') => invoke<SessionQueue>('queue:clear', id, what),
    pause: (id: string) => invoke<SessionQueue>('queue:pause', id),
    resume: (id: string) => invoke<SessionQueue>('queue:resume', id),
    cancelAuto: (id: string) => invoke<SessionQueue>('queue:cancel-auto', id),
    sendNext: (id: string) => invoke<SessionQueue>('queue:send-next', id),
    sendDirect: (id: string, text: string) => invoke<SessionQueue>('queue:send-direct', id, text),
    onChanged: (listener: (q: SessionQueue) => void) => subscribe('queue:changed', listener)
  },

  prompts: {
    list: () => invoke<PromptItem[]>('prompts:list'),
    create: (patch?: PromptPatch) => invoke<PromptItem>('prompts:create', patch),
    update: (id: string, patch: PromptPatch) => invoke<PromptItem>('prompts:update', id, patch),
    duplicate: (id: string) => invoke<PromptItem>('prompts:duplicate', id),
    remove: (id: string) => invoke<void>('prompts:remove', id),
    use: (id: string, use: PromptUse) => invoke<string | null>('prompts:use', id, use),
    onChanged: (listener: (list: PromptItem[]) => void) => subscribe('prompts:changed', listener)
  },

  peers: {
    list: () => invoke<PeerEntry[]>('peers:list'),
    clear: () => invoke<void>('peers:clear'),
    onChanged: (listener: (list: PeerEntry[]) => void) => subscribe('peers:changed', listener)
  },

  claudeCode: {
    info: (recheck?: boolean) => invoke<ClaudeInstallInfo>('cc:info', recheck),
    install: () => invoke<string>('cc:install'),
    checkUpdate: () => invoke<string>('cc:check-update'),
    uninstall: () => invoke<void>('cc:uninstall'),
    cancel: () => invoke<void>('cc:cancel'),
    onChanged: (listener: (info: ClaudeInstallInfo) => void) => subscribe('cc:changed', listener)
  },

  settings: {
    get: () => invoke<AppSettings>('settings:get'),
    update: (patch: SettingsPatch) => invoke<AppSettings>('settings:update', patch),
    onChanged: (listener: (s: AppSettings) => void) => subscribe('settings:changed', listener)
  },

  quit: {
    onAsk: (listener: (q: { id: string; count: number }) => void) => subscribe('quit:ask', listener),
    answer: (id: string, choice: 'detach' | 'end' | null, remember: boolean) => ipcRenderer.send('quit:answer', id, { choice, remember })
  },

  ui: {
    setActiveSession: (id: string | null) => ipcRenderer.send('ui:active-session', id),
    onOpenSession: (listener: (id: string) => void) => subscribe('ui:open-session', listener),
    dimTitleBar: (alpha: number) => ipcRenderer.send('ui:dim-titlebar', alpha)
  },

  toast: {
    ready: () => ipcRenderer.send('toast:ready'),
    resize: (height: number) => ipcRenderer.send('toast:resize', height),
    click: (sessionId?: string) => ipcRenderer.send('toast:click', sessionId),
    onAdd: (listener: (n: Notice & { sound: boolean }) => void) => subscribe('toast:add', listener)
  },

  tray: {
    resize: (height: number) => ipcRenderer.send('tray:resize', height),
    hide: () => ipcRenderer.send('tray:hide'),
    showWindow: () => ipcRenderer.send('tray:show-window'),
    openSession: (id: string) => ipcRenderer.send('tray:open-session', id),
    quit: () => ipcRenderer.send('tray:quit'),
    onShown: (listener: () => void) => subscribe('tray:shown', listener)
  },
  float: {
    openSession: (id: string) => ipcRenderer.send('float:open-session', id),
    resize: (height: number) => ipcRenderer.send('float:resize', height),
    close: () => ipcRenderer.send('float:close'),
    collapse: (collapsed: boolean) => ipcRenderer.send('float:collapse', collapsed),
    onCollapsed: (listener: (c: boolean) => void) => subscribe('float:collapsed', listener)
  },

  maintenance: {
    testNotice: () => invoke<null>('notify:test'),
    hotkeyStatus: () => invoke<{ key: string; error: string | null }>('hotkey:status'),
    usage: (range: UsageRange) => invoke<UsageSummary>('usage:summary', range),
    scanCleanup: () => invoke<CleanupItem[]>('cleanup:scan'),
    runCleanup: (ids: string[]) => invoke<CleanupResult>('cleanup:run', ids),
    logs: () => invoke<LogFileInfo[]>('logs:list'),
    readLog: (name: string) => invoke<string>('logs:read', name),
    openLogDir: () => invoke<string>('logs:open-dir'),
    envCheck: () => invoke<EnvCheck[]>('env:check'),
    copyEnvReport: () => invoke<string>('env:copy-report')
  },

  update: {
    state: () => invoke<UpdateState>('update:state'),
    check: () => invoke<UpdateState>('update:check'),
    download: () => invoke<void>('update:download'),
    install: () => invoke<void>('update:install'),
    dismiss: () => invoke<void>('update:dismiss'),
    onChanged: (listener: (s: UpdateState) => void) => subscribe('update:changed', listener)
  },

  app: {
    openExternal: (url: string) => invoke<void>('app:open-external', url),
    sandboxProfile: () => invoke<boolean>('app:sandbox-profile'),
    contextMenu: (items: MenuItemSpec[]) => invoke<string | null>('ui:context-menu', items)
  }
}

export type PreloadApi = typeof api

contextBridge.exposeInMainWorld('ccshell', api)
