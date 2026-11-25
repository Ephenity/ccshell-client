import { session } from 'electron'
import { CcShellService } from './ccshell/service'
import { loadSecrets, saveSecrets } from './ccshell/vault'
import { readLog } from './log'

type Check = (name: string, pass: boolean, detail?: string) => void

export async function sessionSelfTest(s: CcShellService, mockUrl: string, check: Check): Promise<void> {
  const mock = (path: string, body: unknown = {}) =>
    fetch(`${mockUrl}/__mock/${path}`, { method: 'POST', body: JSON.stringify(body) })
  const ses = session.fromPartition('persist:ccshell')
  const refreshCookie = async () => (await ses.cookies.get({ name: 'ccshell_refresh' })).length > 0
  const accountLog = () => readLog('client.log').split('\n').filter((l) => l.includes('[账号]'))

  try {
    await mock('auth', { spa: false, sidStrict: false, sidConflict: false, refreshFail: 0 })
    if (!s.state().user) await s.login('user', 'user')
    await s.ensureKey()
    check('登录保持：登录后本机有续期 Cookie 和密钥', (await refreshCookie()) && !!s.getApiKey())

    await mock('expire-sessions')
    const s2 = new CcShellService()
    await s2.init()
    check('登录保持：站点会话失效后显示未登录', !s2.state().user)
    check('登录保持：失效时不清掉本机的续期 Cookie', await refreshCookie())
    check('登录保持：失效时保留本机密钥（聊天和会话仍可用）', !!s2.getApiKey())
    check('登录保持：失效时丢掉作废的会话号', !loadSecrets().sid)

    await s2.login('user', 'user')
    await mock('auth', { refreshFail: 1 })
    const s3 = new CcShellService()
    await s3.init()
    check('登录保持：启动续期遇到 503 会重试并恢复登录', s3.state().user?.username === 'user')
    check('登录保持：重试写进日志', accountLog().some((l) => l.includes('启动时恢复登录失败（HTTP 503）')))

    await mock('auth', { sidConflict: true })
    saveSecrets({ ...loadSecrets(), sid: '00000000-0000-4000-8000-000000000000' })
    let before = accountLog().length
    const s4 = new CcShellService()
    await s4.init()
    const lines = accountLog().slice(before)
    check('登录保持：旧会话号被拒（409）后仍能登录', s4.state().user?.username === 'user')
    check('登录保持：记下 409 并去掉会话号重试', lines.some((l) => l.includes('续期被拒（HTTP 409，带本机会话号）')) && lines.some((l) => l.includes('去掉本机会话号后续期成功')))
    check('登录保持：重试后存下这次续期的新会话号', !!loadSecrets().sid && loadSecrets().sid !== '00000000-0000-4000-8000-000000000000')
    await mock('auth', { sidConflict: false })

    await mock('auth', { refreshFail: 3 })
    const s5 = new CcShellService()
    await s5.init()
    check('登录保持：站点一直出错时才显示未登录', !s5.state().user)
    before = accountLog().length
    const healed = await s5.recover()
    check('登录保持：站点恢复后自动回到已登录', healed && s5.state().user?.username === 'user')
    check('登录保持：自动恢复写进日志', accountLog().slice(before).some((l) => l.includes('已自动恢复登录')))

    await s5.logout()
    check('登录保持：主动退出登录才清掉续期 Cookie', !(await refreshCookie()))
    check('登录保持：主动退出登录清掉本机密钥', !s5.getApiKey())
    check('登录保持：主动退出后不再自动恢复', (await s5.recover()) === false && !s5.state().user)
  } finally {
    await mock('auth', { spa: false, sidStrict: false, sidConflict: false, refreshFail: 0 })
    await s.logout().catch(() => {})
  }
}
