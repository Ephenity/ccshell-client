import { testEnv } from '../testhooks'
import { spawn as spawnProcess, spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { closeSync, existsSync, fstatSync, mkdirSync, openSync, readFileSync, readSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { app } from 'electron'
import type { CcShellService } from '../ccshell/service'
import { settings, splitArgs } from '../settings'
import { PERMISSION_MODES, type AppSettings } from '../../shared/settings'
import type { ClaudeState, FavoriteConversation, HistoryItem, Notice, TerminalData, TerminalInfo, TerminalOptions, TerminalSession } from '../../shared/terminal'
import { log } from '../log'
import { anthropicEnv, assertNoAccountLogin, claudeVersion, configDir, findClaude, findSystemClaude, launchEnv, ownInstallDir, prepareConfig } from './claude'
import { anthropicApiKey } from '../anthropic'
import { deleteHistory, historyExists, historyItem, listHistory } from './history'
import { HookServer, type HookEvent } from './hooks'
import { hostClient, HostClient, type RemotePty } from './hostClient'
import type { HostSession } from './hostProtocol'

const SCROLLBACK_CHARS = 1_000_000
const RECENT_MAX = 8
const RECORDS_MAX = 50
const HOOK_GRACE_MS = 30_000
const EXIT_WAIT_MS = 12_000
const READY_PATTERN = /❯|for shortcuts|Try "/
const AUTO_MODE_BLOCKED = /Auto\s*mode\s*can.t\s*check\s*actions/
const ESC = '\x1b'
const CTRL_U = '\x15'

function killPty(proc: RemotePty): void {
  proc.kill()
}

let wtPath: string | null | undefined
function findWt(): string | null {
  if (wtPath !== undefined) return wtPath
  const r = spawnSync('where.exe', ['wt.exe'], { encoding: 'utf8', windowsHide: true })
  wtPath = r.status === 0 ? r.stdout.split(/\r?\n/)[0].trim() || null : null
  return wtPath
}

interface HostMeta {
  title: string
  info: TerminalSession
  options: TerminalOptions
  exe: string | null
  transcript?: string
}

interface Live {
  info: TerminalSession
  options: TerminalOptions
  proc: RemotePty | null
  exe: string | null
  buffer: string
  pending: string
  timer: NodeJS.Timeout | null
  hookTimer: NodeJS.Timeout | null
  gotHook: boolean
  cols: number
  rows: number
  transcript?: string
  transcriptSize?: number
  outputAt: number
  escAt: number
  autoCount: number
  autoGaveUp: boolean
  ending: boolean
  metaJson?: string
  typedAt: number
}

export interface TurnEvent {
  id: string
  kind: 'start' | 'stop' | 'failure' | 'interrupted' | 'session-start' | 'exit'
  error?: string
  detail?: string
  source?: string
}

const STUCK_TICK_MS = Number(testEnv('CCSHELL_STUCK_TICK_MS')) || 5000
const AUTO_CONTINUE_MAX = 3

export function toolSummary(tool: string, input: unknown): string {
  const i = (input ?? {}) as Record<string, unknown>
  const pick = (...keys: string[]) => keys.map((k) => i[k]).find((v) => typeof v === 'string' && v.trim()) as string | undefined
  let detail = pick('command', 'description', 'pattern', 'url', 'query', 'prompt') ?? ''
  const file = pick('file_path', 'notebook_path', 'path')
  if (file) detail = basename(file)
  if (tool === 'AskUserQuestion') {
    const q = (i.questions as { question?: string }[] | undefined)?.[0]?.question
    if (q) return `提问：${q}`.slice(0, 160)
  }
  detail = detail.replace(/\s+/g, ' ').trim()
  return (detail ? `${tool} · ${detail}` : tool).slice(0, 160)
}

export function plainLines(text: string, lines = 3): string {
  return text
    .replace(/```[\s\S]*?```/g, ' [代码] ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, '')
    .replace(/(\*\*|__|\*|_|~~)/g, '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, lines)
    .join('\n')
    .slice(0, 300)
}

export function lastAssistantText(file: string | undefined): string {
  if (!file) return ''
  try {
    const fd = openSync(file, 'r')
    try {
      const size = fstatSync(fd).size
      const len = Math.min(size, 256 * 1024)
      const buf = Buffer.alloc(len)
      readSync(fd, buf, 0, len, size - len)
      const lines = buf.toString('utf8').split('\n').reverse()
      for (const l of lines) {
        if (!l.startsWith('{"parentUuid"')) continue
        let j: { type?: string; isSidechain?: boolean; message?: { content?: unknown } }
        try {
          j = JSON.parse(l)
        } catch {
          continue
        }
        if (j.type !== 'assistant' || j.isSidechain || !Array.isArray(j.message?.content)) continue
        const text = (j.message!.content as { type?: string; text?: string }[]).filter((b) => b.type === 'text').map((b) => b.text).join('\n')
        if (text.trim()) return text
      }
    } finally {
      closeSync(fd)
    }
  } catch {
  }
  return ''
}

const ERROR_KINDS: Record<string, string> = {
  rate_limit: '额度耗尽或请求过于频繁',
  overloaded: '服务器繁忙',
  server_error: '服务器出错',
  invalid_request: '请求出错',
  authentication_failed: '密钥无效',
  billing_error: '余额不足',
  model_not_found: '模型不存在',
  max_output_tokens: '输出超出上限'
}

export function errorText(kind: string, details: string): string {
  const name = ERROR_KINDS[kind] ?? kind
  const d = details.replace(/\s+/g, ' ').trim()
  return name && d ? `${name}：${d}` : name || d
}

function interruptedSince(file: string | undefined, since: number): boolean {
  if (!file) return false
  try {
    const st = statSync(file)
    if (st.mtimeMs < since) return false
    const fd = openSync(file, 'r')
    try {
      const len = Math.min(st.size, 64 * 1024)
      const buf = Buffer.alloc(len)
      readSync(fd, buf, 0, len, st.size - len)
      return buf
        .toString('utf8')
        .split('\n')
        .some((l) => l.includes('[Request interrupted by user') && (Date.parse(/"timestamp":"([^"]+)"/.exec(l)?.[1] ?? '') || 0) >= since - 1000)
    } finally {
      closeSync(fd)
    }
  } catch {
    return false
  }
}

interface Saved {
  recentDirs: string[]
  pinnedDirs: string[]
  favorites: FavoriteConversation[]
  records: Pick<TerminalSession, 'id' | 'title' | 'cwd' | 'model' | 'account' | 'createdAt' | 'conversationId' | 'exitCode' | 'openedBy'>[]
}

const strip = (s: string) => s.replace(/\x1b\[[0-9;?<>=]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(\x07|\x1b\\)|\x1b[()][0-9A-B]|\x1b[=>78]/g, '')
const sameDir = (a: string, b: string) => resolve(a).toLowerCase() === resolve(b).toLowerCase()

function newLive(info: TerminalSession, options: TerminalOptions): Live {
  return {
    info,
    options,
    proc: null,
    exe: null,
    buffer: '',
    pending: '',
    timer: null,
    hookTimer: null,
    gotHook: false,
    cols: 120,
    rows: 30,
    outputAt: 0,
    escAt: 0,
    autoCount: 0,
    autoGaveUp: false,
    ending: false,
    typedAt: 0
  }
}

export class TerminalService extends EventEmitter<{ list: [TerminalSession[]]; data: [TerminalData]; notice: [Notice]; turn: [TurnEvent]; removed: [string] }> {
  holdDone: (id: string) => boolean = () => false
  private readonly sessions = new Map<string, Live>()
  private readonly file = join(app.getPath('userData'), 'terminal.json')
  readonly hooks = new HookServer()
  readonly host: HostClient = hostClient()
  private closing: Promise<void> | null = null
  private readonly ticker: NodeJS.Timeout
  private readonly onSettings = (next: AppSettings): void => {
    const key = JSON.stringify(next.stuck)
    if (key === this.stuckKey) return
    this.stuckKey = key
    this.tick()
  }
  private stuckKey = JSON.stringify(settings.get().stuck)

  constructor(private readonly ccshell: CcShellService) {
    super()
    this.hooks.on('event', (e) => this.onHook(e))
    this.host.on('attach', (id, on) => this.onAttach(id, on))
    for (const r of this.saved().records) {
      this.sessions.set(r.id, newLive({ ...r, status: 'exited', state: 'exited', stateAt: r.createdAt, restored: true }, { cwd: r.cwd, model: r.model, account: r.account, allModels: settings.get().claudeCode.allModels }))
    }
    this.ticker = setInterval(() => this.tick(), STUCK_TICK_MS)
    settings.on('changed', this.onSettings)
  }

  private notice(live: Live, kind: Notice['kind'], title: string, body: string): void {
    this.emit('notice', { id: randomUUID(), kind, sessionId: live.info.id, title, body, at: Date.now() })
  }

  private saved(): Saved {
    try {
      const s = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<Saved>
      return { recentDirs: s.recentDirs ?? [], pinnedDirs: s.pinnedDirs ?? [], favorites: s.favorites ?? [], records: s.records ?? [] }
    } catch {
      return { recentDirs: [], pinnedDirs: [], favorites: [], records: [] }
    }
  }

  private save(patch: Partial<Saved>): void {
    const s = { ...this.saved(), ...patch }
    writeFileSync(this.file + '.tmp', JSON.stringify(s, null, 2))
    renameSync(this.file + '.tmp', this.file)
  }

  private saveRecords(): void {
    const records = [...this.sessions.values()]
      .map(({ info: { id, title, cwd, model, account, createdAt, conversationId, exitCode, openedBy } }) => ({ id, title, cwd, model, account, createdAt, conversationId, exitCode, openedBy }))
      .slice(-RECORDS_MAX)
    this.save({ records })
  }

  private remember(o: TerminalOptions): void {
    const s = this.saved()
    this.save({ recentDirs: [o.cwd, ...s.recentDirs.filter((d) => !sameDir(d, o.cwd))].slice(0, RECENT_MAX) })
    if (o.account === 'anthropic') settings.update({ claudeCode: { account: 'anthropic', anthropic: { model: o.model } } })
    else settings.update({ claudeCode: { account: 'ccshell', model: o.model, allModels: o.allModels } })
  }

  async info(): Promise<TerminalInfo> {
    const found = findClaude()
    const s = this.saved()
    const uniq = (dirs: string[]) => [...new Map(dirs.filter((d) => existsSync(d)).map((d) => [resolve(d).toLowerCase(), resolve(d)])).values()]
    const pinned = uniq(s.pinnedDirs)
    const cc = settings.get().claudeCode
    return {
      claudePath: found.path,
      claudeSource: found.source,
      version: found.path ? await claudeVersion(found.path) : null,
      systemClaude: findSystemClaude(),
      configDir: configDir(),
      pinnedDirs: pinned,
      recentDirs: uniq(s.recentDirs).filter((d) => !pinned.some((p) => sameDir(p, d))),
      favorites: s.favorites,
      lastOptions: { model: cc.model, allModels: cc.allModels, account: cc.account }
    }
  }

  pinDir(dir: string, pinned: boolean): void {
    const s = this.saved()
    if (pinned && s.pinnedDirs.some((d) => sameDir(d, dir))) return
    const rest = s.pinnedDirs.filter((d) => !sameDir(d, dir))
    this.save({ pinnedDirs: pinned ? [...rest, resolve(dir)] : rest })
  }

  forgetDir(dir: string): void {
    const s = this.saved()
    this.save({ recentDirs: s.recentDirs.filter((d) => !sameDir(d, dir)), pinnedDirs: s.pinnedDirs.filter((d) => !sameDir(d, dir)) })
  }

  setFavorite(target: { sessionId?: string; conversationId?: string }, on: boolean): FavoriteConversation[] {
    let conv = target.conversationId
    let cwd = ''
    let title = ''
    if (target.sessionId) {
      const live = this.get(target.sessionId)
      conv = live.info.conversationId
      cwd = live.info.cwd
      title = live.info.title
      if (!conv) throw new Error('该会话尚无对话记录（获取对话 ID 后方可加入）')
    }
    if (!conv) throw new Error('缺少对话 ID')
    const s = this.saved()
    const rest = s.favorites.filter((f) => f.conversationId !== conv)
    if (on) {
      const h = historyItem(conv)
      cwd ||= h?.cwd ?? ''
      title = target.sessionId && title ? title : (h?.title ?? title)
      if (!cwd) throw new Error('未找到该对话的目录')
      rest.push({ conversationId: conv, cwd, title: title || basename(cwd), addedAt: Date.now() })
    }
    this.save({ favorites: rest })
    this.emitList()
    return rest
  }

  list(): TerminalSession[] {
    return [...this.sessions.values()].map((s) => s.info)
  }

  buffer(id: string): string {
    const live = this.get(id)
    this.flush(live)
    return live.buffer
  }

  private openWith(conversationId: string): Live | undefined {
    return [...this.sessions.values()].find((l) => l.proc && l.info.conversationId === conversationId)
  }

  async create(options: TerminalOptions): Promise<TerminalSession> {
    if (options.resumeId) {
      const open = this.openWith(options.resumeId)
      if (open) return open.info
    }
    const raw = options.cwd.trim()
    const cwd = raw ? resolve(raw) : ''
    if (!cwd || !existsSync(cwd) || !statSync(cwd).isDirectory()) throw new Error(`工作目录不存在：${cwd || '（空）'}`)
    if (/^[a-z]:\\?$/i.test(cwd)) throw new Error('不能使用盘符根目录作为工作目录，请选择项目文件夹')
    const acct = options.resumeId ? (historyItem(options.resumeId)?.account ?? 'ccshell') : (options.account ?? 'ccshell')
    const live = newLive(
      {
        id: randomUUID(),
        title: options.title?.trim() || basename(cwd) || cwd,
        cwd,
        model: acct === 'anthropic' && options.account !== 'anthropic' ? settings.get().claudeCode.anthropic.model : options.model,
        account: acct === 'anthropic' ? 'anthropic' : undefined,
        createdAt: Date.now(),
        status: 'exited',
        state: 'starting',
        stateAt: Date.now(),
        conversationId: options.resumeId,
        openedBy: options.openedBy
      },
      { ...options, cwd, account: acct, model: acct === 'anthropic' && options.account !== 'anthropic' ? settings.get().claudeCode.anthropic.model : options.model }
    )
    await this.spawn(live, options.resumeId ? { resume: options.resumeId } : options.continueLast ? { continue: true } : {})
    this.sessions.set(live.info.id, live)
    this.remember(live.options)
    this.saveRecords()
    this.emitList()
    return live.info
  }

  async restart(id: string): Promise<TerminalSession> {
    const live = this.get(id)
    if (live.proc) return live.info
    const conv = live.info.conversationId
    if (conv) {
      const open = this.openWith(conv)
      if (open) return open.info
    }
    const resume = conv && historyExists(conv) ? conv : undefined
    const cc = settings.get().claudeCode
    const model = live.info.account === 'anthropic' ? cc.anthropic.model : cc.model
    live.options = { ...live.options, model, allModels: cc.allModels }
    live.info = { ...live.info, model, restored: false }
    this.push(live, `\r\n\x1b[2m—— 重新启动，${resume ? '继续此对话' : '继续此目录最近的对话'} ——\x1b[0m\r\n`)
    await this.spawn(live, resume ? { resume } : { continue: true })
    this.saveRecords()
    this.emitList()
    return live.info
  }

  private async spawn(live: Live, mode: { resume?: string; continue?: boolean }): Promise<void> {
    const cc = settings.get().claudeCode
    const hook = { session: live.info.id }
    const { path } = findClaude()
    let env: Record<string, string>
    if (live.info.account === 'anthropic') {
      const method = cc.anthropic.method
      const key = method === 'apikey' ? anthropicApiKey() : null
      if (method === 'apikey' && !key) throw new Error('尚未设置 Anthropic API 密钥，请在 设置 › Anthropic 账户 中填写')
      if (!path) throw new Error('未找到 Claude Code（claude.exe），可在设置中安装')
      prepareConfig(live.options.cwd, await claudeVersion(path), 'anthropic', key ?? undefined)
      env = anthropicEnv({ method, apiKey: key ?? undefined, model: live.options.model, hook })
    } else {
      const apiKey = this.ccshell.getApiKey()
      if (!apiKey) throw new Error('尚无 CC Shell 密钥，请先登录账户')
      if (!path) throw new Error('未找到 Claude Code（claude.exe），可在设置中安装')
      assertNoAccountLogin()
      prepareConfig(live.options.cwd, await claudeVersion(path))
      env = launchEnv({
        baseUrl: this.ccshell.getBaseUrl(),
        apiKey,
        model: live.options.model,
        allModels: live.options.allModels,
        modelMap: cc.modelMap,
        hook
      })
    }
    const args = ['--settings', await this.hooks.settingsFile(live.info.id), '--mcp-config', await this.hooks.mcpConfigFile(live.info.id)]
    if (mode.resume) args.push('--resume', mode.resume)
    else if (mode.continue) args.push('--continue')
    const extra = splitArgs(cc.extraArgs)
    if (!extra.includes('--permission-mode')) args.push('--permission-mode', PERMISSION_MODES.some((m) => m[0] === cc.permissionMode) ? cc.permissionMode : 'manual')
    args.push(...extra)
    const proc = await this.host.spawn({ id: live.info.id, file: path, args, cwd: live.options.cwd, env, cols: live.cols, rows: live.rows, meta: null })
    live.proc = proc
    live.exe = path
    live.gotHook = false
    live.ending = false
    live.outputAt = Date.now()
    live.info = { ...live.info, status: 'running', exitCode: undefined, stuck: false, continuing: false, activity: undefined, busySince: undefined }
    this.setState(live, 'starting')
    log('会话', `开始 ${live.info.title}（${live.options.cwd}）${live.info.account === 'anthropic' ? `Anthropic 账户（${cc.anthropic.method === 'apikey' ? 'API 密钥' : '订阅'}）` : 'CC Shell 账户'} 模型 ${live.options.model || '默认'}，${mode.resume ? `--resume ${mode.resume}` : mode.continue ? '--continue' : '新对话'}；${path}`)
    if (live.hookTimer) clearTimeout(live.hookTimer)
    live.hookTimer = setTimeout(() => {
      if (live.proc === proc && !live.gotHook && live.info.state === 'starting') {
        this.setState(live, 'running', '未收到 Claude Code 的状态回报')
        log('hook', `${live.info.title}：启动 ${HOOK_GRACE_MS / 1000} 秒还没收到 hook，状态显示为“运行中”`)
      }
    }, HOOK_GRACE_MS)
    this.wire(live, proc)
  }

  private wire(live: Live, proc: RemotePty): void {
    let startTail = ''
    let busyTail = ''
    let readyTimer: NodeJS.Timeout | null = null
    proc.onData((d) => {
      live.outputAt = Date.now()
      this.push(live, d)
      if (live.info.state === 'starting') {
        startTail = (startTail + strip(d)).slice(-4000)
        if (READY_PATTERN.test(startTail)) {
          if (readyTimer) clearTimeout(readyTimer)
          readyTimer = setTimeout(() => {
            if (live.proc === proc && live.info.state === 'starting' && Date.now() - live.outputAt >= 1400) this.setState(live, 'idle')
            else if (live.proc === proc && live.info.state === 'starting') readyTimer = setTimeout(() => live.proc === proc && live.info.state === 'starting' && this.setState(live, 'idle'), 1500)
          }, 1500)
        }
      }
      if (live.info.state === 'busy' || live.info.state === 'running') {
        busyTail = (busyTail + strip(d)).slice(-2000)
        if (AUTO_MODE_BLOCKED.test(busyTail)) {
          busyTail = ''
          this.setState(live, 'waiting', 'auto mode 安全检查不可用，等待选择')
          this.notice(live, 'attention', `${live.info.title}：需要处理`, 'auto mode 安全检查经网关不可用。可在终端中按 Enter 保留 auto mode 并手动确认此操作，或按 Shift+Tab 切换为 accept edits 模式')
          log('会话', `${live.info.title}：auto mode 的安全检查连不上，Claude Code 在等用户选择`)
        }
      } else busyTail = ''
      if (live.info.state === 'busy' && Date.now() - live.escAt < 30_000 && /Interrupted/.test(strip(d))) {
        live.escAt = 0
        this.setState(live, 'idle', '已中断')
        if (!live.info.continuing) this.turn(live, 'interrupted')
      }
    })
    proc.onExit(({ exitCode }) => {
      if (live.proc !== proc) return
      live.proc = null
      if (live.hookTimer) clearTimeout(live.hookTimer)
      this.flush(live)
      this.push(live, `\r\n\x1b[2m—— Claude Code 已退出（代码 ${exitCode}）——\x1b[0m\r\n`)
      if (live.info.detached) live.ending = true
      live.info = { ...live.info, status: 'exited', exitCode, stuck: false, continuing: false, busySince: undefined, detached: false }
      this.setState(live, 'exited')
      this.saveRecords()
      log('会话', `结束 ${live.info.title}，退出码 ${exitCode}${live.ending ? '（客户端结束）' : ''}`)
      if (exitCode !== 0 && !live.ending) this.notice(live, 'problem', `${live.info.title}：会话异常退出`, `Claude Code 已退出（代码 ${exitCode}），可重新启动以继续此对话。`)
      this.turn(live, 'exit')
    })
  }

  private setState(live: Live, state: ClaudeState, detail?: string, keepTime = false): void {
    if (live.info.state === state && live.info.stateDetail === detail) return
    const changed = live.info.state !== state
    live.info = { ...live.info, state, stateDetail: detail, stateAt: changed && !keepTime ? Date.now() : live.info.stateAt }
    if (changed && state !== 'busy') live.info = { ...live.info, stuck: false }
    this.emitList()
  }

  private onHook({ session, event, input }: HookEvent): void {
    const live = this.sessions.get(session)
    if (!live?.proc) return
    live.gotHook = true
    const sid = typeof input.session_id === 'string' ? input.session_id : undefined
    if (sid && sid !== live.info.conversationId) {
      live.info = { ...live.info, conversationId: sid }
      this.saveRecords()
    }
    if (typeof input.transcript_path === 'string' && input.transcript_path) live.transcript = input.transcript_path
    const tool = typeof input.tool_name === 'string' ? input.tool_name : ''
    const now = Date.now()
    const title = live.info.title
    if (!(event === 'Notification' && input.notification_type === 'idle_prompt')) this.progress(live, now)
    switch (event) {
      case 'SessionStart':
        this.setState(live, 'idle')
        this.turn(live, 'session-start', { source: String(input.source ?? '') })
        break
      case 'UserPromptSubmit': {
        const prompt = typeof input.prompt === 'string' ? input.prompt.replace(/\s+/g, ' ').trim() : ''
        live.escAt = 0
        live.info = { ...live.info, busySince: now, activity: prompt ? `处理：${prompt.slice(0, 80)}` : '处理中' }
        this.setState(live, 'busy')
        this.turn(live, 'start')
        break
      }
      case 'PostToolUse':
        live.info = { ...live.info, busySince: live.info.busySince ?? now }
        this.setState(live, 'busy')
        break
      case 'PreToolUse': {
        live.info = { ...live.info, activity: toolSummary(tool, input.tool_input), busySince: live.info.busySince ?? now }
        if (tool === 'AskUserQuestion') {
          this.setState(live, 'waiting', 'Claude 提出了问题')
          this.notice(live, 'attention', `${title}：Claude 提出了问题`, live.info.activity!)
        } else this.setState(live, 'busy')
        break
      }
      case 'PermissionRequest': {
        if (tool === 'AskUserQuestion') {
          this.setState(live, 'waiting', 'Claude 提出了问题')
          break
        }
        const what = toolSummary(tool, input.tool_input)
        live.info = { ...live.info, activity: `请求使用：${what}` }
        this.setState(live, 'waiting', tool ? `等待确认：${tool}` : '等待确认')
        this.notice(live, 'attention', `${title}：需要确认`, `请求使用：${what}`)
        break
      }
      case 'Notification': {
        const nt = String(input.notification_type ?? '')
        if (nt === 'permission_prompt' || nt === 'elicitation_dialog') {
          const already = live.info.state === 'waiting'
          if (!already) {
            this.setState(live, 'waiting', String(input.message ?? '等待确认'))
            this.notice(live, 'attention', `${title}：需要处理`, String(input.message ?? '等待确认'))
          }
        } else if (nt === 'idle_prompt' && live.info.state !== 'busy') this.setState(live, 'idle')
        break
      }
      case 'Stop': {
        const text = (typeof input.last_assistant_message === 'string' && input.last_assistant_message) || lastAssistantText(live.transcript)
        const apiErr = /^\s*API Error:?\s*(\d{3})?/.exec(text)
        if (apiErr) {
          if (live.info.state === 'error' && now - live.info.stateAt < 5000) break
          const code = Number(apiErr[1] ?? 0)
          const kind = code === 429 ? 'rate_limit' : code === 529 ? 'overloaded' : code >= 500 ? 'server_error' : code === 401 ? 'authentication_failed' : 'invalid_request'
          const detail = text.replace(/^\s*API Error:?\s*/, '').slice(0, 500)
          const err = errorText(kind, detail).slice(0, 300)
          live.info = { ...live.info, busySince: undefined }
          this.setState(live, 'error', err)
          this.notice(live, 'problem', `${title}：本轮出错`, err)
          log('会话', `${title} 这一轮出错（回答里的 API Error）：${detail.slice(0, 300)}`)
          this.turn(live, 'failure', { error: kind, detail })
          break
        }
        const lines = plainLines(text)
        const took = live.info.busySince ? Math.round((now - live.info.busySince) / 1000) : 0
        if (!live.info.continuing) {
          live.autoCount = 0
          live.autoGaveUp = false
        }
        live.info = { ...live.info, activity: lines.split('\n')[0] || undefined, busySince: undefined }
        this.setState(live, 'idle')
        if (!this.holdDone(live.info.id)) this.notice(live, 'done', `${title}：回答完成${took >= 60 ? `（${Math.floor(took / 60)} 分 ${took % 60} 秒）` : ''}`, lines || '本轮处理已完成。')
        this.turn(live, 'stop')
        break
      }
      case 'StopFailure': {
        const kind = String(input.error ?? input.error_type ?? '')
        const details = typeof input.error_details === 'string' ? input.error_details : ''
        const err = (errorText(kind, details) || String(input.reason ?? '本轮出错')).slice(0, 300)
        live.info = { ...live.info, busySince: undefined }
        this.setState(live, 'error', err)
        this.notice(live, 'problem', `${title}：本轮出错`, err)
        log('会话', `${title} 这一轮出错：${kind} ${details.slice(0, 300)}`)
        this.turn(live, 'failure', { error: kind, detail: details })
        break
      }
    }
  }

  private progress(live: Live, at: number): void {
    live.info = { ...live.info, progressAt: at }
    if (live.info.stuck) {
      live.info = { ...live.info, stuck: false }
      if (live.info.state === 'busy') this.setState(live, 'busy', undefined, true)
      log('卡住', `${live.info.title} 又有进展了`)
    }
  }

  tick(): void {
    const cfg = settings.get().stuck
    const now = Date.now()
    for (const live of this.sessions.values()) {
      if (!live.proc || live.info.state !== 'busy' || live.info.continuing) continue
      if (live.transcript) {
        try {
          const size = statSync(live.transcript).size
          if (live.transcriptSize !== undefined && size !== live.transcriptSize) this.progress(live, now)
          live.transcriptSize = size
        } catch {
        }
      }
      const since = Math.max(live.info.progressAt ?? 0, live.info.busySince ?? 0, live.info.stateAt)
      const silentMin = (now - since) / 60_000
      const minutes = Math.max(1, Math.floor(silentMin))
      const overRemind = cfg.remindMinutes > 0 && silentMin >= cfg.remindMinutes
      if (!overRemind && live.info.stuck) {
        live.info = { ...live.info, stuck: false }
        this.setState(live, 'busy', undefined, true)
        log('卡住', `${live.info.title} 停滞判断改为 ${cfg.remindMinutes || '不提醒'}${cfg.remindMinutes ? ' 分钟' : ''}，撤掉疑似停滞`)
      }
      if (overRemind) {
        const detail = `疑似停滞 · ${minutes} 分钟无新输出${cfg.autoContinue && !live.autoGaveUp ? `（${cfg.autoMinutes} 分钟时自动中断并继续）` : ''}`
        if (!live.info.stuck) {
          live.info = { ...live.info, stuck: true }
          log('卡住', `${live.info.title} ${minutes} 分钟没有新内容（${live.info.activity ?? ''}）`)
          if (live.autoCount === 0) this.notice(live, 'attention', `${live.info.title}：疑似停滞`, `${minutes} 分钟无新输出。最近活动：${live.info.activity ?? '（未知）'}`)
        }
        if (live.info.stateDetail !== detail) this.setState(live, 'busy', detail, true)
      }
      if (cfg.autoContinue && silentMin >= cfg.autoMinutes) {
        if (live.autoCount < AUTO_CONTINUE_MAX) {
          live.autoCount++
          void this.continueTurn(live, true)
        } else if (!live.autoGaveUp) {
          live.autoGaveUp = true
          log('卡住', `${live.info.title} 已经连续自动继续 ${AUTO_CONTINUE_MAX} 次，不再自动处理`)
          this.notice(live, 'problem', `${live.info.title}：自动继续未生效`, `已连续自动继续 ${AUTO_CONTINUE_MAX} 次，仍未正常结束本轮，请检查终端。`)
          this.setState(live, 'busy', `疑似停滞 · 已自动继续 ${AUTO_CONTINUE_MAX} 次仍未结束，请检查终端`, true)
        }
      }
    }
  }

  async continueNow(id: string): Promise<string> {
    const live = this.get(id)
    if (!live.proc) throw new Error('会话已经结束')
    if (live.info.continuing) throw new Error('正在续跑')
    if (live.info.state !== 'busy') throw new Error('Claude 当前未在处理，无需续跑')
    return this.continueTurn(live, false)
  }

  private async continueTurn(live: Live, auto: boolean): Promise<string> {
    const proc = live.proc
    if (!proc) return '会话已经结束'
    const title = live.info.title
    const tag = auto ? `自动继续（第 ${live.autoCount} 次）` : '续跑'
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
    const alive = () => live.proc === proc
    live.info = { ...live.info, continuing: true }
    this.setState(live, 'busy', `${tag}：正在中断本轮…`, true)
    log('卡住', `${title} ${tag}：按 Esc 停止这一轮`)
    const t0 = Date.now()
    const finish = (result: string, ok: boolean) => {
      live.info = { ...live.info, continuing: false }
      log('卡住', `${title} ${tag}：${result}（${Math.round((Date.now() - t0) / 100) / 10} 秒）`)
      if (!ok) this.notice(live, 'problem', `${title}：${tag}未完成`, result)
      this.emitList()
      return result
    }
    try {
      let escAt = Date.now()
      live.escAt = Date.now()
      proc.write('\x1b')
      let stopped = false
      let lastEsc = escAt
      while (alive() && Date.now() - t0 < 75_000) {
        await sleep(250)
        if (live.info.state === 'idle' && live.info.stateDetail !== '已中断') return finish('本轮已自行结束，未发送继续指令', true)
        if (live.info.state === 'idle' || interruptedSince(live.transcript, escAt)) {
          stopped = true
          break
        }
        if (Date.now() - lastEsc > 15_000) {
          lastEsc = escAt = Date.now()
          live.escAt = Date.now()
          proc.write('\x1b')
        }
      }
      if (!alive()) return finish('会话结束了', false)
      if (!stopped) return finish('已发送 Esc，但 75 秒内未停止，未发送继续指令。请检查终端', false)
      const q0 = Date.now()
      while (alive() && Date.now() - live.outputAt < 2000 && Date.now() - q0 < 30_000) await sleep(200)
      if (!alive()) return finish('会话结束了', false)
      const text = settings.get().stuck.continueText.replace(/\s*\n\s*/g, ' ').trim()
      const before = live.info.busySince
      proc.write('\x15')
      await sleep(200)
      proc.write(text)
      await sleep(400)
      proc.write('\r')
      const s0 = Date.now()
      while (alive() && Date.now() - s0 < 30_000) {
        await sleep(250)
        if (live.info.state === 'busy' && live.info.busySince && live.info.busySince !== before) return finish('已发送继续指令，Claude 已开始处理', true)
      }
      return finish('已发送继续指令，但 30 秒内未开始处理。请检查终端', false)
    } catch (e) {
      return finish(`出错：${(e as Error).message}`, false)
    }
  }

  write(id: string, data: string): void {
    const live = this.get(id)
    if (live.info.detached) return
    live.typedAt = Date.now()
    if (data.includes(String.fromCharCode(27)) && !data.includes(String.fromCharCode(27) + '[')) live.escAt = Date.now()
    live.proc?.write(data)
  }

  resize(id: string, cols: number, rows: number): void {
    const live = this.get(id)
    if (cols < 2 || rows < 2 || (cols === live.cols && rows === live.rows)) return
    live.cols = cols
    live.rows = rows
    try {
      live.proc?.resize(cols, rows)
    } catch {
    }
  }

  rename(id: string, title: string): void {
    const live = this.get(id)
    live.info = { ...live.info, title: title.trim() || live.info.title }
    this.saveRecords()
    this.emitList()
  }

  end(id: string): Promise<void> {
    const live = this.get(id)
    const proc = live.proc
    if (!proc) return Promise.resolve()
    live.ending = true
    return new Promise((done) => {
      const timer = setTimeout(() => {
        if (live.proc === proc) killPty(proc)
        done()
      }, EXIT_WAIT_MS)
      proc.onExit(() => {
        clearTimeout(timer)
        done()
      })
      const step = (data: string, ms: number) => new Promise((r) => setTimeout(() => (live.proc === proc && proc.write(data), r(null)), ms))
      void (async () => {
        if (live.info.state === 'busy' || live.info.state === 'waiting') await step('\x1b', 0)
        await step('\x15', 300)
        await step('/exit', 200)
        await step('\r', 300)
      })()
    })
  }

  remove(id: string): void {
    const live = this.sessions.get(id)
    if (!live) return
    this.sessions.delete(id)
    live.ending = true
    if (live.timer) clearTimeout(live.timer)
    if (live.hookTimer) clearTimeout(live.hookTimer)
    const proc = live.proc
    live.proc = null
    if (proc) killPty(proc)
    if (proc) log('会话', `从列表删除并结束 ${live.info.title}`)
    this.saveRecords()
    this.emitList()
    this.hooks.removeMcpConfig(id)
    this.emit('removed', id)
  }

  clearExited(): void {
    for (const [id, l] of this.sessions)
      if (!l.proc) {
        this.sessions.delete(id)
        this.hooks.removeMcpConfig(id)
        this.emit('removed', id)
      }
    this.saveRecords()
    this.emitList()
  }

  shutdown(mode: 'end' | 'detach' = 'end'): void {
    clearInterval(this.ticker)
    settings.off('changed', this.onSettings)
    if (mode === 'detach') {
      let n = 0
      for (const live of this.sessions.values()) {
        if (live.timer) clearTimeout(live.timer)
        if (live.hookTimer) clearTimeout(live.hookTimer)
        if (!live.proc) continue
        this.syncMeta(live)
        if (!live.info.detached) {
          try {
            this.openTerminalWindow(live)
          } catch (e) {
            log('会话', `退出：${live.info.title} 没能分离到终端窗口：${(e as Error).message}`)
          }
        }
        live.proc = null
        n++
      }
      log('会话', `退出：${n} 个会话分离到终端窗口，接着运行`)
      this.saveRecords()
      this.closing = this.host.disconnect()
      this.hooks.close()
      return
    }
    const t0 = Date.now()
    let n = 0
    for (const live of this.sessions.values()) {
      if (live.timer) clearTimeout(live.timer)
      if (live.hookTimer) clearTimeout(live.hookTimer)
      const proc = live.proc
      live.proc = null
      if (!proc) continue
      const t1 = Date.now()
      killPty(proc)
      n++
      log('会话', `退出：结束 ${live.info.title}（${live.info.state}）用了 ${Date.now() - t1} ms`)
    }
    if (n) log('会话', `退出：结束 ${n} 个进程共 ${Date.now() - t0} ms`)
    this.saveRecords()
    this.hooks.close()
  }

  async shutdownAndWait(mode: 'end' | 'detach'): Promise<void> {
    const had = this.host.connected
    this.shutdown(mode)
    if (mode === 'detach') await this.closing
    else if (had) await Promise.race([this.host.list().catch(() => undefined), new Promise((r) => setTimeout(r, 8000))])
  }

  usingOwnInstall(): number {
    const own = ownInstallDir().toLowerCase()
    return [...this.sessions.values()].filter((l) => l.proc && l.exe?.toLowerCase().startsWith(own)).length
  }

  history(): HistoryItem[] {
    const open = new Map([...this.sessions.values()].filter((l) => l.proc && l.info.conversationId).map((l) => [l.info.conversationId!, l.info.id]))
    return listHistory().map((h) => ({ ...h, openIn: open.get(h.id) }))
  }

  deleteHistory(id: string): void {
    if (this.openWith(id)) throw new Error('该对话已在会话中打开，请先结束该会话')
    deleteHistory(id)
    const s = this.saved()
    if (s.favorites.some((f) => f.conversationId === id)) this.save({ favorites: s.favorites.filter((f) => f.conversationId !== id) })
    this.emitList()
  }

  private turn(live: Live, kind: TurnEvent['kind'], extra: Omit<TurnEvent, 'id' | 'kind'> = {}): void {
    this.emit('turn', { id: live.info.id, kind, ...extra })
  }

  peek(id: string): { info: TerminalSession; running: boolean; typedAt: number; outputAt: number } | null {
    const live = this.sessions.get(id)
    return live ? { info: live.info, running: !!live.proc, typedAt: live.typedAt, outputAt: live.outputAt } : null
  }

  async typeText(id: string, text: string, opts: { clear?: boolean; submit?: boolean } = {}): Promise<void> {
    const live = this.get(id)
    const proc = live.proc
    if (!proc) throw new Error('会话已经结束')
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
    if (opts.clear) {
      proc.write(CTRL_U)
      await sleep(150)
    }
    if (live.proc !== proc) return
    proc.write(text.replace(/\r\n?/g, '\n'))
    if (!opts.submit) return
    await sleep(400 + Math.min(1200, text.length / 4))
    if (live.proc === proc) proc.write('\r')
  }

  key(id: string, key: 'enter' | 'esc'): void {
    const live = this.get(id)
    if (key === 'esc') live.escAt = Date.now()
    live.proc?.write(key === 'enter' ? '\r' : ESC)
  }

  private get(id: string): Live {
    const live = this.sessions.get(id)
    if (!live) throw new Error('终端会话不存在')
    return live
  }

  private push(live: Live, data: string): void {
    live.buffer += data
    if (live.buffer.length > SCROLLBACK_CHARS * 1.2) live.buffer = live.buffer.slice(-SCROLLBACK_CHARS)
    live.pending += data
    live.timer ??= setTimeout(() => this.flush(live), 16)
  }

  private flush(live: Live): void {
    if (live.timer) clearTimeout(live.timer)
    live.timer = null
    if (!live.pending) return
    const data = live.pending
    live.pending = ''
    this.emit('data', { id: live.info.id, data })
  }

  private emitList(): void {
    for (const live of this.sessions.values()) this.syncMeta(live)
    this.emit('list', this.list())
  }

  private syncMeta(live: Live): void {
    if (!live.proc) return
    const meta: HostMeta = { title: live.info.title, info: live.info, options: live.options, exe: live.exe, transcript: live.transcript }
    const json = JSON.stringify(meta)
    if (json === live.metaJson) return
    live.metaJson = json
    this.host.setMeta(live.info.id, meta)
  }

  async connectHost(): Promise<number> {
    let list: HostSession[]
    try {
      if (!(await this.host.connect(false))) return 0
      list = await this.host.list()
    } catch (e) {
      log('后台', `连不上会话后台进程：${(e as Error).message}`)
      return 0
    }
    let n = 0
    for (const h of list) {
      const meta = h.meta as HostMeta | null
      if (!meta?.info || this.sessions.get(h.id)?.proc) continue
      const old = this.sessions.get(h.id)
      const live = newLive(
        {
          ...meta.info,
          title: old?.info.title ?? meta.info.title,
          status: 'running',
          state: 'running',
          stateDetail: '客户端已重新打开，正在获取 Claude Code 状态',
          stateAt: Date.now(),
          restored: false,
          detached: h.attached,
          stuck: false,
          continuing: false
        },
        meta.options
      )
      live.exe = meta.exe
      live.transcript = meta.transcript
      live.cols = h.cols
      live.rows = h.rows
      live.buffer = h.buffer
      live.gotHook = true
      live.outputAt = Date.now()
      const proc = this.host.adopt(h)
      live.proc = proc
      this.sessions.set(h.id, live)
      this.wire(live, proc)
      this.guessState(live)
      log('会话', `接回还在运行的会话 ${live.info.title}（${h.attached ? '在终端窗口里' : '在后台'}）`)
      n++
    }
    if (n) {
      this.saveRecords()
      this.emitList()
    }
    return n
  }

  private guessState(live: Live): void {
    const proc = live.proc
    if (!proc) return
    let seen = ''
    proc.onData((d) => {
      if (live.proc === proc && seen.length < 200_000) seen += strip(d)
    })
    this.jiggle(live)
    setTimeout(() => {
      if (live.proc !== proc || live.info.state !== 'running') return
      const tail = seen.slice(-6000)
      if (/esc to interrupt/i.test(tail)) {
        live.info = { ...live.info, busySince: Date.now() }
        this.setState(live, 'busy')
      } else if (/Do you want to|Yes, and don.t ask/i.test(tail)) this.setState(live, 'waiting', '等待确认（客户端重新打开时检测）')
      else if (READY_PATTERN.test(tail)) this.setState(live, 'idle')
      else this.setState(live, 'running', '状态未识别，等待 Claude Code 回报')
    }, 2500)
  }

  private jiggle(live: Live): void {
    const proc = live.proc
    if (!proc || live.info.detached) return
    proc.resize(Math.max(2, live.cols - 1), live.rows)
    setTimeout(() => live.proc === proc && proc.resize(live.cols, live.rows), 120)
  }

  private onAttach(id: string, on: boolean): void {
    const live = this.sessions.get(id)
    if (!live?.proc || !!live.info.detached === on) return
    live.info = { ...live.info, detached: on }
    log('会话', on ? `${live.info.title} 分离到终端窗口` : `${live.info.title} 回到客户端`)
    if (!on) this.jiggle(live)
    this.emitList()
  }

  detach(id: string): void {
    const live = this.get(id)
    if (!live.proc) throw new Error('会话已经结束')
    if (live.info.detached) throw new Error('该会话已在终端窗口中')
    this.syncMeta(live)
    this.openTerminalWindow(live)
  }

  setPopout(id: string, on: boolean): void {
    const live = this.sessions.get(id)
    if (!live || !!live.info.popout === on) return
    live.info = { ...live.info, popout: on }
    this.emitList()
  }

  reclaim(id: string): void {
    const live = this.get(id)
    if (live.proc && live.info.detached) this.host.reclaim(id)
  }

  private openTerminalWindow(live: Live): void {
    if (testEnv('CCSHELL_DETACH_NOWINDOW')) return log('会话', `${live.info.title}：开终端窗口（自测，不开）`)
    const dir = join(app.getPath('userData'), 'claude-hooks')
    mkdirSync(dir, { recursive: true })
    const cmd = join(dir, 'attach.cmd')
    const body = `@echo off\r\nchcp 65001 >nul\r\nset ELECTRON_RUN_AS_NODE=1\r\n"${process.execPath}" "${HostClient.script('attach')}" %*\r\n`
    if (!existsSync(cmd) || readFileSync(cmd, 'utf8') !== body) writeFileSync(cmd, body)
    const title = `${live.info.title}（已从 CC Shell 分离）`
    const wt = testEnv('CCSHELL_NO_WT') ? null : findWt()
    const child = wt
      ? spawnProcess(wt, ['-w', 'new', '--title', title, '--suppressApplicationTitle', '-d', live.options.cwd, 'cmd.exe', '/c', cmd, this.host.pipe, live.info.id, this.host.ticket(live.info.id)], { detached: true, stdio: 'ignore' })
      : spawnProcess('cmd.exe', ['/c', cmd, this.host.pipe, live.info.id, this.host.ticket(live.info.id)], { detached: true, stdio: 'ignore', windowsHide: false, cwd: live.options.cwd })
    child.on('error', (e) => log('会话', `开终端窗口失败：${e.message}`))
    child.unref()
    log('会话', `${live.info.title}：开终端窗口（${wt ? 'Windows Terminal' : '控制台窗口'}）`)
  }
}
