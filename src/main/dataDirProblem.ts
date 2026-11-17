import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { devRendererUrl } from './windowGuard'

export function showDataDirProblem(dir: string): void {
  const win = new BrowserWindow({
    width: 560,
    height: 300,
    resizable: false,
    maximizable: false,
    minimizable: false,
    frame: false,
    show: false,
    title: 'CC Shell',
    icon: join(__dirname, '../../build/icon-180.png'),
    backgroundColor: '#f7f5ef',
    webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: true, contextIsolation: true, nodeIntegration: false }
  })
  win.once('ready-to-show', () => win.show())
  win.on('closed', () => app.quit())
  const hash = 'datadir=' + encodeURIComponent(dir)
  const dev = devRendererUrl()
  if (dev) void win.loadURL(dev + '#' + hash)
  else void win.loadFile(join(__dirname, '../renderer/index.html'), { hash })
}
