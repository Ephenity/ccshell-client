import type { ClaudeAccount } from './terminal'
export interface PromptItem {
  id: string
  title: string
  text: string
  pinned: boolean
  createdAt: number
  updatedAt: number
  usedAt?: number
  useCount: number
}

export type PromptPatch = Partial<Pick<PromptItem, 'title' | 'text' | 'pinned'>>

export function sortPrompts(list: PromptItem[]): PromptItem[] {
  const key = (p: PromptItem) => p.usedAt ?? p.createdAt
  return [...list].sort((a, b) => Number(b.pinned) - Number(a.pinned) || key(b) - key(a))
}

export const promptLabel = (p: Pick<PromptItem, 'title' | 'text'>) => p.title.trim() || p.text.trim().split('\n')[0].slice(0, 40) || '（空）'

export const PLACEHOLDER_HELP = '{date} 今天的日期 · {time} 现在的时间 · {weekday} 星期几 · {project} 会话的项目文件夹名'

export type PromptUse =
  | { action: 'insert'; sessionId: string }
  | { action: 'queue'; sessionId: string }
  | { action: 'new'; cwd: string; title?: string; model?: string; allModels?: boolean; account?: ClaudeAccount; anthropicId?: string }
  | { action: 'copy'; sessionId?: string }
