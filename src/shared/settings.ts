import { DEFAULT_ANTHROPIC_ID, type AnthropicAccount } from './anthropic'
import type { ClaudeAccount } from './terminal'
export type QuitAction = 'ask' | 'detach' | 'end'

export type PermissionMode = 'manual' | 'auto' | 'acceptEdits' | 'plan'
export const PERMISSION_MODES: [PermissionMode, string, string][] = [
  ['manual', '每次询问', '需要权限的操作均先确认（推荐）'],
  ['auto', 'auto mode', '由 Claude Code 的安全检查决定是否确认；该检查需连接 Anthropic 服务器，经网关时可能不可用'],
  ['acceptEdits', '自动接受文件修改', '修改文件无需确认，运行命令等仍需确认'],
  ['plan', '仅规划', '只读取与规划，不做修改']
]

export type ClaudeBinaryMode = 'auto' | 'system' | 'custom'

export interface AppSettings {
  claudeCode: {
    model: string
    allModels: boolean
    modelMap: { opus: string; sonnet: string; haiku: string; subagent: string }
    extraArgs: string
    permissionMode: PermissionMode
    account: ClaudeAccount
    binary: ClaudeBinaryMode
    binaryPath: string
    anthropic: {
      method: 'subscription' | 'apikey'
      model: string
    }
    anthropicAccounts: AnthropicAccount[]
    anthropicAccountId: string
  }
  appearance: {
    openAtLogin: boolean
    closeToTray: boolean
    onQuit: QuitAction
    intro: boolean
    onboarded: boolean
    guidedUsers: string[]
  }
  network: {
    registry: 'official' | 'npmmirror' | 'custom'
    customRegistry: string
    proxy: 'system' | 'none' | 'custom'
    customProxy: string
  }
  notify: {
    done: boolean
    attention: boolean
    problem: boolean
    sound: boolean
  }
  stuck: {
    remindMinutes: number
    autoContinue: boolean
    autoMinutes: number
    continueText: string
  }
  queue: {
    autoResume: boolean
    continueText: string
  }
  popout: { width: number; height: number }
  float: {
    enabled: boolean
    collapsed: boolean
    x?: number
    y?: number
  }
  hotkey: {
    global: string
  }
  cleanup: {
    daily: boolean
    idleDays: number
    lastRun?: number
    lastResult?: string
  }
  update: {
    auto: boolean
    remindedVersion: string
    remindedDay: string
  }
}

export const DEFAULT_CONTINUE_TEXT =
  '刚才很久没有新进展，这一轮已被中断（可能是请求挂住或命令在等输入）。请检查当前状态，从中断的地方继续完成任务；如果某个命令一直不结束，换一种不需要交互、不会一直等待的方式。'

export const DEFAULT_QUEUE_CONTINUE_TEXT = '继续'

export const REGISTRIES = {
  official: 'https://registry.npmjs.org/',
  npmmirror: 'https://registry.npmmirror.com/'
} as const

export const defaultSettings: AppSettings = {
  claudeCode: {
    model: 'claude-opus-5-5',
    allModels: true,
    modelMap: { opus: '', sonnet: '', haiku: '', subagent: '' },
    extraArgs: '',
    permissionMode: 'manual',
    account: 'ccshell',
    binary: 'auto',
    binaryPath: '',
    anthropic: { method: 'subscription', model: '' },
    anthropicAccounts: [],
    anthropicAccountId: DEFAULT_ANTHROPIC_ID
  },
  appearance: { openAtLogin: false, closeToTray: false, onQuit: 'ask', intro: true, onboarded: false, guidedUsers: [] },
  network: { registry: 'official', customRegistry: '', proxy: 'system', customProxy: '' },
  notify: { done: true, attention: true, problem: true, sound: true },
  stuck: { remindMinutes: 2, autoContinue: true, autoMinutes: 3, continueText: DEFAULT_CONTINUE_TEXT },
  queue: { autoResume: true, continueText: DEFAULT_QUEUE_CONTINUE_TEXT },
  popout: { width: 980, height: 640 },
  float: { enabled: false, collapsed: false },
  hotkey: { global: 'Control+Alt+C' },
  cleanup: { daily: true, idleDays: 30 },
  update: { auto: true, remindedVersion: '', remindedDay: '' }
}

export type SettingsPatch = { [K in keyof AppSettings]?: K extends 'claudeCode' ? Partial<Omit<AppSettings[K], 'anthropic'>> & { anthropic?: Partial<AppSettings[K]['anthropic']> } : Partial<AppSettings[K]> }

export interface MenuItemSpec {
  id: string
  label: string
  enabled?: boolean
  checked?: boolean
  danger?: boolean
  separatorBefore?: boolean
}
