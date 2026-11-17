import {
  BarChart3,
  BookMarked,
  BookOpen,
  Bot,
  Brush,
  Activity,
  BellRing,
  CircleArrowUp,
  Eraser,
  FileText,
  Globe,
  LayoutGrid,
  MessageSquare,
  Plug,
  SquareTerminal,
  Stethoscope,
  UserRound,
  Workflow,
  type LucideIcon,
  KeyRound
} from 'lucide-react'

export type ModuleId = 'chat' | 'code' | 'library' | 'account'
export type LibraryTab = 'agent' | 'prompts' | 'knowledge' | 'mcp'
export type AccountPane = 'overview' | 'usage' | 'claude-code' | 'anthropic' | 'appearance' | 'notify' | 'network' | 'cleanup' | 'logs' | 'env' | 'peers' | 'update'

export type PageId = ModuleId | LibraryTab | AccountPane | 'settings' | 'tools'

export interface Route {
  module: ModuleId
  library: LibraryTab
  account: AccountPane
}

export const LIBRARY_TABS: { id: LibraryTab; label: string; icon: LucideIcon; description: string }[] = [
  { id: 'agent', label: '助手', icon: Bot, description: '保存提示词、模型、工具与知识库的组合；配置工作目录即为 Agent' },
  { id: 'prompts', label: '提示词', icon: BookMarked, description: '可插入输入框、加入队列或用于新建会话' },
  { id: 'knowledge', label: '知识库', icon: BookOpen, description: '导入文档，供模型检索并据此回答' },
  { id: 'mcp', label: 'MCP', icon: Plug, description: '管理 MCP 服务器，供对话与 Agent 调用' }
]

export const ACCOUNT_GROUPS: { title: string; items: { id: AccountPane; label: string; icon: LucideIcon; description: string }[] }[] = [
  {
    title: '账户',
    items: [
      { id: 'overview', label: '概览', icon: UserRound, description: '余额、密钥、近 30 天消费' },
      { id: 'usage', label: '用量', icon: BarChart3, description: 'Claude Code 与对话的 token 用量（本机记录）' }
    ]
  },
  {
    title: '设置',
    items: [
      { id: 'claude-code', label: 'Claude Code', icon: SquareTerminal, description: '安装、更新、模型和启动参数' },
      { id: 'anthropic', label: 'Anthropic 账户', icon: KeyRound, description: '用订阅账户或 API 密钥运行 Claude Code' },
      { id: 'appearance', label: '外观与启动', icon: Brush, description: '主题、开机启动、托盘、悬浮窗与快捷键' },
      { id: 'notify', label: '通知与队列', icon: BellRing, description: '桌面通知、停滞提醒与队列自动继续' },
      { id: 'network', label: '网络', icon: Globe, description: 'npm 源与代理' }
    ]
  },
  {
    title: '维护',
    items: [
      { id: 'cleanup', label: '清理', icon: Eraser, description: '清理缓存、旧日志与临时文件' },
      { id: 'logs', label: '日志', icon: FileText, description: '客户端与 Claude Code 日志' },
      { id: 'env', label: '环境检查', icon: Stethoscope, description: '检查 Node、Claude Code、网络与目录' },
      { id: 'peers', label: '协作记录', icon: Workflow, description: '会话之间发送消息与新建会话的记录' },
      { id: 'update', label: '更新', icon: CircleArrowUp, description: '当前版本、检查更新与一键更新' }
    ]
  }
]

export const MODULES: { id: ModuleId; label: string; icon: LucideIcon; description: string }[] = [
  { id: 'chat', label: '对话', icon: MessageSquare, description: '与 CC Shell 提供的模型对话' },
  { id: 'code', label: 'Claude Code', icon: SquareTerminal, description: '在客户端中运行 Claude Code 终端会话' },
  { id: 'library', label: '资源库', icon: LayoutGrid, description: '助手、提示词、知识库与 MCP' },
  { id: 'account', label: '账户', icon: Activity, description: '余额、用量、设置与维护' }
]

const isLibrary = (p: string): p is LibraryTab => LIBRARY_TABS.some((t) => t.id === p)
const isAccount = (p: string): p is AccountPane => ACCOUNT_GROUPS.some((g) => g.items.some((i) => i.id === p))

export function resolve(prev: Route, to: PageId): Route {
  if (to === 'settings') return { ...prev, module: 'account', account: 'claude-code' }
  if (to === 'tools') return { ...prev, module: 'account', account: 'cleanup' }
  if (to === 'account') return { ...prev, module: 'account', account: 'overview' }
  if (isLibrary(to)) return { ...prev, module: 'library', library: to }
  if (isAccount(to)) return { ...prev, module: 'account', account: to }
  return { ...prev, module: to }
}

export const DESTINATIONS: { id: PageId; label: string; description: string; icon: LucideIcon }[] = [
  ...MODULES.filter((m) => m.id === 'chat' || m.id === 'code'),
  ...LIBRARY_TABS.map((t) => ({ ...t, label: `资源库 · ${t.label}` })),
  ...ACCOUNT_GROUPS.flatMap((g) => g.items.map((i) => ({ ...i, label: `${g.title} · ${i.label}` })))
]
