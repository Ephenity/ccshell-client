const CHUNK = 800
const OVERLAP = 120

export function chunkText(text: string): string[] {
  const paras = text
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
  const pieces: string[] = []
  for (const p of paras) {
    if (p.length <= CHUNK) pieces.push(p)
    else {
      let buf = ''
      for (const s of p.split(/(?<=[。！？!?；;.\n])/)) {
        if (buf.length + s.length > CHUNK && buf) {
          pieces.push(buf)
          buf = ''
        }
        if (s.length > CHUNK) for (let i = 0; i < s.length; i += CHUNK) pieces.push(s.slice(i, i + CHUNK))
        else buf += s
      }
      if (buf) pieces.push(buf)
    }
  }
  const chunks: string[] = []
  let cur = ''
  for (const piece of pieces) {
    if (cur && cur.length + piece.length + 2 > CHUNK) {
      chunks.push(cur)
      const tail = cur.slice(-OVERLAP)
      cur = (tail.length < cur.length ? tail : '') + '\n\n' + piece
      cur = cur.trim()
    } else cur = cur ? cur + '\n\n' + piece : piece
  }
  if (cur.trim()) chunks.push(cur)
  return chunks
}

const segmenter = new Intl.Segmenter('zh', { granularity: 'word' })
const CJK = /[㐀-鿿豈-﫿]/

export function tokenize(text: string): string[] {
  const out: string[] = []
  for (const s of segmenter.segment(text.toLowerCase())) {
    if (!s.isWordLike) continue
    const w = s.segment
    out.push(w)
    if (CJK.test(w) && w.length > 2) for (let i = 0; i + 1 < w.length; i++) out.push(w.slice(i, i + 2))
  }
  return out
}

export interface Bm25Index {
  docs: { tf: Map<string, number>; len: number }[]
  df: Map<string, number>
  avgLen: number
}

export function buildBm25(texts: string[]): Bm25Index {
  const df = new Map<string, number>()
  let total = 0
  const docs = texts.map((t) => {
    const tf = new Map<string, number>()
    const toks = tokenize(t)
    for (const tok of toks) tf.set(tok, (tf.get(tok) ?? 0) + 1)
    for (const tok of tf.keys()) df.set(tok, (df.get(tok) ?? 0) + 1)
    total += toks.length
    return { tf, len: toks.length }
  })
  return { docs, df, avgLen: docs.length ? total / docs.length : 0 }
}

export function searchBm25(index: Bm25Index, query: string, k1 = 1.2, b = 0.75): [number, number][] {
  const terms = [...new Set(tokenize(query))]
  const N = index.docs.length
  const out: [number, number][] = []
  index.docs.forEach((d, i) => {
    let score = 0
    for (const t of terms) {
      const f = d.tf.get(t)
      if (!f) continue
      const n = index.df.get(t) ?? 0
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5))
      score += (idf * f * (k1 + 1)) / (f + k1 * (1 - b + (b * d.len) / (index.avgLen || 1)))
    }
    if (score > 0) out.push([i, score])
  })
  return out.sort((a, b) => b[1] - a[1])
}

export function cosine(a: Float32Array | number[], b: Float32Array | number[]): number {
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0
}

export function fuseRanks(lists: [number, number][][], k = 60): { id: number; score: number; from: number[] }[] {
  const acc = new Map<number, { score: number; from: number[] }>()
  lists.forEach((list, li) =>
    list.forEach(([id], rank) => {
      const e = acc.get(id) ?? { score: 0, from: [] }
      e.score += 1 / (k + rank + 1)
      e.from.push(li)
      acc.set(id, e)
    })
  )
  return [...acc.entries()].map(([id, e]) => ({ id, ...e })).sort((a, b) => b.score - a.score)
}
