import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

export const HOST_PROTOCOL = 2

export const HOST_KEY_ENV = 'CCSHELL_HOST_KEY'
export const mac = (key: Buffer, data: string) => createHmac('sha256', key).update(data).digest('hex')
export const macEqual = (a: unknown, b: string) => typeof a === 'string' && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b))
export const newNonce = () => randomBytes(16).toString('hex')

export const pipeName = (userData: string, key: Buffer) =>
  `\\\\.\\pipe\\ccshell-host-${createHash('sha1').update(userData.toLowerCase()).digest('hex').slice(0, 16)}-${mac(key, 'pipe').slice(0, 16)}`

export const mainProof = (key: Buffer, hostNonce: string, mainNonce: string) => mac(key, `main|${hostNonce}|${mainNonce}`)
export const hostProof = (key: Buffer, hostNonce: string, mainNonce: string) => mac(key, `host|${mainNonce}|${hostNonce}`)

export function attachTicket(key: Buffer, id: string, ttlMs = 120_000): string {
  const exp = Date.now() + ttlMs
  const n = newNonce()
  return `${exp}.${n}.${mac(key, `attach|${id}|${exp}|${n}`)}`
}

export function checkTicket(key: Buffer, id: string, ticket: unknown): boolean {
  if (typeof ticket !== 'string') return false
  const [exp, n, sig] = ticket.split('.')
  if (!exp || !n || !sig || !(Number(exp) > Date.now())) return false
  return macEqual(sig, mac(key, `attach|${id}|${exp}|${n}`))
}

export interface HostSession {
  id: string
  pid: number
  cols: number
  rows: number
  meta: unknown
  buffer: string
  attached: boolean
}

export interface SpawnRequest {
  id: string
  file: string
  args: string[]
  cwd: string
  env: Record<string, string>
  cols: number
  rows: number
  meta: unknown
}

export type MainMsg =
  | { t: 'hello'; role: 'main'; n: number; nonce: string; proof: string }
  | { t: 'spawn'; n: number; req: SpawnRequest }
  | { t: 'list'; n: number }
  | { t: 'write'; id: string; data: string }
  | { t: 'resize'; id: string; cols: number; rows: number }
  | { t: 'kill'; id: string }
  | { t: 'meta'; id: string; meta: unknown }
  | { t: 'reclaim'; id: string }
  | { t: 'quit'; n: number }

export type HostMsg =
  | { t: 'challenge'; nonce: string }
  | { t: 'reply'; n: number; ok: boolean; error?: string; data?: unknown }
  | { t: 'data'; id: string; data: string }
  | { t: 'exit'; id: string; code: number }
  | { t: 'attach'; id: string; on: boolean }

export type AttachMsg = { t: 'hello'; role: 'attach'; id: string; ticket: string; cols: number; rows: number } | { t: 'input'; data: string } | { t: 'resize'; cols: number; rows: number }

export type ToAttachMsg =
  | { t: 'ok'; title: string }
  | { t: 'error'; error: string }
  | { t: 'data'; data: string }
  | { t: 'exit'; code: number }
  | { t: 'close' }

export function lineReader(onMsg: (msg: unknown) => void): (chunk: Buffer | string) => void {
  let rest = ''
  return (chunk) => {
    rest += chunk.toString()
    let i: number
    while ((i = rest.indexOf('\n')) >= 0) {
      const line = rest.slice(0, i)
      rest = rest.slice(i + 1)
      if (!line.trim()) continue
      try {
        onMsg(JSON.parse(line))
      } catch {
      }
    }
  }
}

export const frame = (msg: unknown) => JSON.stringify(msg) + '\n'
