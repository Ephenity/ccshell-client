import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { app } from 'electron'
import type { CcShellService } from './ccshell/service'
import { cacheDir } from './paths'
import { registryUrl, settings, splitArgs } from './settings'
import { configDir, findClaude, launchEnv, ownInstallDir, SOURCE_OWN } from './terminal/claude'
import { deleteHistory, historyMessages, listHistory, toMarkdown } from './terminal/history'
import { CANCELLED, ClaudeInstaller, compareVersions, explainNpmError } from './terminal/installer'
import { TerminalService } from './terminal/service'

type Check = (name: string, pass: boolean, detail?: string) => void

export async function stage7SelfTest(ccshell: CcShellService, check: Check): Promise<void> {
  rmSync(join(app.getPath('userData'), 'settings.json'), { force: true })
  settings.reload()
  const d = settings.get()
  check('设置默认值', d.claudeCode.allModels && d.network.registry === 'official' && d.network.proxy === 'system' && !d.appearance.closeToTray)
  settings.update({ network: { registry: 'npmmirror' }, claudeCode: { extraArgs: '--verbose --add-dir "X:\\a b"' } })
  settings.reload()
  check('设置写盘后能读回', settings.get().network.registry === 'npmmirror' && registryUrl() === 'https://registry.npmmirror.com/')
  let bad = ''
  try {
    settings.update({ network: { proxy: 'custom', customProxy: 'socks5://127.0.0.1:1080' } })
  } catch (e) {
    bad = (e as Error).message
  }
  check('代理地址不是 http(s) 时拒绝保存', bad.includes('socks'), bad)
  settings.update({ network: { registry: 'custom', customRegistry: 'https://r.example.com' } })
  check('自定义 npm 源（补上末尾斜杠）', registryUrl() === 'https://r.example.com/')
  check('额外参数按空格拆、引号里保留空格', JSON.stringify(splitArgs(settings.get().claudeCode.extraArgs)) === JSON.stringify(['--verbose', '--add-dir', 'X:\\a b']))
  const env = launchEnv({ baseUrl: 'http://x', apiKey: 'k', model: 'm-main', allModels: false, modelMap: { opus: 'm-opus', sonnet: '', haiku: 'm-haiku', subagent: 'm-sub' } })
  check(
    '关掉“其他模型也用它”时按模型映射设，空的不设',
    env.ANTHROPIC_DEFAULT_OPUS_MODEL === 'm-opus' && !('ANTHROPIC_DEFAULT_SONNET_MODEL' in env) && env.ANTHROPIC_SMALL_FAST_MODEL === 'm-haiku' && env.CLAUDE_CODE_SUBAGENT_MODEL === 'm-sub'
  )
  settings.update({ network: { registry: 'official', proxy: 'none' }, claudeCode: { extraArgs: '' } })

  const projDir = join(configDir(), 'projects', 'X--fake-proj')
  mkdirSync(projDir, { recursive: true })
  const id = '11111111-2222-3333-4444-555555555555'
  const line = (o: object) => JSON.stringify(o)
  const base = { isSidechain: false, cwd: 'X:\\fake\\proj', sessionId: id }
  writeFileSync(
    join(projDir, id + '.jsonl'),
    [
      line({ type: 'permission-mode', permissionMode: 'default', sessionId: id }),
      line({ parentUuid: null, ...base, type: 'user', message: { role: 'user', content: '<command-name>/clear</command-name>' }, timestamp: '2026-11-10T01:00:00Z' }),
      line({ parentUuid: 'a', ...base, type: 'user', message: { role: 'user', content: '帮我看看 main.ts' }, timestamp: '2026-11-10T01:00:01Z' }),
      line({ parentUuid: 'b', ...base, type: 'assistant', message: { role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'text', text: '好的，先读一下。' }] }, timestamp: '2026-11-10T01:00:02Z' }),
      line({ parentUuid: 'c', ...base, type: 'assistant', message: { role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'tool_use', name: 'Read', id: 't1', input: {} }] }, timestamp: '2026-11-10T01:00:03Z' }),
      line({ parentUuid: 'd', ...base, type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: '...' }] }, timestamp: '2026-11-10T01:00:04Z' }),
      line({ parentUuid: 'e', ...base, isSidechain: true, type: 'user', message: { role: 'user', content: '子代理的提示' }, timestamp: '2026-11-10T01:00:05Z' }),
      line({ parentUuid: 'f', ...base, type: 'assistant', message: { role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'text', text: '读完了，**没问题**。' }] }, timestamp: '2026-11-10T01:05:00Z' }),
      line({ type: 'api-request-blob', sessionId: id, message: [{ type: 'text', text: '"type":"user" 很长的请求记录' }] }),
      line({ type: 'custom-title', customTitle: '检查 main.ts', sessionId: id }),
      '{坏的一行'
    ].join('\n')
  )
  const item = listHistory().find((h) => h.id === id)
  check('历史对话：自定义标题、目录、模型、时间', item?.title === '检查 main.ts' && item.cwd === 'X:\\fake\\proj' && item.model === 'claude-opus-5-5' && item.updatedAt === Date.parse('2026-11-10T01:05:00Z'), JSON.stringify(item))
  const msgs = historyMessages(id)
  check(
    '历史对话：去掉命令/工具结果/子代理，连着的回答合成一条',
    msgs.length === 2 && msgs[0].text === '帮我看看 main.ts' && msgs[1].text.includes('先读一下') && msgs[1].text.includes('没问题') && msgs[1].tools[0] === 'Read',
    JSON.stringify(msgs.map((m) => [m.role, m.text.slice(0, 10), m.tools]))
  )
  check('导出 Markdown 带目录和工具', toMarkdown(id).includes('`X:\\fake\\proj`') && toMarkdown(id).includes('> 工具：Read'))
  writeFileSync(join(projDir, '22222222-2222-3333-4444-555555555555.jsonl'), line({ type: 'permission-mode', permissionMode: 'default' }))
  check('没有消息的对话不列出来', !listHistory().some((h) => h.id.startsWith('22222222')))
  mkdirSync(join(projDir, id), { recursive: true })
  deleteHistory(id)
  check('删除历史对话（连同同名目录）', !existsSync(join(projDir, id + '.jsonl')) && !existsSync(join(projDir, id)) && !listHistory().some((h) => h.id === id))
  rmSync(projDir, { recursive: true, force: true })

  const term = new TerminalService(ccshell)
  const dirA = join(app.getPath('temp'), 'pin-a')
  const dirB = join(app.getPath('temp'), 'pin-b')
  mkdirSync(dirA, { recursive: true })
  mkdirSync(dirB, { recursive: true })
  term.pinDir(dirA + '\\', true)
  term.pinDir(dirB, true)
  term.pinDir(dirA.toUpperCase(), true)
  let info = await term.info()
  check('固定常用目录（去重、不分大小写、保留原来的写法和顺序）', info.pinnedDirs.length === 2 && info.pinnedDirs[0] === resolve(dirA) && info.pinnedDirs[1] === resolve(dirB), JSON.stringify(info.pinnedDirs))
  term.pinDir(dirB, false)
  term.forgetDir(dirA)
  info = await term.info()
  check('取消固定、从列表移除', info.pinnedDirs.length === 0 && !info.recentDirs.some((x) => x.toLowerCase() === dirA.toLowerCase()))
  let rootErr = ''
  try {
    await term.create({ cwd: 'C:\\', model: 'm', allModels: true })
  } catch (e) {
    rootErr = (e as Error).message
  }
  check('不能用盘符根目录', rootErr.includes('根目录'), rootErr)
  let favErr = ''
  try {
    term.setFavorite({ conversationId: '99999999-2222-3333-4444-555555555555' }, true)
  } catch (e) {
    favErr = (e as Error).message
  }
  check('不存在的对话不能加入常用', favErr.includes('目录'), favErr)

  const hookFile = await term.hooks.settingsFile('hook-a')
  const hookCfg = JSON.parse(readFileSync(hookFile, 'utf8'))
  const hk = hookCfg.hooks.Stop[0].hooks[0]
  const url = hk.url as string
  check(
    'hook 设置：每个会话一份，HTTP hook、本机地址，口令写在文件里（不用环境变量）',
    hk.type === 'http' && url.startsWith('http://127.0.0.1:') && hk.headers['X-CCShell-Session'] === 'hook-a' && hk.headers['X-CCShell-Token'] === term.hooks.sessionToken('hook-a') && !hk.allowedEnvVars && !JSON.stringify(hookCfg).includes('$CCSHELL')
  )
  const wrong = await fetch(url, { method: 'POST', headers: { 'x-ccshell-token': 'wrong', 'x-ccshell-session': 'hook-a' }, body: '{}' })
  const right = await fetch(url, { method: 'POST', headers: { 'x-ccshell-token': term.hooks.sessionToken('hook-a'), 'x-ccshell-session': 'hook-a' }, body: '{}' })
  const spoof = await fetch(url, { method: 'POST', headers: { 'x-ccshell-token': term.hooks.sessionToken('hook-a'), 'x-ccshell-session': 'hook-b' }, body: '{}' })
  check('hook 服务：口令不对、冒充别的会话的请求都拒绝', wrong.status === 404 && right.status === 200 && spoof.status === 404, `${wrong.status} ${right.status} ${spoof.status}`)
  check('hook 服务：每个会话的口令不同', term.hooks.sessionToken('hook-a') !== term.hooks.sessionToken('hook-b'))
  term.hooks.removeMcpConfig('hook-a')
  check('hook 设置：删会话时一起删掉', !existsSync(hookFile))
  term.shutdown()

  check('npm 报错的说明：网络', explainNpmError('npm error code ETIMEDOUT', 'https://registry.npmjs.org/').includes('国内镜像'))
  check('npm 报错的说明：文件被占用', explainNpmError('npm ERR! code EBUSY', 'x').includes('结束运行中的'))
  check('版本比较', compareVersions('2.1.330', '2.1.322') > 0 && compareVersions('2.1.3', '2.1.3') === 0 && compareVersions('2.0.99', '2.1.0') < 0)

  const npmLog = join(app.getPath('temp'), 'mock-npm.log')
  rmSync(npmLog, { force: true })
  rmSync(ownInstallDir(), { recursive: true, force: true })
  process.env.CCSHELL_NPM_PATH = resolve(process.env.CCSHELL_DEV_APP ?? app.getAppPath(), 'tools', 'mock-npm.cmd')
  process.env.MOCKNPM_LOG = npmLog
  let inUse = 0
  const inst = new ClaudeInstaller(() => inUse)
  let i0 = await inst.info()
  check('安装前：客户端没装，npm 可用', i0.own === null && !i0.nodeProblem && !!i0.npm, i0.nodeProblem ?? '')
  process.env.MOCKNPM_VERSION = '9.9.9'
  const v = await inst.install()
  i0 = await inst.info()
  check('一键安装：装到 data\\claude-code\\、读出版本', v === '9.9.9' && i0.own?.version === '9.9.9' && i0.own.path.startsWith(ownInstallDir()) && !existsSync(ownInstallDir() + '.new'), i0.log.slice(-120))
  const calls = readFileSync(npmLog, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
  const call = calls.at(-1)
  check(
    'npm 参数和环境：装到客户端目录、源来自设置、缓存在 .cache、不设代理',
    call.args[0] === 'install' &&
      call.args.includes('--include=optional') &&
      resolve(call.args[call.args.indexOf('--prefix') + 1]) === resolve(ownInstallDir() + '.new') &&
      call.env.npm_config_registry === 'https://registry.npmjs.org/' &&
      call.env.npm_config_cache === join(cacheDir(), 'npm') &&
      !call.env.npm_config_proxy &&
      call.env.TEMP.startsWith(cacheDir()),
    JSON.stringify(call)
  )
  check('缓存目录不在 C 盘', !/^c:/i.test(cacheDir()), cacheDir())
  check('装好后优先用客户端自己装的', findClaude().source === SOURCE_OWN)

  process.env.MOCKNPM_VERSION = '9.10.0'
  check('检查更新：报出 npm 上的最新版本', (await inst.checkUpdate()) === '9.10.0' && (await inst.info()).latest === '9.10.0')

  inUse = 1
  let busyErr = ''
  try {
    await inst.install()
  } catch (e) {
    busyErr = (e as Error).message
  }
  check('有会话在用时不能更新', busyErr.includes('先结束'), busyErr)
  inUse = 0

  process.env.MOCKNPM_MODE = 'network'
  let netErr = ''
  try {
    await inst.install()
  } catch (e) {
    netErr = (e as Error).message
  }
  check('网络失败：给出换镜像/代理的提示，原来那份不受影响', netErr.includes('国内镜像') && (await inst.info()).own?.version === '9.9.9' && !existsSync(ownInstallDir() + '.new'), netErr)
  process.env.MOCKNPM_MODE = 'noexe'
  let noExe = ''
  try {
    await inst.install()
  } catch (e) {
    noExe = (e as Error).message
  }
  check('装完没有 claude.exe 时报错、不替换', noExe.includes('claude.exe') && (await inst.info()).own?.version === '9.9.9', noExe)
  delete process.env.MOCKNPM_MODE

  process.env.MOCKNPM_DELAY = '1500'
  const prevVersion = process.env.MOCKNPM_VERSION
  process.env.MOCKNPM_VERSION = '9.9.8'
  const t0 = Date.now()
  const pending = inst.install().then(
    () => 'done',
    (e: Error) => e.message
  )
  await new Promise((r) => setTimeout(r, 700))
  inst.cancel()
  const stopped = await pending
  const afterStop = await inst.info()
  check(
    '停止安装：马上结束，临时目录清掉，原来那份不变，不显示为出错',
    stopped === CANCELLED && Date.now() - t0 < 4000 && !existsSync(ownInstallDir() + '.new') && afterStop.own?.version === '9.9.9' && !afterStop.error && !afterStop.running && afterStop.log.includes('已停止'),
    JSON.stringify({ stopped, ms: Date.now() - t0, error: afterStop.error, running: afterStop.running })
  )
  delete process.env.MOCKNPM_DELAY
  process.env.MOCKNPM_VERSION = prevVersion

  settings.update({ network: { proxy: 'custom', customProxy: 'http://127.0.0.1:7890' } })
  await inst.install()
  const call2 = readFileSync(npmLog, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).at(-1)
  check('更新到新版本，用设置里的代理', (await inst.info()).own?.version === '9.10.0' && call2.env.npm_config_https_proxy === 'http://127.0.0.1:7890')
  settings.update({ network: { proxy: 'system' } })

  await inst.uninstall()
  check('卸载：目录删掉，回到别的那份', !existsSync(ownInstallDir()) && (await inst.info()).own === null && findClaude().source !== SOURCE_OWN, findClaude().source)

  process.env.CCSHELL_NPM_PATH = join(app.getPath('temp'), 'no-such-npm.cmd')
  const noNpm = await inst.info()
  check('找不到 npm 时给出说明', !!noNpm.nodeProblem, noNpm.nodeProblem ?? '')
  delete process.env.CCSHELL_NPM_PATH
  delete process.env.MOCKNPM_LOG
  delete process.env.MOCKNPM_VERSION
  const real = await inst.info(true)
  check('本机 Node.js / npm 检测', real.node ? /^\d+\./.test(real.node.version) && (!!real.npm || !!real.nodeProblem) : !!real.nodeProblem?.includes('nodejs.org'), JSON.stringify({ node: real.node, npm: real.npm, problem: real.nodeProblem }))
  rmSync(join(app.getPath('userData'), 'settings.json'), { force: true })
  settings.reload()
}
