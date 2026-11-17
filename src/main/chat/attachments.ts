import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { app, protocol } from 'electron'
import type { Attachment, AttachmentKind } from '../../shared/chat'

const IMAGE_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp'
}
const TEXT_EXT = new Set(
  '.txt .md .markdown .json .jsonl .csv .tsv .xml .yaml .yml .toml .ini .log .html .htm .css .scss .js .jsx .ts .tsx .mjs .cjs .py .java .c .h .cpp .hpp .cs .go .rs .rb .php .sh .ps1 .bat .sql .vue .svelte .kt .swift .lua .r .m .dart'.split(
    ' '
  )
)

const LIMITS: Record<AttachmentKind, number> = { image: 5 << 20, pdf: 32 << 20, text: 1 << 20 }
const LIMIT_TEXT: Record<AttachmentKind, string> = { image: '5 MB', pdf: '32 MB', text: '1 MB' }

const dir = () => join(app.getPath('userData'), 'chats', 'files')
const dataFile = (id: string) => join(dir(), id)
const metaFile = (id: string) => join(dir(), `${id}.json`)

function classify(name: string, mediaType?: string): { kind: AttachmentKind; mediaType: string } | null {
  const ext = extname(name).toLowerCase()
  if (IMAGE_TYPES[ext] || mediaType?.startsWith('image/')) {
    const type = IMAGE_TYPES[ext] ?? mediaType!
    return Object.values(IMAGE_TYPES).includes(type) ? { kind: 'image', mediaType: type } : null
  }
  if (ext === '.pdf' || mediaType === 'application/pdf') return { kind: 'pdf', mediaType: 'application/pdf' }
  if (TEXT_EXT.has(ext) || mediaType?.startsWith('text/')) return { kind: 'text', mediaType: 'text/plain' }
  return null
}

export function saveAttachment(name: string, data: Uint8Array, mediaType?: string): Attachment {
  const type = classify(name, mediaType)
  if (!type) throw new Error(`不支持的文件类型：${name}（支持图片、PDF 和文本/代码文件）`)
  if (data.byteLength > LIMITS[type.kind]) throw new Error(`${name} 太大，${type.kind === 'image' ? '图片' : type.kind === 'pdf' ? 'PDF' : '文本文件'}最大 ${LIMIT_TEXT[type.kind]}`)
  if (type.kind === 'text' && new TextDecoder('utf-8', { fatal: false }).decode(data).includes('\u0000'))
    throw new Error(`${name} 看起来不是文本文件`)
  mkdirSync(dir(), { recursive: true })
  const att: Attachment = { id: randomUUID(), name, mediaType: type.mediaType, size: data.byteLength, kind: type.kind }
  writeFileSync(dataFile(att.id), data)
  writeFileSync(metaFile(att.id), JSON.stringify(att))
  return att
}

export function saveAttachmentFromPath(path: string): Attachment {
  const size = statSync(path).size
  const type = classify(path)
  if (!type) throw new Error(`不支持的文件类型：${basename(path)}（支持图片、PDF 和文本/代码文件）`)
  if (size > LIMITS[type.kind]) throw new Error(`${basename(path)} 太大，最大 ${LIMIT_TEXT[type.kind]}`)
  return saveAttachment(basename(path), readFileSync(path))
}

export function readAttachment(id: string): Buffer {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error('附件 id 无效')
  return readFileSync(dataFile(id))
}

export function deleteAttachments(ids: string[]): void {
  for (const id of ids) {
    if (!/^[0-9a-f-]{36}$/.test(id)) continue
    rmSync(dataFile(id), { force: true })
    rmSync(metaFile(id), { force: true })
  }
}

export function registerAttachmentScheme(): void {
  protocol.registerSchemesAsPrivileged([{ scheme: 'ccfile', privileges: { standard: true, secure: true, supportFetchAPI: true } }])
}

export function handleAttachmentProtocol(): void {
  protocol.handle('ccfile', (req) => {
    const id = decodeURIComponent(new URL(req.url).pathname.slice(1))
    try {
      const meta = JSON.parse(readFileSync(metaFile(id), 'utf8')) as Attachment
      return new Response(readAttachment(id), { headers: { 'Content-Type': meta.mediaType } })
    } catch {
      return new Response('not found', { status: 404 })
    }
  })
}
