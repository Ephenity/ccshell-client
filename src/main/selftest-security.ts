import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { app, BrowserWindow } from 'electron'
import type { CcShellService } from './ccshell/service'
import { ConversationStore } from './chat/store'
import { KnowledgeService } from './knowledge/service'
import { openFolder } from './terminal/ipc'
import { devRendererUrl } from './windowGuard'

type Check = (name: string, pass: boolean, detail?: string) => void

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function rejects(fn: () => Promise<unknown> | unknown): Promise<string | null> {
  try {
    await fn()
    return null
  } catch (e) {
    return (e as Error).message
  }
}

export async function securitySelfTest(ccshell: CcShellService, check: Check): Promise<void> {
  let e = await rejects(() => openFolder(process.execPath))
  check('安全：打开目录拒绝程序文件', !!e, e ?? '没有报错')
  e = await rejects(() => openFolder('relative\\dir'))
  check('安全：打开目录拒绝相对路径', !!e, e ?? '没有报错')
  e = await rejects(() => openFolder(join(app.getPath('userData'), 'no-such-dir-xyz')))
  check('安全：打开目录拒绝不存在的路径', !!e, e ?? '没有报错')
  e = await rejects(() => openFolder(123 as unknown as string))
  check('安全：打开目录拒绝非字符串', !!e, e ?? '没有报错')

  const probe = join(app.getPath('userData'), 'guard-probe.json')
  writeFileSync(probe, '{}')
  new ConversationStore().delete('../guard-probe')
  check('安全：删对话不按拼出来的路径删文件', existsSync(probe))
  const kb = new KnowledgeService(ccshell)
  const base = kb.create({ name: '安全自测', description: '', embeddingModel: '' })
  const kbProbe = join(app.getPath('userData'), 'knowledge', 'guard-probe.json')
  mkdirSync(join(app.getPath('userData'), 'knowledge'), { recursive: true })
  writeFileSync(kbProbe, '{}')
  e = await rejects(() => kb.removeItem(base.id, '../../guard-probe'))
  check('安全：删知识库条目拒绝不存在的条目', !!e && existsSync(kbProbe), e ?? '没有报错')
  kb.remove(base.id)
  rmSync(probe, { force: true })
  rmSync(kbProbe, { force: true })

  const saved = process.env.ELECTRON_RENDERER_URL
  process.env.ELECTRON_RENDERER_URL = 'http://127.0.0.1:9/evil'
  const got = devRendererUrl()
  if (saved === undefined) delete process.env.ELECTRON_RENDERER_URL
  else process.env.ELECTRON_RENDERER_URL = saved
  check(
    `安全：${app.isPackaged ? '打包版不认' : '开发版才认'}开发服务器地址`,
    app.isPackaged ? got === undefined : got === 'http://127.0.0.1:9/evil',
    String(got)
  )

  const dir = join(app.getPath('temp'), 'ccshell-guard')
  mkdirSync(dir, { recursive: true })
  const pageA = join(dir, 'a.html')
  const pageB = join(dir, 'b.html')
  writeFileSync(pageA, '<!doctype html><title>A</title>A')
  writeFileSync(pageB, '<!doctype html><title>B</title>B')
  const tryLeave = async (win: BrowserWindow) => {
    await win.loadFile(pageA)
    await win.webContents.executeJavaScript(`location.href = ${JSON.stringify(pathToFileURL(pageB).href)}; 1`)
    await sleep(800)
    return win.webContents.getURL()
  }
  const guarded = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true } })
  try {
    const url = await tryLeave(guarded)
    check('安全：客户端窗口不能跳转到别的页面', url.endsWith('/a.html'), url)
    const opened = await guarded.webContents.executeJavaScript(`window.open('about:blank') === null`)
    const extra = BrowserWindow.getAllWindows().filter((w) => w !== guarded && w.webContents.getURL() === 'about:blank')
    check('安全：客户端窗口不能开新窗口', opened === true && extra.length === 0, `null=${opened} 新窗口=${extra.length}`)
    extra.forEach((w) => w.destroy())
  } finally {
    guarded.destroy()
  }
  const free = new BrowserWindow({ show: false, webPreferences: { partition: 'selftest-guard', sandbox: true, contextIsolation: true } })
  try {
    const url = await tryLeave(free)
    check('安全：独立分区的窗口照常跳转', url.endsWith('/b.html'), url)
  } finally {
    free.destroy()
  }
  rmSync(dir, { recursive: true, force: true })
}
