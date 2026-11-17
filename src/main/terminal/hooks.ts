import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { createServer, type Server } from 'node:http'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import { PEER_READONLY, PEER_SERVER, peerToolName } from '../../shared/peers'
import { handleMcp, type PeerCall } from './peersMcp'

export const HOOK_EVENTS = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'PermissionRequest',
  'Notification',
  'Stop',
  'StopFailure',
  'SessionEnd'
] as const

export interface HookEvent {
  session: string
  event: string
  input: Record<string, unknown>
}

const serverFile = () => join(app.getPath('userData'), 'claude-hooks', 'server.json')
function savedServer(): { port: number; token: string } {
  try {
    const j = JSON.parse(readFileSync(serverFile(), 'utf8')) as { port?: number; token?: string }
    return { port: Number(j.port) || 0, token: typeof j.token === 'string' && /^[0-9a-f]{32}$/.test(j.token) ? j.token : '' }
  } catch {
    return { port: 0, token: '' }
  }
}
function saveServer(port: number, token: string): void {
  try {
    mkdirSync(join(app.getPath('userData'), 'claude-hooks'), { recursive: true })
    writeFileSync(serverFile(), JSON.stringify({ port, token }, null, 2))
  } catch {
  }
}

export class HookServer extends EventEmitter<{ event: [HookEvent] }> {
  private readonly token = savedServer().token || randomBytes(16).toString('hex')
  sessionToken(session: string): string {
    return createHmac('sha256', this.token).update('session|' + session).digest('hex').slice(0, 40)
  }
  private authSession(req: import('node:http').IncomingMessage): string {
    const session = String(req.headers['x-ccshell-session'] ?? '')
    const token = req.headers['x-ccshell-token']
    if (!session || typeof token !== 'string') return ''
    const want = this.sessionToken(session)
    return token.length === want.length && timingSafeEqual(Buffer.from(token), Buffer.from(want)) ? session : ''
  }
  private server: Server | null = null
  private port = 0
  private ready: Promise<void> | null = null
  peers: PeerCall | null = null

  start(): Promise<void> {
    this.ready ??= new Promise((resolve, reject) => {
      const server = createServer((req, res) => {
        const authed = this.authSession(req)
        if (req.url === '/mcp' && authed) {
          this.onMcp(req, res, authed)
          return
        }
        const m =/^\/hook\/(\w+)$/.exec(req.url ?? '')
        if (req.method !== 'POST' || !m || !authed) {
          res.writeHead(404).end()
          return
        }
        let body = ''
        req.setEncoding('utf8')
        req.on('data', (c: string) => {
          if (body.length < 1_000_000) body += c
        })
        req.on('end', () => {
          res.writeHead(200, { 'content-type': 'application/json' }).end('{}')
          let input: Record<string, unknown> = {}
          try {
            input = JSON.parse(body || '{}') ?? {}
          } catch {
          }
          this.emit('event', { session: authed, event: m[1], input })
        })
      })
      const listen = (port: number) =>
        server.listen(port, '127.0.0.1', () => {
          this.server = server
          const addr = server.address()
          this.port = typeof addr === 'object' && addr ? addr.port : 0
          saveServer(this.port, this.token)
          resolve()
        })
      const saved = savedServer().port
      server.on('error', (e: NodeJS.ErrnoException) => {
        if (e.code === 'EADDRINUSE' && !this.server && saved) {
          server.removeAllListeners('error')
          server.on('error', reject)
          listen(0)
        } else reject(e)
      })
      listen(saved)
    })
    return this.ready
  }

  private onMcp(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse, session: string): void {
    if (req.method !== 'POST') {
      res.writeHead(405, { allow: 'POST' }).end()
      return
    }
    const peers = this.peers
    let body = ''
    req.setEncoding('utf8')
    req.on('data', (c: string) => {
      if (body.length < 2_000_000) body += c
    })
    req.on('end', () => {
      if (!peers || !session) {
        res.writeHead(503, { 'content-type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32000, message: '客户端的会话协作没有启动' } }))
        return
      }
      handleMcp(body, session, peers).then(
        ([status, out]) => {
          if (out === null) res.writeHead(status).end()
          else res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(out))
        },
        (e) => res.writeHead(500, { 'content-type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32603, message: String(e) } }))
      )
    })
  }

  async mcpConfigFile(session: string): Promise<string> {
    await this.start()
    const dir = join(app.getPath('userData'), 'claude-hooks', 'mcp')
    mkdirSync(dir, { recursive: true })
    const file = join(dir, `${session}.json`)
    const server = { type: 'http', url: `http://127.0.0.1:${this.port}/mcp`, headers: { 'X-CCShell-Session': session, 'X-CCShell-Token': this.sessionToken(session) } }
    writeFileSync(file, JSON.stringify({ mcpServers: { [PEER_SERVER]: server } }, null, 2))
    return file
  }

  removeMcpConfig(session: string): void {
    rmSync(join(app.getPath('userData'), 'claude-hooks', 'mcp', `${session}.json`), { force: true })
    rmSync(join(app.getPath('userData'), 'claude-hooks', 'settings', `${session}.json`), { force: true })
  }

  async settingsFile(session: string): Promise<string> {
    await this.start()
    const hook = (event: string) => ({
      type: 'http',
      url: `http://127.0.0.1:${this.port}/hook/${event}`,
      headers: { 'X-CCShell-Session': session, 'X-CCShell-Token': this.sessionToken(session) },
      timeout: 5
    })
    const hooks: Record<string, unknown[]> = {}
    for (const e of HOOK_EVENTS) hooks[e] = [{ ...(/ToolUse$|PermissionRequest/.test(e) ? { matcher: '*' } : {}), hooks: [hook(e)] }]
    const dir = join(app.getPath('userData'), 'claude-hooks', 'settings')
    mkdirSync(dir, { recursive: true })
    const file = join(dir, `${session}.json`)
    const permissions = { allow: PEER_READONLY.map(peerToolName) }
    writeFileSync(file, JSON.stringify({ hooks, permissions }, null, 2))
    return file
  }

  close(): void {
    this.server?.close()
    this.server = null
  }
}
