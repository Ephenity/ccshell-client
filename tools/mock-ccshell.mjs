import { constants, createDecipheriv, generateKeyPairSync, privateDecrypt, randomUUID } from 'node:crypto'
import { createServer } from 'node:http'

const port = Number(process.argv[2] || 5199)
const TTL = Number(process.env.MOCK_TTL || 3600)
const now = () => Math.floor(Date.now() / 1000)
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const KID = 'mock-k1'
let turnstile = false
let authMock = { spa: false, sidStrict: false, sidConflict: false, refreshFail: 0 }

const users = {
  user: { id: 1, username: 'user', password: 'user', display_name: process.env.MOCK_DISPLAY_NAME || '测试用户', email: 'user@example.com', group: 'default', quota: 12_345_678, used_quota: 2_500_000, request_count: 321, twofa: false },
  tfa: { id: 2, username: 'tfa', password: 'tfa', display_name: '', email: 'tfa@example.com', group: 'vip', quota: 500_000, used_quota: 0, request_count: 0, twofa: true }
}
const tokens = {
  1: [{ id: 11, name: '默认密钥', key: 'sk-mockUserKey0000000000000000000000000001', status: 1, expired_time: -1, used_quota: 2_500_000, remain_quota: 0, unlimited_quota: true, model_limits_enabled: true, model_limits: 'claude-opus-5-5,claude-haiku-5-5,deepseek-v4,text-embedding-3-small', group: 'default', created_time: now() - 86400 * 9, accessed_time: now() - 3600 }],
  2: []
}
const pricing = {
  success: true,
  group_ratio: { default: 1, vip: 0.8 },
  usable_group: { default: '默认分组' },
  data: [
    { model_name: 'claude-opus-5-5', billing_mode: 'tiered_expr', billing_expr: 'tier("base", p * 0.597014925373134328 + cr * 0.029850746268656716 + cc * 1.194029850746268657 + cc1h * 1.194029850746268657 + c * 2.985074626865671642)', enable_groups: ['default'], quota_type: 0 },
    { model_name: 'claude-haiku-5-5', billing_mode: 'tiered_expr', billing_expr: 'len <= 100000 ? tier("up_to_100k", p * 0.014925373134328358 + cr * 0.001492537313432836 + cc * 0.029850746268656716 + cc1h * 0.029850746268656716 + c * 0.074626865671641791) : tier("over_100k", p * 0.074626865671641791 + cr * 0.007462686567164179 + cc * 0.149253731343283582 + cc1h * 0.149253731343283582 + c * 0.373134328358208955)', enable_groups: ['default'], quota_type: 0 },
    { model_name: 'deepseek-v4', model_ratio: 0.5, completion_ratio: 4, cache_ratio: 0.1, create_cache_ratio: 1, enable_groups: ['default'], quota_type: 0 },
    { model_name: 'text-embedding-3-small', model_ratio: 0.01, completion_ratio: 1, enable_groups: ['default'], quota_type: 0 },
    { model_name: 'claude-sonnet-5-5', billing_mode: 'tiered_expr', billing_expr: 'tier("base", p * 0.3 + cr * 0.015 + cc * 0.6 + cc1h * 0.6 + c * 1.5)', enable_groups: ['default'], quota_type: 0 }
  ]
}
let lastModelRequest = null
const modelRequests = []
let announcements = [
  { id: 2, content: '模拟活动：**Opus 系列**限时优惠，本周日结束。', extra: '', publishDate: '2026-11-14T18:10:37.834Z', type: 'ongoing' },
  { id: 1, content: '模拟公告：遇到问题可在官网提交工单。', extra: '', publishDate: '2026-11-09T15:10:31.884Z', type: 'default' }
]
let modelError = { times: 0, status: 429, type: 'rate_limit_error', message: 'rate limited' }
let scriptRules = []
function scriptedStep(body) {
  const texts = (m) => (typeof m.content === 'string' ? [m.content] : m.content.filter((p) => p.type === 'text').map((p) => p.text))
  const own = (t) => t.trim() && t.length < 4000 && !/^\s*[<[#]/.test(t)
  const hasResult = (m) => Array.isArray(m.content) && m.content.some((p) => p.type === 'tool_result')
  const typed = (m) => m.role === 'user' && !hasResult(m) && texts(m).some(own)
  for (const rule of scriptRules) {
    if (rule.code && !body.tools?.length) continue
    const at = body.messages.findLastIndex((m) => m.role === 'user' && texts(m).some((t) => own(t) && t.includes(rule.match)))
    if (at < 0) continue
    const after = body.messages.slice(at + 1)
    if (after.some(typed)) continue
    let used = after.filter((m) => m.role === 'assistant').flatMap((m) => (Array.isArray(m.content) ? m.content : [])).filter((p) => p.type === 'tool_use').length
    let k = 0
    if (!rule.code) k = after.filter((m) => m.role === 'assistant').length
    else while (k < rule.steps.length && rule.steps[k].tools?.length && used >= rule.steps[k].tools.length) used -= rule.steps[k++].tools.length
    if (k < rule.steps.length) {
      const shape = body.messages.map((m) => m.role[0] + ':' + (typeof m.content === 'string' ? 'str' : m.content.map((p) => p.type[0] + (p.type === 'text' ? '(' + p.text.slice(0, 14).replace(/\s+/g, ' ') + ')' : '')).join('+'))).join(' | ')
      log(`  [脚本] ${rule.match.slice(0, 16)} 第 ${k + 1}/${rule.steps.length} 步：${shape}`)
      return rule.steps[k]
    }
  }
  return null
}
const answeredResults = new Set()
let nextTokenId = 100
const access = new Map()
const refresh = new Map()
const flows = new Map()

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers })
  res.end(JSON.stringify(body))
}
const ok = (res, data, headers) => send(res, 200, { success: true, data }, headers)
const fail = (res, status, message) => send(res, status, { success: false, message })

async function readBody(req) {
  const chunks = []
  for await (const c of req) chunks.push(c)
  const text = Buffer.concat(chunks).toString()
  return text ? JSON.parse(text) : {}
}

const cookies = (req) =>
  Object.fromEntries((req.headers.cookie || '').split(';').map((s) => s.trim().split('=')).filter((p) => p[0]))

function decryptPassword(enc, kid) {
  const [v, rsa, iv, sealed] = enc.split('.')
  if (v !== 'v2' || kid !== KID) throw new Error('bad format')
  const aesKey = privateDecrypt(
    { key: privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256', oaepLabel: Buffer.from('password-v2') },
    Buffer.from(rsa, 'base64')
  )
  const buf = Buffer.from(sealed, 'base64')
  const d = createDecipheriv('aes-256-gcm', aesKey, Buffer.from(iv, 'base64'))
  d.setAAD(Buffer.from(`password-v2:${kid}`))
  d.setAuthTag(buf.subarray(buf.length - 16))
  return Buffer.concat([d.update(buf.subarray(0, buf.length - 16)), d.final()]).toString('utf8')
}

function publicUser(u) {
  const { password, twofa, ...rest } = u
  return { ...rest, role: 1, status: 1, has_password: true, created_at: now() - 86400 * 30, setting: '{}' }
}

function issue(res, userId, sid = randomUUID()) {
  const token = randomUUID()
  const r = randomUUID()
  access.set(token, { userId, sid, exp: now() + TTL })
  refresh.set(r, { userId, sid })
  const user = Object.values(users).find((u) => u.id === userId)
  ok(
    res,
    { access_token: token, access_expires_at: now() + TTL, session: { sid }, user: publicUser(user) },
    { 'Set-Cookie': `ccshell_refresh=${r}; HttpOnly; SameSite=Strict; Path=/api/user/auth; Max-Age=2592000` }
  )
}

function sampleLogs(type) {
  if (type === 5) return [{ id: 905, created_at: now() - 7200, type: 5, model_name: 'claude-opus-5-5', token_name: '默认密钥', is_stream: true, prompt_tokens: 0, completion_tokens: 0, quota: 0, use_time: 1 }]
  return [1, 2, 3, 4].map((i) => ({ id: 800 + i, created_at: now() - i * 1800, type: 2, model_name: i % 2 ? 'claude-opus-5-5' : 'claude-haiku-5-5', token_name: '默认密钥', is_stream: true, prompt_tokens: 12000 * i, completion_tokens: 800 * i, quota: 90_000 * i, use_time: 3 * i }))
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1')
  const path = url.pathname
  const m = req.method
  log(m, url.pathname + url.search, req.headers.cookie ? '[cookie]' : '', req.headers.authorization ? '[bearer]' : '', req.headers['x-auth-session'] ? '[sid]' : '', req.headers.origin ? `origin=${req.headers.origin}` : '')
  try {
    if (m === 'POST' && path === '/__mock/auth') { authMock = { ...authMock, ...(await readBody(req)) }; return ok(res, authMock) }
    if (m === 'POST' && path === '/__mock/expire-sessions') { refresh.clear(); access.clear(); return ok(res, {}) }
    if (m === 'POST' && path === '/__mock/turnstile') { turnstile = !!(await readBody(req)).on; return ok(res, { turnstile }) }
    if (m === 'GET' && path === '/__mock/last-request') return ok(res, lastModelRequest)
    if (m === 'POST' && path === '/__mock/model-error') { modelError = { ...modelError, ...(await readBody(req)) }; return ok(res, modelError) }
    if (m === 'POST' && path === '/__mock/script') { scriptRules = (await readBody(req)).rules ?? []; return ok(res, { rules: scriptRules.length }) }
    if (m === 'GET' && path === '/__mock/requests') return ok(res, modelRequests)
    if (m === 'POST' && path === '/__mock/announcements') { announcements = (await readBody(req)).items ?? []; return ok(res, announcements) }
    if (m === 'GET' && path === '/__mock/embedding-calls') return ok(res, embeddingCalls)
    if (m === 'GET' && path === '/__mock/page') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      return res.end('<!doctype html><html><head><title>测试网页</title></head><body><nav>首页 | 导航栏噪音</nav><article><h1>网页正文标题</h1><p>网页里的独特词：紫色长颈鹿住在客户端的知识库里。</p></article><footer>页脚噪音</footer></body></html>')
    }

    if (path.startsWith('/v1/')) return modelApi(req, res, m, path)

    if (m === 'GET' && path === '/sign-in') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      return res.end(`<!doctype html><meta charset=utf-8><title>模拟登录</title><body style="font-family:sans-serif;padding:24px">
        <h3>模拟站点登录页</h3><input id=u value=user> <input id=p value=user type=password> <button id=go>登录</button>
        <script>go.onclick=async()=>{const r=await fetch('/api/user/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:u.value,password:p.value})});if((await r.json()).success){if(${authMock.spa})history.pushState({},'','/console');else location.href='/dashboard/overview'}}</script>`)
    }
    if (m === 'GET' && path === '/dashboard/overview') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end('<!doctype html><meta charset=utf-8><body>控制台</body>') }

    if (m === 'GET' && path === '/api/status')
      return ok(res, { system_name: 'CC Shell 模拟', quota_per_unit: 500000, quota_display_type: 'CNY', usd_exchange_rate: 7, turnstile_check: turnstile, announcements_enabled: announcements.length > 0, announcements })
    if (m === 'GET' && path === '/api/pricing') return send(res, 200, pricing)
    if (m === 'GET' && path === '/api/user/login/encryption-key')
      return ok(res, { enabled: true, kid: KID, public_key: publicKey.export({ type: 'spki', format: 'pem' }) })

    if (m === 'POST' && path === '/api/user/login') {
      if (turnstile && !url.searchParams.get('turnstile') && !req.headers.referer) return fail(res, 400, '请先完成人机验证')
      const body = await readBody(req)
      const u = users[body.username]
      let pwd = body.password
      if (body.password_encrypted) {
        try { pwd = decryptPassword(body.password_encrypted, body.encryption_key_id) } catch { return fail(res, 400, '密码解密失败') }
        log('  password decrypted OK')
      }
      if (!u || u.password !== pwd) return fail(res, 401, 'Username or password is incorrect, or user has been banned')
      if (u.twofa) {
        const flow = randomUUID()
        flows.set(flow, { userId: u.id, exp: now() + 300 })
        return ok(res, { require_verification: true, flow_token: flow, expires_at: now() + 300, methods: [{ method: '2fa', available: true }] })
      }
      return issue(res, u.id)
    }
    if (m === 'POST' && path === '/api/user/login/verify') {
      const body = await readBody(req)
      const f = flows.get(body.flow_token)
      if (!f || f.exp < now()) return fail(res, 400, 'Verification flow expired')
      if (body.method !== '2fa' || body.code !== '123456') return fail(res, 400, 'Verification failed.')
      flows.delete(body.flow_token)
      return issue(res, f.userId)
    }
    if (m === 'POST' && path.startsWith('/api/user/auth/') && req.headers.origin !== `http://127.0.0.1:${port}`)
      return fail(res, 403, '')
    if (m === 'POST' && path === '/api/user/auth/refresh') {
      if (authMock.refreshFail > 0) {
        authMock = { ...authMock, refreshFail: authMock.refreshFail - 1 }
        return fail(res, 503, 'Service Unavailable')
      }
      const r = refresh.get(cookies(req).ccshell_refresh)
      if (!r) return fail(res, 401, 'Unauthorized')
      const hs = req.headers['x-auth-session']
      if ((authMock.sidStrict || authMock.sidConflict) && hs && hs !== r.sid)
        return fail(res, authMock.sidConflict ? 409 : 401, authMock.sidConflict ? 'Session conflict' : 'Unauthorized')
      refresh.delete(cookies(req).ccshell_refresh)
      return issue(res, r.userId, r.sid)
    }
    if (m === 'POST' && path === '/api/user/auth/logout') {
      refresh.delete(cookies(req).ccshell_refresh)
      return ok(res, {}, { 'Set-Cookie': 'ccshell_refresh=; HttpOnly; SameSite=Strict; Path=/api/user/auth; Max-Age=0' })
    }

    const a = access.get((req.headers.authorization || '').replace(/^Bearer /, ''))
    if (!a || a.exp < now()) return fail(res, 401, 'Unauthorized')
    const user = Object.values(users).find((u) => u.id === a.userId)
    const list = tokens[user.id]

    if (m === 'GET' && path === '/api/user/self') return ok(res, publicUser(user))
    if (m === 'GET' && path === '/api/token/')
      return ok(res, { items: list.map((t) => ({ ...t, key: t.key.slice(3, 7) + '**********' + t.key.slice(-4) })), total: list.length })
    if (m === 'POST' && path === '/api/token/') {
      if (list.length >= 1) return fail(res, 400, '每个账号最多保留 1 个 API 密钥')
      const body = await readBody(req)
      list.push({ ...body, id: nextTokenId++, key: 'sk-' + randomUUID().replace(/-/g, ''), status: 1, used_quota: 0, created_time: now(), accessed_time: 0 })
      return ok(res, undefined)
    }
    const keyMatch = /^\/api\/token\/(\d+)\/key$/.exec(path)
    if (m === 'POST' && keyMatch) {
      const t = list.find((x) => x.id === Number(keyMatch[1]))
      return t ? ok(res, { key: t.key.replace(/^sk-/, '') }) : fail(res, 404, '密钥不存在')
    }
    if (m === 'GET' && path === '/api/log/self') {
      const items = user.id === 1 ? sampleLogs(Number(url.searchParams.get('type'))) : []
      return ok(res, { items, total: items.length })
    }
    if (m === 'GET' && path === '/api/data/self')
      return ok(res, user.id === 1 ? [
        { model_name: 'claude-opus-5-5', quota: 1_800_000, count: 120, created_at: now() - 86400 },
        { model_name: 'claude-opus-5-5', quota: 400_000, count: 30, created_at: now() - 3600 },
        { model_name: 'claude-haiku-5-5', quota: 300_000, count: 171, created_at: now() - 7200 }
      ] : [])
    return fail(res, 404, `模拟后台没有实现 ${m} ${path}`)
  } catch (e) {
    return fail(res, 500, String(e))
  }
})

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function findToken(req) {
  const key = (req.headers['x-api-key'] || (req.headers.authorization || '').replace(/^Bearer /, '')).trim()
  for (const list of Object.values(tokens)) for (const t of list) if (t.key === key) return t
  return null
}

function describeAnthropic(body) {
  const last = body.messages.at(-1)
  const parts = Array.isArray(last.content) ? last.content : [{ type: 'text', text: last.content }]
  const seen = parts.map((p) => (p.type === 'text' ? `文本(${p.text.length}字)` : p.type === 'image' ? `图片(${p.source?.media_type})` : p.type === 'document' ? `PDF(${p.source?.media_type})` : p.type))
  const text = parts.filter((p) => p.type === 'text').map((p) => p.text).join(' ')
  return `收到 ${body.messages.length} 条消息；最后一条包含：${seen.join('、')}。\n\n你说的是：「${text.slice(0, 60)}」\n\n\`\`\`ts\nconst answer: number = 42\n\`\`\``
}

const CONCEPTS = { 汽车: 'car', 轿车: 'car', 车辆: 'car', 保养: 'maint', 维护: 'maint', 维修: 'maint', 猫: 'cat', 猫咪: 'cat' }
let embeddingCalls = 0
function fakeEmbedding(text) {
  const v = new Array(64).fill(0)
  const h = (s) => [...s].reduce((a, c) => (a * 31 + c.codePointAt(0)) >>> 0, 7) % 64
  for (const [w, c] of Object.entries(CONCEPTS)) if (text.includes(w)) v[h(c)] += 5
  for (const ch of text) v[h(ch)] += 0.1
  const n = Math.hypot(...v) || 1
  return v.map((x) => x / n)
}

function pickTools(names, last) {
  const said = JSON.stringify(last.content)
  if (last.role !== 'user' || !names.length || !said.includes('工具')) return []
  if (said.includes('CC Shell 会话协作') && !said.includes('参数{')) return []
  const named = names.filter((n) => said.includes(n))
  const fixed = {
    knowledge_search: { query: '苹果价格' },
    write_file: { path: 'notes/hello.txt', content: '来自 Agent 的问候' },
    read_file: { path: 'notes/hello.txt' },
    list_dir: { path: '.' },
    run_command: { command: 'Get-Content notes/hello.txt' }
  }
  const input = (n) => fixed[n] ?? (n.endsWith('echo') ? { text: '你好 MCP' } : n.endsWith('add') ? { a: 2, b: 3 } : n.endsWith('slow') ? { ms: 3000 } : {})
  const raw = typeof last.content === 'string' ? [last.content] : last.content.filter((p) => p.type === 'text').map((p) => p.text)
  let given = null
  for (const t of raw) {
    const m = /参数(\{[\s\S]*\})/.exec(t)
    if (m) try { given = JSON.parse(m[1]) } catch {}
  }
  return (named.length ? named : names.slice(0, 1)).map((name) => ({ name, input: given && named.length ? given : input(name) }))
}

async function modelApi(req, res, m, path) {
  const token = findToken(req)
  if (m === 'GET' && path === '/v1/models') {
    if (!token) return send(res, 401, { error: { message: 'invalid api key' } })
    const ids = token.model_limits_enabled ? token.model_limits.split(',') : pricing.data.map((p) => p.model_name)
    return send(res, 200, { object: 'list', data: ids.map((id) => ({ id, object: 'model', owned_by: 'ccshell' })) })
  }
  if (m !== 'POST') return send(res, 404, { error: { message: 'not found' } })
  const body = await readBody(req)
  if (path === '/v1/embeddings') {
    if (!token) return send(res, 401, { error: { message: 'invalid api key' } })
    const inputs = Array.isArray(body.input) ? body.input : [body.input]
    embeddingCalls += inputs.length
    return send(res, 200, { object: 'list', model: body.model, data: inputs.map((t, index) => ({ object: 'embedding', index, embedding: fakeEmbedding(String(t)) })), usage: { prompt_tokens: 10 * inputs.length, total_tokens: 10 * inputs.length } })
  }
  lastModelRequest = { path, headers: { auth: req.headers.authorization ? 'bearer' : req.headers['x-api-key'] ? 'x-api-key' : 'none' }, body: JSON.parse(JSON.stringify(body, (k, v) => (k === 'data' && typeof v === 'string' && v.length > 80 ? `<${v.length} chars>` : v))) }
  modelRequests.push(lastModelRequest)
  if (modelRequests.length > 50) modelRequests.shift()
  if (!token) return send(res, 401, { error: { type: 'authentication_error', message: 'invalid api key' } })
  if (token.model_limits_enabled && !token.model_limits.split(',').includes(body.model))
    return send(res, 403, { error: { type: 'permission_error', message: `该令牌无权使用模型：${body.model}` } })

  if (path === '/v1/messages' && modelError.times > 0 && (!modelError.match || JSON.stringify(body.messages.slice(-4)).includes(modelError.match))) {
    modelError.times--
    return send(res, modelError.status, { type: 'error', error: { type: modelError.type, message: modelError.message } }, { Connection: 'close' })
  }
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'close' })
  let aborted = false
  res.on('close', () => (aborted = true))
  const chunks = (s) => s.match(/[\s\S]{1,4}/g) ?? []

  if (path === '/v1/messages') {
    const ev = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`)
    const step = scriptedStep(body)
    if (step) {
      ev('message_start', { message: { id: 'msg_mock', type: 'message', role: 'assistant', model: body.model, content: [], stop_reason: null, usage: { input_tokens: 1200, output_tokens: 1, cache_read_input_tokens: 300, cache_creation_input_tokens: 0 } } })
      if (step.pause) await sleep(step.pause)
      const gap = 2000 / (step.cps ?? 90)
      const stream = async (index, kind, text) => {
        for (const c of text.match(/[\s\S]{1,2}/g) ?? []) {
          if (aborted) return false
          ev('content_block_delta', { index, delta: kind === 'thinking' ? { type: 'thinking_delta', thinking: c } : { type: 'text_delta', text: c } })
          await sleep(gap)
        }
        return true
      }
      let i = 0
      if (step.thinking && body.thinking && body.thinking.type !== 'disabled') {
        ev('content_block_start', { index: i, content_block: { type: 'thinking', thinking: '', signature: '' } })
        if (!(await stream(i, 'thinking', step.thinking))) return
        ev('content_block_delta', { index: i, delta: { type: 'signature_delta', signature: 'mock-sig' } })
        ev('content_block_stop', { index: i++ })
      }
      if (step.text) {
        ev('content_block_start', { index: i, content_block: { type: 'text', text: '' } })
        if (!(await stream(i, 'text', step.text))) return
        ev('content_block_stop', { index: i++ })
      }
      for (const t of step.tools ?? []) {
        ev('content_block_start', { index: i, content_block: { type: 'tool_use', id: 'toolu_' + randomUUID().slice(0, 8), name: t.name, input: {} } })
        ev('content_block_delta', { index: i, delta: { type: 'input_json_delta', partial_json: JSON.stringify(t.input) } })
        ev('content_block_stop', { index: i++ })
      }
      ev('message_delta', { delta: { stop_reason: step.tools?.length ? 'tool_use' : 'end_turn', stop_sequence: null }, usage: { output_tokens: 320 } })
      ev('message_stop', {})
      return res.end()
    }
    let reply = describeAnthropic(body) + (body.system ? `\n\n系统提示词：${JSON.stringify(body.system).slice(0, 40)}` : '')
    ev('message_start', { message: { id: 'msg_mock', type: 'message', role: 'assistant', model: body.model, content: [], stop_reason: null, usage: { input_tokens: 1200, output_tokens: 1, cache_read_input_tokens: 300, cache_creation_input_tokens: 0 } } })
    let index = 0
    const last = body.messages.at(-1)
    let results = (Array.isArray(last.content) ? last.content : []).filter((p) => p.type === 'tool_result')
    const fresh = results.filter((r) => !answeredResults.has(r.tool_use_id))
    for (const r of results) answeredResults.add(r.tool_use_id)
    results = fresh
    const names = (body.tools ?? []).map((t) => t.name)
    let calls = results.length ? [] : pickTools(names, last)
    const wanted = (m) => [...new Set(JSON.stringify(m.content).match(/mcp__\w+/g) ?? [])]
    const typed = () => {
      for (const m of [...body.messages].reverse()) {
        if (m.role !== 'user') break
        const parts = typeof m.content === 'string' ? [m.content] : m.content.filter((p) => p.type === 'text').map((p) => p.text)
        const hit = parts.findLast((t) => t.includes('工具') && t.length < 4000)
        if (hit) return { role: 'user', content: hit }
        if (typeof m.content !== 'string' && m.content.some((p) => p.type === 'tool_result')) break
      }
      return null
    }
    const mcpAsk = !results.length && typed()
    if (mcpAsk && names.includes('ToolSearch') && wanted(mcpAsk).length) {
      const missing = wanted(mcpAsk).filter((n) => !names.includes(n))
      calls = missing.length ? [{ name: 'ToolSearch', input: { query: 'select:' + missing.join(','), max_results: 5 } }] : pickTools(names, mcpAsk).filter((c) => wanted(mcpAsk).includes(c.name))
    }
    let afterSearch = false
    const searchIds = new Set(body.messages.flatMap((m) => (Array.isArray(m.content) ? m.content : [])).filter((p) => p.type === 'tool_use' && p.name === 'ToolSearch').map((p) => p.id))
    if (results.length && results.every((r) => searchIds.has(r.tool_use_id))) {
      const textsOf = (m) => (typeof m.content === 'string' ? [m.content] : m.content.filter((p) => p.type === 'text').map((p) => p.text))
      const asked = body.messages.findLast((m) => m.role === 'user' && textsOf(m).some((t) => t.includes('工具') && t.length < 4000))
      const hit = asked ? textsOf(asked).findLast((t) => t.includes('工具') && t.length < 4000) : null
      if (hit) {
        const msg = { role: 'user', content: hit }
        const next = pickTools(names, msg).filter((c) => wanted(msg).includes(c.name))
        if (next.length) {
          calls = next
          afterSearch = true
        }
      }
    }
    if (results.length && !afterSearch) reply = '工具返回：' + results.map((r) => (typeof r.content === 'string' ? r.content : r.content.map((c) => c.text).join('')) + (r.is_error ? '（错误）' : '')).join(' | ')
    if (calls.length) {
      ev('content_block_start', { index, content_block: { type: 'text', text: '' } })
      ev('content_block_delta', { index, delta: { type: 'text_delta', text: '我来调用工具。' } })
      ev('content_block_stop', { index })
      index++
      for (const c of calls) {
        ev('content_block_start', { index, content_block: { type: 'tool_use', id: 'toolu_' + randomUUID().slice(0, 8), name: c.name, input: {} } })
        ev('content_block_delta', { index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(c.input) } })
        ev('content_block_stop', { index })
        index++
      }
      ev('message_delta', { delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 50 } })
      ev('message_stop', {})
      return res.end()
    }
    if (body.thinking && body.thinking.type !== 'disabled') {
      ev('content_block_start', { index, content_block: { type: 'thinking', thinking: '', signature: '' } })
      for (const c of chunks(`先想一想（${body.thinking.type}）……用户想测试思考过程。`)) { if (aborted) return; ev('content_block_delta', { index, delta: { type: 'thinking_delta', thinking: c } }); await sleep(10) }
      ev('content_block_delta', { index, delta: { type: 'signature_delta', signature: 'mock-sig' } })
      ev('content_block_stop', { index })
      index++
    }
    ev('content_block_start', { index, content_block: { type: 'text', text: '' } })
    const lastText = JSON.stringify(body.messages.at(-1))
    const lastContent = body.messages.findLast((m) => m.role === 'user')?.content ?? ''
    const said = (typeof lastContent === 'string' ? [lastContent] : lastContent.filter((p) => p.type === 'text').map((p) => p.text))
      .filter((t) => t.length < 2000 && !/^\s*[<[#]/.test(t))
      .at(-1) ?? ''
    if (/卡住/.test(said) && !said.includes('CC Shell 会话协作')) {
      ev('content_block_delta', { index, delta: { type: 'text_delta', text: '好的，我开始……' } })
      while (!aborted) await sleep(200)
      return
    }
    if (/假装调用/.test(said)) reply = '<invoke name="mcp__sessions_list"> </invoke>'
    const slow = /慢/.test(lastText)
    for (const c of chunks(slow ? reply + '\n' + '慢慢说……'.repeat(200) : reply)) { if (aborted) return; ev('content_block_delta', { index, delta: { type: 'text_delta', text: c } }); await sleep(slow ? 30 : 5) }
    ev('content_block_stop', { index })
    ev('message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 250 } })
    ev('message_stop', {})
    return res.end()
  }
  if (path === '/v1/chat/completions') {
    const data = (o) => res.write(`data: ${JSON.stringify(o)}\n\n`)
    const base = { id: 'chatcmpl-mock', object: 'chat.completion.chunk', created: now(), model: body.model }
    let reply = `OpenAI 格式回复，收到 ${body.messages.length} 条消息，temperature=${body.temperature ?? '默认'}，max_tokens=${body.max_tokens ?? '默认'}。`
    const last = body.messages.at(-1)
    const calls = last.role === 'tool' ? [] : pickTools((body.tools ?? []).map((t) => t.function.name), last)
    if (last.role === 'tool') reply = '工具返回：' + body.messages.filter((x) => x.role === 'tool').slice(-1).map((x) => x.content).join(' | ')
    if (calls.length) {
      data({ ...base, choices: [{ index: 0, delta: { role: 'assistant', content: '我来调用工具。' }, finish_reason: null }] })
      data({ ...base, choices: [{ index: 0, delta: { tool_calls: calls.map((c, i) => ({ index: i, id: 'call_' + randomUUID().slice(0, 8), type: 'function', function: { name: c.name, arguments: JSON.stringify(c.input) } })) }, finish_reason: null }] })
      data({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] })
      data({ ...base, choices: [], usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 } })
      res.write('data: [DONE]\n\n')
      return res.end()
    }
    for (const c of chunks(reply)) { if (aborted) return; data({ ...base, choices: [{ index: 0, delta: { content: c }, finish_reason: null }] }); await sleep(5) }
    data({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })
    data({ ...base, choices: [], usage: { prompt_tokens: 2000, completion_tokens: 500, total_tokens: 2500 } })
    res.write('data: [DONE]\n\n')
    return res.end()
  }
  return send(res, 404, { error: { message: 'not found' } })
}

let connNo = 0
if (process.env.MOCK_CONN_LOG) server.on('connection', (sock) => {
  const n = ++connNo
  log(`  [连接 ${n}] 打开 :${sock.remotePort}`)
  sock.on('close', () => log(`  [连接 ${n}] 关闭`))
})
server.listen(port, '127.0.0.1', () => log(`CC Shell 模拟后台：http://127.0.0.1:${port}  （令牌有效 ${TTL} 秒）`))
