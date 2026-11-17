import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import { Terminal, type ITheme } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import type { ThemeName } from '../../../shared/theme'

const ANSI: Record<ThemeName, Omit<ITheme, 'background' | 'foreground' | 'cursor' | 'selectionBackground'>> = {
  dark: {
    black: '#2b2925',
    red: '#e5675a',
    green: '#8db580',
    yellow: '#e2b65e',
    blue: '#7aa2d6',
    magenta: '#c49bd6',
    cyan: '#6fbfb3',
    white: '#d9d6cc',
    brightBlack: '#6f6b62',
    brightRed: '#f08a7e',
    brightGreen: '#a9cf9c',
    brightYellow: '#f0cd85',
    brightBlue: '#9dbde6',
    brightMagenta: '#d8b8e6',
    brightCyan: '#92d6cb',
    brightWhite: '#f6f4ee'
  },
  light: {
    black: '#2b2925',
    red: '#c8443a',
    green: '#4f8a42',
    yellow: '#a87a1c',
    blue: '#3d6aa8',
    magenta: '#8a4fa3',
    cyan: '#2f8578',
    white: '#8a867c',
    brightBlack: '#6f6b62',
    brightRed: '#d9574c',
    brightGreen: '#5e9e50',
    brightYellow: '#b88a2a',
    brightBlue: '#4f7cbb',
    brightMagenta: '#9c60b5',
    brightCyan: '#3a988a',
    brightWhite: '#1f1d1a'
  }
}

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

export function xtermTheme(theme: ThemeName): ITheme {
  return {
    ...ANSI[theme],
    background: cssVar('--bg'),
    foreground: cssVar('--text'),
    cursor: cssVar('--brand'),
    cursorAccent: cssVar('--bg'),
    selectionBackground: theme === 'dark' ? 'rgba(217,119,87,0.35)' : 'rgba(217,119,87,0.28)'
  }
}

const MIN_CONTRAST: Record<ThemeName, number> = { dark: 6, light: 5 }

interface Entry {
  term: Terminal
  fit: FitAddon
  ready: boolean
  queue: string[]
  host: HTMLDivElement
  gpu: WebglAddon | null
}

const entries = new Map<string, Entry>()
let listening = false

function listen() {
  if (listening) return
  listening = true
  window.ccshell.terminal.onData(({ id, data }) => {
    const e = entries.get(id)
    if (!e) return
    if (e.ready) e.term.write(data)
    else e.queue.push(data)
  })
}

const monoReady = Promise.all(['400', '600'].map((w) => document.fonts.load(`${w} 14px "JetBrains Mono"`))).catch(() => undefined)

function trackImeAnchor(term: Terminal, host: HTMLDivElement) {
  let cursorHidden = false
  const onMode = (show: boolean) => (params: (number | number[])[]) => {
    if (params.some((p) => p === 25)) cursorHidden = !show
    return false
  }
  term.parser.registerCsiHandler({ prefix: '?', final: 'h' }, onMode(true))
  term.parser.registerCsiHandler({ prefix: '?', final: 'l' }, onMode(false))
  term.parser.registerEscHandler({ final: 'c' }, () => {
    cursorHidden = false
    return false
  })

  let pending = false
  const update = () => {
    pending = false
    const screen = host.querySelector<HTMLElement>('.xterm-screen')
    const spot = cursorHidden ? findInverseCell(term) : null
    if (!screen || !spot || !term.cols || !term.rows) {
      host.classList.remove('ime-anchored')
      return
    }
    const cellW = screen.clientWidth / term.cols
    const cellH = screen.clientHeight / term.rows
    host.style.setProperty('--ime-x', `${spot.x * cellW}px`)
    host.style.setProperty('--ime-y', `${spot.y * cellH}px`)
    host.classList.add('ime-anchored')
  }
  const schedule = () => {
    if (pending) return
    pending = true
    requestAnimationFrame(update)
  }
  term.onRender(schedule)
  term.onCursorMove(schedule)
  term.onResize(schedule)
  term.textarea?.addEventListener('compositionstart', update)
}

function findInverseCell(term: Terminal): { x: number; y: number } | null {
  const buf = term.buffer.active
  const cell = buf.getNullCell()
  for (let y = term.rows - 1; y >= 0; y--) {
    const line = buf.getLine(buf.viewportY + y)
    if (!line) continue
    for (let x = term.cols - 1; x >= 0; x--) {
      if (line.getCell(x, cell)?.isInverse()) return { x, y }
    }
  }
  return null
}

export function getTerminal(id: string, theme: ThemeName): Entry {
  listen()
  let e = entries.get(id)
  if (e) return e

  const term = new Terminal({
    fontFamily: cssVar('--font-mono') || 'Consolas, monospace',
    fontSize: 14,
    lineHeight: 1.15,
    cursorBlink: true,
    allowProposedApi: true,
    scrollback: 10_000,
    minimumContrastRatio: MIN_CONTRAST[theme],
    theme: xtermTheme(theme)
  })
  const fit = new FitAddon()
  term.loadAddon(fit)
  const host = document.createElement('div')
  host.style.width = '100%'
  host.style.height = '100%'
  term.open(host)

  void monoReady.then(() => {
    term.options.fontFamily = `${cssVar('--font-mono') || 'monospace'}, monospace`
    try {
      fit.fit()
    } catch {
    }
  })

  trackImeAnchor(term, host)

  term.onData((d) => window.ccshell.terminal.write(id, d))
  term.onResize(({ cols, rows }) => window.ccshell.terminal.resize(id, cols, rows))
  term.attachCustomKeyEventHandler((ev) => {
    if (ev.type !== 'keydown' || !ev.ctrlKey || ev.altKey) return true
    const key = ev.key.toLowerCase()
    if (key === 'c' && term.hasSelection()) {
      void navigator.clipboard.writeText(term.getSelection())
      term.clearSelection()
      return false
    }
    if (key === 'v' && !ev.shiftKey) return false
    return true
  })

  e = { term, fit, ready: false, queue: [], host, gpu: null }
  entries.set(id, e)
  const entry = e
  void window.ccshell.terminal.buffer(id).then((r) => {
    entry.queue = []
    if (r.ok) term.write(r.data)
    entry.ready = true
  })
  return e
}

export function enableGpu(e: Entry) {
  if (e.gpu) return
  try {
    const gpu = new WebglAddon()
    gpu.onContextLoss(() => {
      gpu.dispose()
      if (e.gpu === gpu) e.gpu = null
    })
    e.term.loadAddon(gpu)
    e.gpu = gpu
  } catch {
    e.gpu = null
  }
}

export function disposeTerminal(id: string) {
  const e = entries.get(id)
  if (!e) return
  entries.delete(id)
  e.term.dispose()
  e.host.remove()
}

export function setTerminalTheme(theme: ThemeName) {
  requestAnimationFrame(() => {
    for (const e of entries.values()) {
      e.term.options.theme = xtermTheme(theme)
      e.term.options.minimumContrastRatio = MIN_CONTRAST[theme]
    }
  })
}

if (__TEST_HOOKS__) (window as unknown as { __ccshellTermWrite?: (id: string, data: string) => void }).__ccshellTermWrite = (id, data) => entries.get(id)?.term.write(data)
