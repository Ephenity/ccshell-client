import { EventEmitter } from 'node:events'
import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import { ANTHROPIC_MAX, type AnthropicAccount } from '../shared/anthropic'
import { defaultSettings, REGISTRIES, type AppSettings, type SettingsPatch } from '../shared/settings'

function cleanAccounts(list: unknown): AnthropicAccount[] {
  const seen = new Set<string>()
  const out: AnthropicAccount[] = []
  for (const a of Array.isArray(list) ? (list as Partial<AnthropicAccount>[]) : []) {
    const id = typeof a?.id === 'string' ? a.id.trim() : ''
    if (!/^[a-z0-9-]{1,32}$/.test(id) || seen.has(id)) continue
    seen.add(id)
    out.push({
      id,
      name: (typeof a.name === 'string' ? a.name : '').trim().slice(0, 40) || id,
      method: a.method === 'apikey' ? 'apikey' : 'subscription',
      model: (typeof a.model === 'string' ? a.model : '').trim().slice(0, 80),
      createdAt: Number(a.createdAt) || Date.now()
    })
    if (out.length >= ANTHROPIC_MAX) break
  }
  return out
}

class SettingsStore extends EventEmitter<{ changed: [AppSettings] }> {
  private cache: AppSettings | null = null
  private get file() {
    return join(app.getPath('userData'), 'settings.json')
  }

  get(): AppSettings {
    if (this.cache) return this.cache
    let raw: Partial<AppSettings> = {}
    try {
      raw = JSON.parse(readFileSync(this.file, 'utf8'))
    } catch {
    }
    const d = defaultSettings
    this.cache = {
      claudeCode: {
        ...d.claudeCode,
        ...raw.claudeCode,
        modelMap: { ...d.claudeCode.modelMap, ...raw.claudeCode?.modelMap },
        anthropic: { ...d.claudeCode.anthropic, ...raw.claudeCode?.anthropic },
        anthropicAccounts: cleanAccounts(raw.claudeCode?.anthropicAccounts)
      },
      appearance: { ...d.appearance, ...raw.appearance },
      network: { ...d.network, ...raw.network },
      notify: { ...d.notify, ...raw.notify },
      stuck: { ...d.stuck, ...raw.stuck },
      queue: { ...d.queue, ...raw.queue },
      popout: { ...d.popout, ...raw.popout },
      float: { ...d.float, ...raw.float },
      hotkey: { ...d.hotkey, ...raw.hotkey },
      cleanup: { ...d.cleanup, ...raw.cleanup },
      update: { ...d.update, ...raw.update }
    }
    return this.cache
  }

  update(patch: SettingsPatch): AppSettings {
    const cur = this.get()
    const next: AppSettings = {
      claudeCode: {
        ...cur.claudeCode,
        ...patch.claudeCode,
        modelMap: { ...cur.claudeCode.modelMap, ...patch.claudeCode?.modelMap },
        anthropic: { ...cur.claudeCode.anthropic, ...patch.claudeCode?.anthropic },
        anthropicAccounts: cleanAccounts(patch.claudeCode?.anthropicAccounts ?? cur.claudeCode.anthropicAccounts)
      },
      appearance: { ...cur.appearance, ...patch.appearance },
      network: { ...cur.network, ...patch.network },
      notify: { ...cur.notify, ...patch.notify },
      stuck: { ...cur.stuck, ...patch.stuck },
      queue: { ...cur.queue, ...patch.queue },
      popout: { ...cur.popout, ...patch.popout },
      float: { ...cur.float, ...patch.float },
      hotkey: { ...cur.hotkey, ...patch.hotkey },
      cleanup: { ...cur.cleanup, ...patch.cleanup },
      update: { ...cur.update, ...patch.update }
    }
    const g = next.appearance.guidedUsers
    next.appearance.guidedUsers = [...new Set((Array.isArray(g) ? g : []).filter((x): x is string => typeof x === 'string' && !!x))].slice(-200)
    if (!next.stuck.continueText.trim()) next.stuck.continueText = defaultSettings.stuck.continueText
    if (!next.queue.continueText.trim()) next.queue.continueText = defaultSettings.queue.continueText
    if (next.stuck.autoContinue && next.stuck.autoMinutes <= 0) throw new Error('自动继续的时间要大于 0')
    const n = next.network
    if (n.registry === 'custom' && n.customRegistry.trim() && !/^https:\/\//i.test(n.customRegistry.trim()))
      throw new Error('npm 源要以 https:// 开头（http 传输中可能被替换安装文件）')
    if (n.proxy === 'custom' && n.customProxy.trim() && !/^https?:\/\//i.test(n.customProxy.trim()))
      throw new Error('代理地址要以 http:// 或 https:// 开头（npm 不支持 socks）')
    this.cache = next
    writeFileSync(this.file + '.tmp', JSON.stringify(next, null, 2))
    renameSync(this.file + '.tmp', this.file)
    this.emit('changed', next)
    return next
  }

  reload(): void {
    this.cache = null
  }
}

export const settings = new SettingsStore()

export function registryUrl(s: AppSettings = settings.get()): string {
  const n = s.network
  if (n.registry === 'custom' && /^https:\/\//i.test(n.customRegistry.trim())) {
    const u = n.customRegistry.trim()
    return u.endsWith('/') ? u : u + '/'
  }
  return n.registry === 'npmmirror' ? REGISTRIES.npmmirror : REGISTRIES.official
}

export function splitArgs(line: string): string[] {
  const out: string[] = []
  const re = /"([^"]*)"|(\S+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(line))) out.push(m[1] ?? m[2])
  return out
}
