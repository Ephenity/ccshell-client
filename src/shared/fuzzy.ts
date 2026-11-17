export function matches(text: string, query: string): boolean {
  const t = text.toLowerCase()
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => {
      if (t.includes(w)) return true
      let i = 0
      for (const ch of t) if (ch === w[i]) i++
      return i === w.length
    })
}
