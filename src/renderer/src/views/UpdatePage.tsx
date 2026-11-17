import { ExternalLink, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import type { UpdateState } from '../../../shared/update'
import { ActionButton, StatusLine } from '../components/UpdateDialog'
import { PageActions } from '../components/PageActions'
import { useSettings } from '../terminal/state'
import { fmtSize, startUpdate, useUpdate } from '../update'
import { Row, Section, Toggle } from './SettingsPage'

const time = (ms?: number) => (ms ? new Date(ms).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '')

function statusText(s: UpdateState): string {
  switch (s.status) {
    case 'unsupported':
      return s.reason ?? '不支持自动更新'
    case 'idle':
      return '尚未检查'
    case 'checking':
      return '正在检查…'
    case 'none':
      return '已是最新版本'
    case 'available':
      return `有新版本 ${s.latest}`
    case 'downloading':
      return `正在下载 ${s.latest}`
    case 'downloaded':
      return `${s.latest} 已下载`
    case 'installing':
      return '正在重启并安装'
    case 'error':
      return s.error ?? '更新出错'
  }
}

export function UpdatePage() {
  const s = useUpdate()
  const settings = useSettings()
  const [error, setError] = useState<string | null>(null)
  if (!s || !settings) return null
  const can = s.status !== 'unsupported'
  const hasUpdate = !!s.latest && (s.status === 'available' || s.status === 'downloading' || s.status === 'downloaded' || s.status === 'installing' || s.status === 'error')

  return (
    <div className="h-full overflow-y-auto">
      <div className="flex max-w-4xl flex-col gap-4 px-8 py-6">
        <PageActions>
          <button className="btn btn-secondary h-8 gap-1.5 px-3 text-[13px]" disabled={!can || s.status === 'checking' || s.status === 'downloading' || s.status === 'installing'} onClick={() => void window.ccshell.update.check()}>
            <RefreshCw size={14} className={s.status === 'checking' ? 'animate-spin' : ''} />
            检查更新
          </button>
        </PageActions>

        <Section id="update-version" title="版本">
          <Row label="当前版本">
            <span className="font-mono text-[13px] text-text">{s.current}</span>
          </Row>
          <Row label="更新状态">
            <span className={'text-[13px] ' + (s.status === 'error' ? 'text-danger' : s.status === 'available' || s.status === 'downloaded' ? 'text-brand-text' : 'text-text-2')}>{statusText(s)}</span>
          </Row>
          {s.checkedAt && (
            <Row label="上次检查">
              <span className="text-[13px] text-text-2">{time(s.checkedAt)}</span>
            </Row>
          )}
          {hasUpdate && (
            <div className="rounded-md border border-border bg-bg-raised p-4">
              <div className="mb-2 flex items-baseline gap-2">
                <span className="text-[13.5px] font-semibold text-text">{s.latest}</span>
                <span className="text-xs text-text-3">
                  {s.releaseDate ? new Date(s.releaseDate).toLocaleDateString('zh-CN') : ''}
                  {s.size ? ` · ${fmtSize(s.size)}` : ''}
                </span>
              </div>
              {s.notes && <div className="mb-3 max-h-[220px] overflow-y-auto text-[12.5px] leading-relaxed whitespace-pre-line text-text-2 select-text">{s.notes}</div>}
              <StatusLine s={s} error={error} className="mb-3" />
              <div className="flex items-center gap-2">
                {s.releaseUrl && (
                  <button className="btn btn-ghost h-8 gap-1 px-2 text-[12.5px] text-text-2" onClick={() => void window.ccshell.app.openExternal(s.releaseUrl!)}>
                    <ExternalLink size={13} />
                    发布页
                  </button>
                )}
                <div className="flex-1" />
                <ActionButton
                  s={s}
                  onClick={async () => {
                    setError(null)
                    setError(await startUpdate(s))
                  }}
                />
              </div>
            </div>
          )}
        </Section>

        <Section id="update-auto" title="自动更新">
          <Row label="自动检查更新" hint="每天检查一次新版本，有新版本时在右下角提醒（同一版本每天最多提醒一次）。关掉后可在这里手动检查。">
            <Toggle checked={settings.update.auto} label="自动检查更新" onChange={(v) => void window.ccshell.settings.update({ update: { auto: v } })} />
          </Row>
        </Section>
      </div>
    </div>
  )
}
