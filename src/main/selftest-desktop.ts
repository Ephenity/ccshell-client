import { EventEmitter } from 'node:events'
import { BrowserWindow, ipcMain, screen } from 'electron'
import { Desktop } from './desktop'
import type { TerminalService } from './terminal/service'

type Check = (name: string, pass: boolean, detail?: string) => void

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function waitFor(fn: () => boolean | Promise<boolean>, ms = 8000): Promise<boolean> {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (await fn()) return true
    await sleep(50)
  }
  return false
}

export async function desktopSelfTest(check: Check): Promise<void> {
  const term = Object.assign(new EventEmitter(), { list: () => [] }) as unknown as TerminalService
  const main = new BrowserWindow({ show: false, width: 400, height: 300 })
  const sent: unknown[][] = []
  main.webContents.send = (channel: string, ...args: unknown[]) => void sent.push([channel, ...args])
  main.focus = () => undefined
  const d = new Desktop(() => main, term)
  d.showWindow = () => main
  const inner = d as any
  d.init()
  try {
    const toastWin = () => inner.toast as BrowserWindow | null
    const js = <T>(code: string) => toastWin()!.webContents.executeJavaScript(code) as Promise<T>
    const cards = () => js<number>(`document.querySelectorAll('[role=button]').length`)
    const press = (index: number, close: boolean) =>
      js<void>(`(() => { const c = document.querySelectorAll('[role=button]')[${index}]; const el = ${close} ? c.querySelector('button') : c; el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 })) })()`)

    const notice = (id: string, sessionId?: string) => d.notify({ id, kind: 'done', title: `自测通知 ${id}`, body: '正文', at: Date.now(), sessionId }, true)
    notice('a', 'sess-a')
    let ok = await waitFor(() => !!toastWin()?.isVisible())
    const b1 = toastWin()?.getBounds()
    const wa = screen.getPrimaryDisplay().workArea
    check('通知：卡片窗口贴在主屏工作区右下角', ok && !!b1 && b1.x + b1.width === wa.x + wa.width && b1.y + b1.height === wa.y + wa.height, JSON.stringify(b1))
    notice('b', 'sess-b')
    notice('c')
    await waitFor(async () => (await cards()) === 3)
    await sleep(300)
    const b2 = toastWin()?.getBounds()
    check('通知：卡片变多时窗口不挪不变大小', JSON.stringify(b1) === JSON.stringify(b2), `${JSON.stringify(b1)} → ${JSON.stringify(b2)}`)
    const layout = await js<{ bottom: number; inner: number }>(`(() => { const r = document.querySelector('[role=button]').parentElement.getBoundingClientRect(); return { bottom: Math.round(r.bottom), inner: innerHeight } })()`)
    check('通知：卡片贴着窗口底部叠放', Math.abs(layout.bottom - layout.inner) <= 1, JSON.stringify(layout))
    const realCursor = screen.getCursorScreenPoint
    const b = toastWin()!.getBounds()
    screen.getCursorScreenPoint = () => ({ x: b.x + 200, y: b.y + b.height - 40 })
    inner.trackToastMouse()
    const onCard = inner.toastCapture
    screen.getCursorScreenPoint = () => ({ x: b.x + 200, y: b.y + 5 })
    inner.trackToastMouse()
    const onBlank = inner.toastCapture
    screen.getCursorScreenPoint = realCursor
    check('通知：光标在卡片上接收鼠标、在空白处穿过去', onCard === true && onBlank === false, `卡片上 ${onCard}，空白处 ${onBlank}`)

    await sleep(400)
    sent.length = 0
    await press(0, false)
    await press(0, false)
    ok = await waitFor(async () => (await cards()) === 2)
    await sleep(200)
    const opened = sent.filter((x) => x[0] === 'ui:open-session')
    check('通知：按下卡片打开对应会话', ok && opened.length === 1 && opened[0][1] === 'sess-a', JSON.stringify(sent))
    check('通知：重复送来的按下只算一次', (await cards()) === 2)

    await sleep(400)
    sent.length = 0
    await press(1, true)
    ok = await waitFor(async () => (await cards()) === 1)
    check('通知：按下关闭只关卡片、不打开会话', ok && !sent.some((x) => x[0] === 'ui:open-session'), JSON.stringify(sent))

    await sleep(400)
    const old = toastWin()
    await press(0, true)
    ok = await waitFor(() => !old || old.isDestroyed() || !old.isVisible(), 3000)
    check('通知：没有卡片时隐藏窗口', ok)
    ok = await waitFor(() => !old || old.isDestroyed(), 8000)
    check('通知：空了一会儿后销毁卡片窗口', ok && inner.toast === null)
    notice('d', 'sess-d')
    ok = await waitFor(() => !!toastWin()?.isVisible() && toastWin() !== old)
    check('通知：下一条通知重新建窗口并显示', ok && (await cards()) === 1)

    inner.showTrayMenu()
    const menu = inner.trayMenu as BrowserWindow
    await waitFor(() => menu.isVisible(), 3000)
    const m1 = menu.getBounds()
    const moved = { x: m1.x - 200, y: m1.y - 150 }
    const real = screen.getCursorScreenPoint
    screen.getCursorScreenPoint = () => moved
    inner.placeTrayMenu()
    const m2 = menu.getBounds()
    screen.getCursorScreenPoint = real
    check('托盘菜单：重新定位用右键时的位置，不跟着鼠标', m1.x === m2.x && m1.y === m2.y, `${JSON.stringify(m1)} → ${JSON.stringify(m2)}`)
    const before = inner.trayMenuHeight
    let placed = 0
    const place = inner.placeTrayMenu.bind(inner)
    inner.placeTrayMenu = () => {
      placed++
      place()
    }
    ipcMain.emit('tray:resize', { sender: menu.webContents }, before)
    check('托盘菜单：高度没变时不重新定位', placed === 0, `重新定位 ${placed} 次`)
    menu.hide()
  } catch (e) {
    check('桌面自测异常', false, (e as Error).stack ?? String(e))
  } finally {
    d.dispose()
    const t = inner.toast as BrowserWindow | null
    if (t && !t.isDestroyed()) t.destroy()
    if (inner.toastMouseTimer) clearInterval(inner.toastMouseTimer)
    if (inner.toastIdle) clearTimeout(inner.toastIdle)
    main.destroy()
  }
}
