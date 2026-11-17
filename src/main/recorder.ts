import { spawn, type ChildProcess } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { app, type BrowserWindow, type WebContents } from 'electron'
import { testEnv } from './testhooks'

export const REC = { width: 1440, height: 900, scale: 4 / 3, fps: 30 }

type Spec = string | { text?: string; sel?: string; within?: string; index?: number; exact?: boolean; dx?: number; dy?: number }
type Target = Spec | { x: number; y: number }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const rand = (a: number, b: number) => a + Math.random() * (b - a)

const OVERLAY = String.raw`(() => {
  if (window.__rec) return
  const NS = 'http://www.w3.org/2000/svg'
  const style = document.createElement('style')
  style.textContent = '#rec-cursor{position:fixed;left:0;top:0;width:26px;height:26px;z-index:2147483647;pointer-events:none;will-change:transform;filter:drop-shadow(0 1.5px 2px rgba(0,0,0,.28))}' +
    '#rec-cursor svg{transition:transform 90ms ease-out;transform-origin:3px 2px}#rec-cursor.down svg{transform:scale(.86)}' +
    '.rec-ripple{position:fixed;width:34px;height:34px;margin:-17px 0 0 -17px;border-radius:50%;z-index:2147483646;pointer-events:none;border:2px solid #d97757;background:rgba(217,119,87,.18);animation:rec-r 460ms cubic-bezier(.2,.7,.3,1) forwards}' +
    '@keyframes rec-r{from{transform:scale(.25);opacity:.95}to{transform:scale(1.25);opacity:0}}' +
    '#rec-ctl{position:fixed;top:0;right:0;height:40px;display:flex;z-index:2147483645;pointer-events:none;color:#b8b2a8}:root[data-theme=light] #rec-ctl{color:#5a554e}' +
    '#rec-ctl span{width:46px;height:40px;display:grid;place-items:center}'
  document.head.appendChild(style)
  const cur = document.createElement('div')
  cur.id = 'rec-cursor'
  cur.innerHTML = '<svg width="26" height="26" viewBox="0 0 26 26"><path d="M3 2 L3 20.5 L7.6 16.4 L10.6 23.2 L13.9 21.8 L10.9 15.1 L17.2 15.1 Z" fill="#fff" stroke="#1d1b18" stroke-width="1.4" stroke-linejoin="round"/></svg>'
  document.body.appendChild(cur)
  const ctl = document.createElement('div')
  ctl.id = 'rec-ctl'
  const g = (d) => '<span><svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1">' + d + '</svg></span>'
  ctl.innerHTML = g('<path d="M0 5.5h10"/>') + g('<rect x=".5" y=".5" width="9" height="9"/>') + g('<path d="M.5.5l9 9M9.5.5l-9 9"/>')
  document.body.appendChild(ctl)
  let x = -100, y = -100
  const place = () => (cur.style.transform = 'translate(' + (x - 3) + 'px,' + (y - 2) + 'px)')
  place()
  addEventListener('mousemove', (e) => { x = e.clientX; y = e.clientY; place() }, true)
  addEventListener('mousedown', (e) => {
    cur.classList.add('down')
    const r = document.createElement('div')
    r.className = 'rec-ripple'
    r.style.left = e.clientX + 'px'
    r.style.top = e.clientY + 'px'
    document.body.appendChild(r)
    setTimeout(() => r.remove(), 600)
  }, true)
  addEventListener('mouseup', () => cur.classList.remove('down'), true)
  const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden' }
  window.__rec = {
    cursor: (show) => (cur.style.display = show ? '' : 'none'),
    find(spec) {
      if (typeof spec === 'string') spec = { sel: spec }
      const root = spec.within ? document.querySelector(spec.within) : document
      if (!root) return null
      let els = [...root.querySelectorAll(spec.sel || 'button,[role=button],a,input,textarea,[role=tab],[role=option],[role=menuitem],label,li,span,div,p')].filter(visible)
      if (spec.text) {
        const t = spec.text
        els = els.filter((el) => (spec.exact ? el.textContent.trim() === t : el.textContent.includes(t)) || el.getAttribute('aria-label') === t || el.getAttribute('title') === t || el.getAttribute('placeholder')?.includes(t))
        els = els.filter((el) => !els.some((o) => o !== el && el.contains(o)))
      }
      const el = els[spec.index ?? 0]
      if (!el) return null
      el.scrollIntoView({ block: 'nearest' })
      const r = el.getBoundingClientRect()
      return { x: r.left + r.width / 2 + (spec.dx || 0), y: r.top + r.height / 2 + (spec.dy || 0), w: r.width, h: r.height, left: r.left, top: r.top }
    }
  }
})()`

class Recorder {
  private frame: Buffer | null = null
  private size = { width: 0, height: 0 }
  private ff: ChildProcess | null = null
  private timer: NodeJS.Timeout | null = null
  private t0 = 0
  private written = 0
  private done: Promise<void> | null = null
  private marks: Record<string, number> = {}

  constructor(
    private wc: WebContents,
    private out: string,
    private ffmpeg: string
  ) {
    wc.setFrameRate(REC.fps * 2)
    wc.on('paint', (_e, _dirty, image) => {
      this.size = image.getSize()
      this.frame = image.toBitmap()
    })
  }

  start(): void {
    if (this.ff) return
    if (!this.frame) this.wc.invalidate()
    const { width, height } = this.size
    this.ff = spawn(this.ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'bgra', '-s', `${width}x${height}`, '-framerate', String(REC.fps), '-i', '-',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '4', '-pix_fmt', 'yuv444p', this.out], { stdio: ['pipe', 'ignore', 'inherit'] })
    this.done = new Promise((r) => this.ff!.on('close', () => r()))
    this.t0 = performance.now()
    this.written = 0
    const tick = () => {
      if (!this.ff) return
      const due = Math.floor(((performance.now() - this.t0) * REC.fps) / 1000) + 1
      while (this.written < due) {
        if (this.frame && this.ff.stdin!.writableLength < 200 * 1024 * 1024) this.ff.stdin!.write(this.frame)
        else if (this.frame) console.warn('[录制] 写入积压，丢一帧')
        this.written++
      }
      this.timer = setTimeout(tick, 4)
    }
    tick()
  }

  mark(name: string): void {
    this.marks[name] = this.ff ? (performance.now() - this.t0) / 1000 : 0
  }

  async stop(): Promise<Record<string, number>> {
    if (this.timer) clearTimeout(this.timer)
    const ff = this.ff
    this.ff = null
    if (ff) {
      ff.stdin!.end()
      await this.done
    }
    return { ...this.marks, duration: this.written / REC.fps }
  }
}

export function makeDirector(wc: WebContents, rec: Recorder, mockUrl: string) {
  let pos = { x: REC.width * 0.62, y: REC.height * 0.7 }
  const js = <T = unknown>(code: string): Promise<T> => wc.executeJavaScript(code, true) as Promise<T>
  const mouse = (type: 'mouseMove' | 'mouseDown' | 'mouseUp', down = false) =>
    wc.sendInputEvent({ type, x: Math.round(pos.x), y: Math.round(pos.y), button: 'left', clickCount: 1, modifiers: down ? ['leftbuttondown'] : [] })

  async function find(spec: Spec, timeout = 8000): Promise<{ x: number; y: number; w: number; h: number; left: number; top: number }> {
    const end = Date.now() + timeout
    for (;;) {
      const r = await js<{ x: number; y: number; w: number; h: number; left: number; top: number } | null>(`window.__rec.find(${JSON.stringify(spec)})`)
      if (r) return r
      if (Date.now() > end) throw new Error('找不到元素：' + JSON.stringify(spec))
      await sleep(120)
    }
  }
  const point = async (t: Target) => (typeof t === 'object' && 'x' in t ? t : await find(t))

  async function move(t: Target, duration?: number, down = false): Promise<void> {
    const to = await point(t)
    const from = { ...pos }
    const dist = Math.hypot(to.x - from.x, to.y - from.y)
    if (dist < 1) return
    const ms = duration ?? Math.min(1000, 280 + dist * 0.55)
    const bend = rand(-0.08, 0.08) * dist
    const nx = -(to.y - from.y) / dist
    const ny = (to.x - from.x) / dist
    const t0 = Date.now()
    for (;;) {
      const k = Math.min(1, (Date.now() - t0) / ms)
      const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2
      const arc = Math.sin(Math.PI * e) * bend
      pos = { x: from.x + (to.x - from.x) * e + nx * arc, y: from.y + (to.y - from.y) * e + ny * arc }
      mouse('mouseMove', down)
      if (k >= 1) break
      await sleep(14)
    }
  }

  async function click(t?: Target, opts: { after?: number; duration?: number } = {}): Promise<void> {
    if (t !== undefined) await move(t, opts.duration)
    await sleep(110)
    mouse('mouseDown', true)
    await sleep(85)
    mouse('mouseUp')
    await sleep(opts.after ?? 350)
  }

  async function type(text: string, cps = 13): Promise<void> {
    for (const ch of text) {
      if (ch === '\n') await key('Enter')
      else wc.sendInputEvent({ type: 'char', keyCode: ch })
      await sleep((1000 / cps) * rand(0.55, 1.45))
    }
  }

  async function key(name: string, modifiers: string[] = []): Promise<void> {
    wc.sendInputEvent({ type: 'keyDown', keyCode: name, modifiers: modifiers as never })
    if (name === 'Enter' && !modifiers.length) wc.sendInputEvent({ type: 'char', keyCode: '\r' })
    await sleep(40)
    wc.sendInputEvent({ type: 'keyUp', keyCode: name, modifiers: modifiers as never })
    await sleep(60)
  }

  async function drag(from: Target, to: Target, duration = 700): Promise<void> {
    await move(from)
    await sleep(120)
    mouse('mouseDown', true)
    await sleep(120)
    await move(to, duration, true)
    await sleep(120)
    mouse('mouseUp')
    await sleep(200)
  }

  async function wheel(t: Target, deltaY: number, steps = 8): Promise<void> {
    await move(t)
    for (let i = 0; i < steps; i++) {
      wc.sendInputEvent({ type: 'mouseWheel', x: Math.round(pos.x), y: Math.round(pos.y), deltaX: 0, deltaY: -deltaY / steps, canScroll: true } as never)
      await sleep(30)
    }
  }

  return {
    js,
    find,
    move,
    click,
    type,
    key,
    drag,
    wheel,
    wait: sleep,
    exists: async (spec: Spec) => !!(await js(`window.__rec.find(${JSON.stringify(spec)})`)),
    api: <T = unknown>(expr: string) => js<T>(`window.ccshell.${expr}`),
    mock: async (path: string, body: unknown) =>
      (await fetch(mockUrl + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json(),
    mockUrl,
    cursor: (show: boolean) => js(`window.__rec.cursor(${show})`),
    async reload(): Promise<void> {
      await new Promise<void>((res) => {
        wc.once('did-finish-load', () => res())
        wc.reload()
      })
      await sleep(500)
      await js(OVERLAY)
      mouse('mouseMove')
    },
    start: () => rec.start(),
    mark: (name: string) => rec.mark(name),
    get pos() {
      return { ...pos }
    },
    setPos(p: { x: number; y: number }) {
      pos = { ...p }
      mouse('mouseMove')
    },
    size: REC
  }
}
export type Director = ReturnType<typeof makeDirector>

export async function runRecording(win: BrowserWindow): Promise<void> {
  const out = testEnv('CCSHELL_RECORD')!
  const scene = testEnv('CCSHELL_RECORD_SCENE')!
  const ffmpeg = testEnv('CCSHELL_RECORD_FFMPEG') ?? 'ffmpeg'
  const mockUrl = testEnv('CCSHELL_RECORD_MOCK') ?? 'http://127.0.0.1:5195'
  const wc = win.webContents
  const rec = new Recorder(wc, out, ffmpeg)
  let code = 0
  try {
    await sleep(600)
    await wc.executeJavaScript(OVERLAY, true)
    wc.focus()
    const r = makeDirector(wc, rec, mockUrl)
    r.setPos(r.pos)
    const mod = (await import(pathToFileURL(scene).href)) as { default: (r: Director) => Promise<void> }
    await mod.default(r)
  } catch (e) {
    code = 1
    console.error('[录制] 场景出错：', e)
  }
  const marks = await rec.stop()
  console.log('[录制] MARKS ' + JSON.stringify(marks))
  app.exit(code)
}
