import { appendFileSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

export type LogArea = '客户端' | '会话' | '安装' | '通知' | '卡住' | '清理' | 'hook' | '设置' | '队列' | '提示词' | '协作' | '后台' | 'Anthropic' | '更新'

function file(): string {
  const dir = app.getPath('logs')
  mkdirSync(dir, { recursive: true })
  return join(dir, 'client.log')
}

const pad = (n: number) => String(n).padStart(2, '0')
export function stamp(t = new Date()): string {
  return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())} ${pad(t.getHours())}:${pad(t.getMinutes())}:${pad(t.getSeconds())}`
}

export function log(area: LogArea, message: string): void {
  try {
    appendFileSync(file(), `${stamp()}  [${area}]  ${message.replace(/\r?\n/g, ' ⏎ ')}\n`, 'utf8')
  } catch {
  }
}

export interface LogFile {
  name: string
  about: string
  size: number
  modified: number
}

const ABOUT: Record<string, string> = {
  'client.log': '客户端的记录：会话开始/结束、安装、通知、卡住和自动继续、清理',
  'main.log': 'Electron 主进程的输出'
}

export function listLogs(): LogFile[] {
  const dir = app.getPath('logs')
  let names: string[] = []
  try {
    names = readdirSync(dir).filter((n) => /\.(log|txt)$/i.test(n))
  } catch {
    return []
  }
  return names
    .map((name) => {
      const st = statSync(join(dir, name))
      return { name, about: ABOUT[name] ?? '', size: st.size, modified: st.mtimeMs }
    })
    .sort((a, b) => (a.name === 'client.log' ? -1 : b.name === 'client.log' ? 1 : b.modified - a.modified))
}

export function readLog(name: string): string {
  if (!/^[\w.-]+\.(log|txt)$/i.test(name)) throw new Error('日志文件名不对')
  const f = join(app.getPath('logs'), name)
  const buf = readFileSync(f)
  const max = 2 * 1024 * 1024
  return buf.length > max ? buf.subarray(buf.length - max).toString('utf8').replace(/^[^\n]*\n/, '') : buf.toString('utf8')
}

export function trimLog(days: number, dryRun = false): number {
  const f = file()
  let text = ''
  try {
    text = readFileSync(f, 'utf8')
  } catch {
    return 0
  }
  const cutoff = stamp(new Date(Date.now() - days * 86_400_000))
  const lines = text.split('\n')
  let keepFrom = lines.length
  for (let i = 0; i < lines.length; i++) {
    const ts = lines[i].slice(0, 19)
    if (/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(ts) && ts >= cutoff) {
      keepFrom = i
      break
    }
  }
  const kept = lines.slice(keepFrom).join('\n')
  const removed = Buffer.byteLength(text) - Buffer.byteLength(kept)
  if (removed > 0 && !dryRun) writeFileSync(f, kept)
  return removed
}
