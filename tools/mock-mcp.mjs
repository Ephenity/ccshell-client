import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'

const mode = process.argv[2] ?? 'stdio'

const tool = (name, description) => ({ name, description, inputSchema: { type: 'object', properties: {} } })
const SETS = {
  filesystem: [tool('read_file', '读取文件内容'), tool('write_file', '写入文件'), tool('list_directory', '列出目录'), tool('search_files', '按名称搜索文件')],
  github: [tool('list_issues', '列出仓库的 issue'), tool('create_issue', '新建 issue'), tool('get_pull_request', '读取 PR 详情'), tool('create_pull_request', '创建 PR'), tool('search_code', '搜索代码')],
  browser: [tool('navigate', '打开网页'), tool('screenshot', '截取页面'), tool('click', '点击元素'), tool('extract_text', '提取页面文字')]
}

const TOOLS = [
  { name: 'echo', description: '原样返回一段文字', inputSchema: { type: 'object', properties: { text: { type: 'string', description: '要返回的文字' } }, required: ['text'] } },
  { name: 'add', description: '两个数相加', inputSchema: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } }, required: ['a', 'b'] } },
  { name: 'fail', description: '总是返回错误（测试用）', inputSchema: { type: 'object', properties: {} } },
  { name: 'slow', description: '等一会儿再返回', inputSchema: { type: 'object', properties: { ms: { type: 'number' } } } }
]

function makeServer() {
  const server = new Server({ name: process.env.MOCK_MCP_SET ? `${process.env.MOCK_MCP_SET}-server` : `mock-mcp-${mode}`, version: '1.0.0' }, { capabilities: { tools: {} } })
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: SETS[process.env.MOCK_MCP_SET] ?? TOOLS }))
  server.setRequestHandler(CallToolRequestSchema, async (req, extra) => {
    const a = req.params.arguments ?? {}
    const text = (t) => ({ content: [{ type: 'text', text: t }] })
    switch (req.params.name) {
      case 'echo':
        return text(`echo(${mode})：${a.text}`)
      case 'add':
        return text(String(Number(a.a) + Number(a.b)))
      case 'fail':
        return { content: [{ type: 'text', text: '故意失败' }], isError: true }
      case 'slow':
        await new Promise((r, j) => {
          const t = setTimeout(r, Number(a.ms) || 5000)
          extra.signal.addEventListener('abort', () => (clearTimeout(t), j(new Error('aborted'))))
        })
        return text('慢工具完成')
      default:
        throw new Error(`没有这个工具：${req.params.name}`)
    }
  })
  return server
}

if (mode === 'stdio') {
  console.error('mock-mcp stdio 启动')
  await makeServer().connect(new StdioServerTransport())
} else {
  const port = Number(process.argv[3] ?? 5198)
  const sessions = new Map()
  const readBody = (req) =>
    new Promise((resolve) => {
      let s = ''
      req.on('data', (c) => (s += c))
      req.on('end', () => resolve(s ? JSON.parse(s) : undefined))
    })
  createServer(async (req, res) => {
    if (!req.url.startsWith('/mcp')) return res.writeHead(404).end()
    if (req.headers.authorization !== 'Bearer mcp-test') return res.writeHead(401, { 'Content-Type': 'text/plain' }).end('unauthorized')
    const sid = req.headers['mcp-session-id']
    let transport = sid ? sessions.get(sid) : undefined
    const body = req.method === 'POST' ? await readBody(req) : undefined
    if (!transport) {
      if (req.method !== 'POST' || body?.method !== 'initialize') return res.writeHead(400).end('no session')
      transport = new StreamableHTTPServerTransport({ sessionIdGenerator: randomUUID, onsessioninitialized: (id) => sessions.set(id, transport) })
      await makeServer().connect(transport)
    }
    await transport.handleRequest(req, res, body)
  }).listen(port, '127.0.0.1', () => console.log(`mock-mcp http://127.0.0.1:${port}/mcp`))
}
