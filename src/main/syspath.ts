import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { delimiter, join } from 'node:path'

let checkedAt = 0

const KEYS = ['HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment', 'HKCU\\Environment']

function readRegistryPath(key: string): string[] {
  try {
    const reg = join(process.env.SystemRoot ?? process.env.windir ?? 'C:\\Windows', 'System32', 'reg.exe')
    const r = spawnSync(reg, ['query', key, '/v', 'Path'], { encoding: 'utf8', windowsHide: true, timeout: 3000 })
    const m = /^\s*Path\s+REG_(?:EXPAND_)?SZ\s+(.*)$/im.exec(r.stdout ?? '')
    if (!m) return []
    return m[1].split(';').map((d) => expand(d.trim())).filter(Boolean)
  } catch {
    return []
  }
}

function expand(s: string): string {
  return s.replace(/%([^%]+)%/g, (all, name: string) => {
    const k = Object.keys(process.env).find((x) => x.toLowerCase() === name.toLowerCase())
    return k ? (process.env[k] ?? all) : all
  })
}

const norm = (d: string) => d.replace(/^"|"$/g, '').replace(/[\\/]+$/, '').toLowerCase()

export function refreshPath(force = false): void {
  if (process.platform !== 'win32') return
  if (!force && Date.now() - checkedAt < 10_000) return
  checkedAt = Date.now()
  const current = (process.env.PATH ?? '').split(delimiter).filter(Boolean)
  const seen = new Set(current.map(norm))
  const added: string[] = []
  for (const key of KEYS) {
    for (const d of readRegistryPath(key)) {
      if (seen.has(norm(d))) continue
      seen.add(norm(d))
      added.push(d)
    }
  }
  if (added.length) process.env.PATH = [...current, ...added].join(delimiter)
}

export function pathDirs(): string[] {
  refreshPath()
  return (process.env.PATH ?? '')
    .split(delimiter)
    .map((d) => d.replace(/^"|"$/g, ''))
    .filter(Boolean)
}

export function which(name: string): string | null {
  for (const dir of pathDirs()) {
    const p = join(dir, name)
    if (existsSync(p)) return p
  }
  return null
}
