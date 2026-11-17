import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import type { CcShellService } from './ccshell/service'
import type { TerminalService } from './terminal/service'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const until = async (cond: () => boolean, ms: number) => {
  const t0 = Date.now()
  while (!cond() && Date.now() - t0 < ms) await sleep(200)
  return cond()
}

export async function quitTest(ccshell: CcShellService, terminals: TerminalService, mockUrl: string): Promise<void> {
  const out = join(app.getPath('userData'), '..', 'quittest.txt')
  writeFileSync(out, '')
  const say = (t: string) => appendFileSync(out, `${new Date().toISOString()} ${t}\n`)
  try {
    await ccshell.setBaseUrl(mockUrl + '/')
    await ccshell.login('user', 'user')
    const proj = join(app.getPath('temp'), 'quit-proj')
    mkdirSync(proj, { recursive: true })
    const n = Number(process.env.CCSHELL_QUITTEST_N ?? '1')
    const ids: string[] = []
    for (let i = 0; i < n; i++) {
      const s = await terminals.create({ cwd: proj, model: 'claude-opus-5-5', allModels: true })
      terminals.resize(s.id, 120, 40)
      ids.push(s.id)
    }
    for (const id of ids) {
      const ok = await until(() => /❯|for shortcuts|Try "/.test(terminals.buffer(id)), 30_000)
      say(`会话 ${id} 起来了: ${ok}`)
      terminals.write(id, '请帮我卡住一下')
      await sleep(500)
      terminals.write(id, '\r')
    }
    for (const id of ids) {
      const busy = await until(() => terminals.list().find((x) => x.id === id)?.state === 'busy', 15_000)
      say(`会话 ${id} 处理中: ${busy}`)
    }
    await sleep(2000)
  } catch (e) {
    say(`出错: ${(e as Error).message}`)
  }
  say('调用 app.quit()')
  app.on('will-quit', () => say('will-quit'))
  app.on('quit', () => say('quit'))
  app.quit()
}
