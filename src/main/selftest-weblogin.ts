import { app, session, type BrowserWindow } from 'electron'
import { ApiError, apiRequest } from './ccshell/http'
import { CcShellService } from './ccshell/service'
import { loadSecrets } from './ccshell/vault'
import { readLog } from './log'

type Check = (name: string, pass: boolean, detail?: string) => void

export async function webLoginSelfTest(s: CcShellService, mockUrl: string, check: Check): Promise<void> {
  const mock = (path: string, body: unknown = {}) =>
    fetch(`${mockUrl}/__mock/${path}`, { method: 'POST', body: JSON.stringify(body) })
  const onNextWindow = (act: (win: BrowserWindow) => void) =>
    app.once('browser-window-created', (_e, win) => win.webContents.once('did-finish-load', () => act(win)))
  const clickLogin = () => onNextWindow((win) => void win.webContents.executeJavaScript('go.click()'))

  try {
    await mock('auth', { spa: true, sidStrict: true })
    if (!s.state().user) await s.login('user', 'user')
    const oldSid = loadSecrets().sid
    check('网页登录：账号密码登录后本机存有会话号', !!oldSid)

    await mock('expire-sessions')
    const s2 = new CcShellService()
    await s2.init()
    check('网页登录：会话过期后启动为未登录', !s2.state().user)
    check('网页登录：会话过期后清掉本机旧会话号', !loadSecrets().sid)

    const logLines = () => readLog('client.log').split('\n').filter((l) => l.includes('[账号]'))
    let before = logLines().length
    clickLogin()
    const ok = await s2.webLogin(null)
    const newSid = loadSecrets().sid
    check('网页登录：前端路由跳转后登录成功', ok && s2.state().user?.username === 'user', `ok=${ok}`)
    check('网页登录：直接取得网页的登录结果（不靠续期）', logLines().slice(before).some((l) => l.includes('已取得登录结果')))
    check('网页登录：保存的是这次登录的新会话号', !!newSid && newSid !== oldSid)
    check('网页登录：登录后自动配好密钥', !!s2.getApiKey())

    const s3 = new CcShellService()
    await s3.init()
    check('网页登录：重启后用 Cookie + 会话号恢复登录', s3.state().user?.username === 'user')

    await mock('expire-sessions')
    before = logLines().length
    clickLogin()
    const ok2 = await s3.webLogin(null)
    check('网页登录：本机留着过期会话号时再次网页登录成功', ok2 && s3.state().user?.username === 'user', `ok=${ok2}`)
    check('网页登录：同上，用的是网页的登录结果', logLines().slice(before).some((l) => l.includes('已取得登录结果')))

    await s3.logout()
    onNextWindow((win) => win.close())
    const closed = await s3.webLogin(null)
    check('网页登录：关掉窗口返回未完成', closed === false && !s3.state().user)

    let msg = ''
    try {
      await apiRequest(session.fromPartition('persist:ccshell'), 'http://127.0.0.1:1', '/api/status')
    } catch (e) {
      msg = e instanceof ApiError ? e.message : String(e)
    }
    check('网络错误提示带错误码', /^网络连接失败（net::ERR_[A-Z_]+）/.test(msg), msg)
    check('网络错误写进日志', /\[账号\]\s+GET \/api\/status 网络错误：net::ERR_/.test(readLog('client.log')))
  } finally {
    await mock('auth', { spa: false, sidStrict: false })
    await s.logout().catch(() => {})
  }
}
