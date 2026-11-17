import { testEnv } from '../testhooks'
import { execFile, spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import { session } from 'electron'
import { cacheDir } from '../paths'
import { which } from '../syspath'
import { registryUrl, settings } from '../settings'
import { NODE_DOWNLOAD_URL, type ClaudeInstallInfo } from '../../shared/terminal'
import { clearVersionCache, ownInstallDir, packageVersion, WIN_PKG } from './claude'

const PACKAGE = '@anthropic-ai/claude-code'
const MIN_NODE_MAJOR = 18
const LOG_MAX = 60_000
export const CANCELLED = '已停止'

function npmEnv(registry: string, proxy: string | null): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined || /^(npm_|ELECTRON_|CCSHELL_)/i.test(k)) continue
    env[k] = v
  }
  const tmp = join(cacheDir(), 'tmp')
  mkdirSync(tmp, { recursive: true })
  env.npm_config_cache = join(cacheDir(), 'npm')
  env.TEMP = env.TMP = tmp
  env.npm_config_registry = registry
  env.npm_config_update_notifier = 'false'
  env.npm_config_fund = 'false'
  env.npm_config_audit = 'false'
  if (proxy) env.npm_config_proxy = env.npm_config_https_proxy = proxy
  return env
}

export function explainNpmError(output: string, registry: string): string {
  const code = /npm (?:ERR!|error) code (\w+)/i.exec(output)?.[1] ?? /\b(E[A-Z]{3,})\b/.exec(output)?.[1] ?? ''
  if (/^(ETIMEDOUT|ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH|ESOCKETTIMEDOUT|UNABLE_TO_GET_ISSUER_CERT_LOCALLY|SELF_SIGNED_CERT_IN_CHAIN|CERT_HAS_EXPIRED)$/.test(code) || /network|socket hang up|proxy/i.test(output))
    return `无法连接 npm 源 ${registry}（${code || '网络错误'}）。可在“设置 → 网络”中切换至国内镜像，或配置代理后重试。`
  if (code === 'E404') return `npm 源 ${registry} 中未找到 ${PACKAGE}，请更换 npm 源。`
  if (/^E40[13]$/.test(code)) return `npm 源拒绝访问（${code}）。请检查自定义源的地址与权限，或切换回官方源。`
  if (/^(EPERM|EBUSY|EACCES)$/.test(code)) return `文件被占用或权限不足（${code}）。请结束运行中的 Claude Code 会话后重试。`
  if (code === 'ENOSPC') return '磁盘空间不足。'
  if (code === 'EBADENGINE') return `Node.js 版本过低，Claude Code 需要 ${MIN_NODE_MAJOR} 或更高版本。`
  const last = output.trim().split('\n').filter((l) => /error|ERR!/i.test(l)).slice(-3).join('\n')
  return `安装失败${code ? `（${code}）` : ''}。${last ? '\n' + last : ''}`
}

export class ClaudeInstaller extends EventEmitter<{ changed: [ClaudeInstallInfo] }> {
  private running: ClaudeInstallInfo['running'] = null
  private log = ''
  private error: string | null = null
  private latest: string | null = null
  private checkedAt: number | null = null
  private child: ChildProcess | null = null
  private cancelled = false
  private nodeCache: { node: ClaudeInstallInfo['node']; checked: number } | null = null

  constructor(private readonly inUse: () => number) {
    super()
  }

  npmPath(): string | null {
    const override = testEnv('CCSHELL_NPM_PATH')
    if (override) return existsSync(override) ? override : null
    return which('npm.cmd')
  }

  private nodeInfo(force = false): Promise<ClaudeInstallInfo['node']> {
    if (!force && this.nodeCache && Date.now() - this.nodeCache.checked < 30_000) return Promise.resolve(this.nodeCache.node)
    const node = which('node.exe')
    if (!node) {
      this.nodeCache = { node: null, checked: Date.now() }
      return Promise.resolve(null)
    }
    return new Promise((done) => {
      execFile(node, ['--version'], { timeout: 10_000, windowsHide: true }, (err, stdout) => {
        const v = err ? null : stdout.trim().replace(/^v/, '')
        const info = v ? { path: node, version: v } : null
        this.nodeCache = { node: info, checked: Date.now() }
        done(info)
      })
    })
  }

  own(): ClaudeInstallInfo['own'] {
    const exe = join(ownInstallDir(), WIN_PKG)
    if (!existsSync(exe)) return null
    return { path: exe, version: packageVersion(exe) }
  }

  async info(recheck = false): Promise<ClaudeInstallInfo> {
    const node = await this.nodeInfo(recheck)
    const npm = this.npmPath()
    let nodeProblem: string | null = null
    const npmOverride = testEnv('CCSHELL_NPM_PATH')
    if (!npmOverride) {
      if (!node) nodeProblem = `未找到 Node.js。安装 Claude Code 需要 npm（随 Node.js 提供）。请从 ${NODE_DOWNLOAD_URL} 安装 LTS 版本，完成后重新检查。`
      else if (Number(node.version.split('.')[0]) < MIN_NODE_MAJOR)
        nodeProblem = `Node.js 版本为 ${node.version}，版本过低，需要 ${MIN_NODE_MAJOR} 或更高。请从 ${NODE_DOWNLOAD_URL} 安装新版本。`
      else if (!npm) nodeProblem = `已找到 Node.js ${node.version}，但未找到 npm（npm.cmd）。请重新安装 Node.js 并勾选 npm。`
    } else if (!npm) nodeProblem = `指定的 npm 不存在：${npmOverride}`
    return {
      own: this.own(),
      node,
      npm,
      nodeProblem,
      registry: registryUrl(),
      running: this.running,
      latest: this.latest,
      checkedAt: this.checkedAt,
      log: this.log,
      error: this.error,
      inUse: this.inUse()
    }
  }

  private async emitInfo(): Promise<void> {
    this.emit('changed', await this.info())
  }

  private append(text: string): void {
    this.log += text
    if (this.log.length > LOG_MAX) this.log = this.log.slice(-LOG_MAX)
    void this.emitInfo()
  }

  private async proxy(registry: string): Promise<string | null> {
    const n = settings.get().network
    if (n.proxy === 'none') return null
    if (n.proxy === 'custom') return n.customProxy.trim() || null
    try {
      const r = await session.defaultSession.resolveProxy(registry)
      const m = /(?:PROXY|HTTPS)\s+([^;\s]+)/i.exec(r)
      return m ? `http://${m[1]}` : null
    } catch {
      return null
    }
  }

  private async npm(args: string[], quiet = false): Promise<{ code: number; out: string }> {
    const npm = this.npmPath()
    if (!npm) throw new Error((await this.info()).nodeProblem ?? '未找到 npm')
    const registry = registryUrl()
    const proxy = await this.proxy(registry)
    const env = npmEnv(registry, proxy)
    if (!quiet) this.append(`> npm ${args.join(' ')}\n  源：${registry}${proxy ? `  代理：${proxy}` : ''}\n`)
    const q = (s: string) => (/[\s&()^|<>"]/.test(s) ? `"${s.replace(/"/g, '')}"` : s)
    const line = `"${[q(npm), ...args.map(q)].join(' ')}"`
    if (this.cancelled) return { code: -1, out: '' }
    return new Promise((done) => {
      const child = spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', line], { env, windowsHide: true, windowsVerbatimArguments: true })
      this.child = child
      let out = ''
      const on = (d: Buffer) => {
        const s = d.toString('utf8')
        out += s
        if (!quiet) this.append(s)
      }
      child.stdout.on('data', on)
      child.stderr.on('data', on)
      child.on('error', (e) => {
        out += String(e)
        this.child = null
        done({ code: -1, out })
      })
      child.on('close', (code) => {
        this.child = null
        done({ code: code ?? -1, out })
      })
    })
  }

  private async run<T>(kind: NonNullable<ClaudeInstallInfo['running']>, fn: () => Promise<T>): Promise<T> {
    if (this.running) throw new Error('上一个操作尚未完成')
    this.running = kind
    this.error = null
    this.cancelled = false
    if (kind !== 'check') this.log = ''
    await this.emitInfo()
    try {
      return await fn()
    } catch (e) {
      if (this.cancelled) {
        if (kind !== 'check') this.append('\n已停止。\n')
        throw new Error(CANCELLED)
      }
      this.error = (e as Error).message
      throw e
    } finally {
      this.running = null
      await this.emitInfo()
    }
  }

  install(): Promise<string> {
    const updating = !!this.own()
    return this.run(updating ? 'update' : 'install', async () => {
      if (updating && this.inUse() > 0) throw new Error(`有 ${this.inUse()} 个会话正在使用客户端安装的 Claude Code，请先结束后再更新。`)
      const target = ownInstallDir()
      const staging = target + '.new'
      rmSync(staging, { recursive: true, force: true })
      mkdirSync(staging, { recursive: true })
      writeFileSync(join(staging, 'package.json'), JSON.stringify({ name: 'ccshell-claude-code', private: true }, null, 2))
      const r = await this.npm(['install', `${PACKAGE}@latest`, '--prefix', staging, '--include=optional', '--no-audit', '--no-fund', '--no-save'])
      if (this.cancelled) {
        rmSync(staging, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
        throw new Error(CANCELLED)
      }
      if (r.code !== 0) {
        rmSync(staging, { recursive: true, force: true })
        throw new Error(explainNpmError(r.out, registryUrl()))
      }
      const exe = join(staging, WIN_PKG)
      if (!existsSync(exe)) {
        rmSync(staging, { recursive: true, force: true })
        throw new Error('npm 安装完成，但未包含 claude.exe（Windows 可选依赖安装失败），请更换 npm 源后重试。')
      }
      const version = packageVersion(exe) ?? '?'
      const old = target + '.old'
      rmSync(old, { recursive: true, force: true })
      if (existsSync(target)) renameSync(target, old)
      try {
        renameSync(staging, target)
      } catch (e) {
        if (existsSync(old)) renameSync(old, target)
        throw new Error(`替换失败：${(e as Error).message}`)
      }
      rmSync(old, { recursive: true, force: true })
      clearVersionCache()
      this.latest = version
      this.checkedAt = Date.now()
      this.append(`\n已${updating ? '更新' : '安装'} Claude Code ${version}：${target}\n`)
      return version
    })
  }

  checkUpdate(): Promise<string> {
    return this.run('check', async () => {
      const r = await this.npm(['view', `${PACKAGE}@latest`, 'version'], true)
      const v = /\d+\.\d+\.\d+\S*/.exec(r.out.trim().split('\n').at(-1) ?? '')?.[0]
      if (this.cancelled) throw new Error(CANCELLED)
      if (r.code !== 0 || !v) throw new Error(explainNpmError(r.out, registryUrl()))
      this.latest = v
      this.checkedAt = Date.now()
      return v
    })
  }

  cancel(): void {
    if (!this.running || this.running === 'uninstall') return
    this.cancelled = true
    const pid = this.child?.pid
    if (pid) {
      spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true })
      this.child?.kill()
    }
  }

  uninstall(): Promise<void> {
    return this.run('uninstall', async () => {
      if (this.inUse() > 0) throw new Error(`有 ${this.inUse()} 个会话正在使用客户端安装的 Claude Code，请先结束后再卸载。`)
      rmSync(ownInstallDir(), { recursive: true, force: true })
      clearVersionCache()
      this.log = '已卸载客户端安装的 Claude Code。\n'
    })
  }
}

export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.-]/).map((x) => parseInt(x, 10) || 0)
  const pb = b.split(/[.-]/).map((x) => parseInt(x, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0)
  return 0
}

