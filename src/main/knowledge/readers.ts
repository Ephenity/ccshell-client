import { readFileSync, statSync } from 'node:fs'
import { extname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { BrowserWindow, session } from 'electron'
import { KNOWLEDGE_DOC_EXT, KNOWLEDGE_TEXT_EXT } from '../../shared/knowledge'

const MAX_FILE = 30 * 1024 * 1024

export const extOf = (p: string) => extname(p).slice(1).toLowerCase()
export const isSupported = (p: string) => KNOWLEDGE_TEXT_EXT.includes(extOf(p)) || KNOWLEDGE_DOC_EXT.includes(extOf(p))

export async function readDocument(path: string): Promise<string> {
  const size = statSync(path).size
  if (size > MAX_FILE) throw new Error(`文件太大（${(size / 1024 / 1024).toFixed(0)} MB，上限 30 MB）`)
  const ext = extOf(path)
  const buf = readFileSync(path)
  if (ext === 'pdf') return readPdf(buf)
  if (ext === 'docx') {
    const mammoth = await import('mammoth')
    return (await mammoth.extractRawText({ buffer: buf })).value
  }
  if (!KNOWLEDGE_TEXT_EXT.includes(ext)) throw new Error(`不支持的文件类型：.${ext}`)
  if (buf.subarray(0, 8000).includes(0)) throw new Error('看起来是二进制文件')
  const text = buf.toString('utf8').replace(/^﻿/, '')
  return ext === 'html' || ext === 'htm' ? htmlToText(text) : text
}

async function readPdf(buf: Buffer): Promise<string> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs')).href
  const task = pdfjs.getDocument({ data: new Uint8Array(buf), useSystemFonts: false, disableFontFace: true, verbosity: 0 })
  const doc = await task.promise
  const pages: string[] = []
  try {
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i)
      const content = await page.getTextContent()
      let text = ''
      for (const item of content.items) if ('str' in item) text += item.str + (item.hasEOL ? '\n' : '')
      pages.push(text.trim())
    }
  } finally {
    await task.destroy()
  }
  const text = pages.filter(Boolean).join('\n\n')
  if (!text.trim()) throw new Error('PDF 里没有文字（可能是扫描版图片）')
  return text
}

function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, '')
    .replace(/<\/(p|div|h\d|li|tr|br|section|article)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
}

export async function readUrl(url: string): Promise<{ title: string; text: string }> {
  if (!/^https?:\/\//i.test(url)) throw new Error('网址要以 http:// 或 https:// 开头')
  const win = new BrowserWindow({
    show: false,
    width: 1280,
    height: 900,
    webPreferences: { session: session.fromPartition('knowledge-fetch'), sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: true }
  })
  win.webContents.setAudioMuted(true)
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  try {
    await Promise.race([
      win.loadURL(url),
      new Promise((_, reject) => setTimeout(() => reject(new Error('打开网页超时（30 秒）')), 30_000))
    ])
    await new Promise((r) => setTimeout(r, 1200))
    const r = (await win.webContents.executeJavaScript(`(() => {
      const pick = document.querySelector('article') || document.querySelector('main') || document.querySelector('[role=main]') || document.body
      return { title: document.title, text: pick ? pick.innerText : '' }
    })()`)) as { title: string; text: string }
    const text = (r.text ?? '').replace(/\n{3,}/g, '\n\n').trim()
    if (!text) throw new Error('网页里没有读到文字')
    return { title: (r.title ?? '').trim() || url, text }
  } finally {
    win.destroy()
  }
}
