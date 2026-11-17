import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { connect, type Socket } from 'node:net'
import { join } from 'node:path'
import { app, nativeTheme } from 'electron'
import { configDir, prepareConfig } from './terminal/claude'
import { AgentService, inside } from './agent/service'
import { saveAttachmentFromPath } from './chat/attachments'
import { ChatService } from './chat/service'
import type { CcShellService } from './ccshell/service'
import { McpService } from './mcp/service'
import { registryUrl, settings } from './settings'
import { hostClient } from './terminal/hostClient'
import { frame, lineReader } from './terminal/hostProtocol'
import { pastedDir, savePastedImage } from './terminal/pasted'

type Check = (name: string, pass: boolean, detail?: string) => void

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function rawConn(pipe: string): Promise<{ sock: Socket; msgs: { t: string; [k: string]: unknown }[]; closed: () => boolean; send: (m: unknown) => void }> {
  return new Promise((resolve, reject) => {
    const sock = connect(pipe)
    const msgs: { t: string }[] = []
    let closed = false
    sock.on('data', lineReader((m) => msgs.push(m as { t: string })))
    sock.on('close', () => (closed = true))
    sock.once('error', reject)
    sock.once('connect', () => resolve({ sock, msgs: msgs as never, closed: () => closed, send: (m) => !sock.destroyed && sock.write(frame(m)) }))
  })
}

export async function stage7fSelfTest(ccshell: CcShellService, check: Check): Promise<void> {
  const host = hostClient()
  await host.connect(true)
  check('后台管道：管道名带密钥算出的一段（猜不到）', /\\ccshell-host-[0-9a-f]{16}-[0-9a-f]{16}$/.test(host.pipe), host.pipe)
  check('后台管道：客户端经双向认证连上', host.connected)
  check('后台管道：认证密钥用系统加密存在数据目录', existsSync(join(app.getPath('userData'), 'host.key')) && !/^[0-9a-f]{64}$/.test(readFileSync(join(app.getPath('userData'), 'host.key'), 'latin1')))

  const a = await rawConn(host.pipe)
  await sleep(300)
  check('后台管道：连上先收到挑战', a.msgs[0]?.t === 'challenge' && typeof a.msgs[0].nonce === 'string')
  a.send({ t: 'hello', role: 'main', n: 1, nonce: 'x', proof: 'bad' })
  await sleep(500)
  check('后台管道：证明不对的客户端被断开、拿不到回复', a.closed() && !a.msgs.some((m) => m.t === 'reply'), JSON.stringify(a.msgs))

  const b = await rawConn(host.pipe)
  b.send({ t: 'list', n: 1 })
  b.send({ t: 'spawn', n: 2, req: { id: 'evil', file: 'cmd.exe', args: [], cwd: 'C:\\', env: {}, cols: 80, rows: 24, meta: null } })
  await sleep(500)
  check('后台管道：不认证直接发 list / spawn 被断开', b.closed() && !b.msgs.some((m) => m.t === 'reply'), JSON.stringify(b.msgs))
  check('后台管道：没有起任何进程', !(await host.list()).some((s) => s.id === 'evil'))

  const c = await rawConn(host.pipe)
  c.send({ t: 'hello', role: 'attach', id: 'nobody', ticket: '9999999999999.abc.def', cols: 80, rows: 24 })
  await sleep(500)
  check('后台管道：伪造的终端窗口票据被拒绝', c.closed() && c.msgs.some((m) => m.t === 'error' && /票据/.test(String(m.error))), JSON.stringify(c.msgs))

  const ticket = host.ticket('nobody')
  const d = await rawConn(host.pipe)
  d.send({ t: 'hello', role: 'attach', id: 'nobody', ticket, cols: 80, rows: 24 })
  await sleep(500)
  check('后台管道：真的票据能用（会话不存在时照常提示）', !d.closed() && d.msgs.some((m) => m.t === 'error' && /已经结束/.test(String(m.error))), JSON.stringify(d.msgs))
  d.sock.destroy()
  const e = await rawConn(host.pipe)
  e.send({ t: 'hello', role: 'attach', id: 'nobody', ticket, cols: 80, rows: 24 })
  await sleep(500)
  check('后台管道：票据只能用一次', e.closed() && e.msgs.some((m) => m.t === 'error' && /票据/.test(String(m.error))), JSON.stringify(e.msgs))
  const f = await rawConn(host.pipe)
  f.send({ t: 'hello', role: 'attach', id: 'other', ticket: host.ticket('nobody'), cols: 80, rows: 24 })
  await sleep(500)
  check('后台管道：别的会话的票据不能用', f.closed(), JSON.stringify(f.msgs))
  for (const x of [a, b, c, e, f]) x.sock.destroy()

  const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex')
  mkdirSync(pastedDir(), { recursive: true })
  const old = join(pastedDir(), 'old.png')
  writeFileSync(old, png)
  const longAgo = new Date(Date.now() - 8 * 24 * 3600_000)
  utimesSync(old, longAgo, longAgo)
  const saved = savePastedImage(png, 'image/png')
  check('粘贴图片：存进客户端缓存目录，返回路径', saved.startsWith(pastedDir()) && saved.endsWith('.png') && readFileSync(saved).equals(png), saved)
  check('粘贴图片：7 天前的自动删掉', !existsSync(old))
  let bad = ''
  try {
    savePastedImage(png, 'application/x-msdownload')
  } catch (err) {
    bad = (err as Error).message
  }
  check('粘贴图片：只收图片', /只支持粘贴图片/.test(bad), bad)
  rmSync(saved, { force: true })

  const chat = new ChatService(ccshell, new McpService())
  chat.rememberSettings({ peers: true, model: 'claude-opus-5-5' })
  chat.rememberSettings({ peers: false })
  check('新对话参数：取消“会话协作”后记住了（切走再回来、重启后都不变）', chat.lastSettings().peers === false && chat.lastSettings().model === 'claude-opus-5-5')
  const conv = chat.create()
  check('新对话参数：之后新建的对话用的就是它', conv.settings.peers === false)
  chat.delete(conv.id)
  chat.rememberSettings({ peers: true })
  check('新对话参数：再勾上也记住', chat.lastSettings().peers === true)

  const ws = join(app.getPath('temp'), 'agent-ws')
  mkdirSync(ws, { recursive: true })
  const agentChat = new ChatService(ccshell, new McpService(), { agent: new AgentService() })
  const finish = async (id: string) => {
    for (let i = 0; i < 60 && (agentChat.get(id).messages.at(-1)?.role !== 'assistant' || agentChat.get(id).messages.at(-1)?.status === 'streaming'); i++) await sleep(250)
    return agentChat.get(id).messages.at(-1)
  }
  const conv2 = agentChat.create()
  agentChat.updateSettings(conv2.id, { model: 'claude-opus-5-5', thinking: 'off', peers: false, workspace: '' }, false)
  agentChat.send(conv2.id, '请假装调用', [])
  const r1 = await finish(conv2.id)
  check('文字工具调用：没开工具时不提示', r1?.status === 'done' && !r1.notices?.length && (r1.text ?? '').includes('<invoke'), JSON.stringify(r1).slice(0, 300))
  agentChat.updateSettings(conv2.id, { workspace: ws }, false)
  agentChat.send(conv2.id, '请假装调用', [])
  const r2 = await finish(conv2.id)
  check('文字工具调用：开了工具、模型却写成文字时提示换分组或关工具', r2?.status === 'done' && !!r2.notices?.some((n) => n.includes('写成了文字')), JSON.stringify(r2).slice(0, 400))
  agentChat.delete(conv2.id)
  rmSync(ws, { recursive: true, force: true })

  let httpErr = ''
  try {
    settings.update({ network: { registry: 'custom', customRegistry: 'http://registry.example.com/' } })
  } catch (err) {
    httpErr = (err as Error).message
  }
  check('npm 源：拒绝 http://', /https/.test(httpErr), httpErr)
  const stale = settings.get()
  check(
    'npm 源：以前存下的 http 源不用，退回官方源',
    registryUrl({ ...stale, network: { ...stale.network, registry: 'custom', customRegistry: 'http://registry.example.com/' } }) === 'https://registry.npmjs.org/'
  )
  settings.update({ network: { registry: 'official', customRegistry: '' } })

  const guided0 = settings.get().appearance.guidedUsers
  check('新手指引：默认没有账户走过', Array.isArray(guided0))
  settings.update({ appearance: { guidedUsers: [...guided0, 'http://a#1', 'http://a#1', 'http://b#1', 3 as unknown as string] } })
  const guided1 = settings.get().appearance.guidedUsers
  check('新手指引：记录去重、只留字符串，同一用户 ID 在不同服务器分开记', guided1.filter((x) => x === 'http://a#1').length === 1 && guided1.includes('http://b#1') && !guided1.some((x) => typeof x !== 'string'), JSON.stringify(guided1))
  settings.update({ appearance: { guidedUsers: guided0 } })

  const root = join(app.getPath('temp'), 'agent-root')
  const outside = join(app.getPath('temp'), 'agent-outside')
  rmSync(root, { recursive: true, force: true })
  rmSync(outside, { recursive: true, force: true })
  mkdirSync(join(root, 'sub'), { recursive: true })
  mkdirSync(outside, { recursive: true })
  writeFileSync(join(outside, 'secret.txt'), 'x')
  symlinkSync(outside, join(root, 'link'), 'junction')
  const blocked = (p: string) => {
    try {
      inside(root, p)
      return false
    } catch {
      return true
    }
  }
  check('Agent 路径：普通文件、要新建的文件照常', !blocked('sub/a.txt') && !blocked('new/dir/b.txt') && !blocked('.'))
  check('Agent 路径：../ 跳出去拒绝', blocked('../agent-outside/secret.txt'))
  check('Agent 路径：经目录联接读外面的文件拒绝', blocked('link/secret.txt'))
  check('Agent 路径：经目录联接在外面新建文件拒绝', blocked('link/new.txt') && blocked('link'))
  rmSync(root, { recursive: true, force: true })
  rmSync(outside, { recursive: true, force: true })

  const themeOf = () => JSON.parse(readFileSync(join(configDir('ccshell'), '.claude.json'), 'utf8')).theme
  const cwdT = join(app.getPath('temp'), 'theme-cwd')
  mkdirSync(cwdT, { recursive: true })
  const was = nativeTheme.themeSource
  nativeTheme.themeSource = 'light'
  prepareConfig(cwdT, null)
  const light = themeOf()
  nativeTheme.themeSource = 'dark'
  prepareConfig(cwdT, null)
  const dark = themeOf()
  nativeTheme.themeSource = was
  check('Claude Code 配色：浅色主题用 light、深色主题用 dark', light === 'light' && dark === 'dark', `${light} / ${dark}`)

  const big = join(app.getPath('temp'), 'big.bin')
  writeFileSync(big, Buffer.alloc(1024))
  let attErr = ''
  try {
    saveAttachmentFromPath(big)
  } catch (err) {
    attErr = (err as Error).message
  }
  check('附件：不支持的类型直接报错', /不支持的文件类型/.test(attErr), attErr)
  rmSync(big, { force: true })
}
