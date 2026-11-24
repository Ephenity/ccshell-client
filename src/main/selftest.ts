import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, safeStorage } from 'electron'
import { CcShellService } from './ccshell/service'
import { hostClient } from './terminal/hostClient'

export async function runSelfTest(mockUrl: string): Promise<number> {
  const out = join(app.getPath('userData'), '..', 'selftest.txt')
  writeFileSync(out, '')
  let failed = 0
  const check = (name: string, pass: boolean, detail = '') => {
    if (!pass) failed++
    const line = `${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`
    appendFileSync(out, line + '\n')
    console.log(line)
  }
  const expectError = async (name: string, fn: () => Promise<unknown>, pattern: RegExp) => {
    try {
      await fn()
      check(name, false, '没有报错')
    } catch (e) {
      const msg = (e as Error).message
      check(name, pattern.test(msg), msg)
    }
  }
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
  const turnstile = (on: boolean) =>
    fetch(`${mockUrl}/__mock/turnstile`, { method: 'POST', body: JSON.stringify({ on }) })

  try {
    const s = new CcShellService()
    await s.init()
    await s.setBaseUrl(mockUrl + '/')
    await hostClient().quitHost().catch(() => undefined)
    const only = process.env.CCSHELL_SELFTEST_ONLY
    if (only) {
      await s.login('user', 'user')
      if (only === '7b') await (await import('./selftest-stage7b')).stage7bSelfTest(s, mockUrl, check)
      else if (only === '7c') await (await import('./selftest-stage7c')).stage7cSelfTest(s, mockUrl, check)
      else if (only === '7d') await (await import('./selftest-stage7d')).stage7dSelfTest(s, mockUrl, check)
      else if (only === '7e') await (await import('./selftest-stage7e')).stage7eSelfTest(s, mockUrl, check)
      else if (only === 'chatqueue') await (await import('./selftest-chatqueue')).chatQueueSelfTest(s, mockUrl, check)
      else if (only === 'anthropic') await (await import('./selftest-anthropic')).anthropicSelfTest(s, check)
      else if (only === 'claudebin') await (await import('./selftest-claudebin')).claudeBinSelfTest(check)
      else if (only === 'modelcaps') (await import('./selftest-modelcaps')).modelCapsSelfTest(check)
      else if (only === '7f') await (await import('./selftest-stage7f')).stage7fSelfTest(s, check)
      else if (only === 'terminal') await (await import('./selftest-terminal')).terminalSelfTest(s, mockUrl, check)
      else if (only === 'security') await (await import('./selftest-security')).securitySelfTest(s, check)
      else if (only === 'update') await (await import('./selftest-update')).updateSelfTest(check)
      else if (only === 'weblogin') await (await import('./selftest-weblogin')).webLoginSelfTest(s, mockUrl, check)
      else if (only === 'desktop') await (await import('./selftest-desktop')).desktopSelfTest(check)
      else check(`没有这一段：${only}`, false)
      await hostClient().quitHost().catch(() => undefined)
      appendFileSync(out, `\n${failed === 0 ? '全部通过' : `${failed} 项失败`}\n`)
      return failed
    }
    check('设置服务器地址（去掉末尾斜杠）', s.state().baseUrl === mockUrl, s.state().baseUrl)
    await expectError('拒绝非 https 的远程地址', () => s.setBaseUrl('http://example.com'), /https/)

    await expectError('密码错误', () => s.login('user', 'wrong'), /账号或密码错误/)
    const r1 = await s.login('user', 'user')
    const st1 = s.state()
    check('密码加密登录（user）', r1.kind === 'done' && st1.user?.username === 'user', JSON.stringify(r1))
    check('余额换算（12,345,678 / 500,000 × 7 = ¥172.84）', st1.balance?.symbol === '¥' && Math.abs(st1.balance.amount - 172.839492) < 1e-3, JSON.stringify(st1.balance))
    check('登录后自动保存账号现有的密钥', st1.activeKey?.id === '11' && s.getApiKey() === 'sk-mockUserKey0000000000000000000000000001', JSON.stringify(st1.activeKey))
    check('密钥加密落盘（文件里不是明文）', !readFileSync(join(app.getPath('userData'), 'ccshell', 'secrets.bin')).toString('latin1').includes('mockUserKey') && safeStorage.isEncryptionAvailable())

    const ov = await s.overview()
    check('概览：密钥列表、模型限制', ov.keys.length === 1 && ov.keys[0].models[0] === 'claude-opus-5-5' && ov.keys[0].status === 'active')
    check('概览：最近调用 5 条（含 1 条失败）', ov.recentLogs.length === 5 && ov.recentLogs.some((l) => l.status === 'error'))
    check('概览：近 30 天按模型汇总', ov.last30Days[0]?.model === 'claude-opus-5-5' && ov.last30Days[0].requests === 150, JSON.stringify(ov.last30Days))

    await sleep(4000)
    await s.refreshBalance()
    check('令牌过期后自动续期（HttpOnly + SameSite=Strict Cookie）', s.state().user?.username === 'user')

    let changes = 0
    const onChange = () => changes++
    s.on('changed', onChange)
    const stopTimer = s.startBalanceTimer(300)
    await sleep(1100)
    stopTimer()
    const afterStop = changes
    await sleep(700)
    s.off('changed', onChange)
    check('已登录时定时刷新余额，停下后不再刷新', afterStop >= 2 && changes === afterStop, `${afterStop} → ${changes}`)

    const restarted = new CcShellService()
    await restarted.init()
    check('重启后用 Cookie 恢复登录', restarted.state().user?.username === 'user' && restarted.state().activeKey?.id === '11')

    await restarted.logout()
    check('退出登录：清空状态和本机密钥', !restarted.state().user && !restarted.state().activeKey && restarted.getApiKey() === null)
    const afterLogout = new CcShellService()
    await afterLogout.init()
    check('退出后重启不会自动登录', !afterLogout.state().user)

    const r2 = await afterLogout.login('tfa', 'tfa')
    check('开启 2FA 的账号要求验证', r2.kind === 'two-factor')
    await expectError('2FA 验证码错误', () => afterLogout.verifyTwoFactor('000000'), /验证失败/)
    await afterLogout.verifyTwoFactor('123456')
    const st2 = afterLogout.state()
    check('2FA 验证后登录成功', st2.user?.username === 'tfa')
    check('账号没有密钥时自动新建一个', !!st2.activeKey && /^sk-[0-9a-f]{32}$/.test(afterLogout.getApiKey() ?? ''), st2.activeKey?.masked)
    await afterLogout.ensureKey()
    const ov2 = await afterLogout.overview()
    check('再次确保密钥不会重复创建', ov2.keys.length === 1)

    await turnstile(true)
    await afterLogout.logout()
    const r3 = await afterLogout.login('user', 'user')
    check('站点开启人机验证时改走网页登录', r3.kind === 'web-login')
    await turnstile(false)

    app.once('browser-window-created', (_e, win) => {
      win.webContents.once('did-finish-load', () => void win.webContents.executeJavaScript('go.click()'))
    })
    const ok = await afterLogout.webLogin(null)
    check('网页登录窗口完成后客户端拿到登录状态', ok && afterLogout.state().user?.username === 'user')
    await afterLogout.logout()
    await (await import('./selftest-weblogin')).webLoginSelfTest(afterLogout, mockUrl, check)

    const { chatSelfTest } = await import('./selftest-chat')
    await chatSelfTest(afterLogout, mockUrl, check)
    const { mcpSelfTest } = await import('./selftest-mcp')
    await mcpSelfTest(afterLogout, mockUrl, check)
    const { stage6SelfTest } = await import('./selftest-stage6')
    await stage6SelfTest(afterLogout, mockUrl, check)
    if (!afterLogout.getApiKey()) await afterLogout.login('user', 'user')
    const { terminalSelfTest } = await import('./selftest-terminal')
    await terminalSelfTest(afterLogout, mockUrl, check)
    const { anthropicSelfTest } = await import('./selftest-anthropic')
    await anthropicSelfTest(afterLogout, check)
    const { claudeBinSelfTest } = await import('./selftest-claudebin')
    await claudeBinSelfTest(check)
    ;(await import('./selftest-modelcaps')).modelCapsSelfTest(check)
    const { stage7SelfTest } = await import('./selftest-stage7')
    await stage7SelfTest(afterLogout, check)
    const { stage7bSelfTest } = await import('./selftest-stage7b')
    await stage7bSelfTest(afterLogout, mockUrl, check)
    const { stage7cSelfTest } = await import('./selftest-stage7c')
    await stage7cSelfTest(afterLogout, mockUrl, check)
    const { stage7dSelfTest } = await import('./selftest-stage7d')
    await stage7dSelfTest(afterLogout, mockUrl, check)
    const { stage7eSelfTest } = await import('./selftest-stage7e')
    await stage7eSelfTest(afterLogout, mockUrl, check)
    const { chatQueueSelfTest } = await import('./selftest-chatqueue')
    await chatQueueSelfTest(afterLogout, mockUrl, check)
    const { stage7fSelfTest } = await import('./selftest-stage7f')
    await stage7fSelfTest(afterLogout, check)
    await (await import('./selftest-security')).securitySelfTest(afterLogout, check)
    await (await import('./selftest-update')).updateSelfTest(check)
    await (await import('./selftest-desktop')).desktopSelfTest(check)
    await afterLogout.logout()
  } catch (e) {
    check('未预期的异常', false, (e as Error).stack ?? String(e))
  }
  await hostClient().quitHost().catch(() => undefined)
  appendFileSync(out, `\n${failed === 0 ? '全部通过' : `${failed} 项失败`}\n`)
  return failed
}
