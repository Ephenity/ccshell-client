import { execFile } from 'node:child_process'
import { existsSync, rmSync, statfsSync, writeFileSync } from 'node:fs'
import { delimiter, dirname, join } from 'node:path'
import { app } from 'electron'
import type { EnvCheck } from '../shared/maintenance'
import { NODE_DOWNLOAD_URL } from '../shared/terminal'
import type { CcShellService } from './ccshell/service'
import { claudeVersion, configDir, findClaude } from './terminal/claude'
import { anthropicStatus } from './anthropic'
import type { ClaudeInstaller } from './terminal/installer'
import type { TerminalService } from './terminal/service'

const run = (file: string, args: string[]) =>
  new Promise<{ code: number; out: string }>((done) =>
    execFile(file, args, { timeout: 8000, windowsHide: true }, (err, stdout, stderr) => done({ code: err ? ((err as { code?: number }).code ?? 1) : 0, out: String(stdout || stderr) }))
  )

export function findGitBash(): string | null {
  const env = process.env.CLAUDE_CODE_GIT_BASH_PATH
  if (env && existsSync(env)) return env
  const candidates = [
    join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Git', 'bin', 'bash.exe'),
    join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Git', 'bin', 'bash.exe'),
    join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Git', 'bin', 'bash.exe')
  ]
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    if (!dir) continue
    const git = join(dir, 'git.exe')
    if (existsSync(git)) candidates.push(join(dirname(dirname(git)), 'bin', 'bash.exe'))
  }
  return candidates.find((p) => p && existsSync(p)) ?? null
}

const mb = (n: number) => (n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(1)} GB` : `${Math.round(n / 1024 ** 2)} MB`)

export async function envCheck(deps: { ccshell: CcShellService; installer: ClaudeInstaller; term: TerminalService; hotkeyError: () => string | null }): Promise<EnvCheck[]> {
  const out: EnvCheck[] = []
  const add = (c: EnvCheck) => out.push(c)

  const admin = (await run('net', ['session'])).code === 0
  add(
    admin
      ? { id: 'admin', group: '本机', label: '运行身份', status: 'warn', detail: '客户端以管理员身份运行', fix: '建议以普通用户身份运行：否则 Claude Code 修改的文件将归属管理员，且拖放文件不可用。' }
      : { id: 'admin', group: '本机', label: '运行身份', status: 'ok', detail: '普通用户' }
  )
  const install = await deps.installer.info(true)
  add(
    install.node
      ? { id: 'node', group: '本机', label: 'Node.js / npm', status: install.nodeProblem ? 'warn' : 'ok', detail: `Node.js ${install.node.version}${install.npm ? '，npm 可用' : ''}`, fix: install.nodeProblem ?? undefined }
      : { id: 'node', group: '本机', label: 'Node.js / npm', status: 'info', detail: '未找到 Node.js', fix: `仅在安装或更新 Claude Code 时需要；如需安装，请从 ${NODE_DOWNLOAD_URL} 获取 LTS 版本。` }
  )
  const bash = findGitBash()
  add(
    bash
      ? { id: 'git-bash', group: '本机', label: 'Git Bash', status: 'ok', detail: bash }
      : { id: 'git-bash', group: '本机', label: 'Git Bash', status: 'warn', detail: '未找到 Git Bash', fix: 'Claude Code 在 Windows 上需通过 Git Bash 执行命令。安装 Git for Windows（https://git-scm.com/download/win），或设置环境变量 CLAUDE_CODE_GIT_BASH_PATH 指向 bash.exe。' }
  )
  const dataRoot = join(app.getPath('userData'), '..')
  try {
    const fs = statfsSync(dataRoot)
    const free = fs.bavail * fs.bsize
    add({
      id: 'disk',
      group: '本机',
      label: '磁盘空间',
      status: free < 200 * 1024 ** 2 ? 'error' : free < 1024 ** 3 ? 'warn' : 'ok',
      detail: `数据目录所在磁盘剩余 ${mb(free)}`,
      fix: free < 1024 ** 3 ? '磁盘空间不足：可在“清理”中清除缓存，或释放磁盘空间。' : undefined
    })
  } catch {
    add({ id: 'disk', group: '本机', label: '磁盘空间', status: 'info', detail: '无法读取磁盘剩余空间' })
  }
  try {
    const probe = join(dataRoot, '.write-test')
    writeFileSync(probe, 'ok')
    rmSync(probe)
    add({ id: 'data-dir', group: '本机', label: '数据目录', status: 'ok', detail: dataRoot })
  } catch (e) {
    add({ id: 'data-dir', group: '本机', label: '数据目录', status: 'error', detail: `无法写入：${(e as Error).message}`, fix: '请检查该文件夹的权限，或确认其不在只读磁盘上。' })
  }

  const found = findClaude()
  if (found.path) {
    const v = await claudeVersion(found.path)
    add({ id: 'claude', group: 'Claude Code', label: 'Claude Code', status: v ? 'ok' : 'warn', detail: `${v ?? '无法读取版本'} · ${found.source}\n${found.path}`, fix: v ? undefined : 'claude.exe 无法运行，可在设置中重新安装。' })
  } else add({ id: 'claude', group: 'Claude Code', label: 'Claude Code', status: 'error', detail: '未找到 claude.exe', fix: '可在“设置 → Claude Code”中安装。' })
  const creds = join(configDir('ccshell'), '.credentials.json')
  add(
    existsSync(creds)
      ? { id: 'no-login', group: 'Claude Code', label: 'CC Shell 配置目录', status: 'error', detail: `存在 Anthropic 账户登录凭据：${creds}`, fix: '请删除该文件；Anthropic 账户请在启动会话时选择 Anthropic，它使用独立的配置目录。' }
      : { id: 'no-login', group: 'Claude Code', label: 'CC Shell 配置目录', status: 'ok', detail: '无 Anthropic 账户登录凭据' }
  )
  const an = anthropicStatus()
  const way = an.method === 'apikey' ? 'API 密钥' : '订阅账户'
  add(
    an.ready
      ? { id: 'anthropic', group: 'Claude Code', label: 'Anthropic 账户', status: 'ok', detail: an.method === 'apikey' ? `使用 API 密钥（…${an.apiKeyHint}）` : '使用订阅账户（已登录）' }
      : { id: 'anthropic', group: 'Claude Code', label: 'Anthropic 账户', status: 'info', detail: `未配置（当前方式：${way}）`, fix: '可选。需要时在“设置 → Anthropic 账户”中登录或填写密钥。' }
  )
  const running = deps.term.list().filter((s) => s.status === 'running')
  const noHook = running.filter((s) => s.state === 'running')
  add(
    !running.length
      ? { id: 'hooks', group: 'Claude Code', label: '状态回报（hook）', status: 'info', detail: '当前无运行中的会话，无法检查' }
      : noHook.length
        ? { id: 'hooks', group: 'Claude Code', label: '状态回报（hook）', status: 'warn', detail: `${noHook.map((s) => s.title).join('、')} 未回报状态`, fix: '状态指示、通知与停滞提醒均依赖此项。请重新启动这些会话；如仍无效，请查看日志中 client.log 的 [hook] 行。' }
        : { id: 'hooks', group: 'Claude Code', label: '状态回报（hook）', status: 'ok', detail: `${running.length} 个运行中的会话均正常回报` }
  )

  const st = deps.ccshell.state()
  add(
    st.user
      ? { id: 'login', group: '账号', label: 'CC Shell 登录', status: 'ok', detail: `${st.user.username} · ${st.baseUrl}` }
      : { id: 'login', group: '账号', label: 'CC Shell 登录', status: 'error', detail: '未登录', fix: '请登录账户。' }
  )
  let key: string | null = null
  try {
    key = deps.ccshell.getApiKey()
  } catch {
    key = null
  }
  add(
    key
      ? { id: 'key', group: '账号', label: 'CC Shell 密钥', status: 'ok', detail: `${st.activeKey?.masked ?? '已保存'}（本机加密保存，可正常解密）` }
      : { id: 'key', group: '账号', label: 'CC Shell 密钥', status: st.user ? 'error' : 'warn', detail: '无可用密钥', fix: '登录账户后将自动创建或选择密钥。' }
  )

  const hk = deps.hotkeyError()
  add(hk ? { id: 'hotkey', group: '客户端', label: '全局热键', status: 'warn', detail: hk, fix: '请在“设置 → 外观与启动”中更换组合。' } : { id: 'hotkey', group: '客户端', label: '全局热键', status: 'ok', detail: '正常' })
  add({ id: 'version', group: '客户端', label: '客户端版本', status: 'info', detail: `${app.getVersion()} · Electron ${process.versions.electron}` })
  return out
}

export function reportText(checks: EnvCheck[]): string {
  const icon = { ok: '✓', info: 'i', warn: '!', error: '✕' } as const
  return [
    `CC Shell 环境检查  ${new Date().toLocaleString('zh-CN', { hour12: false })}`,
    '',
    ...checks.map((c) => `[${icon[c.status]}] ${c.group} · ${c.label}：${c.detail.replace(/\n/g, ' ')}${c.fix ? `\n    建议：${c.fix}` : ''}`)
  ].join('\n')
}
