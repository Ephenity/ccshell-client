import { randomBytes } from 'node:crypto'
import { mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { cacheDir } from '../paths'

const KEEP_MS = 7 * 24 * 3600_000
const MAX_BYTES = 30 * 1024 * 1024
const EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/bmp': 'bmp'
}

export function pastedDir(): string {
  return join(cacheDir(), 'pasted-images')
}

export function savePastedImage(data: Uint8Array, mediaType: string): string {
  const ext = EXT[mediaType.toLowerCase()]
  if (!ext) throw new Error('只支持粘贴图片（PNG、JPEG、GIF、WebP、BMP）')
  if (data.byteLength > MAX_BYTES) throw new Error('图片超过 30MB')
  const dir = pastedDir()
  mkdirSync(dir, { recursive: true })
  prune(dir)
  const d = new Date()
  const p2 = (n: number) => String(n).padStart(2, '0')
  const name = `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}-${randomBytes(3).toString('hex')}.${ext}`
  const file = join(dir, name)
  writeFileSync(file, data)
  return file
}

function prune(dir: string): void {
  const now = Date.now()
  try {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f)
      try {
        if (now - statSync(p).mtimeMs > KEEP_MS) rmSync(p, { force: true })
      } catch {
      }
    }
  } catch {
  }
}
