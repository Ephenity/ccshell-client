import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { crc32 } from 'node:zlib'
import { app } from 'electron'
import type { Conversation } from '../shared/chat'
import { AgentService, globToRegExp, inside } from './agent/service'
import { AssistantStore } from './assistant/store'
import type { CcShellService } from './ccshell/service'
import { ChatService } from './chat/service'
import { KnowledgeService } from './knowledge/service'
import { chunkText, tokenize } from './knowledge/search'
import { McpService } from './mcp/service'

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
const awaitingOrDone = (c: Conversation) => finished(c) || !!c.messages.at(-1)?.tools?.some((t) => t.status === 'approval')

function makePdf(text: string): Buffer {
  const stream = `BT /F1 18 Tf 50 700 Td (${text}) Tj ET`
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  ]
  let out = '%PDF-1.4\n'
  const offsets: number[] = []
  objs.forEach((o, i) => {
    offsets.push(out.length)
    out += `${i + 1} 0 obj\n${o}\nendobj\n`
  })
  const xref = out.length
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(out, 'latin1')
}

function makeZip(files: Record<string, string>): Buffer {
  const parts: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.from(content, 'utf8')
    const fname = Buffer.from(name, 'utf8')
    const crc = crc32(data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x0800, 6)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(fname.length, 26)
    parts.push(local, fname, data)
    const c = Buffer.alloc(46)
    c.writeUInt32LE(0x02014b50, 0)
    c.writeUInt16LE(20, 4)
    c.writeUInt16LE(20, 6)
    c.writeUInt16LE(0x0800, 8)
    c.writeUInt32LE(crc, 16)
    c.writeUInt32LE(data.length, 20)
    c.writeUInt32LE(data.length, 24)
    c.writeUInt16LE(fname.length, 28)
    c.writeUInt32LE(offset, 42)
    central.push(c, fname)
    offset += 30 + fname.length + data.length
  }
  const cd = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(Object.keys(files).length, 8)
  end.writeUInt16LE(Object.keys(files).length, 10)
  end.writeUInt32LE(cd.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...parts, cd, end])
}

function makeDocx(text: string): Buffer {
  return makeZip({
    '[Content_Types].xml':
      '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    '_rels/.rels':
      '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    'word/document.xml': `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`
  })
}

export async function stage6SelfTest(ccshell: CcShellService, mockUrl: string, check: Check): Promise<void> {
  const tmp = join(app.getPath('temp'), 'stage6')
  rmSync(tmp, { recursive: true, force: true })
  const docs = join(tmp, 'docs')
  mkdirSync(join(docs, 'sub'), { recursive: true })
  mkdirSync(join(docs, 'node_modules'), { recursive: true })
  writeFileSync(join(docs, 'a.md'), '# 水果\n\n苹果的价格是每斤五元，香蕉三元。\n\n' + '无关的填充内容。'.repeat(200))
  writeFileSync(join(docs, 'b.txt'), '这是一份普通的说明文本，讲的是天气。')
  writeFileSync(join(docs, 'c.pdf'), makePdf('Purple giraffe lives in the PDF file'))
  writeFileSync(join(docs, 'd.docx'), makeDocx('Word 文档里的独特词：蓝色鲸鱼'))
  writeFileSync(join(docs, 'e.bin'), Buffer.from([0, 1, 2, 3]))
  writeFileSync(join(docs, 'sub', 'f.ts'), 'export const secretNumber = 4242 // 代码里的数字')
  writeFileSync(join(docs, 'node_modules', 'g.md'), '依赖目录里的内容不该被读：橙色企鹅')
  writeFileSync(join(docs, 'broken.pdf'), 'not a pdf')

  const chunks = chunkText('第一段。'.repeat(150) + '\n\n' + '第二段。'.repeat(150))
  check('长文本切块且相邻块有重叠', chunks.length >= 2 && chunks.every((c) => c.length <= 900) && chunks[1].startsWith(chunks[0].slice(-20).trim().slice(0, 4)), chunks.map((c) => c.length).join(','))
  check('中文分词', tokenize('知识库检索').includes('检索'), tokenize('知识库检索').join('|'))
  check('通配符', globToRegExp('**/*.md').test('a/b/c.md') && globToRegExp('*.md').test('x/y.md') && !globToRegExp('src/*.ts').test('src/a/b.ts'))

  await ccshell.login('user', 'user')

  rmSync(join(app.getPath('userData'), 'ccshell', 'announcements-seen.json'), { force: true })
  const d1 = new Date(2031, 0, 5, 9)
  const first = await ccshell.dueAnnouncements(d1)
  check('公告：当天首次返回官网公告（按发布时间倒序）', !!first && first.length === 2 && first[0].type === 'ongoing' && first[0].publishedAt > first[1].publishedAt, JSON.stringify(first))
  check('公告：同一天第二次不再提示', (await ccshell.dueAnnouncements(new Date(2031, 0, 5, 22))) === null)
  check('公告：第二天再提示一次', ((await ccshell.dueAnnouncements(new Date(2031, 0, 6, 8))) ?? []).length === 2)
  await fetch(mockUrl + '/__mock/announcements', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items: [{ id: 3, content: '模拟新公告：客户端已发布。', extra: '', publishDate: '2031-01-06T05:00:00.000Z', type: 'default' }, { id: 2, content: '模拟活动：**Opus 系列**限时优惠，本周日结束。', extra: '', publishDate: '2026-11-14T18:10:37.834Z', type: 'ongoing' }, { id: 1, content: '模拟公告：遇到问题可在官网提交工单。', extra: '', publishDate: '2026-11-09T15:10:31.884Z', type: 'default' }] })
  })
  const fresh = await ccshell.dueAnnouncements(new Date(2031, 0, 6, 15))
  check('公告：当天已提示过，出现新公告时再提示一次', !!fresh && fresh.length === 3 && fresh[0].id === 3, JSON.stringify(fresh?.map((a) => a.id)))
  check('公告：新公告提示过后当天不再重复', (await ccshell.dueAnnouncements(new Date(2031, 0, 6, 20))) === null)
  await fetch(mockUrl + '/__mock/announcements', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: [] }) })
  check('公告：官网没有公告时不提示', (await ccshell.dueAnnouncements(new Date(2031, 0, 7, 8))) === null)
  await fetch(mockUrl + '/__mock/announcements', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items: [{ id: 1, content: '模拟公告：遇到问题可在官网提交工单。', publishDate: '2026-11-09T15:10:31.884Z', type: 'default' }, { id: 2, content: '模拟活动：**Opus 系列**限时优惠，本周日结束。', publishDate: '2026-11-14T18:10:37.834Z', type: 'ongoing' }] })
  })
  const kb = new KnowledgeService(ccshell)
  for (const b of kb.list()) kb.remove(b.id)

  const base = kb.create({ name: '资料', description: '测试用的资料', embeddingModel: '' })
  kb.addPaths(base.id, [docs])
  await kb.whenIdle()
  let item = kb.list()[0].items[0]
  check('文件夹建索引（md、txt、pdf、docx、ts 共 5 个）', item.status === 'ready' && item.docCount === 5 && item.chunkCount >= 6, JSON.stringify(item))
  check('读不了的文件记在跳过列表里', !!item.skipped?.some((s) => s.startsWith('broken.pdf')), item.skipped?.join(' / '))
  let hits = await kb.search([base.id], '苹果价格')
  check('关键词检索（中文）', hits[0]?.doc === 'a.md' && hits[0].via.join() === 'keyword', JSON.stringify(hits[0]))
  hits = await kb.search([base.id], 'giraffe')
  check('读 PDF', hits[0]?.doc === 'c.pdf', JSON.stringify(hits[0]))
  hits = await kb.search([base.id], '蓝色鲸鱼')
  check('读 Word', hits[0]?.doc === 'd.docx', JSON.stringify(hits[0]))
  hits = await kb.search([base.id], 'secretNumber')
  check('读子目录里的代码', hits[0]?.doc === 'sub/f.ts', JSON.stringify(hits[0]))
  hits = await kb.search([base.id], '橙色企鹅')
  check('跳过 node_modules', !hits.some((h) => h.text.includes('橙色企鹅')))

  kb.addUrl(base.id, `${mockUrl}/__mock/page`)
  await kb.whenIdle()
  const urlItem = kb.list()[0].items[1]
  hits = await kb.search([base.id], '紫色长颈鹿')
  check('网页：取标题和正文', urlItem.status === 'ready' && urlItem.name === '测试网页' && hits[0]?.doc === '测试网页', JSON.stringify(urlItem) + (urlItem.error ?? ''))
  check('网页：只取正文，不带导航和页脚', !!hits[0] && !hits[0].text.includes('导航栏噪音'), hits[0]?.text)

  let err = ''
  try {
    kb.addPaths(base.id, [join(docs, 'e.bin')])
  } catch (e) {
    err = (e as Error).message
  }
  check('拒绝不支持的单个文件', err.includes('不支持'), err)

  writeFileSync(join(docs, 'b.txt'), '天气说明改过了，新增独特词：橘子汽水。')
  kb.refreshItem(base.id, item.id)
  await kb.whenIdle()
  hits = await kb.search([base.id], '橘子汽水')
  check('重新同步后能搜到改过的内容', hits[0]?.doc === 'b.txt')
  const around = kb.readAround([base.id], `${hits[0].itemId}#${hits[0].chunk}`, 1, 1)
  check('按片段编号读上下文', around.includes('《b.txt》') && around.includes('橘子汽水'), around.slice(0, 80))

  const before = ((await (await fetch(`${mockUrl}/__mock/embedding-calls`)).json()) as { data: number }).data
  const vbase = kb.create({ name: '车', description: '', embeddingModel: 'text-embedding-3-small' })
  writeFileSync(join(tmp, 'car.txt'), '轿车保养手册：每五千公里更换一次机油。')
  writeFileSync(join(tmp, 'cat.txt'), '猫咪喜欢晒太阳，也喜欢睡觉。')
  kb.addPaths(vbase.id, [join(tmp, 'car.txt'), join(tmp, 'cat.txt')])
  await kb.whenIdle()
  const after = ((await (await fetch(`${mockUrl}/__mock/embedding-calls`)).json()) as { data: number }).data
  check('建索引时生成向量', after - before === 2 && existsSync(join(app.getPath('userData'), 'knowledge', vbase.id, 'vectors')), `${after - before} 次`)
  hits = await kb.search([vbase.id], '汽车维护')
  check('向量检索找到关键词找不到的内容', hits[0]?.doc === 'car.txt' && hits[0].via.join() === 'vector', JSON.stringify(hits.map((h) => [h.doc, h.via])))
  kb.update(vbase.id, { embeddingModel: '' })
  await kb.whenIdle()
  hits = await kb.search([vbase.id], '汽车维护')
  check('去掉 embedding 模型后只用关键词', !hits.some((h) => h.doc === 'car.txt'), JSON.stringify(hits.map((h) => h.doc)))

  const reloaded = new KnowledgeService(ccshell)
  hits = await reloaded.search([base.id], '苹果价格')
  check('重启后知识库还在、能搜', reloaded.list().length === 2 && hits[0]?.doc === 'a.md')

  const lastRequest = async () => ((await (await fetch(`${mockUrl}/__mock/last-request`)).json()) as { data: { body: Record<string, any> } }).data
  const mcp = new McpService()
  const agent = new AgentService()
  agent.setAlwaysAllowed([])
  const chat = new ChatService(ccshell, mcp, { knowledge: kb, agent })
  let conv = chat.create()
  chat.updateSettings(conv.id, { model: 'claude-opus-5-5', thinking: 'off', systemPrompt: '我的提示词', mcpServers: [], knowledgeBases: [base.id] })
  chat.send(conv.id, '用工具 knowledge_search 查一下', [])
  conv = await waitFor(chat, conv.id, awaitingOrDone)
  let reply = conv.messages.at(-1)!
  const firstReq = await lastRequest()
  check('搜知识库不用确认', reply.status === 'done' && reply.tools?.[0].status === 'done' && reply.tools[0].serverName === '知识库', reply.error ?? JSON.stringify(reply.tools))
  check('搜索结果交给模型', reply.text.includes('工具返回：找到') && reply.text.includes('a.md'), reply.text.slice(0, 120))
  const sys = JSON.stringify((await lastRequest()).body.system ?? firstReq.body.system)
  check('系统提示词附上知识库说明', sys.includes('我的提示词') && sys.includes('knowledge_search') && sys.includes('资料：测试用的资料'), sys.slice(0, 200))

  const ws = join(tmp, 'ws')
  mkdirSync(join(ws, 'src'), { recursive: true })
  writeFileSync(join(ws, 'src', 'main.ts'), 'const a = 1\nconst b = 2\nconsole.log(a + b)\n')
  writeFileSync(join(ws, 'README.md'), '# 项目\n说明\n')
  let threw = ''
  try {
    inside(ws, '../outside.txt')
  } catch (e) {
    threw = (e as Error).message
  }
  check('不允许访问工作目录外面', threw.includes('工作目录外面'), threw)
  const { tools } = agent.toolset(ws, true)
  const T = (n: string) => tools.find((t) => t.name === n)!
  const ac = new AbortController().signal
  const run = async (n: string, input: unknown) => (await T(n).call(input, ac)).text
  check('列目录', (await run('list_dir', { depth: 2 })).includes('main.ts'))
  check('按通配符找文件', (await run('find_files', { pattern: '**/*.ts' })) === 'src/main.ts')
  check('搜文件内容（带行号）', (await run('search_text', { pattern: 'console' })).includes('src/main.ts:3:'))
  check('分段读文件', (await run('read_file', { path: 'src/main.ts', offset: 2, limit: 1 })).includes('2\tconst b = 2'))
  check('写文件（自动建目录）', (await run('write_file', { path: 'out/x.txt', content: '你好' })).includes('已新建') && readFileSync(join(ws, 'out', 'x.txt'), 'utf8') === '你好')
  const e1 = await T('edit_file').call({ path: 'src/main.ts', old_string: 'const', new_string: 'let' }, ac)
  check('改文件：不唯一时报错', e1.isError && e1.text.includes('出现了 2 次'), e1.text)
  await run('edit_file', { path: 'src/main.ts', old_string: 'const b = 2', new_string: 'const b = 3' })
  check('改文件', readFileSync(join(ws, 'src', 'main.ts'), 'utf8').includes('const b = 3'))
  const cmd = await run('run_command', { command: 'Write-Output "中文输出"; exit 3' })
  check('运行命令（中文输出、退出码）', cmd.includes('中文输出') && cmd.includes('退出码 3'), cmd)
  const slow = await run('run_command', { command: 'Start-Sleep 5', timeout: 1 })
  check('命令超时被结束', slow.includes('超过 1 秒'), slow)
  check('读类工具不用确认、写类要确认', !T('read_file').needsApproval() && T('write_file').needsApproval() && T('run_command').needsApproval())
  T('edit_file').allowAlways('tool')
  check('“总是允许”记下来', !T('edit_file').needsApproval() && new AgentService().alwaysAllowed().includes('edit_file'))
  agent.setAlwaysAllowed([])
  check('不允许命令时不提供 run_command', !agent.toolset(ws, false).tools.some((t) => t.name === 'run_command'))

  const c2 = chat.create()
  chat.updateSettings(c2.id, { model: 'claude-opus-5-5', thinking: 'off', systemPrompt: '', knowledgeBases: [], workspace: ws, allowCommands: false })
  chat.send(c2.id, '用工具 write_file 写个文件', [])
  let conv2 = await waitFor(chat, c2.id, awaitingOrDone)
  reply = conv2.messages.at(-1)!
  let req = await lastRequest()
  check('Agent 对话带上内置工具（不允许命令时没有 run_command）', req.body.tools?.some((t: { name: string }) => t.name === 'write_file') && !req.body.tools.some((t: { name: string }) => t.name === 'run_command'))
  check('写文件前等确认', reply.tools?.[0].status === 'approval' && reply.tools[0].serverName === 'Agent', JSON.stringify(reply.tools))
  chat.approveTool(reply.tools![0].id, 'allow')
  conv2 = await waitFor(chat, c2.id, finished)
  check('允许后写进工作目录', readFileSync(join(ws, 'notes', 'hello.txt'), 'utf8') === '来自 Agent 的问候' && conv2.messages.at(-1)!.text.includes('已新建'))
  chat.send(c2.id, '用工具 read_file 看看', [])
  conv2 = await waitFor(chat, c2.id, awaitingOrDone)
  check('读文件直接执行', conv2.messages.at(-1)!.status === 'done' && conv2.messages.at(-1)!.text.includes('来自 Agent 的问候'))
  check('系统提示词说明了工作目录', JSON.stringify((await lastRequest()).body.system).includes(ws.replace(/\\/g, '\\\\')))
  chat.updateSettings(c2.id, { workspace: join(tmp, 'nope') })
  chat.send(c2.id, '你好', [])
  conv2 = await waitFor(chat, c2.id, finished)
  check('工作目录不存在时给出提示', !!conv2.messages.at(-1)!.notices?.[0]?.includes('不存在'), conv2.messages.at(-1)!.notices?.join())

  const store = new AssistantStore()
  for (const a of store.list()) store.remove(a.id)
  const lastBefore = chat.lastSettings()
  const a = store.create({ name: '翻译官', icon: '', description: '中英互译', settings: { ...lastBefore, systemPrompt: '你是翻译', model: 'deepseek-v4', knowledgeBases: [base.id] } })
  check('建助手（没填图标用名字首字）', a.icon === '翻' && a.settings.systemPrompt === '你是翻译')
  const started = chat.updateSettings(chat.create().id, { ...a.settings, assistantId: a.id }, false)
  check('用助手建对话：套用设置', started.settings.assistantId === a.id && started.settings.model === 'deepseek-v4' && started.settings.knowledgeBases[0] === base.id)
  check('套用助手不改新对话的默认参数', chat.lastSettings().systemPrompt === lastBefore.systemPrompt && !chat.lastSettings().assistantId)
  store.update(a.id, { ...a, name: '翻译官 2' })
  check('助手保存到文件', new AssistantStore().list()[0]?.name === '翻译官 2')
  store.remove(a.id)

  for (const c of chat.list()) chat.delete(c.id)
  for (const b of kb.list()) kb.remove(b.id)
  rmSync(tmp, { recursive: true, force: true })
}
