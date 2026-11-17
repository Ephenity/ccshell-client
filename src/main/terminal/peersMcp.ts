import { PEER_LIMITS, PEER_SERVER, type PeerTool } from '../../shared/peers'

const L = PEER_LIMITS

export const PEER_TOOL_DEFS: { name: PeerTool; description: string; inputSchema: Record<string, unknown> }[] = [
  {
    name: 'sessions_list',
    description:
      '列出 CC Shell 客户端里的 Claude Code 会话（运行中的，以及两小时内结束的）：id、名字、项目目录、状态（idle 空闲 / busy 处理中 / waiting 等用户确认 / starting 启动中 / error 出错 / exited 已结束）、' +
      '正在做什么、最后说的话、队列里还有几条。self=true 的是你自己。要和别的会话协作时先用它。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    name: 'session_read',
    description: '读另一个会话的对话记录（最新的若干条）：用户的消息、Claude 的回答、用了哪些工具。只读，对方不知道。session 是 sessions_list 里的 id。',
    inputSchema: {
      type: 'object',
      properties: {
        session: { type: 'string', description: '会话 id（sessions_list 里的 id）' },
        last: { type: 'integer', minimum: 1, maximum: 200, description: '最多读最近几条消息，默认 20' }
      },
      required: ['session'],
      additionalProperties: false
    }
  },
  {
    name: 'session_send',
    description:
      '给另一个运行中的会话发一条消息，它会作为一条新的用户消息出现在那个会话里（写明是你发的、怎么回复）。mode：queue（默认，进对方的队列，它空闲时发）、' +
      'now（马上发进它正在进行的这一轮，Claude Code 会在这一轮中途读到）、interrupt（先停下它这一轮再发，只在它正在做的事错了、不能继续时用）。' +
      '对方在等用户回答问题或确认权限时，消息只排在队列最前面，不会打进那个对话框。' +
      `长内容写进项目里的文件，消息里给路径（最多 ${L.maxText} 字）。有频率限制，避免两个会话无限来回：不需要回复的消息别要求对方回复。`,
    inputSchema: {
      type: 'object',
      properties: {
        to: { type: 'string', description: '对方的会话 id' },
        text: { type: 'string', description: `消息内容（最多 ${L.maxText} 字）` },
        mode: { type: 'string', enum: ['queue', 'now', 'interrupt'], description: '默认 queue' }
      },
      required: ['to', 'text'],
      additionalProperties: false
    }
  },
  {
    name: 'session_start',
    description:
      '开一个新的 Claude Code 会话并把任务交给它：会话出现在 CC Shell 客户端里，启动后任务自动发进去，任务里会写明是你开的、做完用 session_send 回报给你。' +
      `directory 默认是你自己的项目目录。每小时最多开 ${L.startsPerHour} 个；能用已有的会话就别开新的。`,
    inputSchema: {
      type: 'object',
      properties: {
        task: { type: 'string', description: `交给新会话的任务（最多 ${L.maxText} 字）` },
        directory: { type: 'string', description: '新会话的项目目录（完整路径），默认和你的一样' },
        name: { type: 'string', description: '新会话的名字，默认“协作”' }
      },
      required: ['task'],
      additionalProperties: false
    }
  }
]

const INSTRUCTIONS =
  '这些工具连着 CC Shell 客户端：可以看到客户端里的其他 Claude Code 会话、读它们的对话、给它们发消息、开新会话分派任务。' +
  '用户说“另一个会话”“那个项目的 Claude”“开个会话去做……”时用它们。'

export type PeerCall = (session: string, tool: PeerTool, args: Record<string, unknown>) => Promise<Record<string, unknown>>

interface RpcRequest {
  jsonrpc?: string
  id?: string | number | null
  method?: string
  params?: Record<string, unknown>
}

const rpcError = (id: RpcRequest['id'], code: number, message: string) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } })

async function handleOne(msg: RpcRequest, session: string, call: PeerCall): Promise<unknown | null> {
  const id = msg.id
  const isNotice = id === undefined
  try {
    switch (msg.method) {
      case 'initialize': {
        const asked = typeof msg.params?.protocolVersion === 'string' ? msg.params.protocolVersion : '2025-06-18'
        return {
          jsonrpc: '2.0',
          id,
          result: { protocolVersion: asked, capabilities: { tools: { listChanged: false } }, serverInfo: { name: PEER_SERVER, title: 'CC Shell 会话协作', version: '1.0.0' }, instructions: INSTRUCTIONS }
        }
      }
      case 'ping':
        return { jsonrpc: '2.0', id, result: {} }
      case 'tools/list':
        return { jsonrpc: '2.0', id, result: { tools: PEER_TOOL_DEFS } }
      case 'tools/call': {
        const name = String(msg.params?.name ?? '')
        const def = PEER_TOOL_DEFS.find((t) => t.name === name)
        if (!def) return rpcError(id, -32602, `没有这个工具：${name}`)
        const args = (msg.params?.arguments ?? {}) as Record<string, unknown>
        let answer: Record<string, unknown>
        try {
          answer = await call(session, def.name, args)
        } catch (e) {
          answer = { ok: false, error: (e as Error).message }
        }
        const failed = answer.ok === false
        const text = failed ? String(answer.error ?? '失败') : JSON.stringify(answer, null, 2)
        return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text }], isError: failed } }
      }
      default:
        if (isNotice) return null
        return rpcError(id, -32601, `不支持的方法：${msg.method}`)
    }
  } catch (e) {
    return isNotice ? null : rpcError(id, -32603, (e as Error).message)
  }
}

export async function handleMcp(body: string, session: string, call: PeerCall): Promise<[number, unknown | null]> {
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    return [400, rpcError(null, -32700, '不是 JSON')]
  }
  if (Array.isArray(parsed)) {
    const out = (await Promise.all(parsed.map((m) => handleOne(m as RpcRequest, session, call)))).filter((x) => x !== null)
    return out.length ? [200, out] : [202, null]
  }
  const one = await handleOne(parsed as RpcRequest, session, call)
  return one === null ? [202, null] : [200, one]
}
