import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { app } from 'electron'
import type { Conversation } from '../shared/chat'
import { EMPTY_SERVER } from '../shared/mcp'
import type { CcShellService } from './ccshell/service'
import { ChatService } from './chat/service'
import { parseImport } from './mcp/config'
import { McpService } from './mcp/service'
import { configDir } from './terminal/claude'

type Check = (name: string, pass: boolean, detail?: string) => void

function waitFor(chat: ChatService, id: string, pred: (c: Conversation) => boolean, timeoutMs = 20000): Promise<Conversation> {
  return new Promise((done, fail) => {
    const timer = setTimeout(() => {
      chat.off('conversation', on)
      fail(new Error('等待超时'))
    }, timeoutMs)
    const on = (conv: Conversation) => {
      if (conv.id !== id || !pred(conv)) return
      clearTimeout(timer)
      chat.off('conversation', on)
      done(structuredClone(conv))
    }
    chat.on('conversation', on)
  })
}
const finished = (c: Conversation) => c.messages.at(-1)?.status !== 'streaming'
const awaiting = (c: Conversation) => !!c.messages.at(-1)?.tools?.some((t) => t.status === 'approval') || finished(c)

export async function mcpSelfTest(ccshell: CcShellService, mockUrl: string, check: Check): Promise<void> {
  const mockMcp = resolve(process.env.CCSHELL_DEV_APP ?? app.getAppPath(), 'tools', 'mock-mcp.mjs')
  const httpPort = 5198
  const http = spawn('node', [mockMcp, 'http', String(httpPort)], { stdio: 'ignore', windowsHide: true })
  const httpUrl = `http://127.0.0.1:${httpPort}/mcp`
  const lastRequest = async () =>
    ((await (await fetch(`${mockUrl}/__mock/last-request`)).json()) as { data: { path: string; body: Record<string, any> } }).data
  try {
    await new Promise((r) => setTimeout(r, 800))

    const parsed = parseImport(JSON.stringify({ mcpServers: { a: { command: 'npx', args: ['-y', 'x'] }, b: { type: 'streamable-http', url: 'https://x/mcp' }, c: { url: 'https://y/sse', type: 'sse', disabled: true } } }))
    check('解析 Claude Desktop 格式（stdio / http / sse / 停用）', parsed.length === 3 && parsed[0].transport === 'stdio' && parsed[1].transport === 'http' && parsed[2].transport === 'sse' && !parsed[2].enabled)
    let bad = ''
    try {
      parseImport('{"mcpServers": {"x": {}}}')
    } catch (e) {
      bad = (e as Error).message
    }
    check('导入没有命令也没有地址的条目时报错', bad.includes('没有找到'), bad)

    const mcp = new McpService()
    for (const s of mcp.list()) await mcp.remove(s.config.id)
    const imported = await mcp.importJson(
      JSON.stringify({
        mcpServers: {
          'mock-stdio': { command: 'node', args: [mockMcp] },
          'mock-http': { type: 'http', url: httpUrl, headers: { Authorization: 'Bearer mcp-test' } },
          'mock-sse': { type: 'sse', url: httpUrl, headers: { Authorization: 'Bearer mcp-test' } }
        }
      })
    )
    check('导入 3 台服务器', imported.added.length === 3, JSON.stringify(imported))
    const byName = (n: string) => mcp.list().find((s) => s.config.name === n)!
    const stdio = byName('mock-stdio')
    const remote = byName('mock-http')
    const sse = byName('mock-sse')
    check('stdio 服务器连上并列出 4 个工具', stdio.state.status === 'connected' && stdio.state.tools.length === 4, stdio.state.error ?? stdio.state.status)
    check('Streamable HTTP 带请求头连上', remote.state.status === 'connected' && remote.state.transportUsed === 'http', remote.state.error ?? remote.state.status)
    check('SSE 连不上时自动改用 Streamable HTTP', sse.state.status === 'connected' && sse.state.transportUsed === 'http', sse.state.error ?? `${sse.state.status} ${sse.state.transportUsed}`)
    check('stdio 服务器的 stderr 进日志', stdio.state.log.some((l) => l.includes('mock-mcp stdio 启动')), stdio.state.log.join(' / '))

    const again = await mcp.importJson(JSON.stringify({ mcpServers: { 'mock-sse': { type: 'sse', url: httpUrl, headers: { Authorization: 'Bearer mcp-test' }, disabled: true } } }))
    check('同名再导入是覆盖，不重复', again.updated.length === 1 && mcp.list().length === 3 && !byName('mock-sse').config.enabled && byName('mock-sse').state.status === 'stopped')

    const noAuth = await mcp.add({ ...EMPTY_SERVER, name: 'no-auth', transport: 'http', url: httpUrl })
    check('缺认证头时报错并提示填请求头', noAuth.state.status === 'error' && !!noAuth.state.error?.includes('请求头'), noAuth.state.error)
    await mcp.remove(noAuth.config.id)
    const missing = await mcp.add({ ...EMPTY_SERVER, name: 'missing', command: 'definitely-not-a-command-xyz' })
    check('命令不存在时报错', missing.state.status === 'error', missing.state.error)
    await mcp.remove(missing.config.id)
    let dup = ''
    try {
      await mcp.add({ ...EMPTY_SERVER, name: 'mock-http', transport: 'http', url: httpUrl })
    } catch (e) {
      dup = (e as Error).message
    }
    check('不允许重名', dup.includes('已经有'), dup)

    const ac = new AbortController()
    const r1 = await mcp.callTool(remote.config.id, 'echo', { text: 'hi' }, ac.signal)
    const r2 = await mcp.callTool(stdio.config.id, 'fail', {}, ac.signal)
    check('直接调用工具（HTTP）', r1.text === 'echo(http)：hi' && !r1.isError, r1.text)
    check('工具返回错误时标记 isError', r2.isError && r2.text === '故意失败')

    await mcp.update(stdio.config.id, { disabledTools: ['slow'] })
    const set = await mcp.toolset([stdio.config.id, remote.config.id])
    check('工具集：名字加服务器前缀、停用的工具不提供', set.tools.length === 7 && set.tools.some((t) => t.name === 'mock-stdio__echo') && !set.tools.some((t) => t.name === 'mock-stdio__slow'), set.tools.map((t) => t.name).join(','))

    await ccshell.login('user', 'user')
    const chat = new ChatService(ccshell, mcp)
    let conv = chat.create()
    chat.updateSettings(conv.id, { model: 'claude-opus-5-5', thinking: 'off', systemPrompt: '', mcpServers: [stdio.config.id, remote.config.id] })
    chat.send(conv.id, '用工具 mock-stdio__echo 试试', [])
    conv = await waitFor(chat, conv.id, awaiting)
    let reply = conv.messages.at(-1)!
    let req = await lastRequest()
    check('请求里带上了工具定义', req.body.tools?.length === 7, String(req.body.tools?.length))
    check('调用前等待确认', reply.tools?.length === 1 && reply.tools[0].status === 'approval' && reply.tools[0].serverName === 'mock-stdio' && (reply.tools[0].input as { text: string }).text === '你好 MCP', JSON.stringify(reply).slice(0, 600))
    chat.approveTool(reply.tools![0].id, 'allow')
    conv = await waitFor(chat, conv.id, finished)
    reply = conv.messages.at(-1)!
    req = await lastRequest()
    check('允许后执行并把结果交回模型', reply.status === 'done' && reply.tools![0].status === 'done' && reply.text.includes('工具返回：echo(stdio)：你好 MCP'), reply.error ?? reply.text)
    check('工具调用位置在第一段文字之后', reply.tools![0].at === '我来调用工具。'.length && reply.text.startsWith('我来调用工具。'))
    check('第二步请求里有 tool_use 和 tool_result', JSON.stringify(req.body.messages).includes('"tool_use"') && JSON.stringify(req.body.messages).includes('"tool_result"'))
    check('多步用量合计', (reply.usage?.output ?? 0) === 300, JSON.stringify(reply.usage))

    chat.send(conv.id, '再用工具 mock-http__add', [])
    conv = await waitFor(chat, conv.id, awaiting)
    chat.approveTool(conv.messages.at(-1)!.tools![0].id, 'deny')
    conv = await waitFor(chat, conv.id, finished)
    reply = conv.messages.at(-1)!
    check('拒绝后告诉模型被拒绝了', reply.tools![0].status === 'denied' && reply.text.includes('工具返回：用户拒绝了这次工具调用'), reply.text)
    req = await lastRequest()
    check('历史里的工具调用重发时保持成对', (JSON.stringify(req.body.messages).match(/"tool_use"/g) ?? []).length === 2 && (JSON.stringify(req.body.messages).match(/"tool_result"/g) ?? []).length === 2)

    chat.send(conv.id, '工具 mock-http__echo', [])
    conv = await waitFor(chat, conv.id, awaiting)
    chat.approveTool(conv.messages.at(-1)!.tools![0].id, 'always-tool')
    conv = await waitFor(chat, conv.id, finished)
    check('“总是允许此工具”记进配置', mcp.get(remote.config.id)!.allowedTools.includes('echo'))
    chat.send(conv.id, '工具 mock-http__echo 再来', [])
    conv = await waitFor(chat, conv.id, finished)
    reply = conv.messages.at(-1)!
    check('总是允许的工具不再确认', reply.tools![0].status === 'done' && reply.text.includes('echo(http)'), reply.text)

    chat.send(conv.id, '工具 mock-stdio__echo 和 mock-stdio__add', [])
    conv = await waitFor(chat, conv.id, (c) => (c.messages.at(-1)?.tools?.filter((t) => t.status === 'approval').length ?? 0) >= 1)
    chat.approveTool(conv.messages.at(-1)!.tools!.find((t) => t.status === 'approval')!.id, 'always-server')
    conv = await waitFor(chat, conv.id, finished)
    reply = conv.messages.at(-1)!
    check('一步里两个调用；允许整台服务器后另一个也不用确认', reply.tools?.length === 2 && reply.tools.every((t) => t.status === 'done') && reply.text.includes('5'), JSON.stringify(reply.tools?.map((t) => t.status)) + reply.text)
    check('“总是允许此服务器”记进配置', mcp.get(stdio.config.id)!.alwaysAllow)

    await mcp.update(remote.config.id, { allowedTools: [] })
    chat.send(conv.id, '工具 mock-http__add', [])
    conv = await waitFor(chat, conv.id, awaiting)
    chat.stop(conv.id)
    conv = await waitFor(chat, conv.id, finished)
    reply = conv.messages.at(-1)!
    check('等待确认时停止：调用标记为中止', reply.status === 'stopped' && reply.tools![0].status === 'stopped', `${reply.status} ${reply.tools?.[0].status}`)

    chat.updateSettings(conv.id, { mcpServers: [] })
    chat.send(conv.id, '没有工具了', [])
    conv = await waitFor(chat, conv.id, finished)
    req = await lastRequest()
    check('没有工具时历史调用转成文字', conv.messages.at(-1)!.status === 'done' && !req.body.tools && !JSON.stringify(req.body.messages).includes('tool_use') && JSON.stringify(req.body.messages).includes('调用了工具 mock-stdio/echo'), conv.messages.at(-1)!.error)

    const down = await mcp.add({ ...EMPTY_SERVER, name: 'down', transport: 'http', url: 'http://127.0.0.1:5197/mcp' })
    chat.updateSettings(conv.id, { mcpServers: [down.config.id, stdio.config.id] })
    chat.send(conv.id, '你好', [])
    conv = await waitFor(chat, conv.id, finished)
    reply = conv.messages.at(-1)!
    check('连不上的服务器给出提示，不影响回复', reply.status === 'done' && !!reply.notices?.[0]?.includes('down'), reply.notices?.join() ?? reply.error)
    await mcp.remove(down.config.id)

    const c2 = chat.create()
    chat.updateSettings(c2.id, { model: 'deepseek-v4', thinking: 'off', systemPrompt: '', mcpServers: [stdio.config.id] })
    chat.send(c2.id, '工具 mock-stdio__add', [])
    const conv2 = await waitFor(chat, c2.id, finished)
    reply = conv2.messages.at(-1)!
    check('OpenAI 兼容接口也能调用工具', reply.status === 'done' && reply.tools?.[0].status === 'done' && reply.text.includes('工具返回：5'), reply.error ?? reply.text)

    const reloaded = new McpService()
    check('服务器配置保存到文件', reloaded.list().length === 3 && reloaded.get(stdio.config.id)?.alwaysAllow === true && reloaded.get(stdio.config.id)?.disabledTools[0] === 'slow')
    reloaded.closeAll()
    const saved = new ChatService(ccshell, mcp).get(conv.id)
    check('工具调用记录随对话保存', saved.messages.some((m) => m.tools?.some((t) => t.status === 'denied')))

    mcp.syncToClaudeCode([stdio.config.id, remote.config.id])
    let cc = JSON.parse(readFileSync(join(configDir(), '.claude.json'), 'utf8'))
    check(
      '同步到 Claude Code 的配置格式',
      cc.mcpServers['mock-stdio']?.type === 'stdio' && cc.mcpServers['mock-stdio'].command === 'node' && cc.mcpServers['mock-http']?.type === 'http' && cc.mcpServers['mock-http'].headers.Authorization === 'Bearer mcp-test',
      JSON.stringify(cc.mcpServers)
    )
    mcp.syncToClaudeCode([remote.config.id])
    cc = JSON.parse(readFileSync(join(configDir(), '.claude.json'), 'utf8'))
    check('取消勾选的从 Claude Code 里删掉', !cc.mcpServers['mock-stdio'] && !!cc.mcpServers['mock-http'] && mcp.claudeCodeServers().join() === 'mock-http')
    mcp.syncToClaudeCode([])

    chat.delete(conv.id)
    chat.delete(c2.id)
    for (const s of mcp.list()) await mcp.remove(s.config.id)
    mcp.closeAll()
  } finally {
    http.kill()
  }
}
