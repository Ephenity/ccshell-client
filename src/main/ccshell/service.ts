import { testEnv } from '../testhooks'
import { EventEmitter } from 'node:events'
import { BrowserWindow, clipboard, session, type Session } from 'electron'
import type { AccountOverview, AccountState, AccountUser, Announcement, LoginOutcome, Money } from '../../shared/ccshell'
import { encryptPassword } from './crypto'
import { ApiError, apiRequest, type RequestOptions } from './http'
import {
  DAY_MS,
  makeMoney,
  mapLog,
  mapToken,
  mapUser,
  maskKey,
  startOfDayUtc8,
  type RawLog,
  type RawStatus,
  type RawToken,
  type RawUser
} from './mapping'
import { clearSecrets, loadAnnounceSeen, loadConfig, loadSecrets, saveAnnounceSeen, saveConfig, saveSecrets, type Secrets } from './vault'

interface AuthBundle {
  access_token?: string
  access_expires_at?: number
  session?: { sid?: string }
  user?: RawUser
}

interface LoginResponse extends AuthBundle {
  require_verification?: boolean
  flow_token?: string
  expires_at?: number
  methods?: { method: string; available: boolean }[]
}

interface Page<T> {
  items?: T[]
  total?: number
}

const AUTH_PATHS = ['/sign-in', '/sign-up', '/forgot-password', '/reset-password']

export class CcShellService extends EventEmitter<{ changed: [AccountState] }> {
  private readonly ses: Session = session.fromPartition('persist:ccshell')
  private baseUrl = loadConfig().baseUrl
  private secrets: Secrets = {}
  private accessToken = ''
  private accessExpiresAt = 0
  private user: AccountUser | null = null
  private balance: Money | null = null
  private restoring = true
  private refreshing: Promise<boolean> | null = null
  private pendingVerification: { flowToken: string; expiresAt: number } | null = null
  private statusCache: { at: number; value: RawStatus } | null = null

  async init(): Promise<void> {
    this.secrets = loadSecrets()
    try {
      if (await this.refresh()) await this.loadSelf()
    } catch {
    }
    this.restoring = false
    this.emitChanged()
  }

  state(): AccountState {
    return {
      baseUrl: this.baseUrl,
      restoring: this.restoring,
      user: this.user,
      balance: this.balance,
      activeKey: this.secrets.apiKey ? { id: this.secrets.apiKey.id, masked: this.secrets.apiKey.masked } : null
    }
  }

  getApiKey(): string | null {
    return this.secrets.apiKey?.secret ?? null
  }

  getBaseUrl(): string {
    return this.baseUrl
  }

  getUserGroup(): string {
    return this.user?.group || 'default'
  }

  siteStatus(): Promise<RawStatus> {
    return this.getStatus()
  }

  publicGet<T>(path: string, raw = false): Promise<T> {
    return this.publicRequest<T>(path, { raw })
  }

  async setBaseUrl(input: string): Promise<void> {
    const url = normalizeBaseUrl(input)
    if (url === this.baseUrl) return
    await this.clearLocal()
    this.baseUrl = url
    this.statusCache = null
    saveConfig({ baseUrl: url })
    this.emitChanged()
  }

  async loginMode(): Promise<'password' | 'web'> {
    return (await this.getStatus(true)).turnstile_check ? 'web' : 'password'
  }

  async login(account: string, password: string): Promise<LoginOutcome> {
    if (!account.trim()) throw new ApiError('请输入用户名或邮箱')
    if (!password) throw new ApiError('请输入密码')
    const status = await this.getStatus(true)
    if (status.turnstile_check) return { kind: 'web-login' }

    const enc = await this.publicRequest<{ enabled?: boolean; public_key?: string; kid?: string }>(
      '/api/user/login/encryption-key'
    )
    const secret =
      enc.enabled && enc.public_key && enc.kid
        ? { password_encrypted: encryptPassword(password, enc.public_key, enc.kid), encryption_key_id: enc.kid }
        : { password }

    const res = await this.publicRequest<LoginResponse>('/api/user/login', {
      method: 'POST',
      body: { username: account.trim(), ...secret }
    })
    if (res.require_verification) {
      if (!res.methods?.some((m) => m.method === '2fa' && m.available))
        throw new ApiError('该账号的登录验证方式客户端暂不支持，请改用网页登录')
      this.pendingVerification = { flowToken: res.flow_token ?? '', expiresAt: (res.expires_at ?? 0) * 1000 }
      return { kind: 'two-factor', expiresAt: this.pendingVerification.expiresAt }
    }
    await this.completeLogin(res)
    return { kind: 'done' }
  }

  async verifyTwoFactor(code: string): Promise<void> {
    const pending = this.pendingVerification
    if (!pending || pending.expiresAt < Date.now()) {
      this.pendingVerification = null
      throw new ApiError('登录验证已过期，请重新登录', 0, 'expired')
    }
    const res = await this.publicRequest<AuthBundle>('/api/user/login/verify', {
      method: 'POST',
      body: { flow_token: pending.flowToken, method: '2fa', code: code.trim() }
    })
    this.pendingVerification = null
    await this.completeLogin(res)
  }

  webLogin(parent: BrowserWindow | null): Promise<boolean> {
    const win = new BrowserWindow({
      parent: parent ?? undefined,
      modal: !!parent,
      width: 520,
      height: 720,
      title: '登录 CC Shell',
      autoHideMenuBar: true,
      webPreferences: { partition: 'persist:ccshell', sandbox: true, contextIsolation: true }
    })
    return new Promise((resolve) => {
      let done = false
      const finish = (ok: boolean) => {
        if (done) return
        done = true
        if (!win.isDestroyed()) win.close()
        resolve(ok)
      }
      const check = async (url: string) => {
        const u = new URL(url)
        if (done || u.origin !== new URL(this.baseUrl).origin || AUTH_PATHS.some((p) => u.pathname.startsWith(p))) return
        done = true
        if (!win.isDestroyed()) win.destroy()
        try {
          const ok = await this.refresh()
          if (ok) await this.afterLogin()
          resolve(ok)
        } catch {
          resolve(false)
        }
      }
      win.webContents.on('did-navigate', (_e, url) => void check(url))
      win.webContents.on('did-navigate-in-page', (_e, url) => void check(url))
      win.on('closed', () => finish(false))
      void win.loadURL(`${this.baseUrl}/sign-in`)
    })
  }

  async logout(): Promise<void> {
    try {
      await this.publicRequest('/api/user/auth/logout', { method: 'POST', body: {}, headers: this.sessionHeader() })
    } catch {}
    await this.clearLocal()
    this.emitChanged()
  }

  async overview(): Promise<AccountOverview> {
    const money = await this.money()
    const since = Math.floor((startOfDayUtc8() - 29 * DAY_MS) / 1000)
    const [self, tokens, logs, daily] = await Promise.all([
      this.authed<RawUser>('/api/user/self'),
      this.listTokens(),
      Promise.all([2, 5].map((type) => this.authed<Page<RawLog>>(`/api/log/self?type=${type}&p=1&page_size=10`))),
      this.authed<{ model_name?: string; quota?: number; count?: number }[]>(
        `/api/data/self?start_timestamp=${since}&end_timestamp=${Math.ceil(Date.now() / 1000)}`
      )
    ])
    this.setUser(self, money)

    const byModel = new Map<string, { quota: number; requests: number }>()
    for (const row of Array.isArray(daily) ? daily : []) {
      const name = row.model_name || '未知模型'
      const cur = byModel.get(name) ?? { quota: 0, requests: 0 }
      cur.quota += Number(row.quota) || 0
      cur.requests += Number(row.count) || 0
      byModel.set(name, cur)
    }

    return {
      user: this.user!,
      balance: money(self.quota),
      totalSpent: money(self.used_quota),
      requestCount: Number(self.request_count) || 0,
      last30Days: [...byModel]
        .map(([model, v]) => ({ model, cost: money(v.quota), requests: v.requests }))
        .sort((a, b) => b.cost.amount - a.cost.amount),
      keys: tokens.map((t) => mapToken(t, money)),
      recentLogs: logs
        .flatMap((p) => p.items ?? [])
        .map((l) => mapLog(l, money))
        .sort((a, b) => b.time - a.time)
        .slice(0, 10)
    }
  }

  async refreshBalance(): Promise<void> {
    const [self, money] = await Promise.all([this.authed<RawUser>('/api/user/self'), this.money()])
    this.setUser(self, money)
  }

  startBalanceTimer(ms = Number(testEnv('CCSHELL_BALANCE_MS')) || 5 * 60_000): () => void {
    const timer = setInterval(() => {
      if (this.user && !this.restoring) void this.refreshBalance().catch(() => {})
    }, ms)
    return () => clearInterval(timer)
  }

  async ensureKey(): Promise<void> {
    const tokens = await this.listTokens()
    const saved = this.secrets.apiKey
    if (saved && tokens.some((t) => String(t.id) === saved.id)) return
    if (tokens.length > 0) {
      const money = await this.money()
      const usable = tokens.find((t) => mapToken(t, money).status === 'active') ?? tokens[0]
      await this.selectKey(String(usable.id))
      return
    }
    await this.authed('/api/token/', {
      method: 'POST',
      body: {
        name: 'CC Shell 客户端',
        remain_quota: 0,
        unlimited_quota: true,
        expired_time: -1,
        model_limits_enabled: false,
        model_limits: '',
        group: this.user?.group || 'default'
      }
    })
    const created = (await this.listTokens())[0]
    if (!created) throw new ApiError('密钥已创建，但读取失败，请刷新后重试')
    await this.selectKey(String(created.id))
  }

  async selectKey(id: string): Promise<void> {
    const res = await this.authed<{ key: string }>(`/api/token/${encodeURIComponent(id)}/key`, {
      method: 'POST',
      body: {}
    })
    const secret = res.key.startsWith('sk-') ? res.key : `sk-${res.key}`
    this.secrets = { ...this.secrets, apiKey: { id, masked: `${secret.slice(0, 7)}…${secret.slice(-4)}`, secret } }
    saveSecrets(this.secrets)
    this.emitChanged()
  }

  copyKey(): void {
    const key = this.getApiKey()
    if (!key) throw new ApiError('尚未保存密钥')
    clipboard.writeText(key)
  }

  private async completeLogin(bundle: AuthBundle): Promise<void> {
    if (bundle.access_token) this.applyBundle(bundle)
    else if (!(await this.refresh())) throw new ApiError('登录未完成，请重试')
    await this.afterLogin()
  }

  private async afterLogin(): Promise<void> {
    await this.loadSelf()
    try {
      await this.ensureKey()
    } catch {
    }
  }

  private async loadSelf(): Promise<void> {
    const [self, money] = await Promise.all([this.authed<RawUser>('/api/user/self'), this.money()])
    this.setUser(self, money)
  }

  private setUser(self: RawUser, money: (q: unknown) => Money): void {
    this.user = mapUser(self)
    this.balance = money(self.quota)
    this.emitChanged()
  }

  private applyBundle(bundle: AuthBundle): void {
    this.accessToken = bundle.access_token ?? ''
    this.accessExpiresAt = (bundle.access_expires_at ?? 0) * 1000
    const sid = bundle.session?.sid
    if (sid && sid !== this.secrets.sid) {
      this.secrets = { ...this.secrets, sid }
      saveSecrets(this.secrets)
    }
    if (bundle.user) this.user = mapUser(bundle.user)
  }

  private refresh(): Promise<boolean> {
    this.refreshing ??= (async () => {
      try {
        const bundle = await this.publicRequest<AuthBundle>('/api/user/auth/refresh', {
          method: 'POST',
          body: {},
          headers: this.sessionHeader()
        })
        if (!bundle?.access_token) return false
        this.applyBundle(bundle)
        return true
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) {
          this.accessToken = ''
          return false
        }
        throw e
      } finally {
        this.refreshing = null
      }
    })()
    return this.refreshing
  }

  private async authed<T>(path: string, opts: RequestOptions = {}): Promise<T> {
    if (!this.accessToken || this.accessExpiresAt < Date.now() + 30_000) await this.ensureFresh()
    try {
      return await apiRequest<T>(this.ses, this.baseUrl, path, { ...opts, accessToken: this.accessToken })
    } catch (e) {
      if (!(e instanceof ApiError) || e.status !== 401) throw e
      await this.ensureFresh()
      return apiRequest<T>(this.ses, this.baseUrl, path, { ...opts, accessToken: this.accessToken })
    }
  }

  private async ensureFresh(): Promise<void> {
    if (await this.refresh()) return
    await this.clearLocal({ keepKey: true })
    this.emitChanged()
    throw new ApiError('登录已失效，请重新登录', 401, 'auth-required')
  }

  private publicRequest<T>(path: string, opts: RequestOptions = {}): Promise<T> {
    return apiRequest<T>(this.ses, this.baseUrl, path, opts)
  }

  private sessionHeader(): Record<string, string> {
    return this.secrets.sid ? { 'X-Auth-Session': this.secrets.sid } : {}
  }

  async dueAnnouncements(now = new Date()): Promise<Announcement[] | null> {
    if (!this.user) return null
    const shot = testEnv('CCSHELL_SCREENSHOT')
    if (shot && !shot.includes('announce')) return null
    const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    const key = `${this.baseUrl}#${this.user.id}`
    const seen = loadAnnounceSeen()
    const status = await this.getStatus(true)
    if (status.announcements_enabled === false) return null
    const list: Announcement[] = (status.announcements ?? [])
      .filter((a) => a.content?.trim())
      .map((a) => ({ id: a.id ?? 0, content: a.content!.trim(), publishedAt: Date.parse(a.publishDate ?? '') || 0, type: a.type || 'default', ...(a.extra ? { extra: a.extra } : {}) }))
      .sort((a, b) => b.publishedAt - a.publishedAt)
    if (!list.length) return null
    const ident = (a: Announcement) => `${a.id}|${a.publishedAt}`
    const rec = seen[key]
    const known = rec && typeof rec === 'object' && rec.day === day && Array.isArray(rec.ids) ? rec.ids : null
    if (known && list.every((a) => known.includes(ident(a)))) return null
    seen[key] = { day, ids: [...new Set([...list.map(ident), ...(known ?? [])])].slice(0, 100) }
    saveAnnounceSeen(seen)
    return list
  }

  private async getStatus(fresh = false): Promise<RawStatus> {
    if (!fresh && this.statusCache && Date.now() - this.statusCache.at < 60_000) return this.statusCache.value
    const value = await this.publicRequest<RawStatus>('/api/status')
    this.statusCache = { at: Date.now(), value }
    return value
  }

  private async money() {
    return makeMoney(await this.getStatus())
  }

  private async listTokens(): Promise<RawToken[]> {
    const all: RawToken[] = []
    for (let p = 1; p <= 10; p++) {
      const page = await this.authed<Page<RawToken>>(`/api/token/?p=${p}&page_size=100`)
      all.push(...(page.items ?? []))
      if (!page.items?.length || all.length >= (page.total ?? 0)) break
    }
    return all
  }

  private async clearLocal({ keepKey = false } = {}): Promise<void> {
    this.accessToken = ''
    this.accessExpiresAt = 0
    this.user = null
    this.balance = null
    this.pendingVerification = null
    const apiKey = keepKey ? this.secrets.apiKey : undefined
    this.secrets = apiKey ? { apiKey } : {}
    if (apiKey) saveSecrets(this.secrets)
    else clearSecrets()
    await this.ses.clearStorageData()
  }

  private emitChanged(): void {
    this.emit('changed', this.state())
  }
}

export function normalizeBaseUrl(input: string): string {
  let text = input.trim()
  if (!/^https?:\/\//i.test(text)) text = `https://${text}`
  let url: URL
  try {
    url = new URL(text)
  } catch {
    throw new ApiError('服务器地址格式无效')
  }
  const local = ['127.0.0.1', 'localhost'].includes(url.hostname)
  if (url.protocol !== 'https:' && !local) throw new ApiError('仅支持 https 地址（本机测试地址除外）')
  return `${url.origin}${url.pathname.replace(/\/+$/, '').replace(/\/v1$/, '')}`
}
