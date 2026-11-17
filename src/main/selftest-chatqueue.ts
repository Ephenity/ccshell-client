import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import type { CcShellService } from './ccshell/service'
import { saveAttachment } from './chat/attachments'
import { chatKey, ChatQueue } from './chat/queue'
import { ChatService } from './chat/service'
import { McpService } from './mcp/service'
import { settings } from './settings'

type Check = (name: string, pass: boolean, detail?: string) => void

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const until = async (cond: () => boolean, ms: number) => {
  const t0 = Date.now()
  while (!cond() && Date.now() - t0 < ms) await sleep(150)
  return cond()
}

export async function chatQueueSelfTest(ccshell: CcShellService, mockUrl: string, check: Check): Promise<void> {
  const mock = (path: string, body: unknown) => fetch(mockUrl + path, { method: 'POST', body: JSON.stringify(body) })
  settings.update({ queue: { autoResume: true } })
  const chat = new ChatService(ccshell, new McpService())
  const conv = chat.create()
  chat.updateSettings(conv.id, { model: 'claude-opus-5-5', thinking: 'off', mcpServers: [], knowledgeBases: [] }, false)
  const key = chatKey(conv.id)
  const q = () => chat.queue.get(key)
  const byText = (t: string) => q().items.find((x) => x.text.includes(t))
  const msgs = () => chat.get(conv.id).messages
  const running = () => chat.isRunning(conv.id)
  const userTexts = () => msgs().filter((m) => m.role === 'user').map((m) => m.text)

  chat.send(conv.id, '慢一点 讲个长故事', [])
  await until(running, 5000)
  chat.queue.add(key, '排队第一句')
  chat.queue.add(key, '排队第二句 {weekday}')
  check('聊天队列：正在回答时加的先排着', byText('排队第一句')?.status === 'pending' && !userTexts().some((t) => t.includes('排队第一句')))
  await until(() => byText('排队第二句')?.status === 'done', 90_000)
  const u = userTexts()
  check('聊天队列：答完按顺序发进去、每条都回答了', u.indexOf('排队第一句') > 0 && u.findIndex((t) => t.startsWith('排队第二句')) > u.indexOf('排队第一句') && msgs().at(-1)?.role === 'assistant' && msgs().at(-1)?.status === 'done', JSON.stringify(u))
  check('聊天队列：占位符发送时替换', u.some((t) => /^排队第二句 周[日一二三四五六]$/.test(t)), JSON.stringify(u))

  const att = saveAttachment('说明.txt', new TextEncoder().encode('附件内容'), 'text/plain')
  chat.queue.add(key, '带附件的一句', { attachments: [att] })
  await until(() => byText('带附件的一句')?.status === 'done', 30_000)
  check('聊天队列：附件跟着一起发', msgs().some((m) => m.role === 'user' && m.text === '带附件的一句' && m.attachments?.[0]?.name === '说明.txt'))
  let bad = ''
  try {
    chat.queue.add(key, '/new')
  } catch (e) {
    bad = (e as Error).message
  }
  check('聊天队列：/new 在聊天里报错（要开新对话）', /新建对话/.test(bad), bad)

  chat.queue.add(key, '/wait 2s')
  chat.queue.add(key, '等待后的一句')
  check('聊天队列：/wait 期间是等待中', await until(() => byText('/wait')?.status === 'waiting', 5000))
  check('聊天队列：/wait 到时间后接着发', await until(() => byText('等待后的一句')?.status === 'done', 30_000))
  chat.queue.add(key, '/pause')
  chat.queue.add(key, '暂停后的一句')
  await until(() => q().paused, 5000)
  await sleep(1500)
  check('聊天队列：/pause 停住、不往下发', q().paused && byText('暂停后的一句')?.status === 'pending')
  chat.queue.resume(key)
  check('聊天队列：点继续后往下发', await until(() => byText('暂停后的一句')?.status === 'done', 30_000))

  chat.queue.add(key, '慢一点 会被停止的一句')
  chat.queue.add(key, '停止后的一句')
  await until(() => byText('会被停止的一句')?.status === 'running', 10_000)
  await sleep(800)
  chat.stop(conv.id)
  check('聊天队列：停止后这一条标中断、队列暂停', (await until(() => q().paused, 10_000)) && byText('会被停止的一句')?.status === 'skipped' && byText('停止后的一句')?.status === 'pending', JSON.stringify(q()))

  chat.queue.clear(key, 'all')
  chat.queue.add(key, '慢一点 第一条长回答')
  chat.queue.add(key, '插队的一句')
  await until(() => byText('第一条长回答')?.status === 'running', 10_000)
  await sleep(800)
  chat.queue.sendNext(key)
  check('聊天队列：立即发送下一条会停下这一轮、马上发', (await until(() => byText('插队的一句')?.status === 'done', 30_000)) && byText('第一条长回答')?.status === 'done' && !q().paused, JSON.stringify(q().items.map((x) => [x.text, x.status, x.note])))

  await mock('/__mock/model-error', { times: 1, status: 429, type: 'rate_limit_error', message: 'Rate limit exceeded', match: '额度测试的一句' })
  chat.queue.add(key, '额度测试的一句')
  check('聊天队列：额度用完后暂停、等着自动重试', await until(() => q().paused && !!q().resumeAt, 20_000) && byText('额度测试的一句')?.status === 'failed' && !!q().items.find((x) => x.regenerate), q().pauseReason)
  check('聊天队列：到时间自动重新生成，答出来了', (await until(() => q().items.find((x) => x.regenerate)?.status === 'done', 30_000)) && msgs().at(-1)?.status === 'done' && userTexts().filter((t) => t === '额度测试的一句').length === 1, JSON.stringify(q().items.slice(-2)))
  await mock('/__mock/model-error', { times: 1, status: 400, type: 'invalid_request_error', message: '坏请求测试', match: '会出错的一句' })
  chat.queue.add(key, '会出错的一句')
  chat.queue.add(key, '出错后的一句')
  check('聊天队列：其他错误暂停、不往下发', (await until(() => q().paused, 20_000)) && !q().resumeAt && byText('会出错的一句')?.status === 'failed' && byText('出错后的一句')?.status === 'pending', q().pauseReason)
  await mock('/__mock/model-error', { times: 0, match: '' })

  const reloaded = new ChatQueue(chat, join(app.getPath('userData'), 'chat-queues'))
  check('聊天队列：存在文件里，重新读还在', reloaded.get(key).paused && reloaded.get(key).items.some((x) => x.text === '出错后的一句' && x.status === 'pending'))
  reloaded.shutdown()
  chat.delete(conv.id)
  check('聊天队列：删掉对话时队列一起删', !existsSync(join(app.getPath('userData'), 'chat-queues', `${conv.id}.json`)) && !chat.queue.get(key).items.length)
  chat.queue.shutdown()
}
