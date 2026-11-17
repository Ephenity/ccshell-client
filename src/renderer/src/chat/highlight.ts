import { bundledLanguages, createHighlighter, type BundledLanguage, type Highlighter } from 'shiki'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'

let highlighter: Promise<Highlighter> | null = null
const loading = new Map<string, Promise<void>>()

const ALIASES: Record<string, string> = { sh: 'bash', shell: 'bash', zsh: 'bash', ps: 'powershell', ps1: 'powershell', py: 'python', js: 'javascript', ts: 'typescript', yml: 'yaml', md: 'markdown', 'c++': 'cpp', 'c#': 'csharp', cs: 'csharp' }

export async function highlight(code: string, lang: string): Promise<string | null> {
  const name = (ALIASES[lang.toLowerCase()] ?? lang.toLowerCase()) as BundledLanguage
  if (!(name in bundledLanguages)) return null
  highlighter ??= createHighlighter({ themes: ['github-light', 'github-dark'], langs: [], engine: createJavaScriptRegexEngine() })
  const h = await highlighter
  if (!h.getLoadedLanguages().includes(name)) {
    if (!loading.has(name)) loading.set(name, h.loadLanguage(name))
    await loading.get(name)
  }
  return h.codeToHtml(code, { lang: name, themes: { light: 'github-light', dark: 'github-dark' }, defaultColor: false })
}
