export type KnowledgeItemType = 'file' | 'folder' | 'url'
export type KnowledgeItemStatus = 'pending' | 'indexing' | 'ready' | 'error'

export interface KnowledgeItem {
  id: string
  type: KnowledgeItemType
  source: string
  name: string
  status: KnowledgeItemStatus
  error?: string
  docCount: number
  chunkCount: number
  skipped?: string[]
  updatedAt: number
}

export interface KnowledgeBase {
  id: string
  name: string
  description: string
  embeddingModel: string
  createdAt: number
  items: KnowledgeItem[]
}

export interface KnowledgeHit {
  baseId: string
  baseName: string
  itemId: string
  doc: string
  chunk: number
  text: string
  score: number
  via: ('keyword' | 'vector')[]
}

export const KNOWLEDGE_TEXT_EXT = [
  'txt', 'md', 'markdown', 'rst', 'csv', 'tsv', 'json', 'jsonl', 'yaml', 'yml', 'toml', 'ini', 'xml', 'html', 'htm', 'log',
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py', 'java', 'kt', 'go', 'rs', 'c', 'h', 'cpp', 'hpp', 'cs', 'rb', 'php', 'swift',
  'sh', 'ps1', 'bat', 'sql', 'css', 'scss', 'vue', 'svelte', 'lua', 'r', 'm', 'tex'
]
export const KNOWLEDGE_DOC_EXT = ['pdf', 'docx']
