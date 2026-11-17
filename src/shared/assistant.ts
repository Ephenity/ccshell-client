import type { ChatSettings } from './chat'

export interface Assistant {
  id: string
  name: string
  icon: string
  description: string
  settings: Omit<ChatSettings, 'assistantId'>
  createdAt: number
  updatedAt: number
}

export type AssistantInput = Pick<Assistant, 'name' | 'icon' | 'description' | 'settings'>

export const AGENT_TOOLS = {
  list_dir: { label: '列目录', write: false },
  find_files: { label: '按名字找文件', write: false },
  search_text: { label: '搜文件内容', write: false },
  read_file: { label: '读文件', write: false },
  write_file: { label: '写文件', write: true },
  edit_file: { label: '改文件', write: true },
  run_command: { label: '运行命令', write: true }
} as const

export type AgentToolName = keyof typeof AGENT_TOOLS
