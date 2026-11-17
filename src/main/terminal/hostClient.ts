import { spawn as spawnProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { connect, type Socket } from 'node:net'
import { join } from 'node:path'
import { app, safeStorage } from 'electron'
import { log } from '../log'
import { attachTicket, frame, HOST_KEY_ENV, HOST_PROTOCOL, hostProof, lineReader, macEqual, mainProof, newNonce, pipeName, type HostMsg, type HostSession, type MainMsg, type SpawnRequest } from './hostProtocol'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function loadHostKey(): Buffer {
  const file = join(app.getPath('userData'), 'host.key')
  try {
    const k = Buffer.from(safeStorage.decryptString(readFileSync(file)), 'hex')
    if (k.length === 32) return k
  } catch {
  }
  const k = randomBytes(32)
  try {
    if (safeStorage.isEncryptionAvailable()) writeFileSync(file, safeStorage.encryptString(k.toString('hex')))
  } catch (e) {
    log('后台', `认证密钥没能保存：${(e as Error).message}`)
  }
  return k
}

export class RemotePty {
  private readonly dataCbs = new Set<(d: string) => void>()
  private readonly exitCbs = new Set<(e: { exitCode: number }) => void>()
  exited = false

  constructor(
    private readonly host: HostClient,
    readonly id: string,
    readonly pid: number
  ) {}

  write(data: string): void {
    if (!this.exited) this.host.send({ t: 'write', id: this.id, data })
  }
  resize(cols: number, rows: number): void {
    if (!this.exited) this.host.send({ t: 'resize', id: this.id, cols, rows })
  }
  kill(): void {
    if (!this.exited) this.host.send({ t: 'kill', id: this.id })
  }
  onData(cb: (d: string) => void): void {
    this.dataCbs.add(cb)
  }
  onExit(cb: (e: { exitCode: number }) => void): void {
    this.exitCbs.add(cb)
  }
  emitData(d: string): void {
    for (const cb of this.dataCbs) cb(d)
  }
  emitExit(code: number): void {
    if (this.exited) return
    this.exited = true
    for (const cb of [...this.exitCbs]) cb({ exitCode: code })
  }
}

export class HostClient extends EventEmitter<{ attach: [string, boolean] }> {
  private keyCache: Buffer | null = null
  private get key(): Buffer {
    return (this.keyCache ??= loadHostKey())
  }
  get pipe(): string {
    return pipeName(app.getPath('userData'), this.key)
  }
  ticket(id: string): string {
    return attachTicket(this.key, id)
  }
  private sock: Socket | null = null
  private challenge: { promise: Promise<string>; resolve: (n: string) => void } | null = null
  private connecting: Promise<void> | null = null
  private n = 0
  private readonly waiting = new Map<number, { ok: (d: unknown) => void; fail: (e: Error) => void }>()
  private readonly ptys = new Map<string, RemotePty>()

  static script(name: 'host' | 'attach'): string {
    return join(__dirname, `${name}.js`).replace(/([\\/])app\.asar([\\/])/i, '$1app.asar.unpacked$2')
  }

  get connected(): boolean {
    return !!this.sock && !this.sock.destroyed
  }

  async connect(spawn = true): Promise<boolean> {
    if (this.connected) return true
    this.connecting ??= this.doConnect(spawn).finally(() => (this.connecting = null))
    await this.connecting
    return this.connected
  }

  private async doConnect(spawn: boolean): Promise<void> {
    let started = false
    const t0 = Date.now()
    for (;;) {
      try {
        await this.open()
        break
      } catch (e) {
        const code = (e as NodeJS.ErrnoException).code
        if (code !== 'ENOENT' && code !== 'ECONNREFUSED') throw e
        if (!spawn) return
        if (!started) {
          this.startHost()
          started = true
        }
        if (Date.now() - t0 > 10_000) throw new Error('会话后台进程启动失败（10 秒内未能连接）')
        await sleep(150)
      }
    }
    const hostNonce = await Promise.race([this.challenge!.promise, sleep(5000).then(() => null)])
    if (!hostNonce) {
      this.sock?.destroy()
      throw new Error('会话后台进程没有回应（握手超时）')
    }
    const mainNonce = newNonce()
    const hello = (await this.request({ t: 'hello', role: 'main', n: 0, nonce: mainNonce, proof: mainProof(this.key, hostNonce, mainNonce) })) as { protocol: number; pid: number; proof?: string }
    if (!macEqual(hello.proof, hostProof(this.key, hostNonce, mainNonce))) {
      this.sock?.destroy()
      this.sock = null
      log('后台', '会话后台进程身份校验失败，已断开')
      throw new Error('会话后台进程身份校验失败')
    }
    log('后台', `连上会话后台进程（pid ${hello.pid}${started ? '，刚启动' : ''}）`)
    if (hello.protocol !== HOST_PROTOCOL) {
      const live = await this.list()
      if (live.length) {
        log('后台', `后台进程的协议版本 ${hello.protocol} 和客户端 ${HOST_PROTOCOL} 不同，但还有 ${live.length} 个会话在运行，先接着用`)
      } else {
        log('后台', `后台进程的协议版本 ${hello.protocol} 和客户端 ${HOST_PROTOCOL} 不同，重启它`)
        await this.request({ t: 'quit', n: 0 }).catch(() => undefined)
        this.sock?.destroy()
        this.sock = null
        await sleep(400)
        return this.doConnect(spawn)
      }
    }
  }

  private open(): Promise<void> {
    return new Promise((resolve, reject) => {
      const sock = connect(this.pipe)
      let resolveChallenge: (n: string) => void = () => {}
      this.challenge = { promise: new Promise<string>((r) => (resolveChallenge = r)), resolve: (n) => resolveChallenge(n) }
      sock.once('error', reject)
      sock.once('connect', () => {
        sock.off('error', reject)
        sock.on('error', (e) => log('后台', `和后台进程的连接出错：${e.message}`))
        sock.on('data', lineReader((m) => this.onMsg(m as HostMsg)))
        sock.on('close', () => this.onClose(sock))
        this.sock = sock
        resolve()
      })
    })
  }

  private startHost(): void {
    const script = HostClient.script('host')
    if (!existsSync(script)) throw new Error(`未找到会话后台程序：${script}`)
    const logFile = join(app.getPath('logs'), 'client.log')
    const child = spawnProcess(process.execPath, [script, this.pipe, logFile], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', [HOST_KEY_ENV]: this.key.toString('hex') }
    })
    child.unref()
    log('后台', `启动会话后台进程（pid ${child.pid}）`)
  }

  private onClose(sock: Socket): void {
    if (this.sock !== sock) return
    this.sock = null
    for (const w of this.waiting.values()) w.fail(new Error('与会话后台进程的连接已断开'))
    this.waiting.clear()
    if (this.ptys.size) log('后台', `和会话后台进程断开了，${this.ptys.size} 个会话当作已结束`)
    for (const p of [...this.ptys.values()]) p.emitExit(-1)
    this.ptys.clear()
  }

  private onMsg(msg: HostMsg): void {
    switch (msg.t) {
      case 'challenge':
        this.challenge?.resolve(msg.nonce)
        return
      case 'reply': {
        const w = this.waiting.get(msg.n)
        this.waiting.delete(msg.n)
        if (msg.ok) w?.ok(msg.data)
        else w?.fail(new Error(msg.error ?? '后台进程出错'))
        return
      }
      case 'data':
        this.ptys.get(msg.id)?.emitData(msg.data)
        return
      case 'exit': {
        const p = this.ptys.get(msg.id)
        this.ptys.delete(msg.id)
        p?.emitExit(msg.code)
        return
      }
      case 'attach':
        this.emit('attach', msg.id, msg.on)
        return
    }
  }

  send(msg: MainMsg): void {
    if (this.connected) this.sock!.write(frame(msg))
  }

  private request(msg: MainMsg & { n: number }): Promise<unknown> {
    if (!this.connected) return Promise.reject(new Error('未连接到会话后台进程'))
    const n = ++this.n
    return new Promise((ok, fail) => {
      this.waiting.set(n, { ok, fail })
      this.sock!.write(frame({ ...msg, n }))
    })
  }

  async spawn(req: SpawnRequest): Promise<RemotePty> {
    await this.connect(true)
    const { pid } = (await this.request({ t: 'spawn', n: 0, req })) as { pid: number }
    const p = new RemotePty(this, req.id, pid)
    this.ptys.set(req.id, p)
    return p
  }

  async list(): Promise<HostSession[]> {
    if (!this.connected) return []
    return (await this.request({ t: 'list', n: 0 })) as HostSession[]
  }

  adopt(s: HostSession): RemotePty {
    const p = this.ptys.get(s.id) ?? new RemotePty(this, s.id, s.pid)
    this.ptys.set(s.id, p)
    return p
  }

  setMeta(id: string, meta: unknown): void {
    this.send({ t: 'meta', id, meta })
  }

  reclaim(id: string): void {
    this.send({ t: 'reclaim', id })
  }

  async quitHost(): Promise<void> {
    if (!(await this.connect(false))) return
    await this.request({ t: 'quit', n: 0 }).catch(() => undefined)
    this.sock?.destroy()
  }

  disconnect(): Promise<void> {
    const sock = this.sock
    this.sock = null
    this.ptys.clear()
    if (!sock || sock.destroyed) return Promise.resolve()
    return new Promise((done) => {
      const timer = setTimeout(done, 3000)
      sock.once('close', () => (clearTimeout(timer), done()))
      sock.end()
    })
  }
}

let shared: HostClient | null = null
export const hostClient = () => (shared ??= new HostClient())
