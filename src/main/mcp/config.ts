import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { app } from 'electron'
import { EMPTY_SERVER, type McpServerConfig, type McpServerInput, type McpTransport } from '../../shared/mcp'

export class McpConfigStore {
  private readonly file = join(app.getPath('userData'), 'mcp', 'servers.json')
  private servers: McpServerConfig[]

  constructor() {
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf8')) as McpServerConfig[]
      this.servers = raw.map((s) => ({ ...EMPTY_SERVER, ...s }))
    } catch {
      this.servers = []
    }
  }

  all(): McpServerConfig[] {
    return this.servers
  }

  get(id: string): McpServerConfig | undefined {
    return this.servers.find((s) => s.id === id)
  }

  put(server: McpServerConfig): void {
    const i = this.servers.findIndex((s) => s.id === server.id)
    if (i < 0) this.servers.push(server)
    else this.servers[i] = server
    this.save()
  }

  remove(id: string): void {
    this.servers = this.servers.filter((s) => s.id !== id)
    this.save()
  }

  private save(): void {
    mkdirSync(dirname(this.file), { recursive: true })
    writeFileSync(this.file + '.tmp', JSON.stringify(this.servers, null, 2))
    renameSync(this.file + '.tmp', this.file)
  }
}

export function normalizeInput(input: McpServerInput): McpServerInput {
  const s: McpServerInput = { ...EMPTY_SERVER, ...input }
  s.name = s.name.trim()
  if (!s.name) throw new Error('请填写服务器名称')
  if (!['stdio', 'http', 'sse'].includes(s.transport)) throw new Error('不支持的连接方式')
  s.command = s.command.trim()
  s.cwd = s.cwd.trim()
  s.url = s.url.trim()
  s.args = s.args.filter((a) => a !== '')
  if (s.transport === 'stdio' && !s.command) throw new Error('请填写启动命令')
  if (s.transport !== 'stdio') {
    let url: URL
    try {
      url = new URL(s.url)
    } catch {
      throw new Error('服务器地址不是有效的网址')
    }
    if (!/^https?:$/.test(url.protocol)) throw new Error('服务器地址要以 http:// 或 https:// 开头')
  }
  return s
}

type JsonEntry = {
  type?: string
  transport?: string
  command?: string
  args?: unknown
  env?: unknown
  cwd?: string
  url?: string
  serverUrl?: string
  baseUrl?: string
  headers?: unknown
  disabled?: boolean
}

const strMap = (v: unknown): Record<string, string> =>
  v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, String(x)])) : {}

function transportOf(e: JsonEntry): McpTransport {
  const t = (e.type ?? e.transport ?? '').toLowerCase().replace(/[-_]/g, '')
  if (t === 'sse') return 'sse'
  if (t === 'http' || t === 'streamablehttp') return 'http'
  if (t === 'stdio') return 'stdio'
  return e.command ? 'stdio' : 'http'
}

export function parseImport(text: string): McpServerInput[] {
  let root: unknown
  try {
    root = JSON.parse(text)
  } catch (e) {
    throw new Error(`JSON 格式不对：${(e as Error).message}`)
  }
  if (!root || typeof root !== 'object' || Array.isArray(root)) throw new Error('JSON 最外层应该是对象')
  const obj = root as Record<string, unknown>
  const map = (obj.mcpServers ?? obj.servers ?? obj) as Record<string, JsonEntry>
  if (!map || typeof map !== 'object') throw new Error('没有找到 mcpServers')
  const out: McpServerInput[] = []
  for (const [name, e] of Object.entries(map)) {
    if (!e || typeof e !== 'object' || (!e.command && !e.url && !e.serverUrl && !e.baseUrl)) continue
    out.push(
      normalizeInput({
        ...EMPTY_SERVER,
        name,
        transport: transportOf(e),
        enabled: e.disabled !== true,
        command: e.command ?? '',
        args: Array.isArray(e.args) ? e.args.map(String) : [],
        env: strMap(e.env),
        cwd: e.cwd ?? '',
        url: e.url ?? e.serverUrl ?? e.baseUrl ?? '',
        headers: strMap(e.headers)
      })
    )
  }
  if (!out.length) throw new Error('没有找到可以导入的服务器（每个服务器要有 command 或 url）')
  return out
}

export function toClaudeCodeEntry(s: McpServerConfig): Record<string, unknown> {
  if (s.transport === 'stdio') return { type: 'stdio', command: s.command, args: s.args, env: s.env }
  return { type: s.transport, url: s.url, headers: s.headers }
}
