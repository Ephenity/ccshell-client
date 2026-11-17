import { testEnv } from '../main/testhooks'
import { execFileSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { createServer, type Socket } from 'node:net'
import * as pty from 'node-pty'
import { checkTicket, frame, HOST_KEY_ENV, HOST_PROTOCOL, hostProof, lineReader, macEqual, mainProof, newNonce, type AttachMsg, type HostMsg, type HostSession, type MainMsg, type SpawnRequest, type ToAttachMsg } from '../main/terminal/hostProtocol'

const [pipe, logFile] = process.argv.slice(2)
const KEY = Buffer.from(process.env[HOST_KEY_ENV] ?? '', 'hex')
delete process.env[HOST_KEY_ENV]
const usedTickets = new Set<string>()
const BUFFER_CHARS = 1_000_000
const IDLE_EXIT_MS = Number(testEnv('CCSHELL_HOST_IDLE_MS')) || 10_000
const EXIT_WAIT_MS = 12_000

function log(text: string): void {
  if (!logFile) return
  try {
    const t = new Date()
    const p = (n: number) => String(n).padStart(2, '0')
    const at = `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())} ${p(t.getHours())}:${p(t.getMinutes())}:${p(t.getSeconds())}`
    appendFileSync(logFile, `${at}  [后台]  ${text.replace(/\r?\n/g, ' ⏎ ')}\n`, 'utf8')
  } catch {
  }
}

interface Session {
  id: string
  proc: pty.IPty
  cols: number
  rows: number
  meta: unknown
  buffer: string
  attach: Socket | null
  reclaiming: boolean
  ending: boolean
}

const sessions = new Map<string, Session>()
const mains = new Set<Socket>()
let idleTimer: NodeJS.Timeout | null = null

const send = (sock: Socket | null, msg: HostMsg | ToAttachMsg) => {
  if (sock && !sock.destroyed) sock.write(frame(msg))
}
const broadcast = (msg: HostMsg) => mains.forEach((m) => send(m, msg))
const titleOf = (s: Session) => String((s.meta as { title?: string } | null)?.title ?? 'Claude Code')

function killTree(proc: pty.IPty): void {
  try {
    execFileSync('taskkill.exe', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true, timeout: 5000 })
  } catch {
  }
  try {
    proc.kill()
  } catch {
  }
}

function checkIdle(): void {
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = null
  if (sessions.size || mains.size) return
  idleTimer = setTimeout(() => {
    if (sessions.size || mains.size) return
    log('没有会话也没有客户端，退出')
    process.exit(0)
  }, IDLE_EXIT_MS)
}

function spawn(req: SpawnRequest): Session {
  if (sessions.has(req.id)) throw new Error('会话已经在运行')
  const proc = pty.spawn(req.file, req.args, { name: 'xterm-256color', cols: req.cols, rows: req.rows, cwd: req.cwd, env: req.env, useConpty: true })
  const s: Session = { id: req.id, proc, cols: req.cols, rows: req.rows, meta: req.meta, buffer: '', attach: null, reclaiming: false, ending: false }
  sessions.set(req.id, s)
  proc.onData((data) => {
    s.buffer += data
    if (s.buffer.length > BUFFER_CHARS * 1.2) s.buffer = s.buffer.slice(-BUFFER_CHARS)
    broadcast({ t: 'data', id: s.id, data })
    send(s.attach, { t: 'data', data })
  })
  proc.onExit(({ exitCode }) => {
    sessions.delete(s.id)
    log(`会话结束 ${titleOf(s)}（${s.id}），退出码 ${exitCode}`)
    broadcast({ t: 'exit', id: s.id, code: exitCode })
    send(s.attach, { t: 'exit', code: exitCode })
    checkIdle()
  })
  log(`开始会话 ${titleOf(s)}（${s.id}）pid ${proc.pid}`)
  checkIdle()
  return s
}

function resize(s: Session, cols: number, rows: number): void {
  if (cols < 2 || rows < 2) return
  s.cols = cols
  s.rows = rows
  try {
    s.proc.resize(cols, rows)
  } catch {
  }
}

function redraw(s: Session, cols: number, rows: number): void {
  resize(s, Math.max(2, cols - 1), rows)
  setTimeout(() => sessions.get(s.id) === s && resize(s, cols, rows), 120)
}

function endGracefully(s: Session): void {
  if (s.ending) return
  s.ending = true
  log(`终端窗口关掉了，正常结束会话 ${titleOf(s)}`)
  const steps: [string, number][] = [
    ['\x1b', 0],
    ['\x15', 400],
    ['/exit', 200],
    ['\r', 300]
  ]
  let at = 0
  for (const [data, ms] of steps) {
    at += ms
    setTimeout(() => sessions.get(s.id) === s && s.proc.write(data), at)
  }
  setTimeout(() => sessions.get(s.id) === s && killTree(s.proc), EXIT_WAIT_MS)
}

function snapshot(s: Session): HostSession {
  return { id: s.id, pid: s.proc.pid, cols: s.cols, rows: s.rows, meta: s.meta, buffer: s.buffer, attached: !!s.attach }
}

function onMain(sock: Socket, msg: MainMsg): void {
  const reply = (n: number, data?: unknown) => send(sock, { t: 'reply', n, ok: true, data })
  const fail = (n: number, error: string) => send(sock, { t: 'reply', n, ok: false, error })
  const s = 'id' in msg ? sessions.get(msg.id) : undefined
  switch (msg.t) {
    case 'hello':
      return fail(msg.n, '已经认证过了')
    case 'spawn':
      try {
        return reply(msg.n, { pid: spawn(msg.req).proc.pid })
      } catch (e) {
        return fail(msg.n, (e as Error).message)
      }
    case 'list':
      return reply(msg.n, [...sessions.values()].map(snapshot))
    case 'write':
      s?.proc.write(msg.data)
      return
    case 'resize':
      if (s && !s.attach) resize(s, msg.cols, msg.rows)
      return
    case 'kill':
      if (s) {
        s.ending = true
        if (s.attach) {
          s.reclaiming = true
          send(s.attach, { t: 'close' })
        }
        killTree(s.proc)
      }
      return
    case 'meta':
      if (s) s.meta = msg.meta
      return
    case 'reclaim':
      if (s?.attach) {
        s.reclaiming = true
        send(s.attach, { t: 'close' })
        log(`收回 ${titleOf(s)}：让终端窗口关掉`)
      }
      return
    case 'quit':
      log('客户端要求结束所有会话并退出')
      for (const x of sessions.values()) killTree(x.proc)
      reply(msg.n)
      setTimeout(() => process.exit(0), 200)
      return
  }
}

function onAttach(sock: Socket, msg: AttachMsg, state: { session: Session | null }): void {
  if (msg.t === 'hello') {
    if (state.session) return
    const s = sessions.get(msg.id)
    if (!s) return send(sock, { t: 'error', error: '这个会话已经结束了。' })
    if (s.attach && !s.attach.destroyed) return send(sock, { t: 'error', error: '这个会话已经在另一个终端窗口里了。' })
    s.attach = sock
    s.reclaiming = false
    state.session = s
    send(sock, { t: 'ok', title: titleOf(s) })
    broadcast({ t: 'attach', id: s.id, on: true })
    log(`会话 ${titleOf(s)} 分离到终端窗口（${msg.cols}×${msg.rows}）`)
    redraw(s, msg.cols, msg.rows)
    return
  }
  const s = state.session
  if (!s || s.attach !== sock) return
  if (msg.t === 'input') s.proc.write(msg.data)
  else if (msg.t === 'resize') resize(s, msg.cols, msg.rows)
}

const server = createServer((sock) => {
  let role: 'main' | 'attach' | null = null
  const attachState = { session: null as Session | null }
  const challenge = newNonce()
  send(sock, { t: 'challenge', nonce: challenge })
  const reject = (why: string, graceful = false) => {
    log(`拒绝一个连接：${why}`)
    if (graceful) sock.end()
    else sock.destroy()
  }
  sock.on(
    'data',
    lineReader((m) => {
      if (sock.destroyed) return
      const msg = m as MainMsg | AttachMsg
      if (!role) {
        if (msg.t !== 'hello') return reject('没有先认证')
        if (msg.role === 'main') {
          if (!macEqual(msg.proof, mainProof(KEY, challenge, String(msg.nonce)))) return reject('客户端证明不对')
          role = 'main'
          mains.add(sock)
          checkIdle()
          return send(sock, { t: 'reply', n: msg.n, ok: true, data: { protocol: HOST_PROTOCOL, pid: process.pid, proof: hostProof(KEY, challenge, String(msg.nonce)) } })
        }
        if (msg.role === 'attach') {
          if (usedTickets.has(msg.ticket) || !checkTicket(KEY, msg.id, msg.ticket)) {
            send(sock, { t: 'error', error: '终端窗口的票据无效或已过期，请在客户端里重新分离。' })
            return reject('终端窗口票据无效', true)
          }
          usedTickets.add(msg.ticket)
          role = 'attach'
        } else return reject('未知角色')
      }
      if (role === 'main') onMain(sock, msg as MainMsg)
      else if (role === 'attach') onAttach(sock, msg as AttachMsg, attachState)
    })
  )
  sock.on('error', () => {})
  sock.on('close', () => {
    if (role === 'main') mains.delete(sock)
    const s = attachState.session
    if (s && s.attach === sock) {
      s.attach = null
      broadcast({ t: 'attach', id: s.id, on: false })
      if (sessions.get(s.id) === s && !s.reclaiming && !s.ending) endGracefully(s)
      else log(`会话 ${titleOf(s)} 回到客户端`)
      s.reclaiming = false
    }
    checkIdle()
  })
})

server.on('error', (e: NodeJS.ErrnoException) => {
  log(`管道开不了（${e.code}）：${e.message}`)
  process.exit(e.code === 'EADDRINUSE' ? 0 : 1)
})
if (KEY.length < 32) {
  log('没有拿到认证密钥，退出')
  process.exit(1)
}
server.listen(pipe, () => {
  log(`启动，pid ${process.pid}，管道 ${pipe}`)
  checkIdle()
})
process.on('uncaughtException', (e) => log(`出错：${e.stack ?? e}`))
