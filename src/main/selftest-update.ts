import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { dirname, join } from 'node:path'
import { app } from 'electron'
import { UPDATE_REPO } from '../shared/update'
import { cacheDir } from './paths'
import { settings } from './settings'
import { cleanInstallerStaging, explainUpdateError, installerStagingDirs, notesToText, UpdateService } from './updater'

type Check = (name: string, pass: boolean, detail?: string) => void
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function mockGitHub(): Promise<{ server: Server; base: string; set: (o: { version?: string; corrupt?: boolean; published?: boolean }) => void; hits: () => string[] }> {
  const payload = (v: string) => Buffer.concat([Buffer.from(`MZ fake installer ${v} `), Buffer.alloc(300_000, 7)])
  const sha512 = (v: string) => createHash('sha512').update(payload(v)).digest('base64')
  let version = '9.9.9'
  let corrupt = false
  let published = true
  const hits: string[] = []
  const server = createServer((req, res) => {
    const url = (req.url ?? '').split('?')[0]
    hits.push(url)
    const host = `http://${req.headers.host}`
    if (url === '/api/v3/repos/test/client/releases/latest') {
      if (!published) return void res.writeHead(404).end('{"message":"Not Found"}')
      return void res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ tag_name: `v${version}` }))
    }
    if (url === '/test/client/releases.atom') {
      const entry = published
        ? `<entry><id>tag:github.com,2008:Repository/1/v${version}</id><updated>2026-11-17T00:00:00Z</updated><link rel="alternate" type="text/html" href="${host}/test/client/releases/tag/v${version}"/><title>v${version}</title><content type="html">&lt;p&gt;修复了 A &amp;amp; C&lt;/p&gt;&lt;ul&gt;&lt;li&gt;新增 B&lt;/li&gt;&lt;/ul&gt;&lt;script&gt;x&lt;/script&gt;</content></entry>`
        : ''
      return void res.writeHead(200, { 'content-type': 'application/atom+xml' }).end(`<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom"><id>x</id><title>Release notes</title>${entry}</feed>`)
    }
    const m = /^\/test\/client\/releases\/download\/v([^/]+)\/(.+)$/.exec(url)
    if (m && m[2] === 'latest.yml') {
      const name = `CC-Shell-Setup-${m[1]}.exe`
      const yml = `version: ${m[1]}\nfiles:\n  - url: ${name}\n    sha512: ${sha512(m[1])}\n    size: ${payload(m[1]).length}\npath: ${name}\nsha512: ${sha512(m[1])}\nreleaseDate: '2026-11-17T00:00:00.000Z'\n`
      return void res.writeHead(200, { 'content-type': 'text/yaml' }).end(yml)
    }
    if (m && m[2].endsWith('.exe')) {
      const v = /CC-Shell-Setup-(.+)\.exe$/.exec(m[2])?.[1] ?? ''
      const body = corrupt ? Buffer.alloc(payload(v).length, 1) : payload(v)
      return void res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': body.length }).end(body)
    }
    res.writeHead(404).end()
  })
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as { port: number }).port
      resolve({
        server,
        base: `http://127.0.0.1:${port}`,
        set: (o) => {
          if (o.version) version = o.version
          if (o.corrupt !== undefined) corrupt = o.corrupt
          if (o.published !== undefined) published = o.published
        },
        hits: () => hits
      })
    })
  )
}

export async function updateSelfTest(check: Check): Promise<void> {
  const saved = settings.get().update
  settings.update({ update: { auto: true, remindedVersion: '', remindedDay: '' } })
  let prepared = 0
  const hooks = { busy: () => ({ sessions: 1, chats: 0 }), prepareInstall: async () => void prepared++ }

  const t = notesToText('<p>修复了 A &amp; C</p><ul><li>新增 B</li></ul><script>x</script>')
  check('更新：发布说明转成纯文本', t.includes('修复了 A & C') && t.includes('• 新增 B') && !t.includes('<'), JSON.stringify(t))
  check('更新：网络错误的说明', explainUpdateError(new Error('net::ERR_CONNECTION_REFUSED')).includes('连不上 GitHub'))

  const dirs = installerStagingDirs()
  check('更新：安装临时文件夹在程序目录的上一级', dirs[0].endsWith('.ccshell-update') && dirname(dirs[0]) === dirname(dirname(process.execPath)), dirs[0])
  const fake = join(cacheDir(), 'staging-test', '.ccshell-update')
  mkdirSync(join(fake, 'tmp'), { recursive: true })
  writeFileSync(join(fake, 'setup.exe'), 'x')
  cleanInstallerStaging([fake, join(cacheDir(), 'staging-test', 'missing')])
  check('更新：清理安装临时文件夹', !existsSync(fake))
  rmSync(join(cacheDir(), 'staging-test'), { recursive: true, force: true })

  delete process.env.CCSHELL_UPDATE_FEED
  const none = new UpdateService(hooks)
  const ns = none.state()
  check(
    app.isPackaged ? '更新：打包版指向 GitHub 仓库' : '更新：开发版不检查更新',
    app.isPackaged ? ns.status === 'idle' && !!ns.releaseUrl?.includes(`${UPDATE_REPO.owner}/${UPDATE_REPO.repo}`) : ns.status === 'unsupported' && ns.reason === '开发版不检查更新',
    JSON.stringify(ns)
  )

  const gh = await mockGitHub()
  process.env.CCSHELL_UPDATE_FEED = gh.base
  let day = new Date(2026, 10, 17, 10)
  const svc = new UpdateService(hooks, () => day)
  const events: string[] = []
  svc.on('changed', (s) => events.push(s.status))
  try {
    check('更新：配置好以后待检查', svc.state().status === 'idle' && !!svc.state().releaseUrl, JSON.stringify(svc.state()))

    let s = await svc.check()
    check('更新：查到新版本', s.status === 'available' && s.latest === '9.9.9' && s.current === app.getVersion(), JSON.stringify({ ...s, notes: undefined }))
    check('更新：带上发布说明（纯文本）和大小', !!s.notes?.includes('• 新增 B') && !s.notes.includes('<') && (s.size ?? 0) > 300_000, JSON.stringify(s.notes))
    check('更新：有新版本时提醒', s.remind === true)
    check('更新：检查时发了“检查中”', events.includes('checking'))

    await svc.dismiss()
    check('更新：点“稍后”后当天不再提醒', svc.state().remind === false)
    day = new Date(2026, 10, 17, 22)
    s = await svc.check()
    check('更新：当天再自动检查也不提醒', s.status === 'available' && s.remind === false)
    day = new Date(2026, 10, 18, 9)
    check('更新：第二天再提醒', svc.state().remind === true)
    day = new Date(2026, 10, 17, 23)
    check('更新：（回到前一天）仍不提醒', svc.state().remind === false)
    s = await svc.check(true)
    check('更新：手动“检查更新”查到新版本时重新提醒', s.remind === true)

    await svc.download()
    s = svc.state()
    check('更新：下载完成', s.status === 'downloaded' && s.percent === 100, JSON.stringify({ ...s, notes: undefined }))
    check('更新：有会话在运行时不自动重启安装', prepared === 0 && s.busy?.sessions === 1)
    const dir = join(cacheDir(), 'updater')
    const files = existsSync(dir) ? readdirSync(dir, { recursive: true }).map(String) : []
    check('更新：安装包下载到程序旁边的 .cache\\updater', files.some((f) => /CC-Shell-Setup-9\.9\.9\.exe$/i.test(f)), files.join(', '))
    check('更新：下载过程中有进度', events.includes('downloading'))

    gh.set({ version: '0.1.0' })
    const same = new UpdateService(hooks, () => day)
    s = await same.check()
    check('更新：版本相同时“已是最新”', s.status === 'none' && s.remind === false, JSON.stringify(s))

    gh.set({ version: '9.9.10', corrupt: true })
    const bad = new UpdateService(hooks, () => day)
    await bad.check(true)
    await bad.download()
    s = bad.state()
    check('更新：安装包校验不通过时报错、不安装', s.status === 'error' && !!s.error?.includes('校验') && prepared === 0, JSON.stringify({ status: s.status, error: s.error, percent: s.percent }))
    check('更新：下载出错后提醒卡片留着（可重试）', s.remind === true && s.latest === '9.9.10')

    gh.set({ published: false, corrupt: false })
    const empty = new UpdateService(hooks, () => day)
    s = await empty.check()
    check('更新：还没发布过版本', s.status === 'error' && s.error === '还没有发布过版本', JSON.stringify(s.error))
    gh.set({ published: true, version: '9.9.9' })

    process.env.CCSHELL_UPDATE_FIRST_MS = '200'
    settings.update({ update: { auto: false } })
    const off = new UpdateService(hooks, () => day)
    off.start()
    await sleep(900)
    check('更新：关掉自动检查后不检查', off.state().status === 'idle')
    off.stop()
    settings.update({ update: { auto: true } })
    const on = new UpdateService(hooks, () => day)
    on.start()
    for (let i = 0; i < 40 && on.state().status !== 'available'; i++) await sleep(150)
    check('更新：开着自动检查时启动后自动检查', on.state().status === 'available', on.state().status)
    on.stop()

    process.env.CCSHELL_UPDATE_FEED = 'http://127.0.0.1:9'
    const down = new UpdateService(hooks, () => day)
    s = await down.check()
    check('更新：连不上时说明网络问题', s.status === 'error' && !!s.error?.includes('连不上'), JSON.stringify(s.error))
  } finally {
    delete process.env.CCSHELL_UPDATE_FEED
    delete process.env.CCSHELL_UPDATE_FIRST_MS
    gh.server.close()
    settings.update({ update: saved })
    rmSync(join(cacheDir(), 'updater'), { recursive: true, force: true })
    rmSync(join(cacheDir(), 'updater-config.yml'), { force: true })
  }
}
