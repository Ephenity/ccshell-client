import { join } from 'node:path'
import { BrowserWindow, screen, type WebContents } from 'electron'
import type { TerminalSession } from '../../shared/terminal'
import { log } from '../log'
import { settings } from '../settings'
import type { TerminalService } from './service'
import { devRendererUrl } from '../windowGuard'

const STATE: Record<TerminalSession['state'], string> = {
  starting: '启动中',
  idle: '空闲',
  busy: '处理中',
  waiting: '等待确认',
  error: '出错',
  running: '运行中',
  exited: '已结束'
}

export class Popouts {
  private readonly wins = new Map<string, BrowserWindow>()

  constructor(
    private readonly term: TerminalService,
    private readonly mainWindow: () => BrowserWindow | null
  ) {
    term.on('list', (list) => {
      for (const [id, win] of this.wins) {
        const s = list.find((x) => x.id === id)
        if (!s) win.close()
        else if (!win.isDestroyed()) win.setTitle(`${s.title} · ${STATE[s.state]} — CC Shell`)
      }
    })
    term.on('removed', (id) => this.wins.get(id)?.close())
  }

  resizeAllowed(id: string, sender: WebContents): boolean {
    const win = this.wins.get(id)
    return !win || win.isDestroyed() || win.webContents === sender
  }

  open(id: string): void {
    const s = this.term.list().find((x) => x.id === id)
    if (!s) throw new Error('终端会话不存在')
    const old = this.wins.get(id)
    if (old && !old.isDestroyed()) {
      if (old.isMinimized()) old.restore()
      old.focus()
      return
    }
    const saved = settings.get().popout
    const wa = screen.getDisplayMatching(this.mainWindow()?.getBounds() ?? screen.getPrimaryDisplay().bounds).workArea
    const width = Math.min(saved.width, wa.width)
    const height = Math.min(saved.height, wa.height)
    const win = new BrowserWindow({
      width,
      height,
      x: wa.x + Math.round((wa.width - width) / 2) + this.wins.size * 28,
      y: wa.y + Math.round((wa.height - height) / 2) + this.wins.size * 28,
      minWidth: 520,
      minHeight: 320,
      title: `${s.title} — CC Shell`,
      icon: join(__dirname, '../../build/icon-180.png'),
      autoHideMenuBar: true,
      webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: true, contextIsolation: true, nodeIntegration: false }
    })
    win.setMenu(null)
    this.wins.set(id, win)
    win.on('resized', () => {
      const [w, h] = win.getSize()
      settings.update({ popout: { width: w, height: h } })
    })
    win.on('closed', () => {
      if (this.wins.get(id) === win) this.wins.delete(id)
      this.term.setPopout(id, false)
      log('会话', `${s.title}：独立窗口关了，放回主窗口`)
    })
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    const hash = `popout=${encodeURIComponent(id)}`
    const dev = devRendererUrl()
    if (dev) void win.loadURL(`${dev}#${hash}`)
    else void win.loadFile(join(__dirname, '../renderer/index.html'), { hash })
    this.term.setPopout(id, true)
    log('会话', `${s.title}：弹出到独立窗口`)
  }

  close(id: string): void {
    const win = this.wins.get(id)
    if (win && !win.isDestroyed()) win.close()
  }

  focusMain(): void {
    const w = this.mainWindow()
    if (!w) return
    if (w.isMinimized()) w.restore()
    w.show()
    w.focus()
  }
}
