import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { readFileSync, renameSync, writeFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { ToolListChangedNotificationSchema, type CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { app } from 'electron'
import type {
  McpImportResult,
  McpServer,
  McpServerConfig,
  McpServerInput,
  McpServerState,
  McpToolInfo,
  McpTransport
} from '../../shared/mcp'
import { capResult, type ChatTool } from '../chat/tools'
import { electronFetch } from '../electronFetch'
import { configDir as claudeConfigDir } from '../terminal/claude'
import { McpConfigStore, normalizeInput, parseImport, toClaudeCodeEntry } from './config'

interface Connection {
  client: Client | null
  pid: number | null
  state: McpServerState
  closing: boolean
  connecting: Promise<void> | null
}

const MAX_LOG = 200

export class McpService extends EventEmitter<{ changed: [McpServer[]] }> {
  private readonly store = new McpConfigStore()
  private readonly conns = new Map<string, Connection>()

  init(): void {
    for (const s of this.store.all()) if (s.enabled) void this.connect(s).catch(() => {})
  }

  list(): McpServer[] {
    return this.store.all().map((config) => ({ config, state: this.stateOf(config.id) }))
  }

  get(id: string): McpServerConfig | undefined {
    return this.store.get(id)
  }

  async add(input: McpServerInput): Promise<McpServer> {
    const config: McpServerConfig = { ...normalizeInput(input), id: randomUUID(), createdAt: Date.now() }
    this.assertUniqueName(config)
    this.store.put(config)
    this.emitChanged()
    if (config.enabled) await this.connect(config).catch(() => {})
    return { config, state: this.stateOf(config.id) }
  }

  async update(id: string, patch: Partial<McpServerInput>): Promise<McpServer> {
    const old = this.require(id)
    const config: McpServerConfig = { ...old, ...normalizeInput({ ...old, ...patch }), id: old.id, createdAt: old.createdAt }
    this.assertUniqueName(config)
    this.store.put(config)
    const connKeys: (keyof McpServerInput)[] = ['transport', 'command', 'args', 'env', 'cwd', 'url', 'headers', 'enabled']
    const reconnect = connKeys.some((k) => JSON.stringify(old[k]) !== JSON.stringify(config[k]))
    if (reconnect) {
      if (config.enabled) await this.connect(config).catch(() => {})
      else await this.disconnect(id)
    }
    this.emitChanged()
    return { config, state: this.stateOf(id) }
  }

  async remove(id: string): Promise<void> {
    await this.disconnect(id)
    this.conns.delete(id)
    this.store.remove(id)
    this.emitChanged()
  }

  async restart(id: string): Promise<void> {
    const config = this.require(id)
    if (!config.enabled) throw new Error('服务器已停用，先启用再连接')
    await this.connect(config)
  }

  async importJson(text: string): Promise<McpImportResult> {
    const result: McpImportResult = { added: [], updated: [] }
    for (const input of parseImport(text)) {
      const existing = this.store.all().find((s) => s.name === input.name)
      if (existing) {
        const { alwaysAllow, allowedTools, disabledTools } = existing
        await this.update(existing.id, { ...input, alwaysAllow, allowedTools, disabledTools })
        result.updated.push(input.name)
      } else {
        await this.add(input)
        result.added.push(input.name)
      }
    }
    return result
  }

  allowAlways(id: string, tool: string | null): void {
    const config = this.require(id)
    if (tool === null) config.alwaysAllow = true
    else if (!config.allowedTools.includes(tool)) config.allowedTools = [...config.allowedTools, tool]
    this.store.put(config)
    this.emitChanged()
  }

  needsApproval(id: string, tool: string): boolean {
    const config = this.store.get(id)
    return !config || !(config.alwaysAllow || config.allowedTools.includes(tool))
  }

  claudeCodeServers(): string[] {
    return Object.keys(readClaudeJson().mcpServers ?? {})
  }

  syncToClaudeCode(ids: string[]): string[] {
    const cfg = readClaudeJson()
    const servers = { ...(cfg.mcpServers ?? {}) }
    for (const s of this.store.all()) {
      if (ids.includes(s.id)) servers[s.name] = toClaudeCodeEntry(s)
      else delete servers[s.name]
    }
    cfg.mcpServers = servers
    const dir = claudeConfigDir()
    mkdirSync(dir, { recursive: true })
    const file = join(dir, '.claude.json')
    writeFileSync(file + '.tmp', JSON.stringify(cfg, null, 2))
    renameSync(file + '.tmp', file)
    return Object.keys(servers)
  }

  async toolset(ids: string[]): Promise<{ tools: ChatTool[]; failed: string[] }> {
    const tools: ChatTool[] = []
    const failed: string[] = []
    const used = new Set<string>()
    for (const id of ids) {
      const config = this.store.get(id)
      if (!config?.enabled) continue
      let conn: Connection
      try {
        conn = await this.ready(id)
      } catch {
        failed.push(config.name)
        continue
      }
      for (const t of conn.state.tools) {
        if (config.disabledTools.includes(t.name)) continue
        let name = `${slug(config.name) || 'mcp'}__${slug(t.name) || 'tool'}`.slice(0, 60)
        for (let n = 2; used.has(name); n++) name = `${name.slice(0, 58)}_${n}`
        used.add(name)
        tools.push({
          name,
          description: (t.title && t.title !== t.name ? `${t.title}：` : '') + t.description,
          inputSchema: { type: 'object', properties: {}, ...t.inputSchema },
          serverId: id,
          serverName: config.name,
          tool: t.name,
          needsApproval: () => this.needsApproval(id, t.name),
          allowAlways: (scope) => this.allowAlways(id, scope === 'tool' ? t.name : null),
          call: (input, signal) => this.callTool(id, t.name, input, signal)
        })
      }
    }
    return { tools, failed }
  }

  async callTool(id: string, tool: string, args: unknown, signal: AbortSignal): Promise<{ text: string; isError: boolean }> {
    const conn = await this.ready(id)
    const r = (await conn.client!.callTool(
      { name: tool, arguments: (args ?? {}) as Record<string, unknown> },
      undefined,
      { signal, timeout: 10 * 60_000, resetTimeoutOnProgress: true }
    )) as CallToolResult
    return { text: resultText(r), isError: !!r.isError }
  }

  closeAll(): void {
    for (const conn of this.conns.values()) {
      conn.closing = true
      killTree(conn.pid)
      void conn.client?.close().catch(() => {})
    }
  }

  private async ready(id: string): Promise<Connection> {
    let conn = this.conns.get(id)
    if (conn?.connecting) await conn.connecting
    conn = this.conns.get(id)
    if (!conn || conn.state.status !== 'connected') {
      const config = this.require(id)
      await this.connect(config)
      conn = this.conns.get(id)
    }
    if (!conn?.client || conn.state.status !== 'connected') throw new Error(conn?.state.error ?? '没有连上')
    return conn
  }

  private async connect(config: McpServerConfig): Promise<void> {
    await this.disconnect(config.id)
    const conn: Connection = {
      client: null,
      pid: null,
      state: { status: 'connecting', tools: [], log: this.conns.get(config.id)?.state.log ?? [] },
      closing: false,
      connecting: null
    }
    this.conns.set(config.id, conn)
    this.emitChanged()
    conn.connecting = this.tryConnect(config, conn).finally(() => {
      conn.connecting = null
      this.emitChanged()
    })
    await conn.connecting
    if (conn.state.status === 'error') throw new Error(conn.state.error)
  }

  private async tryConnect(config: McpServerConfig, conn: Connection): Promise<void> {
    const order: McpTransport[] =
      config.transport === 'stdio' ? ['stdio'] : config.transport === 'http' ? ['http', 'sse'] : ['sse', 'http']
    const log = (line: string) => pushLog(conn, line)
    let lastError = ''
    for (const t of order) {
      if (conn.closing) return
      const client = new Client({ name: 'CC Shell', version: app.getVersion() })
      const transport = this.createTransport(config, t, conn)
      log(`正在连接（${label(t)}）…`)
      try {
        await client.connect(transport, { timeout: 30_000 })
        if (conn.closing) {
          await client.close().catch(() => {})
          return
        }
        conn.client = client
        conn.pid = transport instanceof StdioClientTransport ? transport.pid : null
        const info = client.getServerVersion()
        conn.state.serverInfo = info ? `${info.name} ${info.version}` : undefined
        conn.state.transportUsed = t
        client.onclose = () => {
          if (conn.closing || this.conns.get(config.id) !== conn) return
          conn.client = null
          conn.state.status = 'error'
          conn.state.error = '连接断开了' + stderrTail(conn)
          log('连接断开')
          this.emitChanged()
        }
        if (client.getServerCapabilities()?.tools?.listChanged)
          client.setNotificationHandler(ToolListChangedNotificationSchema, () => void this.refreshTools(conn).catch(() => {}))
        await this.refreshTools(conn)
        conn.state.status = 'connected'
        conn.state.error = undefined
        log(`已连接：${conn.state.serverInfo ?? '（服务器没报名字）'}，${conn.state.tools.length} 个工具`)
        return
      } catch (e) {
        lastError = describe(e)
        log(`${label(t)} 连接失败：${lastError}`)
        killTree(transport instanceof StdioClientTransport ? transport.pid : null)
        await client.close().catch(() => {})
      }
    }
    if (conn.closing) return
    conn.state.status = 'error'
    conn.state.error = lastError + stderrTail(conn)
  }

  private createTransport(config: McpServerConfig, t: McpTransport, conn: Connection): Transport {
    if (t === 'stdio') {
      const transport = new StdioClientTransport({
        command: config.command,
        args: config.args,
        env: { ...inheritedEnv(), ...config.env },
        cwd: config.cwd || homedir(),
        stderr: 'pipe'
      })
      transport.stderr?.on('data', (chunk: Buffer) => {
        for (const line of chunk.toString('utf8').split(/\r?\n/)) if (line.trim()) pushLog(conn, line)
        this.emitChangedSoon()
      })
      return transport
    }
    const opts = { fetch: electronFetch, requestInit: { headers: config.headers } }
    return t === 'http' ? new StreamableHTTPClientTransport(new URL(config.url), opts) : new SSEClientTransport(new URL(config.url), opts)
  }

  private async refreshTools(conn: Connection): Promise<void> {
    const tools: McpToolInfo[] = []
    let cursor: string | undefined
    do {
      const r = await conn.client!.listTools(cursor ? { cursor } : undefined)
      for (const t of r.tools)
        tools.push({ name: t.name, title: t.title ?? t.annotations?.title, description: t.description ?? '', inputSchema: t.inputSchema })
      cursor = r.nextCursor
    } while (cursor)
    conn.state.tools = tools
    this.emitChanged()
  }

  private async disconnect(id: string): Promise<void> {
    const conn = this.conns.get(id)
    if (!conn) return
    conn.closing = true
    killTree(conn.pid)
    await conn.client?.close().catch(() => {})
    conn.client = null
    conn.state = { status: 'stopped', tools: [], log: conn.state.log }
    this.emitChanged()
  }

  private stateOf(id: string): McpServerState {
    return this.conns.get(id)?.state ?? { status: 'stopped', tools: [], log: [] }
  }

  private require(id: string): McpServerConfig {
    const config = this.store.get(id)
    if (!config) throw new Error('服务器不存在或已删除')
    return config
  }

  private assertUniqueName(config: McpServerConfig): void {
    if (this.store.all().some((s) => s.id !== config.id && s.name === config.name)) throw new Error(`已经有一个叫“${config.name}”的服务器了`)
  }

  private emitChanged(): void {
    this.emit('changed', this.list())
  }

  private logTimer: NodeJS.Timeout | null = null
  private emitChangedSoon(): void {
    this.logTimer ??= setTimeout(() => {
      this.logTimer = null
      this.emitChanged()
    }, 300)
  }
}

function readClaudeJson(): Record<string, any> {
  try {
    return JSON.parse(readFileSync(join(claudeConfigDir(), '.claude.json'), 'utf8'))
  } catch {
    return {}
  }
}

function inheritedEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined || /^(ELECTRON_|VITE_|CCSHELL_|npm_)/i.test(k)) continue
    env[k] = v
  }
  return env
}

function killTree(pid: number | null): void {
  if (!pid) return
  try {
    if (process.platform === 'win32') execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
    else process.kill(pid)
  } catch {
  }
}

function pushLog(conn: Connection, line: string): void {
  conn.state.log.push(line.length > 500 ? line.slice(0, 500) + '…' : line)
  if (conn.state.log.length > MAX_LOG) conn.state.log.splice(0, conn.state.log.length - MAX_LOG)
}

function stderrTail(conn: Connection): string {
  const lines = conn.state.log.filter((l) => !/^(正在连接|已连接|连接断开)|连接失败：/.test(l)).slice(-3)
  return lines.length ? `\n${lines.join('\n')}` : ''
}

const label = (t: McpTransport) => (t === 'stdio' ? '本机命令' : t === 'http' ? 'Streamable HTTP' : 'SSE')

const slug = (s: string) =>
  s
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')

function describe(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  if (/ENOENT/.test(msg)) return `找不到命令（${msg}）`
  if (/401|unauthorized/i.test(msg)) return `服务器拒绝了请求，可能需要在请求头里填认证信息（${msg}）`
  return msg
}

function resultText(r: CallToolResult): string {
  const parts: string[] = []
  for (const c of r.content ?? []) {
    if (c.type === 'text') parts.push(c.text)
    else if (c.type === 'image' || c.type === 'audio')
      parts.push(`[${c.type === 'image' ? '图片' : '音频'} ${c.mimeType}，约 ${Math.round((c.data.length * 3) / 4 / 1024)} KB，客户端暂不转发]`)
    else if (c.type === 'resource') parts.push('text' in c.resource ? String(c.resource.text) : `[资源 ${c.resource.uri}]`)
    else if (c.type === 'resource_link') parts.push(`[资源链接 ${c.uri}]`)
  }
  if (!parts.length && r.structuredContent) parts.push(JSON.stringify(r.structuredContent, null, 2))
  return capResult(parts.join('\n\n'))
}
