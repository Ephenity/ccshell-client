import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import type { Conversation } from '../shared/chat'
import type { CcShellService } from './ccshell/service'
import { saveAttachment } from './chat/attachments'
import { estimateCost, parseBillingExpr } from './chat/pricing'
import { ChatService } from './chat/service'
import { McpService } from './mcp/service'

type Check = (name: string, pass: boolean, detail?: string) => void

function waitDone(chat: ChatService, id: string, timeoutMs = 15000): Promise<Conversation> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chat.off('conversation', on)
      reject(new Error('等待回复超时'))
    }, timeoutMs)
    const on = (conv: Conversation) => {
      if (conv.id !== id || conv.messages.at(-1)?.status === 'streaming') return
      clearTimeout(timer)
      chat.off('conversation', on)
      resolve(structuredClone(conv))
    }
    chat.on('conversation', on)
  })
}

const near = (a: number | undefined, b: number, eps = 1e-6) => a !== undefined && Math.abs(a - b) < eps

export async function chatSelfTest(ccshell: CcShellService, mockUrl: string, check: Check): Promise<void> {
  const lastRequest = async () =>
    ((await (await fetch(`${mockUrl}/__mock/last-request`)).json()) as { data: { path: string; headers: { auth: string }; body: Record<string, any> } }).data

  const haiku = parseBillingExpr(
    'len <= 100000 ? tier("a", p * 1 + cr * 0.1 + cc * 2 + cc1h * 2 + c * 5) : tier("b", p * 3 + cr * 0.3 + cc * 6 + cc1h * 6 + c * 15)'
  )
  check('分档表达式解析为两档', haiku.length === 2 && haiku[0].maxInput === 100000 && haiku[1].input === 3)
  const status = { quota_display_type: 'CNY', usd_exchange_rate: 7 }
  const small = estimateCost({ tiers: haiku }, { input: 1000, output: 1000, cacheRead: 0, cacheWrite: 0, reasoning: 0 }, 1, status)
  const big = estimateCost({ tiers: haiku }, { input: 200_000, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 }, 1, status)
  check('按输入长度选档计费', near(small.amount, ((1000 * 1 + 1000 * 5) / 1e6) * 7) && near(big.amount, ((200_000 * 3) / 1e6) * 7), `${small.amount} / ${big.amount}`)
  check('无法识别的表达式不估价', parseBillingExpr('p * 1 + foo').length === 0)

  await ccshell.login('user', 'user')
  const mcp = new McpService()
  const chat = new ChatService(ccshell, mcp)

  const models = await chat.models()
  const opus = models.find((m) => m.id === 'claude-opus-5-5')
  check('模型列表按密钥限制过滤（3 个聊天模型 + 1 个 embedding）', models.filter((m) => !m.embedding).length === 3 && models.find((m) => m.embedding)?.id === 'text-embedding-3-small' && !models.some((m) => m.id === 'claude-sonnet-5-5'), models.map((m) => m.id).join(','))
  check('Claude 走 Anthropic、其他走 OpenAI', opus?.protocol === 'anthropic' && models.find((m) => m.id === 'deepseek-v4')?.protocol === 'openai')
  check('模型价格换算（opus 输入 ¥4.18/百万）', near(opus?.price?.input, 0.597014925373134328 * 7, 1e-9), String(opus?.price?.input))

  let conv = chat.create()
  chat.updateSettings(conv.id, { model: 'claude-opus-5-5', thinking: 'off', systemPrompt: '', temperature: null, maxOutputTokens: 0, effort: null })
  chat.send(conv.id, '你好', [])
  conv = await waitDone(chat, conv.id)
  let reply = conv.messages.at(-1)!
  let req = await lastRequest()
  check('Anthropic 流式回复完成', reply.status === 'done' && reply.text.includes('你说的是：「你好」'), reply.error ?? reply.text.slice(0, 40))
  check('Anthropic 请求用 Bearer 密钥；Opus 5.5 思考关不掉、输出上限自动 32000', req.path === '/v1/messages' && req.headers.auth === 'bearer' && req.body.thinking?.type === 'adaptive' && req.body.max_tokens === 32000 && req.body.temperature === undefined, JSON.stringify(req.body).slice(0, 160))
  check('用量拆分（输入/缓存读取/输出）', reply.usage?.input === 1200 && reply.usage.cacheRead === 300 && reply.usage.output === 250, JSON.stringify(reply.usage))
  const expect = ((1200 * 0.597014925373134328 + 300 * 0.029850746268656716 + 250 * 2.985074626865671642) / 1e6) * 7
  check('费用估算', near(reply.cost?.amount, expect, 1e-9) && reply.cost?.symbol === '¥', `${reply.cost?.amount} ≈ ${expect}`)
  check('对话标题取第一句话', conv.title === '你好')

  chat.updateSettings(conv.id, { systemPrompt: '你是测试助手', thinking: 'adaptive', temperature: 0.5 })
  chat.send(conv.id, '再来', [])
  conv = await waitDone(chat, conv.id)
  reply = conv.messages.at(-1)!
  req = await lastRequest()
  check('自适应思考：请求参数', req.body.thinking?.type === 'adaptive' && req.body.temperature === undefined, JSON.stringify(req.body.thinking))
  check('思考内容单独保存', !!reply.reasoning?.includes('先想一想') && !reply.text.includes('先想一想'))
  check('系统提示词发出去了', JSON.stringify(req.body.system ?? '').includes('你是测试助手'))
  check('多轮对话带上历史（3 条）', req.body.messages.length === 3, String(req.body.messages.length))

  chat.updateSettings(conv.id, { model: 'claude-haiku-4-5', thinking: 'budget', thinkingBudget: 2000 })
  chat.send(conv.id, '预算', [])
  conv = await waitDone(chat, conv.id)
  req = await lastRequest()
  check('旧款模型固定预算思考：budget 和 max_tokens', req.body.thinking?.type === 'enabled' && req.body.thinking.budget_tokens === 2000 && req.body.max_tokens === 2000 + 32000, JSON.stringify(req.body.thinking) + ' max=' + req.body.max_tokens)

  const png = saveAttachment('a.png', Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')))
  const pdf = saveAttachment('b.pdf', new TextEncoder().encode('%PDF-1.4\n%mock\n'))
  const txt = saveAttachment('c.ts', new TextEncoder().encode('export const x = 1\n'))
  check('附件分类', png.kind === 'image' && pdf.kind === 'pdf' && txt.kind === 'text')
  let rejected = ''
  try {
    saveAttachment('d.exe', new Uint8Array([77, 90]))
  } catch (e) {
    rejected = (e as Error).message
  }
  check('拒绝不支持的文件类型', rejected.includes('不支持'), rejected)
  chat.updateSettings(conv.id, { model: 'claude-opus-5-5', thinking: 'off' })
  chat.send(conv.id, '看看附件', [png, pdf, txt])
  conv = await waitDone(chat, conv.id)
  reply = conv.messages.at(-1)!
  check('图片、PDF、文本附件都发出去了', reply.text.includes('图片(image/png)') && reply.text.includes('PDF(application/pdf)') && /文本.*文本/.test(reply.text), reply.text.split('\n')[0])

  const c2 = chat.create()
  chat.updateSettings(c2.id, { model: 'deepseek-v4', temperature: 0.3, thinking: 'off', systemPrompt: '' })
  chat.send(c2.id, 'hi', [])
  let conv2 = await waitDone(chat, c2.id)
  reply = conv2.messages.at(-1)!
  req = await lastRequest()
  check('OpenAI 兼容流式回复', reply.status === 'done' && reply.text.includes('temperature=0.3'), reply.error ?? reply.text)
  check('OpenAI 用量与费用（比例计费）', reply.usage?.input === 2000 && reply.usage.output === 500 && near(reply.cost?.amount, ((2000 * 1 + 500 * 4) / 1e6) * 7, 1e-9), JSON.stringify(reply.usage) + ' ' + reply.cost?.amount)
  check('OpenAI 请求要求返回用量', req.path === '/v1/chat/completions' && req.body.stream_options?.include_usage === true)

  chat.updateSettings(c2.id, { model: 'claude-sonnet-5-5' })
  chat.send(c2.id, '403?', [])
  conv2 = await waitDone(chat, c2.id)
  reply = conv2.messages.at(-1)!
  check('未开通的模型给出中文提示', reply.status === 'error' && !!reply.error?.includes('未开通 claude-sonnet-5-5'), reply.error)

  chat.updateSettings(c2.id, { model: 'claude-opus-5-5' })
  chat.send(c2.id, '慢', [])
  const stopped = waitDone(chat, c2.id)
  setTimeout(() => chat.stop(c2.id), 400)
  conv2 = await stopped
  reply = conv2.messages.at(-1)!
  check('中途停止：保留已输出的内容', reply.status === 'stopped' && reply.text.length > 0 && !reply.text.endsWith('慢慢说……'.repeat(3)), `${reply.status} ${reply.text.length} 字`)

  const before = conv2.messages.length
  const oldId = reply.id
  chat.regenerate(c2.id)
  conv2 = await waitDone(chat, c2.id, 30000)
  check('重新生成替换最后一条回复', conv2.messages.length === before && conv2.messages.at(-1)!.id !== oldId && conv2.messages.at(-1)!.status === 'done')

  chat.rename(conv.id, '  改过的标题  ')
  const reloaded = new ChatService(ccshell, mcp)
  const again = reloaded.get(conv.id)
  check('重启后对话还在（含附件、思考、用量）', again.title === '改过的标题' && again.messages.length === conv.messages.length && !!again.messages.some((m) => m.reasoning) && !!again.messages.at(-1)?.usage)
  check('对话列表按时间排序', reloaded.list()[0].id === c2.id)
  chat.delete(conv.id)
  const dir = join(app.getPath('userData'), 'chats')
  check('删除对话同时删除文件和附件', !existsSync(join(dir, `${conv.id}.json`)) && !existsSync(join(dir, 'files', png.id)))
  chat.delete(c2.id)
}
