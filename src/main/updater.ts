import { testEnv } from './testhooks'
import { EventEmitter } from 'node:events'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { app, BrowserWindow, ipcMain } from 'electron'
import { NsisUpdater, type ProgressInfo, type UpdateInfo } from 'electron-updater'
import type { AppAdapter } from 'electron-updater/out/AppAdapter'
import type { Result } from '../shared/ccshell'
import { UPDATE_REPO, type UpdateBusy, type UpdateState } from '../shared/update'
import { log } from './log'
import { cacheDir } from './paths'
import { settings } from './settings'

const FIRST_CHECK_MS = 20_000
const CHECK_EVERY_MS = 4 * 60 * 60_000

interface Feed {
  owner: string
  repo: string
  host?: string
  protocol?: 'http' | 'https'
}

function feed(): Feed | null {
  const test = testEnv('CCSHELL_UPDATE_FEED')
  if (test) {
    const u = new URL(test)
    return { owner: 'test', repo: 'client', host: u.host, protocol: u.protocol === 'http:' ? 'http' : 'https' }
  }
  return UPDATE_REPO.owner && UPDATE_REPO.repo ? { owner: UPDATE_REPO.owner, repo: UPDATE_REPO.repo } : null
}

export const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export function notesToText(notes: UpdateInfo['releaseNotes']): string {
  const html = Array.isArray(notes) ? notes.map((n) => n.note ?? '').join('\n') : (notes ?? '')
  return html
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\s*li[^>]*>/gi, '• ')
    .replace(/<\/\s*(p|div|li|h\d|ul|ol|pre|blockquote|tr)\s*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 4000)
}

export function explainUpdateError(e: unknown): string {
  const msg = String((e as Error)?.message ?? e)
  const code = String((e as { code?: string })?.code ?? '')
  if (/ERR_UPDATER_LATEST_VERSION_NOT_FOUND|ERR_UPDATER_NO_PUBLISHED_VERSIONS|No published versions/i.test(code + msg)) return '还没有发布过版本'
  if (/ERR_UPDATER_CHANNEL_FILE_NOT_FOUND/.test(code + msg)) return '最新发布里缺少 latest.yml，请联系发布者'
  if (/sha512 checksum mismatch|ERR_CHECKSUM_MISMATCH/i.test(msg)) return '下载的安装包校验不通过，已丢弃；请稍后重试'
  if (/ENOTFOUND|ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN|net::ERR_|socket hang up|timeout/i.test(msg)) return '连不上 GitHub，请检查网络后重试'
  if (/ENOSPC/.test(msg)) return '磁盘空间不足'
  return msg.split('\n')[0].slice(0, 200) || '更新出错'
}

export class UpdateService extends EventEmitter<{ changed: [UpdateState] }> {
  private s: UpdateState
  private updater: NsisUpdater | null = null
  private wantInstall = false
  private timers: NodeJS.Timeout[] = []

  constructor(
    private readonly hooks: { busy: () => UpdateBusy; prepareInstall: () => Promise<void> },
    private readonly now: () => Date = () => new Date()
  ) {
    super()
    this.s = { status: 'idle', current: app.getVersion(), remind: false }
    const f = feed()
    const active = app.isPackaged || (__TEST_HOOKS__ && !!testEnv('CCSHELL_UPDATE_FEED'))
    if (!f) this.s = { ...this.s, status: 'unsupported', reason: '未配置更新源' }
    else if (!active) this.s = { ...this.s, status: 'unsupported', reason: '开发版不检查更新' }
    else {
      this.s.releaseUrl = `${f.protocol ?? 'https'}://${f.host ?? 'github.com'}/${f.owner}/${f.repo}/releases`
      this.updater = this.createUpdater(f)
    }
    settings.on('changed', () => this.emitChanged())
    const fake = testEnv('CCSHELL_UPDATE_FAKE')
    if (__TEST_HOOKS__ && fake) {
      this.updater = null
      this.s = {
        status: fake as UpdateState['status'],
        current: this.s.current,
        latest: '0.2.0',
        notes: '• Claude Code 页的会话标题移到顶部\n• 新增自动检查更新\n• 修复通知卡片在部分情况下不弹出的问题',
        releaseDate: '2026-11-20T00:00:00.000Z',
        size: 163_000_000,
        percent: fake === 'downloading' ? 46 : fake === 'downloaded' ? 100 : undefined,
        error: fake === 'error' ? '连不上 GitHub，请检查网络后重试' : undefined,
        checkedAt: Date.now(),
        releaseUrl: 'https://github.com/owner/repo/releases',
        remind: false
      }
    }
  }

  private createUpdater(f: Feed): NsisUpdater {
    const config = join(cacheDir(), 'updater-config.yml')
    mkdirSync(dirname(config), { recursive: true })
    writeFileSync(config, JSON.stringify({ provider: 'github', ...f, updaterCacheDirName: 'updater' }))
    const u = new NsisUpdater(null)
    Object.defineProperty((u as unknown as { app: AppAdapter }).app, 'baseCachePath', { get: () => cacheDir() })
    u.updateConfigPath = config
    u.autoDownload = false
    u.autoInstallOnAppQuit = false
    u.allowDowngrade = false
    u.forceDevUpdateConfig = !app.isPackaged
    if (app.isPackaged) u.installDirectory = dirname(process.execPath)
    u.logger = {
      info: () => {},
      warn: (m: unknown) => log('更新', String(m).slice(0, 300)),
      error: (m: unknown) => log('更新', `出错：${String(m).split('\n')[0].slice(0, 300)}`)
    }
    u.on('error', () => {})
    u.on('update-available', (info: UpdateInfo) => {
      this.set({
        status: 'available',
        latest: info.version,
        notes: notesToText(info.releaseNotes),
        releaseDate: info.releaseDate,
        size: info.files?.[0]?.size,
        error: undefined
      })
      log('更新', `有新版本 ${info.version}（当前 ${this.s.current}）`)
    })
    u.on('update-not-available', () => this.set({ status: 'none', error: undefined }))
    u.on('download-progress', (p: ProgressInfo) => this.set({ status: 'downloading', percent: Math.max(0, Math.min(100, Math.round(p.percent))) }))
    u.on('update-downloaded', (info: UpdateInfo) => {
      this.set({ status: 'downloaded', percent: 100, latest: info.version })
      log('更新', `${info.version} 下载完成`)
      const b = this.hooks.busy()
      if (this.wantInstall && b.sessions === 0 && b.chats === 0) void this.install().catch(() => {})
    })
    return u
  }

  state(): UpdateState {
    const st = settings.get().update
    const pending = this.s.status === 'available' || this.s.status === 'downloading' || this.s.status === 'downloaded' || (this.s.status === 'error' && !!this.s.latest)
    const dismissed = st.remindedVersion === this.s.latest && st.remindedDay === dayKey(this.now())
    return { ...this.s, remind: pending && !dismissed, ...(this.s.status === 'downloaded' ? { busy: this.hooks.busy() } : {}) }
  }

  private set(patch: Partial<UpdateState>): void {
    this.s = { ...this.s, ...patch }
    this.emitChanged()
  }

  private emitChanged(): void {
    this.emit('changed', this.state())
  }

  async check(manual = false): Promise<UpdateState> {
    const u = this.updater
    if (!u) return this.state()
    if (this.s.status === 'checking' || this.s.status === 'downloading' || this.s.status === 'installing') return this.state()
    if (this.s.status === 'downloaded') {
      if (manual) this.undismiss()
      return this.state()
    }
    this.set({ status: 'checking', error: undefined })
    try {
      const r = await u.checkForUpdates()
      if ((this.s.status as UpdateState['status']) === 'checking') this.s.status = r?.isUpdateAvailable ? 'available' : 'none'
      this.set({ checkedAt: Date.now() })
      if (manual && this.s.status === 'available') this.undismiss()
    } catch (e) {
      this.set({ status: 'error', error: explainUpdateError(e), checkedAt: Date.now() })
    }
    return this.state()
  }

  async download(): Promise<void> {
    const u = this.updater
    if (!u || !this.s.latest) throw new Error('没有可更新的版本')
    if (this.s.status === 'downloading' || this.s.status === 'installing') return
    this.wantInstall = true
    if (this.s.status === 'downloaded') {
      const b = this.hooks.busy()
      if (b.sessions === 0 && b.chats === 0) await this.install()
      return
    }
    this.set({ status: 'downloading', percent: 0, error: undefined })
    log('更新', `开始下载 ${this.s.latest}`)
    try {
      await u.downloadUpdate()
    } catch (e) {
      this.wantInstall = false
      this.set({ status: 'error', error: explainUpdateError(e) })
    }
  }

  async install(): Promise<void> {
    const u = this.updater
    if (!u || this.s.status !== 'downloaded') throw new Error('更新还没下载好')
    this.set({ status: 'installing' })
    log('更新', `重启并安装 ${this.s.latest}`)
    try {
      await this.hooks.prepareInstall()
    } catch (e) {
      log('更新', `安装前结束会话出错：${(e as Error).message}`)
    }
    u.once('error', (e: unknown) => this.set({ status: 'error', error: explainUpdateError(e) }))
    u.quitAndInstall(true, true)
  }

  dismiss(): void {
    if (!this.s.latest) return
    settings.update({ update: { remindedVersion: this.s.latest, remindedDay: dayKey(this.now()) } })
  }

  private undismiss(): void {
    const st = settings.get().update
    if (st.remindedVersion || st.remindedDay) settings.update({ update: { remindedVersion: '', remindedDay: '' } })
    else this.emitChanged()
  }

  start(): void {
    if (!this.updater) return
    const tick = () => {
      if (settings.get().update.auto) void this.check()
    }
    this.timers.push(setTimeout(tick, Number(testEnv('CCSHELL_UPDATE_FIRST_MS')) || FIRST_CHECK_MS))
    this.timers.push(setInterval(tick, CHECK_EVERY_MS))
  }

  stop(): void {
    this.timers.forEach((t) => clearTimeout(t))
    this.timers = []
  }
}

export function registerUpdateIpc(svc: UpdateService): void {
  const handle = <A extends unknown[], T>(channel: string, fn: (...args: A) => Promise<T> | T) =>
    ipcMain.handle(channel, async (_e, ...args): Promise<Result<T>> => {
      try {
        return { ok: true, data: await fn(...(args as A)) }
      } catch (e) {
        return { ok: false, error: (e as Error).message || '操作失败' }
      }
    })
  handle('update:state', () => svc.state())
  handle('update:check', () => svc.check(true))
  handle('update:download', () => svc.download())
  handle('update:install', () => svc.install())
  handle('update:dismiss', () => svc.dismiss())
  svc.on('changed', (s) => {
    for (const w of BrowserWindow.getAllWindows()) w.webContents.send('update:changed', s)
  })
}
