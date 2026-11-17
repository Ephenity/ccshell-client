import { testEnv } from './testhooks'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, BrowserWindow, dialog, ipcMain, nativeTheme, shell } from 'electron'
import { TITLE_BAR_HEIGHT, dimColor, overlayColors, titleBarColors, type ThemeName } from '../shared/theme'
import { registerCcShellIpc } from './ccshell/ipc'
import { CcShellService } from './ccshell/service'
import { handleAttachmentProtocol, registerAttachmentScheme } from './chat/attachments'
import { registerChatIpc } from './chat/ipc'
import { ChatService } from './chat/service'
import { AgentService } from './agent/service'
import { AssistantStore } from './assistant/store'
import { KnowledgeService } from './knowledge/service'
import { registerStage6Ipc } from './stage6Ipc'
import { registerMcpIpc } from './mcp/ipc'
import { McpService } from './mcp/service'
import { dataDirProblem, relocateAppPaths } from './paths'
import { showDataDirProblem } from './dataDirProblem'
import { registerTerminalIpc } from './terminal/ipc'
import { TerminalService } from './terminal/service'
import { Popouts } from './terminal/popout'
import { ClaudeInstaller } from './terminal/installer'
import { attachCloseToTray, registerAppShell } from './appShell'
import { cancelQuit, Desktop, isQuitting } from './desktop'
import { settings } from './settings'
import { Cleaner } from './cleanup'
import { registerMaintenanceIpc } from './maintenanceIpc'
import { log } from './log'
import { devRendererUrl, guardWindows } from './windowGuard'
import { PromptStore } from './prompts'
import { registerQueueIpc } from './queueIpc'
import { PeerService } from './terminal/peers'
import { QueueService } from './terminal/queue'
import { hostClient } from './terminal/hostClient'
import { registerUpdateIpc, UpdateService } from './updater'

relocateAppPaths()
guardWindows()
registerAttachmentScheme()
if (dataDirProblem) void app.whenReady().then(() => showDataDirProblem(dataDirProblem!))

if (!app.requestSingleInstanceLock()) app.quit()

let mainWindow: BrowserWindow | null = null

let shouldAskBeforeClose: () => boolean = () => false

async function askQuit(n: number): Promise<'detach' | 'end' | null> {
  const win = mainWindow
  if (win && !win.isDestroyed()) {
    if (win.isMinimized()) win.restore()
    if (!win.isVisible()) win.show()
    win.focus()
    const id = String(Date.now())
    const answer = await new Promise<{ choice: 'detach' | 'end' | null; remember: boolean } | null>((resolve) => {
      const onAnswer = (_e: Electron.IpcMainEvent, rid: string, a: { choice: 'detach' | 'end' | null; remember: boolean }) => {
        if (rid !== id) return
        done(a)
      }
      const onGone = () => done(null)
      const done = (a: { choice: 'detach' | 'end' | null; remember: boolean } | null) => {
        ipcMain.off('quit:answer', onAnswer)
        win.off('closed', onGone)
        resolve(a)
      }
      ipcMain.on('quit:answer', onAnswer)
      win.once('closed', onGone)
      win.webContents.send('quit:ask', { id, count: n })
    })
    const choice = answer?.choice ?? null
    if (!choice) return null
    if (answer?.remember) settings.update({ appearance: { onQuit: choice } })
    log('客户端', `退出时选了：${choice === 'detach' ? '分离到终端' : '全部结束'}${answer?.remember ? '（以后不再询问）' : ''}`)
    return choice
  }
  return askQuitNative(null, n)
}

async function askQuitNative(parent: BrowserWindow | null, n: number): Promise<'detach' | 'end' | null> {
  const options: Electron.MessageBoxOptions = {
    type: 'question',
    title: '退出 CC Shell',
    message: `仍有 ${n} 个 Claude Code 会话在运行`,
    detail:
      '分离到终端：每个会话转入独立终端窗口继续运行，当前任务不中断；再次打开 CC Shell 时可在列表中收回。关闭终端窗口将正常结束该会话。\n\n全部结束：保留对话记录，之后可基于该对话重新启动。',
    buttons: ['分离到终端继续运行', '全部结束', '取消'],
    defaultId: 0,
    cancelId: 2,
    noLink: true,
    checkboxLabel: '不再询问（可在“设置 → 外观与启动”中修改）'
  }
  const r = parent && !parent.isDestroyed() ? await dialog.showMessageBox(parent, options) : await dialog.showMessageBox(options)
  if (r.response === 2) return null
  const choice = r.response === 0 ? 'detach' : 'end'
  if (r.checkboxChecked) settings.update({ appearance: { onQuit: choice } })
  log('客户端', `退出时选了：${choice === 'detach' ? '分离到终端' : '全部结束'}${r.checkboxChecked ? '（以后不再询问）' : ''}`)
  return choice
}

function createMainWindow(): void {
  const theme: ThemeName = 'light'
  const recording = __TEST_HOOKS__ && !!testEnv('CCSHELL_RECORD')
  if (recording) settings.update({ appearance: { onboarded: true }, notify: { done: false, attention: false, problem: false, sound: false }, float: { enabled: false } })
  overlayDim = 0
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 880,
    minHeight: 560,
    show: false,
    title: 'CC Shell',
    icon: join(__dirname, '../../build/icon-180.png'),
    backgroundColor: overlayColors[theme].color,
    titleBarStyle: 'hidden',
    titleBarOverlay: { ...overlayColors[theme], height: TITLE_BAR_HEIGHT },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      ...(recording ? { offscreen: { useSharedTexture: false, deviceScaleFactor: 4 / 3 }, backgroundThrottling: false } : {})
    },
    ...(recording ? { width: 1440, height: 900, useContentSize: true, minWidth: 0, minHeight: 0 } : {})
  })
  if (__TEST_HOOKS__ && recording) mainWindow.webContents.once('did-finish-load', () => void import('./recorder').then((m) => m.runRecording(mainWindow!)))

  mainWindow.once('ready-to-show', () => mainWindow?.show())
  attachCloseToTray(mainWindow)
  mainWindow.on('close', (e) => {
    if (settings.get().appearance.closeToTray && !isQuitting()) return
    if (!shouldAskBeforeClose()) return
    e.preventDefault()
    app.quit()
  })
  mainWindow.on('closed', () => {
    mainWindow = null
    if (!testEnv('CCSHELL_SCREENSHOT')) app.quit()
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== mainWindow?.webContents.getURL()) event.preventDefault()
  })

  const shotPath = testEnv('CCSHELL_SCREENSHOT')
  if (__TEST_HOOKS__ && shotPath) {
    mainWindow.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        const wc = mainWindow!.webContents
        const script = testEnv('CCSHELL_SCREENSHOT_SCRIPT')
        if (script) await wc.executeJavaScript(script)
        if (testEnv('CCSHELL_SCREENSHOT_THEME') === 'light')
          await wc.executeJavaScript("document.documentElement.dataset.theme='light'")
        else if (testEnv('CCSHELL_SCREENSHOT_THEME') === 'dark')
          await wc.executeJavaScript('delete document.documentElement.dataset.theme')
        if (testEnv('CCSHELL_SCREENSHOT_PAGE'))
          await wc.executeJavaScript(`document.querySelector('nav [aria-label="${testEnv('CCSHELL_SCREENSHOT_PAGE')}"]')?.click()`)
        await new Promise((r) => setTimeout(r, Number(testEnv('CCSHELL_SCREENSHOT_WAIT')) || 300))
        const image = await mainWindow!.webContents.capturePage()
        writeFileSync(shotPath, image.toPNG())
        for (const w of BrowserWindow.getAllWindows()) {
          if (w === mainWindow || !w.isVisible()) continue
          const kind = new URL(w.webContents.getURL()).hash.slice(1) || 'window'
          writeFileSync(shotPath.replace(/\.png$/, `-${kind}.png`), (await w.webContents.capturePage()).toPNG())
        }
        app.quit()
      }, 1500)
    })
  }

  const shot = testEnv('CCSHELL_SCREENSHOT') ?? ''
  const quiet = (!!shot && !/intro|onboard/.test(shot)) || !!testEnv('CCSHELL_SELFTEST') || (recording && !testEnv('CCSHELL_RECORD_INTRO'))
  const query = quiet ? { quiet: '1' } : undefined
  const dev = devRendererUrl()
  if (dev) void mainWindow.loadURL(dev + (quiet ? '?quiet=1' : ''))
  else void mainWindow.loadFile(join(__dirname, '../renderer/index.html'), { query })
}

let overlayTheme: ThemeName = 'light'
let overlayDim = 0
function applyOverlay(win: BrowserWindow) {
  const c = overlayColors[overlayTheme]
  win.setTitleBarOverlay({ color: dimColor(c.color, overlayDim), symbolColor: dimColor(c.symbolColor, overlayDim), height: TITLE_BAR_HEIGHT })
}
ipcMain.on('ui:dim-titlebar', (event, alpha: number) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win || win !== mainWindow || typeof alpha !== 'number') return
  overlayDim = Math.min(0.8, Math.max(0, alpha))
  applyOverlay(win)
})

ipcMain.on('theme:set', (event, theme: ThemeName) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win || !(theme in titleBarColors)) return
  nativeTheme.themeSource = theme
  win.setBackgroundColor(titleBarColors[theme].color)
  if (win === mainWindow) {
    win.setBackgroundColor(overlayColors[theme].color)
    overlayTheme = theme
    applyOverlay(win)
  }
})

app.on('second-instance', () => {
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
})

app.whenReady().then(async () => {
  app.setAppUserModelId('dev.ccshell.client')
  if (dataDirProblem) return
  const selfTestUrl = testEnv('CCSHELL_SELFTEST')
  if (__TEST_HOOKS__ && selfTestUrl) {
    const { runSelfTest } = await import('./selftest')
    app.exit((await runSelfTest(selfTestUrl)) === 0 ? 0 : 1)
    return
  }
  const ccshell = new CcShellService()
  registerCcShellIpc(ccshell)
  handleAttachmentProtocol()
  const mcp = new McpService()
  registerMcpIpc(mcp)
  const knowledge = new KnowledgeService(ccshell)
  const agent = new AgentService()
  const chat = new ChatService(ccshell, mcp, { knowledge, agent })
  registerChatIpc(chat)
  registerStage6Ipc(knowledge, new AssistantStore(), agent, chat)
  const terminals = new TerminalService(ccshell)
  void terminals.connectHost()
  const installer = new ClaudeInstaller(() => terminals.usingOwnInstall())
  registerTerminalIpc(terminals, installer, new Popouts(terminals, () => mainWindow))
  const queue = new QueueService(terminals)
  const peers = new PeerService(terminals, queue)
  chat.setPeers(peers)
  registerQueueIpc(queue, new PromptStore(), terminals, peers, chat.queue)
  registerAppShell()
  const desktop = new Desktop(() => mainWindow, terminals)
  const cleaner = new Cleaner(terminals)
  registerMaintenanceIpc({ ccshell, chat, term: terminals, installer, cleaner, hotkeyError: () => desktop.hotkeyError })
  const updates = new UpdateService({
    busy: () => ({ sessions: terminals.list().filter((s) => s.status === 'running').length, chats: chat.runningCount() }),
    prepareInstall: async () => {
      quitPhase = 'closing'
      queue.shutdown()
      chat.queue.shutdown()
      await terminals.shutdownAndWait('end')
      await hostClient().quitHost().catch(() => undefined)
      mcp.closeAll()
      quitPhase = 'done'
    }
  })
  registerUpdateIpc(updates)
  let quitPhase: 'idle' | 'asking' | 'closing' | 'done' = 'idle'
  shouldAskBeforeClose = () =>
    quitPhase === 'idle' &&
    settings.get().appearance.onQuit === 'ask' &&
    !(testEnv('CCSHELL_SCREENSHOT') || testEnv('CCSHELL_QUITTEST')) &&
    terminals.list().some((s) => s.status === 'running')
  const close = async (action: 'detach' | 'end') => {
    quitPhase = 'closing'
    queue.shutdown()
    chat.queue.shutdown()
    try {
      await terminals.shutdownAndWait(action)
    } catch (err) {
      log('客户端', `退出时处理会话出错：${(err as Error).message}`)
    }
    mcp.closeAll()
    quitPhase = 'done'
    app.quit()
  }
  app.on('before-quit', (e) => {
    if (quitPhase === 'done') return
    e.preventDefault()
    if (quitPhase !== 'idle') return
    const running = terminals.list().filter((s) => s.status === 'running')
    const sandbox = !!(testEnv('CCSHELL_SCREENSHOT') || testEnv('CCSHELL_QUITTEST'))
    const pref = settings.get().appearance.onQuit
    if (!running.length || sandbox || pref === 'end') return void close('end')
    if (pref === 'detach') return void close('detach')
    quitPhase = 'asking'
    void askQuit(running.length).then((choice) => {
      if (choice) return close(choice)
      quitPhase = 'idle'
      cancelQuit()
      if (!mainWindow) createMainWindow()
    })
  })
  createMainWindow()
  desktop.init()
  cleaner.startDaily()
  updates.start()
  log('客户端', `启动 ${app.getVersion()}`)
  void ccshell.init()
  ccshell.startBalanceTimer()
  mcp.init()
  knowledge.init()
  const quitTestUrl = testEnv('CCSHELL_QUITTEST')
  if (__TEST_HOOKS__ && quitTestUrl) void import('./quittest').then((m) => m.quitTest(ccshell, terminals, quitTestUrl))
})

app.on('window-all-closed', () => {
  if (!testEnv('CCSHELL_SELFTEST')) app.quit()
})
