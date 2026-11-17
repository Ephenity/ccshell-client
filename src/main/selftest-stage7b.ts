import { existsSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import type { CcShellService } from './ccshell/service'
import { matches } from '../shared/fuzzy'
import type { Notice } from '../shared/terminal'
import { Cleaner } from './cleanup'
import { envCheck, reportText } from './envcheck'
import { listLogs, readLog, stamp, trimLog } from './log'
import { settings } from './settings'
import { configDir, findClaude } from './terminal/claude'
import { ClaudeInstaller } from './terminal/installer'
import { plainLines, TerminalService, toolSummary } from './terminal/service'
import { usageSummary } from './usage'

type Check = (name: string, pass: boolean, detail?: string) => void

const strip = (t: string) => t.replace(/\x1b\[[0-9;?<>=]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(\x07|\x1b\\)|\x1b[()][0-9A-B]|\x1b[=>78]/g, '')
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const until = async (cond: () => boolean, ms: number) => {
  const t0 = Date.now()
  while (!cond() && Date.now() - t0 < ms) await sleep(200)
  return cond()
}

export async function stage7bSelfTest(ccshell: CcShellService, mockUrl: string, check: Check): Promise<void> {
  check(
    '工具说明：命令',
    toolSummary('Bash', {
      command: 'npm   test\n--watch',
      description: '跑测试'
    }) === 'Bash · npm test --watch'
  )
  check('工具说明：文件只显示文件名', toolSummary('Edit', { file_path: 'X:\\proj\\src\\main.ts' }) === 'Edit · main.ts')
  check(
    '工具说明：提问显示问题',
    toolSummary('AskUserQuestion', {
      questions: [{ question: '用哪个库？' }]
    }) === '提问：用哪个库？'
  )
  check('工具说明：没有参数只显示工具名', toolSummary('TodoWrite', {}) === 'TodoWrite')
  const pl = plainLines('## 完成了\n\n- **改了** `main.ts`\n- 见 [文档](http://x)\n```js\ncode\n```\n第四行')
  check('通知正文：去掉 Markdown 符号，取前 3 行', pl === '完成了\n改了 main.ts\n见 文档', JSON.stringify(pl))

  check('搜索：子串、按顺序的字母、多个词', matches('claude-code', 'cdc') && matches('CC Shell 设置', 'cc 设') && !matches('用量', '清理') && matches('任何', ''))

  const logFile = join(app.getPath('logs'), 'client.log')
  mkdirSync(app.getPath('logs'), { recursive: true })
  const oldLine = `${stamp(new Date(Date.now() - 40 * 86_400_000))}  [会话]  很久以前的一行\n  接着上一行\n`
  const newLine = `${stamp()}  [会话]  今天的一行\n`
  writeFileSync(logFile, oldLine + newLine)
  check('日志列表：client.log 排第一', listLogs()[0]?.name === 'client.log')
  const dry = trimLog(30, true)
  check('删旧日志：先只算不删', dry === Buffer.byteLength(oldLine) && readFileSync(logFile, 'utf8').includes('很久以前'), String(dry))
  trimLog(30)
  check('删旧日志：30 天前的行（连同续行）删掉，今天的留着', readLog('client.log') === newLine, JSON.stringify(readLog('client.log')))
  let badName = ''
  try {
    readLog('..\\settings.json')
  } catch (e) {
    badName = (e as Error).message
  }
  check('读日志：不能读日志目录外的文件', badName.includes('文件名'), badName)

  const projDir = join(configDir(), 'projects', 'X--usage-test')
  mkdirSync(projDir, { recursive: true })
  const at = (msAgo: number) => new Date(Date.now() - msAgo).toISOString()
  const rec = (id: string, model: string, ago: number, u: object, extra: object = {}) =>
    JSON.stringify({
      parentUuid: 'p',
      isSidechain: false,
      type: 'assistant',
      timestamp: at(ago),
      message: { id, model, role: 'assistant', content: [], usage: u },
      ...extra
    })
  writeFileSync(
    join(projDir, 'aaaaaaaa-0000-0000-0000-000000000001.jsonl'),
    [
      rec('m1', 'test-model-a', 60_000, {
        input_tokens: 100,
        output_tokens: 1,
        cache_read_input_tokens: 1000,
        cache_creation_input_tokens: 50
      }),
      rec('m1', 'test-model-a', 60_000, {
        input_tokens: 100,
        output_tokens: 40,
        cache_read_input_tokens: 1000,
        cache_creation_input_tokens: 50
      }),
      rec('m2', 'test-model-a', 120_000, {
        input_tokens: 10,
        output_tokens: 5
      }),
      rec('m3', 'test-model-b', 120_000, { input_tokens: 7, output_tokens: 3 }, { isSidechain: true }),
      rec('m4', '<synthetic>', 120_000, { input_tokens: 9, output_tokens: 9 }),
      rec('m5', 'test-model-a', 3 * 86_400_000, {
        input_tokens: 1000,
        output_tokens: 1000
      }),
      '{坏的一行'
    ].join('\n')
  )
  const today = await usageSummary('today', async (_m, u) => ({
    amount: u.output,
    symbol: '¥'
  }))
  const a = today.rows.find((r) => r.model === 'test-model-a' && r.source === 'code')
  const b = today.rows.find((r) => r.model === 'test-model-b')
  check(
    '用量：同一次回答去重、按模型汇总、子代理算进去、<synthetic> 不算',
    a?.requests === 2 && a.input === 110 && a.output === 45 && a.cacheRead === 1000 && a.cacheWrite === 50 && b?.requests === 1 && !today.rows.some((r) => r.model === '<synthetic>'),
    JSON.stringify([a, b])
  )
  check('用量：按次估算费用再相加', a?.cost?.amount === 45 && (today.totalCost?.amount ?? 0) >= 48, JSON.stringify(a?.cost))
  const week = await usageSummary('7d')
  check('用量：近 7 天包含 3 天前的、按天补全 7 天', week.rows.find((r) => r.model === 'test-model-a')?.requests === 3 && week.days.length === 7)
  rmSync(projDir, { recursive: true, force: true })

  const twoDaysAgo = new Date(Date.now() - 2 * 86_400_000)
  const aged = (p: string) => utimesSync(p, twoDaysAgo, twoDaysAgo)
  const cproj = join(configDir(), 'projects', 'X--cleanup-test')
  const keepId = 'bbbbbbbb-0000-0000-0000-000000000001'
  const goneId = 'bbbbbbbb-0000-0000-0000-000000000002'
  const emptyId = 'bbbbbbbb-0000-0000-0000-000000000003'
  mkdirSync(join(cproj, keepId, 'subagents'), { recursive: true })
  mkdirSync(join(cproj, goneId, 'subagents'), { recursive: true })
  writeFileSync(
    join(cproj, keepId + '.jsonl'),
    JSON.stringify({
      parentUuid: null,
      isSidechain: false,
      type: 'user',
      cwd: 'X:\\c',
      sessionId: keepId,
      message: { role: 'user', content: '还在的对话' },
      timestamp: at(0)
    })
  )
  writeFileSync(join(cproj, keepId, 'subagents', 'a.jsonl'), 'x')
  writeFileSync(join(cproj, goneId, 'subagents', 'a.jsonl'), 'x'.repeat(1000))
  writeFileSync(join(cproj, emptyId + '.jsonl'), JSON.stringify({ type: 'permission-mode', permissionMode: 'default' }))
  for (const p of [
    join(cproj, goneId, 'subagents', 'a.jsonl'),
    join(cproj, goneId, 'subagents'),
    join(cproj, goneId),
    join(cproj, keepId, 'subagents', 'a.jsonl'),
    join(cproj, keepId, 'subagents'),
    join(cproj, keepId),
    join(cproj, emptyId + '.jsonl')
  ])
    aged(p)
  const freshId = 'bbbbbbbb-0000-0000-0000-000000000004'
  mkdirSync(join(cproj, freshId), { recursive: true })
  const tmpOld = join(app.getPath('temp'), 'cleanup-old.txt')
  const tmpNew = join(app.getPath('temp'), 'cleanup-new.txt')
  mkdirSync(app.getPath('temp'), { recursive: true })
  writeFileSync(tmpOld, 'x'.repeat(500))
  writeFileSync(tmpNew, 'x')
  aged(tmpOld)
  const termFile = join(app.getPath('userData'), 'terminal.json')
  writeFileSync(
    termFile,
    JSON.stringify({
      records: [
        {
          id: 'old-record',
          title: '旧会话',
          cwd: 'X:\\c',
          model: 'm',
          createdAt: twoDaysAgo.getTime()
        }
      ]
    })
  )
  writeFileSync(logFile, oldLine + newLine)

  const cterm = new TerminalService(ccshell)
  const cleaner = new Cleaner(cterm)
  const scan = Object.fromEntries(cleaner.scan().map((x) => [x.id, x]))
  check('清理扫描：已删除对话的残留只算 1 小时前的', scan.orphans.count === 1 && scan.orphans.bytes === 1000, JSON.stringify(scan.orphans))
  check(
    '清理扫描：空对话、旧临时文件、旧会话记录、旧日志',
    scan.empty.count === 1 && scan.temp.count >= 1 && scan.records.count === 1 && scan.logs.count === 1,
    JSON.stringify([scan.empty.count, scan.temp.count, scan.records.count, scan.logs.count])
  )
  check('清理扫描：默认不勾“改动备份”和 npm 缓存', !scan['file-history'].defaultOn && !scan['npm-cache'].defaultOn && scan.orphans.defaultOn)
  const res = cleaner.clean(['orphans', 'empty', 'temp', 'records', 'logs'])
  check(
    '清理：删掉残留/空对话/临时文件/旧记录/旧日志，留下还在的对话和新文件',
    !existsSync(join(cproj, goneId)) &&
      !existsSync(join(cproj, emptyId + '.jsonl')) &&
      !existsSync(tmpOld) &&
      existsSync(tmpNew) &&
      existsSync(join(cproj, keepId + '.jsonl')) &&
      existsSync(join(cproj, keepId, 'subagents')) &&
      existsSync(join(cproj, freshId)) &&
      cterm.list().length === 0 &&
      !readFileSync(logFile, 'utf8').includes('很久以前'),
    JSON.stringify(res)
  )
  check('清理结果：项数和大小', res.count >= 5 && res.bytes >= 1500 && res.skipped === 0, JSON.stringify(res))
  check(
    '清理后再扫一遍：没有可清的了',
    cleaner
      .scan()
      .filter((x) => ['orphans', 'empty', 'records', 'logs'].includes(x.id))
      .every((x) => x.count === 0)
  )
  cterm.shutdown()
  rmSync(cproj, { recursive: true, force: true })
  rmSync(tmpNew, { force: true })

  const eterm = new TerminalService(ccshell)
  const checks = await envCheck({
    ccshell,
    installer: new ClaudeInstaller(() => 0),
    term: eterm,
    hotkeyError: () => 'Ctrl+Alt+C 被别的程序占用了'
  })
  const byId = Object.fromEntries(checks.map((c) => [c.id, c]))
  check(
    '环境检查：各组都有、密钥能解开',
    ['本机', 'Claude Code', '账号', '客户端'].every((g) => checks.some((c) => c.group === g)) && byId.key?.status === 'ok',
    checks.map((c) => `${c.id}:${c.status}`).join(' ')
  )
  check('环境检查：热键被占用时提示怎么办', byId.hotkey?.status === 'warn' && !!byId.hotkey.fix)
  const report = reportText(checks)
  check('环境检查报告：每项一行，不带密钥', report.split('\n').length >= checks.length + 2 && !report.includes(ccshell.getApiKey() ?? '###'), report.split('\n')[2])
  eterm.shutdown()

  if (!findClaude().path) {
    check('卡住检测（没有 Claude Code，跳过）', false)
    return
  }
  rmSync(termFile, { force: true })
  const proj = join(app.getPath('temp'), 'stuck-proj')
  mkdirSync(proj, { recursive: true })
  settings.update({
    stuck: {
      remindMinutes: 0.1,
      autoContinue: false,
      autoMinutes: 0.15,
      continueText: ''
    }
  })
  const term = new TerminalService(ccshell)
  const notices: Notice[] = []
  term.on('notice', (n: Notice) => notices.push(n))
  const s = await term.create({
    cwd: proj,
    model: 'claude-opus-5-5',
    allModels: true
  })
  term.resize(s.id, 120, 40)
  const info = () => term.list().find((x) => x.id === s.id)!
  const say = async (text: string) => {
    term.write(s.id, text)
    await sleep(500)
    term.write(s.id, '\r')
  }
  const screen = () => strip(term.buffer(s.id)).replace(/\s+/g, ' ').slice(-300)
  try {
    const ready = await until(() => /❯|for shortcuts|Try "/.test(term.buffer(s.id)), 30_000)
    check('卡住测试：Claude Code 起来了', ready)

    {
      const hook = (event: string, input: Record<string, unknown>) =>
        (term as unknown as { onHook(e: { session: string; event: string; input: Record<string, unknown> }): void }).onHook({ session: s.id, event, input })
      const before = notices.length
      const ask = { tool_name: 'AskUserQuestion', tool_input: { questions: [{ question: '用哪个库？' }] } }
      hook('PreToolUse', ask)
      hook('PermissionRequest', ask)
      hook('Notification', { notification_type: 'permission_prompt', message: 'Claude needs your permission to use AskUserQuestion' })
      const got = notices.slice(before).filter((n) => n.sessionId === s.id)
      check('提问：只发“提出了问题”一条提醒，不再重复“需要确认”', got.length === 1 && got[0].title.includes('提出了问题'), got.map((n) => n.title).join(' | '))
      check('提问：状态是等待、说明是提出了问题', info().state === 'waiting' && info().stateDetail === 'Claude 提出了问题', `${info().state} ${info().stateDetail}`)
      hook('PermissionRequest', { tool_name: 'Bash', tool_input: { command: 'ls' } })
      check('其他工具的权限请求照常提醒“需要确认”', notices.slice(before).some((n) => n.title.includes('需要确认')))
      hook('Notification', { notification_type: 'idle_prompt' })
    }

    let notBusy = ''
    try {
      await term.continueNow(s.id)
    } catch (e) {
      notBusy = (e as Error).message
    }
    check('续跑：没在处理时不让续跑', notBusy.includes('未在处理'), notBusy)

    await say('请帮我卡住一下')
    check('卡住测试：开始处理', await until(() => info().state === 'busy', 15_000), info().state)
    const stuckSeen = await until(() => !!info().stuck, 15_000)
    let reqDump = ''
    if (!stuckSeen) {
      const all = ((await (await fetch(`${mockUrl}/__mock/requests`)).json()) as { data: { body: { messages: { role: string; content: unknown }[] } }[] }).data
      reqDump = JSON.stringify(
        all.slice(-3).map((x) => x.body.messages.map((m) => [m.role, typeof m.content === 'string' ? m.content.slice(0, 80) : (m.content as { type: string; text?: string }[]).map((p) => `${p.type}:${(p.text ?? '').slice(0, 60)}…${(p.text ?? '').slice(-60)}`)]))
      )
    }
    check('6 秒没有新内容：标记“可能卡住了”', stuckSeen, `${info().state} ${info().stateDetail} | ${screen()} | ${reqDump}`)
    check(
      '可能卡住了：发“需要你处理”的通知',
      notices.some((n) => n.kind === 'attention' && n.title.includes('疑似停滞') && n.sessionId === s.id)
    )
    check('可能卡住了：状态说明里写着多久没有新内容', /疑似停滞 · \d+ 分钟无新输出/.test(info().stateDetail ?? ''), info().stateDetail)
    settings.update({ stuck: { remindMinutes: 5 } })
    check('调高停滞阈值：马上撤掉疑似停滞和说明', await until(() => !info().stuck && !info().stateDetail, 400), `${info().stuck} ${info().stateDetail}`)
    settings.update({ stuck: { remindMinutes: 0 } })
    check('关掉停滞提醒：不再标疑似停滞', await until(() => !info().stuck, 400) && (await sleep(1300), !info().stuck), `${info().stuck}`)
    settings.update({ stuck: { remindMinutes: 0.1 } })
    check('调回停滞阈值：马上重新标上', await until(() => !!info().stuck, 400), `${info().stuck} ${info().stateDetail}`)
    const manual = await term.continueNow(s.id)
    check('手动续跑：停下这一轮、发继续的话、Claude 开始处理', manual.includes('已开始处理'), manual)
    check('手动续跑后答完一轮', await until(() => info().state === 'idle', 60_000), info().state)
    check('答完后不再标记卡住', !info().stuck && !info().continuing)
    const reqs = (
      (await (await fetch(`${mockUrl}/__mock/requests`)).json()) as {
        data: { body: unknown }[]
      }
    ).data
    const lastBody = JSON.stringify(reqs.at(-1)?.body ?? '')
    check('续跑发的是设置里的话', lastBody.includes(settings.get().stuck.continueText.slice(0, 12)), lastBody.slice(-200))
    check(
      '回答完了：发“回答完了”的通知',
      notices.some((n) => n.kind === 'done' && n.sessionId === s.id)
    )

    settings.update({
      stuck: { autoContinue: true, continueText: '继续，还是卡住' }
    })
    notices.length = 0
    const trace: string[] = []
    const tracer = setInterval(() => {
      const x = `${info().state}:${info().stateDetail ?? ''}`
      if (trace.at(-1) !== x) trace.push(x)
    }, 200)
    await say('再卡住一次')
    const gaveUp = await until(() => notices.some((n) => n.kind === 'problem' && n.title.includes('自动继续未生效')), 150_000)
    clearInterval(tracer)
    if (!gaveUp) check('（调试）自动继续过程', false, `${trace.join(' → ')} | ${screen()}`)
    const autoLog = readLog('client.log')
    check('自动继续：同一段对话连续 3 次', /自动继续（第 1 次）/.test(autoLog) && /自动继续（第 3 次）/.test(autoLog) && !/自动继续（第 4 次）/.test(autoLog))
    check('连续 3 次没有正常结束：不再自动处理，发“出了问题”的通知', gaveUp, notices.map((n) => n.title).join(' | '))
    check('放弃后状态说明请用户看终端', (info().stateDetail ?? '').includes('请检查终端'), info().stateDetail)

    settings.update({ stuck: { continueText: '' } })
    await term.continueNow(s.id)
    check('换回正常的话后手动续跑能答完', await until(() => info().state === 'idle', 60_000), info().state)
    writeFileSync(logFile, '')
    await say('第三次卡住')
    check('答完一轮后计数清零：又能自动继续', await until(() => /自动继续（第 1 次）：已发送继续指令/.test(readLog('client.log')), 60_000), readLog('client.log').slice(-300))
    check('自动继续后答完', await until(() => info().state === 'idle', 60_000), info().state)

    await term.end(s.id)
    term.remove(s.id)
  } finally {
    term.shutdown()
  }
  settings.update({
    stuck: {
      remindMinutes: 2,
      autoContinue: true,
      autoMinutes: 3,
      continueText: ''
    }
  })
}
