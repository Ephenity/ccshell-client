import { testEnv } from './testhooks'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { app } from 'electron'

export let dataDirProblem: string | null = null

export function relocateAppPaths(): string {
  const testing = testEnv('CCSHELL_SELFTEST') || testEnv('CCSHELL_SCREENSHOT')
  const profile = testing ? 'selftest' : (testEnv('CCSHELL_PROFILE') ?? '').replace(/[^\w-]/g, '')
  const base = app.isPackaged ? dirname(process.execPath) : resolve(app.getAppPath(), '..')
  const dataRoot = resolve(base, 'data', ...(profile ? [profile] : []))
  const dirs = {
    userData: join(dataRoot, 'user'),
    sessionData: join(dataRoot, 'user'),
    logs: join(dataRoot, 'logs'),
    crashDumps: join(dataRoot, 'crash'),
    temp: join(dataRoot, 'tmp')
  } as const
  try {
    for (const dir of Object.values(dirs)) mkdirSync(dir, { recursive: true })
    const probe = join(dataRoot, '.write-test')
    writeFileSync(probe, 'ok')
    rmSync(probe)
  } catch {
    dataDirProblem = dataRoot
    const fallback = join(tmpdir(), 'CC Shell')
    mkdirSync(fallback, { recursive: true })
    for (const name of ['userData', 'sessionData', 'logs', 'crashDumps', 'temp'] as const) app.setPath(name, fallback)
    return dataRoot
  }
  for (const [name, dir] of Object.entries(dirs)) app.setPath(name as Parameters<typeof app.setPath>[0], dir)
  cacheRoot = resolve(dataRoot, ...(profile ? ['..'] : []), '..', '.cache')
  process.env.TEMP = dirs.temp
  process.env.TMP = dirs.temp
  return dataRoot
}

let cacheRoot = ''

export function cacheDir(): string {
  if (!cacheRoot) throw new Error('relocateAppPaths 还没调用')
  mkdirSync(cacheRoot, { recursive: true })
  return cacheRoot
}
