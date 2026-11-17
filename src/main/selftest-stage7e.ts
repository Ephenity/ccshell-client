import { spawn, type ChildProcess } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { app, BrowserWindow } from 'electron'
import type { CcShellService } from './ccshell/service'
import type { Notice } from '../shared/terminal'
import { settings } from './settings'
import { findClaude } from './terminal/claude'
import { HostClient } from './terminal/hostClient'
import { Popouts } from './terminal/popout'
import { TerminalService } from './terminal/service'

type Check = (name: string, pass: boolean, detail?: string) => void

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const until = async (cond: () => boolean | Promise<boolean>, ms: number) => {
  const t0 = Date.now()
  while (!(await cond()) && Date.now() - t0 < ms) await sleep(250)
  return cond()
}
const strip = (s: string) => s.replace(/\x1b\[[0-9;?<>=]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, '')

function attachProc(pipe: string, id: string, ticket: string): { proc: ChildProcess; out: () => string; exited: () => number | null } {
  let out = ''
  let code: number | null = null
  const proc = spawn(process.execPath, [HostClient.script('attach'), pipe, id, ticket], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', CCSHELL_ATTACH_PIPEIO: '1', CCSHELL_ATTACH_SIZE: '100x30' },
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true
  })
  proc.stdout!.on('data', (d) => (out += d.toString()))
  proc.on('exit', (c) => (code = c ?? -1))
  return { proc, out: () => out, exited: () => code }
}

export async function stage7eSelfTest(ccshell: CcShellService, _mockUrl: string, check: Check): Promise<void> {
  if (!findClaude().path) {
    check('分离终端端到端（没有 Claude Code，跳过）', false)
    return
  }
  rmSync(join(app.getPath('userData'), 'terminal.json'), { force: true })
  settings.update({ stuck: { remindMinutes: 0, autoContinue: false } })
  process.env.CCSHELL_DETACH_NOWINDOW = '1'
  const proj = join(app.getPath('temp'), 'detach-proj')
  mkdirSync(proj, { recursive: true })
  const opts = { model: 'claude-opus-5-5', allModels: true }

  const t1 = new TerminalService(ccshell)
  const A = await t1.create({ cwd: proj, title: '分离甲', ...opts })
  t1.resize(A.id, 110, 32)
  const info1 = () => t1.list().find((x) => x.id === A.id)
  check('分离：会话在后台进程里启动、能到空闲', await until(() => info1()?.state === 'idle', 60_000), JSON.stringify(info1()))
  const hosted = await t1.host.list()
  check('分离：后台进程里有这个会话（pid 不是客户端的）', hosted.some((h) => h.id === A.id && h.pid > 0 && h.pid !== process.pid))
  const server1 = JSON.parse(readFileSync(join(app.getPath('userData'), 'claude-hooks', 'server.json'), 'utf8'))

  t1.shutdown('detach')
  await sleep(800)
  const t2 = new TerminalService(ccshell)
  const notices: Notice[] = []
  t2.on('notice', (n: Notice) => notices.push(n))
  const adopted = await t2.connectHost()
  const info = () => t2.list().find((x) => x.id === A.id)
  check('分离：客户端重新打开后接回还在运行的会话', adopted === 1 && info()?.status === 'running' && info()?.title === '分离甲', JSON.stringify(info()))
  check('分离：接回来时带着之前的画面', strip(t2.buffer(A.id)).length > 50)
  check('分离：从画面认出是空闲', await until(() => info()?.state === 'idle', 10_000), JSON.stringify(info()))
  await t2.hooks.settingsFile(A.id)
  const server2 = JSON.parse(readFileSync(join(app.getPath('userData'), 'claude-hooks', 'server.json'), 'utf8'))
  check('分离：hook 端口和口令沿用（旧会话接着能回报）', server1.port === server2.port && server1.token === server2.token, `${server1.port} → ${server2.port}`)
  await t2.typeText(A.id, '你好，接回来了', { clear: true, submit: true })
  check('分离：接回来的会话发话后 hook 照常回报（处理中 → 空闲）', (await until(() => info()?.state === 'busy', 20_000)) && (await until(() => info()?.state === 'idle', 30_000)), JSON.stringify(info()))

  const w1 = attachProc(t2.host.pipe, A.id, t2.host.ticket(A.id))
  check('分离：终端窗口连上后标着“在终端窗口里”', await until(() => info()?.detached === true, 10_000), JSON.stringify(info()))
  check('分离：终端窗口收到 Claude Code 的画面', await until(() => strip(w1.out()).length > 30, 10_000), strip(w1.out()).slice(0, 200))
  const w2 = attachProc(t2.host.pipe, A.id, t2.host.ticket(A.id))
  check('分离：同一个会话不能开两个终端窗口', await until(() => w2.exited() !== null, 10_000) && /已经在另一个终端窗口/.test(w2.out()), w2.out())
  const before = w1.out().length
  w1.proc.stdin!.write('终端窗口里打的字')
  await sleep(400)
  w1.proc.stdin!.write('\r')
  check('分离：终端窗口里打字能发给 Claude（开始处理）', await until(() => info()?.state === 'busy' || (info()?.state === 'idle' && w1.out().length > before + 200), 20_000), JSON.stringify(info()))
  await until(() => info()?.state === 'idle', 30_000)
  check('分离：客户端也看得到终端窗口里的输出', strip(t2.buffer(A.id)).includes('终端窗口里打的字'))

  t2.reclaim(A.id)
  check('分离：收回后终端窗口自己关掉（退出码 0）', (await until(() => w1.exited() !== null, 10_000)) && w1.exited() === 0, String(w1.exited()))
  check('分离：收回后回到客户端，会话还在运行', (await until(() => info()?.detached === false, 5000)) && info()?.status === 'running', JSON.stringify(info()))

  const w3 = attachProc(t2.host.pipe, A.id, t2.host.ticket(A.id))
  await until(() => info()?.detached === true, 10_000)
  await sleep(1500)
  w3.proc.kill()
  check('分离：关掉终端窗口后会话正常结束（/exit，退出码 0）', await until(() => info()?.status === 'exited', 20_000), JSON.stringify(info()))
  check('分离：关掉窗口结束不弹“出错退出”', info()?.exitCode === 0 && !notices.some((n) => n.kind === 'problem'), JSON.stringify(notices))
  check('分离：后台进程里不再有这个会话', !(await t2.host.list()).some((h) => h.id === A.id))

  const B = await t2.create({ cwd: proj, title: '分离乙', ...opts })
  await until(() => t2.list().find((x) => x.id === B.id)?.state === 'idle', 60_000)

  const pops = new Popouts(t2, () => null)
  const infoB = () => t2.list().find((x) => x.id === B.id)
  pops.open(B.id)
  const popWin = BrowserWindow.getAllWindows().find((w) => w.getTitle().includes('分离乙'))
  check('弹出：开了独立窗口，会话标着“在独立窗口里”', !!popWin && infoB()?.popout === true, popWin?.getTitle())
  const other = new BrowserWindow({ show: false })
  check('弹出：终端大小只听独立窗口（主窗口那份不算）', !!popWin && pops.resizeAllowed(B.id, popWin.webContents) && !pops.resizeAllowed(B.id, other.webContents))
  other.destroy()
  pops.open(B.id)
  check('弹出：同一个会话再弹出只是切到那个窗口', BrowserWindow.getAllWindows().filter((w) => w.getTitle().includes('分离乙')).length === 1)
  pops.close(B.id)
  check('弹出：关掉独立窗口放回主窗口，会话不中断', (await until(() => infoB()?.popout === false, 5000)) && infoB()?.status === 'running', JSON.stringify(infoB()))
  t2.shutdown('end')
  await sleep(500)
  check('分离：退出时“全部结束”会结束后台里的会话', await until(async () => !(await t2.host.list()).some((h) => h.id === B.id), 10_000))
  t2.remove(A.id)
  t2.remove(B.id)
  delete process.env.CCSHELL_DETACH_NOWINDOW
}
