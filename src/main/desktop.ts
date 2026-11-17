import { join } from 'node:path'
import { app, BrowserWindow, globalShortcut, ipcMain, nativeImage, screen, Tray, type NativeImage } from 'electron'
import type { Notice, TerminalSession } from '../shared/terminal'
import { log } from './log'
import { settings } from './settings'
import type { TerminalService } from './terminal/service'
import { devRendererUrl } from './windowGuard'

const TRAY_ICONS: [number, string][] = [
  [1, 'tray-16.png'],
  [1.5, 'tray-24.png'],
  [2, 'tray-32.png']
]
const TRAY_MENU_WIDTH = 276
const TOAST_WIDTH = 412
const FLOAT_WIDTH = 300
const DONE_DEDUPE_MS = 15_000
const SOUND_GAP_MS = 4_000

let quitting = false
export const isQuitting = () => quitting
export function cancelQuit(): void {
  quitting = false
}
export function quitApp(): void {
  quitting = true
  app.quit()
}

function loadPage(win: BrowserWindow, hash: string): void {
  const dev = devRendererUrl()
  if (dev) void win.loadURL(`${dev}#${hash}`)
  else void win.loadFile(join(__dirname, '../renderer/index.html'), { hash })
}

function withDot(img: NativeImage): NativeImage {
  const size = img.getSize()
  const bmp = Buffer.from(img.toBitmap())
  const r = Math.max(3, Math.round(size.width * 0.22))
  const cx = size.width - r - 0.5
  const cy = r - 0.5
  for (let y = 0; y < size.height; y++)
    for (let x = 0; x < size.width; x++) {
      const d = Math.hypot(x - cx, y - cy)
      if (d > r + 1) continue
      const i = (y * size.width + x) * 4
      const ring = d > r - 0.5
      bmp[i] = ring ? 255 : 58
      bmp[i + 1] = ring ? 255 : 68
      bmp[i + 2] = ring ? 255 : 229
      bmp[i + 3] = 255
    }
  return nativeImage.createFromBitmap(bmp, size)
}

export class Desktop {
  private tray: Tray | null = null
  private toast: BrowserWindow | null = null
  private toastReady = false
  private toastQueue: (Notice & { sound: boolean })[] = []
  private float: BrowserWindow | null = null
  private lastDone = new Map<string, number>()
  private sessions: TerminalSession[] = []
  private activeSession: string | null = null
  private hotkey = ''
  hotkeyError: string | null = null
  private trayMenu: BrowserWindow | null = null
  private trayMenuHeight = 200
  private trayIcons: { plain: NativeImage; dot: NativeImage } | null = null

  constructor(
    private readonly getWindow: () => BrowserWindow | null,
    private readonly term: TerminalService
  ) {}

  init(): void {
    app.on('before-quit', () => (quitting = true))
    this.sessions = this.term.list()
    this.term.on('list', (list) => {
      this.sessions = list
      this.refreshTray()
      this.refreshBadge()
    })
    this.hookWindow()
    this.term.on('notice', (n) => this.notify(n))

    ipcMain.on('ui:active-session', (_e, id: string | null) => (this.activeSession = id))
    ipcMain.on('toast:ready', () => {
      this.toastReady = true
      for (const n of this.toastQueue.splice(0)) this.toast?.webContents.send('toast:add', n)
    })
    ipcMain.on('toast:resize', (_e, height: number) => this.placeToast(height))
    ipcMain.on('toast:click', (_e, sessionId?: string) => this.openSession(sessionId))
    ipcMain.on('float:open-session', (_e, id: string) => this.openSession(id))
    ipcMain.on('float:resize', (_e, height: number) => {
      if (!this.float) return
      const b = this.float.getBounds()
      this.float.setBounds({ ...b, width: FLOAT_WIDTH, height: Math.max(40, Math.min(600, Math.round(height))) })
    })
    ipcMain.on('float:close', () => settings.update({ float: { enabled: false } }))
    ipcMain.on('float:collapse', (_e, collapsed: boolean) => settings.update({ float: { collapsed } }))
    if (__TEST_HOOKS__) ipcMain.handle('notify:test', () => {
      this.notify({ id: String(Date.now()), kind: 'done', title: '测试通知：回答完成', body: '这是一条测试通知。\n点击返回客户端。', at: Date.now() }, true)
      setTimeout(() => this.notify({ id: String(Date.now() + 1), kind: 'attention', title: '测试通知：需要处理', body: '请求使用：Bash · npm run build', at: Date.now() }, true), 600)
      setTimeout(() => this.notify({ id: String(Date.now() + 2), kind: 'problem', title: '测试通知：异常', body: '本轮回答出错：rate_limit_error', at: Date.now() }, true), 1200)
      return { ok: true, data: null }
    })
    ipcMain.handle('hotkey:status', () => ({ ok: true, data: { key: this.hotkey, error: this.hotkeyError } }))

    this.createTray()
    this.applySettings()
    settings.on('changed', () => this.applySettings())
    app.on('will-quit', () => globalShortcut.unregisterAll())
  }

  private applySettings(): void {
    const s = settings.get()
    if (s.float.enabled) this.showFloat()
    else if (this.float) {
      this.float.destroy()
      this.float = null
    }
    this.float?.webContents.send('float:collapsed', s.float.collapsed)
    if (s.hotkey.global !== this.hotkey || this.hotkeyError) {
      if (this.hotkey) globalShortcut.unregister(this.hotkey)
      this.hotkey = ''
      this.hotkeyError = null
      if (s.hotkey.global) {
        let ok = false
        try {
          ok = globalShortcut.register(s.hotkey.global, () => this.toggleWindow())
        } catch {
          ok = false
        }
        if (ok) this.hotkey = s.hotkey.global
        else {
          this.hotkeyError = `${s.hotkey.global} 注册失败（可能已被其他程序占用，或格式无效）`
          log('设置', this.hotkeyError)
        }
      }
    }
    this.refreshTray()
  }

  showWindow(): BrowserWindow | null {
    const win = this.getWindow()
    if (!win) return null
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
    return win
  }

  private toggleWindow(): void {
    const win = this.getWindow()
    if (!win) return
    if (win.isVisible() && win.isFocused() && !win.isMinimized()) {
      if (settings.get().appearance.closeToTray) win.hide()
      else win.minimize()
    } else this.showWindow()
  }

  openSession(id?: string): void {
    const win = this.showWindow()
    if (win && id) win.webContents.send('ui:open-session', id)
  }

  notify(n: Notice, force = false): void {
    const s = settings.get().notify
    const kind = n.kind === 'info' ? 'done' : n.kind
    if (!force && !s[kind]) return
    if (!force && n.kind === 'done' && n.sessionId) {
      const last = this.lastDone.get(n.sessionId) ?? 0
      if (Date.now() - last < DONE_DEDUPE_MS) return
      this.lastDone.set(n.sessionId, Date.now())
      const win = this.getWindow()
      if (win?.isFocused() && this.activeSession === n.sessionId) return
    }
    log('通知', `${n.title} — ${n.body.split('\n')[0]}`)
    const win = this.getWindow()
    if ((n.kind === 'attention' || n.kind === 'problem') && win && !win.isFocused()) win.flashFrame(true)
    const now = Date.now()
    const sound = s.sound && now - this.lastSound > SOUND_GAP_MS
    if (sound) this.lastSound = now
    const payload = { ...n, sound }
    this.ensureToast()
    this.raiseToast = true
    if (this.toastReady) this.toast!.webContents.send('toast:add', payload)
    else {
      this.toastQueue.push(payload)
      log('通知', '卡片窗口还没准备好，排队')
    }
  }

  private ensureToast(): void {
    if (this.toast && !this.toast.isDestroyed()) return
    this.toastReady = false
    this.toast = new BrowserWindow({
      width: TOAST_WIDTH,
      height: 10,
      show: false,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      focusable: false,
      hasShadow: false,
      webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: true, contextIsolation: true, autoplayPolicy: 'no-user-gesture-required', backgroundThrottling: false }
    })
    this.toast.setAlwaysOnTop(true, 'pop-up-menu')
    this.toast.on('closed', () => (this.toast = null))
    this.toast.webContents.on('render-process-gone', (_e, d) => {
      log('通知', `卡片窗口页面退出（${d.reason}），下次重建`)
      if (this.toast && !this.toast.isDestroyed()) this.toast.destroy()
      this.toast = null
      this.toastReady = false
    })
    loadPage(this.toast, 'toast')
  }

  private raiseToast = false
  private placeToast(height: number): void {
    const t = this.toast
    if (!t || t.isDestroyed()) return
    if (height <= 0) {
      t.hide()
      return
    }
    const wa = screen.getPrimaryDisplay().workArea
    const h = Math.min(Math.round(height), wa.height)
    t.setBounds({ x: wa.x + wa.width - TOAST_WIDTH, y: wa.y + wa.height - h, width: TOAST_WIDTH, height: h })
    const wasVisible = t.isVisible()
    if (!wasVisible) t.showInactive()
    if (this.raiseToast) {
      this.raiseToast = false
      t.setAlwaysOnTop(true, 'pop-up-menu')
      t.moveTop()
      log('通知', `卡片显示：${wasVisible ? '已在显示，提到最上面' : '显示'}，高 ${h}，位置 ${t.getBounds().x},${t.getBounds().y}，可见 ${t.isVisible()}，置顶 ${t.isAlwaysOnTop()}`)
    }
  }

  private icons(): { plain: NativeImage; dot: NativeImage } {
    if (this.trayIcons) return this.trayIcons
    const build = (dot: boolean) => {
      const img = nativeImage.createEmpty()
      for (const [scaleFactor, file] of TRAY_ICONS) {
        let rep = nativeImage.createFromPath(join(__dirname, '../../build', file))
        if (rep.isEmpty()) continue
        if (dot) rep = withDot(rep)
        const { width, height } = rep.getSize()
        img.addRepresentation({ scaleFactor, width, height, buffer: rep.toPNG() })
      }
      return img
    }
    this.trayIcons = { plain: build(false), dot: build(true) }
    return this.trayIcons
  }

  private createTray(): void {
    if (this.tray) return
    this.tray = new Tray(this.icons().plain)
    this.tray.on('click', () => this.showWindow())
    this.tray.on('right-click', () => this.showTrayMenu())
    ipcMain.on('tray:resize', (_e, height: number) => {
      this.trayMenuHeight = Math.max(80, Math.min(640, Math.round(height)))
      if (this.trayMenu?.isVisible()) this.placeTrayMenu()
    })
    ipcMain.on('tray:hide', () => this.trayMenu?.hide())
    ipcMain.on('tray:show-window', () => {
      this.trayMenu?.hide()
      this.showWindow()
    })
    ipcMain.on('tray:open-session', (_e, id: string) => {
      this.trayMenu?.hide()
      this.openSession(id)
    })
    ipcMain.on('tray:quit', () => {
      this.trayMenu?.hide()
      quitApp()
    })
    this.ensureTrayMenu()
    this.refreshTray()
  }

  private ensureTrayMenu(): BrowserWindow {
    if (this.trayMenu && !this.trayMenu.isDestroyed()) return this.trayMenu
    const win = new BrowserWindow({
      width: TRAY_MENU_WIDTH,
      height: this.trayMenuHeight,
      show: false,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      hasShadow: false,
      webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: true, contextIsolation: true }
    })
    win.setAlwaysOnTop(true, 'pop-up-menu')
    win.on('blur', () => win.hide())
    win.on('closed', () => (this.trayMenu = null))
    loadPage(win, 'tray')
    this.trayMenu = win
    return win
  }

  private placeTrayMenu(): void {
    const win = this.trayMenu
    if (!win || win.isDestroyed()) return
    const p = screen.getCursorScreenPoint()
    const wa = screen.getDisplayNearestPoint(p).workArea
    const w = TRAY_MENU_WIDTH
    const h = Math.min(this.trayMenuHeight, wa.height - 8)
    let x = p.x - w + 12
    let y = p.y - h - 4
    if (p.y < wa.y + wa.height / 2) y = p.y + 4
    x = Math.max(wa.x + 4, Math.min(x, wa.x + wa.width - w - 4))
    y = Math.max(wa.y + 4, Math.min(y, wa.y + wa.height - h - 4))
    win.setBounds({ x, y, width: w, height: h })
  }

  private showTrayMenu(): void {
    const win = this.ensureTrayMenu()
    this.placeTrayMenu()
    win.webContents.send('tray:shown')
    win.show()
    win.focus()
  }

  private attentionCount(): number {
    return this.sessions.filter((s) => s.status === 'running' && (s.state === 'waiting' || s.state === 'error' || s.stuck)).length
  }

  private refreshTray(): void {
    if (!this.tray) return
    const count = this.attentionCount()
    this.tray.setImage(count ? this.icons().dot : this.icons().plain)
    const running = this.sessions.filter((s) => s.status === 'running')
    const busy = running.filter((s) => s.state === 'busy').length
    this.tray.setToolTip(`CC Shell${running.length ? `\n${running.length} 个会话，${busy} 个处理中${count ? `，${count} 个需要处理` : ''}` : ''}`)
  }

  private lastSound = 0
  private lastAttention = 0
  private hooked = new WeakSet<BrowserWindow>()
  private hookWindow(): BrowserWindow | null {
    const win = this.getWindow()
    if (!win || win.isDestroyed() || this.hooked.has(win)) return win
    this.hooked.add(win)
    win.setOverlayIcon(null, '')
    win.on('focus', () => !win.isDestroyed() && win.flashFrame(false))
    return win
  }
  private refreshBadge(): void {
    const win = this.hookWindow()
    if (!win || win.isDestroyed()) return
    const count = this.attentionCount()
    if (count > this.lastAttention && !win.isFocused()) win.flashFrame(true)
    if (!count) win.flashFrame(false)
    this.lastAttention = count
  }

  private showFloat(): void {
    if (this.float && !this.float.isDestroyed()) return
    const s = settings.get().float
    const wa = screen.getPrimaryDisplay().workArea
    const onScreen = s.x !== undefined && s.y !== undefined && screen.getAllDisplays().some((d) => s.x! >= d.workArea.x && s.x! < d.workArea.x + d.workArea.width && s.y! >= d.workArea.y && s.y! < d.workArea.y + d.workArea.height)
    this.float = new BrowserWindow({
      width: FLOAT_WIDTH,
      height: 120,
      x: onScreen ? s.x : wa.x + wa.width - FLOAT_WIDTH - 16,
      y: onScreen ? s.y : wa.y + 16,
      show: false,
      frame: false,
      transparent: true,
      resizable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      focusable: false,
      hasShadow: false,
      webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: true, contextIsolation: true }
    })
    this.float.setAlwaysOnTop(true, 'floating')
    this.float.once('ready-to-show', () => this.float?.showInactive())
    this.float.on('moved', () => {
      const b = this.float?.getBounds()
      if (b) settings.update({ float: { x: b.x, y: b.y } })
    })
    this.float.on('closed', () => (this.float = null))
    loadPage(this.float, 'float')
  }

  dispose(): void {
    this.tray?.destroy()
    this.tray = null
    if (this.trayMenu && !this.trayMenu.isDestroyed()) this.trayMenu.destroy()
    this.trayMenu = null
  }
}
