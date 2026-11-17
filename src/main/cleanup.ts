import { existsSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import type { CleanupItem, CleanupResult } from '../shared/maintenance'
import { log, trimLog } from './log'
import { cacheDir } from './paths'
import { settings } from './settings'
import { configDir, ownInstallDir } from './terminal/claude'
import { listHistory } from './terminal/history'
import type { TerminalService } from './terminal/service'

const HOUR = 3_600_000
const DAY = 24 * HOUR
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface Target {
  path: string
  bytes: number
}

interface Def {
  id: string
  label: string
  desc: string
  defaultOn: boolean
  daily: boolean
  scan: () => Target[]
  clean?: (targets: Target[]) => CleanupResult
}

function size(p: string): number {
  try {
    const st = statSync(p)
    if (!st.isDirectory()) return st.size
    let total = 0
    for (const n of readdirSync(p)) total += size(join(p, n))
    return total
  } catch {
    return 0
  }
}

function newest(p: string, depth = 0): number {
  try {
    const st = statSync(p)
    if (!st.isDirectory() || depth > 6) return st.mtimeMs
    let t = st.mtimeMs
    for (const n of readdirSync(p)) t = Math.max(t, newest(join(p, n), depth + 1))
    return t
  } catch {
    return Date.now()
  }
}

const ls = (dir: string): string[] => {
  try {
    return readdirSync(dir)
  } catch {
    return []
  }
}

const old = (p: string, ms: number) => Date.now() - newest(p) > ms

export class Cleaner {
  private readonly defs: Def[]

  constructor(private readonly term: TerminalService) {
    const projects = () => join(configDir(), 'projects')
    const transcripts = () => {
      const ids = new Set<string>()
      for (const d of ls(projects())) for (const n of ls(join(projects(), d))) if (n.endsWith('.jsonl')) ids.add(n.slice(0, -6))
      return ids
    }
    const openIds = () => new Set(this.term.list().filter((s) => s.status === 'running' && s.conversationId).map((s) => s.conversationId!))
    const t = (path: string): Target => ({ path, bytes: size(path) })

    this.defs = [
      {
        id: 'orphans',
        label: '已删除对话的残留',
        desc: '对话已删除，但其关联文件夹（子代理记录、工具输出）、改动备份（file-history）与 session-env 仍有残留',
        defaultOn: true,
        daily: true,
        scan: () => {
          const ids = transcripts()
          const open = openIds()
          const out: Target[] = []
          for (const d of ls(projects()))
            for (const n of ls(join(projects(), d))) {
              const p = join(projects(), d, n)
              if (UUID.test(n) && !ids.has(n) && !open.has(n) && old(p, HOUR)) out.push(t(p))
            }
          for (const sub of ['file-history', 'session-env'])
            for (const n of ls(join(configDir(), sub))) {
              const p = join(configDir(), sub, n)
              if (UUID.test(n) && !ids.has(n) && !open.has(n) && old(p, HOUR)) out.push(t(p))
            }
          return out
        }
      },
      {
        id: 'empty',
        label: '空对话',
        desc: '不含任何消息的对话记录（1 小时前），例如启动后即退出的会话',
        defaultOn: true,
        daily: false,
        scan: () => {
          const withMessages = new Set(listHistory().map((h) => h.id))
          const open = openIds()
          const out: Target[] = []
          for (const d of ls(projects()))
            for (const n of ls(join(projects(), d))) {
              const id = n.slice(0, -6)
              const p = join(projects(), d, n)
              if (n.endsWith('.jsonl') && UUID.test(id) && !withMessages.has(id) && !open.has(id) && old(p, HOUR)) out.push(t(p))
            }
          return out
        }
      },
      {
        id: 'file-history',
        label: '闲置对话的改动备份',
        desc: `Claude Code /rewind 用的文件备份（file-history），仅清理 ${settings.get().cleanup.idleDays} 天无活动的对话；清理后这些对话将无法 /rewind`,
        defaultOn: false,
        daily: false,
        scan: () => {
          const days = settings.get().cleanup.idleDays
          const open = openIds()
          return ls(join(configDir(), 'file-history'))
            .map((n) => join(configDir(), 'file-history', n))
            .filter((p) => !open.has(p.split(/[\\/]/).pop()!) && old(p, days * DAY))
            .map(t)
        }
      },
      {
        id: 'shell-snapshots',
        label: '过期的终端环境快照',
        desc: 'Claude Code 执行命令前记录的 shell 环境（shell-snapshots），1 天前',
        defaultOn: true,
        daily: true,
        scan: () =>
          ls(join(configDir(), 'shell-snapshots'))
            .map((n) => join(configDir(), 'shell-snapshots', n))
            .filter((p) => old(p, DAY))
            .map(t)
      },
      {
        id: 'temp',
        label: '临时文件',
        desc: '客户端的临时目录（data\\tmp）与安装临时目录中 1 天前的文件，以及安装失败的残留',
        defaultOn: true,
        daily: true,
        scan: () => {
          const out: Target[] = []
          for (const dir of [app.getPath('temp'), join(cacheDir(), 'tmp')]) for (const n of ls(dir)) if (old(join(dir, n), DAY)) out.push(t(join(dir, n)))
          for (const p of [ownInstallDir() + '.new', ownInstallDir() + '.old']) if (existsSync(p) && old(p, HOUR)) out.push(t(p))
          return out
        }
      },
      {
        id: 'npm-cache',
        label: 'npm 下载缓存',
        desc: '安装 Claude Code 时 npm 的缓存（.cache\\npm）；清理后重装或更新需重新下载',
        defaultOn: false,
        daily: false,
        scan: () => (existsSync(join(cacheDir(), 'npm')) ? [t(join(cacheDir(), 'npm'))] : [])
      },
      {
        id: 'records',
        label: '已结束会话的记录',
        desc: 'Claude Code 会话列表中 1 天前已结束的会话（对话记录仍保留在“历史对话”中）',
        defaultOn: true,
        daily: true,
        scan: () => this.term.list().filter((s) => s.status === 'exited' && Date.now() - s.stateAt > DAY).map((s) => ({ path: s.id, bytes: 0 })),
        clean: (targets) => {
          for (const x of targets) this.term.remove(x.path)
          return { count: targets.length, bytes: 0, skipped: 0 }
        }
      },
      {
        id: 'logs',
        label: '过期日志',
        desc: '客户端日志（client.log）里 30 天前的行',
        defaultOn: true,
        daily: true,
        scan: () => {
          const bytes = trimLog(30, true)
          return bytes > 0 ? [{ path: join(app.getPath('logs'), 'client.log'), bytes }] : []
        },
        clean: () => {
          const bytes = trimLog(30)
          return { count: bytes > 0 ? 1 : 0, bytes, skipped: 0 }
        }
      }
    ]
  }

  scan(): CleanupItem[] {
    return this.defs.map((d) => {
      const targets = d.scan()
      return { id: d.id, label: d.label, desc: d.desc, defaultOn: d.defaultOn, daily: d.daily, count: targets.length, bytes: targets.reduce((a, x) => a + x.bytes, 0) }
    })
  }

  clean(ids: string[]): CleanupResult {
    const total: CleanupResult = { count: 0, bytes: 0, skipped: 0 }
    for (const d of this.defs.filter((x) => ids.includes(x.id))) {
      const targets = d.scan()
      const r = d.clean ? d.clean(targets) : this.remove(targets)
      total.count += r.count
      total.bytes += r.bytes
      total.skipped += r.skipped
    }
    log('清理', `清理 ${ids.join('、')}：${total.count} 项，${(total.bytes / 1048576).toFixed(1)} MB${total.skipped ? `，${total.skipped} 项被占用跳过` : ''}`)
    return total
  }

  private remove(targets: Target[]): CleanupResult {
    const r: CleanupResult = { count: 0, bytes: 0, skipped: 0 }
    for (const x of targets) {
      try {
        rmSync(x.path, { recursive: true, force: true, maxRetries: 2 })
        if (existsSync(x.path)) throw new Error('还在')
        r.count++
        r.bytes += x.bytes
      } catch {
        r.skipped++
      }
    }
    return r
  }

  startDaily(): void {
    const run = () => {
      const c = settings.get().cleanup
      if (!c.daily || (c.lastRun && Date.now() - c.lastRun < DAY)) return
      const r = this.clean(this.defs.filter((d) => d.daily).map((d) => d.id))
      settings.update({ cleanup: { lastRun: Date.now(), lastResult: `已清理 ${r.count} 项，${(r.bytes / 1048576).toFixed(1)} MB` } })
    }
    setTimeout(run, 60_000)
    setInterval(run, HOUR).unref?.()
  }
}
