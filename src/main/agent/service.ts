import { spawn } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { app } from 'electron'
import { AGENT_TOOLS, type AgentToolName } from '../../shared/assistant'
import { capResult, type ChatTool } from '../chat/tools'

const SKIP_DIRS = new Set(['node_modules', '.git', '.svn', '.hg', 'dist', 'out', 'build', '.next', '.cache', '__pycache__', '.venv', 'venv'])
const MAX_READ = 200_000
const MAX_SEARCH_FILE = 2_000_000
const MAX_WALK = 20_000

type Input = Record<string, unknown>

export class AgentService {
  private readonly file = join(app.getPath('userData'), 'agent', 'permissions.json')
  private allowed: AgentToolName[]

  constructor() {
    try {
      this.allowed = JSON.parse(readFileSync(this.file, 'utf8')).alwaysAllow ?? []
    } catch {
      this.allowed = []
    }
  }

  alwaysAllowed(): AgentToolName[] {
    return [...this.allowed]
  }

  setAlwaysAllowed(tools: AgentToolName[]): void {
    this.allowed = tools.filter((t) => t in AGENT_TOOLS)
    mkdirSync(dirname(this.file), { recursive: true })
    writeFileSync(this.file + '.tmp', JSON.stringify({ alwaysAllow: this.allowed }, null, 2))
    renameSync(this.file + '.tmp', this.file)
  }

  toolset(workspace: string, allowCommands: boolean): { tools: ChatTool[]; prompt: string } {
    const root = resolve(workspace)
    if (!existsSync(root) || !statSync(root).isDirectory()) throw new Error(`Agent 的工作目录不存在：${root}`)
    const tools: ChatTool[] = []
    const add = (name: AgentToolName, description: string, properties: Record<string, unknown>, required: string[], run: (a: Input, signal: AbortSignal) => Promise<string> | string) => {
      tools.push({
        name,
        description,
        inputSchema: { type: 'object', properties, required },
        serverId: 'agent',
        serverName: 'Agent',
        tool: name,
        needsApproval: () => AGENT_TOOLS[name].write && !this.allowed.includes(name),
        allowAlways: (scope) => {
          const names = scope === 'tool' ? [name] : (Object.keys(AGENT_TOOLS) as AgentToolName[]).filter((n) => AGENT_TOOLS[n].write)
          this.setAlwaysAllowed([...new Set([...this.allowed, ...names])])
        },
        call: async (input, signal) => {
          try {
            return { text: capResult(await run((input ?? {}) as Input, signal)), isError: false }
          } catch (e) {
            return { text: (e as Error).message, isError: true }
          }
        }
      })
    }
    const str = { type: 'string' }
    const p = (a: Input, key = 'path') => inside(root, String(a[key] ?? '.'))

    add('list_dir', '列出目录里的文件和子目录（相对工作目录的路径，默认根目录）。depth 是展开层数，默认 1，最多 4。', { path: str, depth: { type: 'number' } }, [], (a) =>
      listDir(root, p(a), Math.min(4, Math.max(1, Number(a.depth) || 1)))
    )
    add('find_files', '按文件名通配符找文件，例如 **/*.ts、src/**/config.*。返回相对路径，最多 500 个。', { pattern: str }, ['pattern'], (a) =>
      findFiles(root, String(a.pattern ?? '*'))
    )
    add(
      'search_text',
      '在文件内容里搜索（正则表达式，不区分大小写），返回“路径:行号: 内容”，最多 200 行。可用 glob 限定文件，例如 **/*.md。',
      { pattern: str, glob: str, path: str },
      ['pattern'],
      (a) => searchText(root, p(a), String(a.pattern ?? ''), a.glob ? String(a.glob) : '')
    )
    add(
      'read_file',
      '读文本文件，带行号。大文件用 offset（起始行，从 1 开始）和 limit（行数）分段读。',
      { path: str, offset: { type: 'number' }, limit: { type: 'number' } },
      ['path'],
      (a) => readText(root, p(a), Number(a.offset) || 1, Number(a.limit) || 0)
    )
    add('write_file', '新建或整个覆盖一个文本文件（UTF-8）。目录不存在会自动创建。改已有文件的一部分请用 edit_file。', { path: str, content: str }, ['path', 'content'], (a) => {
      const file = p(a)
      const existed = existsSync(file)
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, String(a.content ?? ''), 'utf8')
      return `${existed ? '已覆盖' : '已新建'} ${rel(root, file)}（${String(a.content ?? '').length} 字）`
    })
    add(
      'edit_file',
      '把文件里的 old_string 替换成 new_string。old_string 必须和文件内容完全一致且只出现一次（要全部替换时设 replace_all: true）。',
      { path: str, old_string: str, new_string: str, replace_all: { type: 'boolean' } },
      ['path', 'old_string', 'new_string'],
      (a) => editFile(root, p(a), String(a.old_string ?? ''), String(a.new_string ?? ''), a.replace_all === true)
    )
    if (allowCommands)
      add(
        'run_command',
        '在工作目录里用 PowerShell 运行一条命令，返回输出和退出码。默认 120 秒超时（timeout 单位秒，最多 600）。不要运行需要交互输入的命令。',
        { command: str, timeout: { type: 'number' } },
        ['command'],
        (a, signal) => runCommand(root, String(a.command ?? ''), Math.min(600, Number(a.timeout) || 120), signal)
      )

    const prompt = [
      `你可以操作工作目录 ${root} 里的文件（Windows）。工具里的路径都相对这个目录，不能访问它外面的文件。`,
      '先用 list_dir、find_files、search_text、read_file 了解情况，再动手修改；改文件前先读它。',
      allowCommands ? 'run_command 在这个目录里用 PowerShell 运行命令。' : '这个对话不允许运行命令。',
      '写文件、改文件和运行命令会先请用户确认，用户可能拒绝，被拒绝时换个办法或问用户。'
    ].join('\n')
    return { tools, prompt }
  }
}

export function inside(root: string, p: string): string {
  const abs = resolve(root, p)
  const within = (base: string, target: string) => {
    const r = relative(base, target)
    if (r.startsWith('..') || isAbsolute(r)) throw new Error(`路径 ${p} 在工作目录外面，不允许访问`)
  }
  within(root, abs)
  const realRoot = realpathSync.native(root)
  let cur = abs
  const tail: string[] = []
  for (;;) {
    let real: string | null = null
    try {
      real = realpathSync.native(cur)
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
      let dangling = false
      try {
        lstatSync(cur)
        dangling = true
      } catch {
      }
      if (dangling) throw new Error(`路径 ${p} 是失效的链接，不允许访问`)
    }
    if (real !== null) {
      within(realRoot, join(real, ...tail))
      return abs
    }
    const parent = dirname(cur)
    if (parent === cur) return abs
    tail.unshift(basename(cur))
    cur = parent
  }
}

const rel = (root: string, abs: string) => relative(root, abs).split(sep).join('/') || '.'

function listDir(root: string, dir: string, depth: number): string {
  if (!statSync(dir).isDirectory()) throw new Error(`${rel(root, dir)} 不是目录`)
  const lines: string[] = []
  const walk = (d: string, level: number) => {
    const entries = readdirSync(d, { withFileTypes: true }).sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
    for (const e of entries) {
      if (lines.length >= 1000) return
      const pad = '  '.repeat(level)
      if (e.isDirectory()) {
        lines.push(`${pad}${e.name}/`)
        if (level + 1 < depth && !SKIP_DIRS.has(e.name)) walk(join(d, e.name), level + 1)
      } else {
        let size = ''
        try {
          size = ` (${fmtSize(statSync(join(d, e.name)).size)})`
        } catch {}
        lines.push(`${pad}${e.name}${size}`)
      }
    }
  }
  walk(dir, 0)
  return lines.length ? lines.join('\n') + (lines.length >= 1000 ? '\n…（太多了，只列出前 1000 项）' : '') : '（空目录）'
}

function* walkFiles(dir: string, count = { n: 0 }): Generator<string> {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    if (++count.n > MAX_WALK) return
    const full = join(dir, e.name)
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) yield* walkFiles(full, count)
    } else if (e.isFile()) yield full
  }
}

export function globToRegExp(glob: string): RegExp {
  let re = ''
  const g = glob.replace(/\\/g, '/')
  for (let i = 0; i < g.length; i++) {
    const c = g[i]
    if (c === '*') {
      if (g[i + 1] === '*') {
        re += g[i + 2] === '/' ? '(?:.*/)?' : '.*'
        i += g[i + 2] === '/' ? 2 : 1
      } else re += '[^/]*'
    } else if (c === '?') re += '[^/]'
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp((g.includes('/') ? '^' : '(?:^|/)') + re + '$', 'i')
}

function findFiles(root: string, pattern: string): string {
  const re = globToRegExp(pattern)
  const out: string[] = []
  for (const f of walkFiles(root)) {
    const r = rel(root, f)
    if (re.test(r)) out.push(r)
    if (out.length >= 500) break
  }
  return out.length ? out.join('\n') : '没有找到匹配的文件'
}

function searchText(root: string, dir: string, pattern: string, glob: string): string {
  let re: RegExp
  try {
    re = new RegExp(pattern, 'i')
  } catch (e) {
    throw new Error(`正则表达式写错了：${(e as Error).message}`)
  }
  const only = glob ? globToRegExp(glob) : null
  const out: string[] = []
  for (const f of walkFiles(dir)) {
    const r = rel(root, f)
    if (only && !only.test(r)) continue
    let text: string
    try {
      if (statSync(f).size > MAX_SEARCH_FILE) continue
      const buf = readFileSync(f)
      if (buf.subarray(0, 8000).includes(0)) continue
      text = buf.toString('utf8')
    } catch {
      continue
    }
    const lines = text.split(/\r?\n/)
    for (let i = 0; i < lines.length; i++) {
      if (!re.test(lines[i])) continue
      out.push(`${r}:${i + 1}: ${lines[i].length > 300 ? lines[i].slice(0, 300) + '…' : lines[i]}`)
      if (out.length >= 200) return out.join('\n') + '\n…（结果太多，只显示前 200 行）'
    }
  }
  return out.length ? out.join('\n') : '没有找到'
}

function readText(root: string, file: string, offset: number, limit: number): string {
  const st = statSync(file)
  if (st.isDirectory()) throw new Error(`${rel(root, file)} 是目录，请用 list_dir`)
  const buf = readFileSync(file)
  if (buf.subarray(0, 8000).includes(0)) throw new Error(`${rel(root, file)} 看起来是二进制文件，不能按文本读`)
  const lines = buf.toString('utf8').replace(/^﻿/, '').split(/\r?\n/)
  const start = Math.max(1, offset)
  let end = limit > 0 ? Math.min(lines.length, start + limit - 1) : lines.length
  const width = String(end).length
  const out: string[] = []
  let size = 0
  for (let i = start; i <= end; i++) {
    const line = `${String(i).padStart(width)}\t${lines[i - 1]}`
    size += line.length + 1
    if (size > MAX_READ) {
      end = i - 1
      out.push(`…（太长了，读到第 ${end} 行为止；共 ${lines.length} 行，用 offset 继续读）`)
      break
    }
    out.push(line)
  }
  const head = start > 1 || end < lines.length ? `（第 ${start}–${end} 行，共 ${lines.length} 行）\n` : ''
  return head + out.join('\n')
}

function editFile(root: string, file: string, oldStr: string, newStr: string, all: boolean): string {
  if (!oldStr) throw new Error('old_string 不能是空的')
  const text = readFileSync(file, 'utf8')
  const count = text.split(oldStr).length - 1
  if (count === 0) throw new Error(`在 ${rel(root, file)} 里没找到 old_string（要和文件内容完全一致，包括空格和换行）`)
  if (count > 1 && !all) throw new Error(`old_string 在文件里出现了 ${count} 次，请多带几行上下文让它唯一，或者设 replace_all: true`)
  writeFileSync(file, all ? text.split(oldStr).join(newStr) : text.replace(oldStr, () => newStr), 'utf8')
  return `已修改 ${rel(root, file)}（替换 ${all ? count : 1} 处）`
}

function runCommand(root: string, command: string, timeoutSec: number, signal: AbortSignal): Promise<string> {
  if (!command.trim()) throw new Error('命令是空的')
  return new Promise((done) => {
    const script = `[Console]::OutputEncoding=[Text.Encoding]::UTF8; $OutputEncoding=[Text.Encoding]::UTF8; ${command}`
    const env: Record<string, string> = {}
    for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !/^(ELECTRON_|VITE_|CCSHELL_|npm_)/i.test(k)) env[k] = v
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], {
      cwd: root,
      env,
      windowsHide: true
    })
    const chunks: Buffer[] = []
    let size = 0
    const collect = (b: Buffer) => {
      if (size < MAX_READ) chunks.push(b)
      size += b.length
    }
    child.stdout.on('data', collect)
    child.stderr.on('data', collect)
    let why = ''
    const kill = (reason: string) => {
      why = reason
      if (child.pid) spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true })
    }
    const timer = setTimeout(() => kill(`超过 ${timeoutSec} 秒，已结束`), timeoutSec * 1000)
    const onAbort = () => kill('用户停止了')
    signal.addEventListener('abort', onAbort)
    const finish = (code: number | null, err?: Error) => {
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      const out = Buffer.concat(chunks).toString('utf8').trim()
      const tail = size > MAX_READ ? `\n…（输出太长，只保留前 ${MAX_READ} 字节）` : ''
      done([out || '（没有输出）', tail, err ? `启动失败：${err.message}` : why ? `【${why}】` : `【退出码 ${code}】`].filter(Boolean).join('\n'))
    }
    child.on('error', (e) => finish(null, e))
    child.on('close', (code) => finish(code))
  })
}

function fmtSize(n: number): string {
  return n < 1024 ? `${n} B` : n < 1 << 20 ? `${(n / 1024).toFixed(0)} KB` : `${(n / (1 << 20)).toFixed(1)} MB`
}
