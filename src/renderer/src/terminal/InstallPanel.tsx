import { confirmDialog } from '../components/Dialog'
import { Download, ExternalLink, Info, RefreshCw, Square, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { NODE_DOWNLOAD_URL, type ClaudeInstallInfo } from '../../../shared/terminal'
import { useInstallInfo, when } from './state'

const newer = (a: string, b: string) => {
  const pa = a.split(/[.-]/).map((x) => parseInt(x, 10) || 0)
  const pb = b.split(/[.-]/).map((x) => parseInt(x, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0)
  return false
}

const STOPPED = '已停止'

const ACTION: Record<NonNullable<ClaudeInstallInfo['running']>, string> = {
  install: '正在安装…',
  update: '正在更新…',
  uninstall: '正在卸载…',
  check: '正在检查更新…'
}

export function InstallPanel({ compact, onInstalled }: { compact?: boolean; onInstalled?: () => void }) {
  const [info, reload] = useInstallInfo()
  const [error, setError] = useState<string | null>(null)
  const [showLog, setShowLog] = useState(!!compact)
  const logBox = useRef<HTMLPreElement>(null)

  useEffect(() => {
    if (logBox.current) logBox.current.scrollTop = logBox.current.scrollHeight
  }, [info?.log, showLog])

  if (!info) return null
  const busy = !!info.running
  const act = async (fn: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) => {
    setError(null)
    const r = await fn()
    if (!r.ok) setError(r.error === STOPPED ? null : (r.error ?? '操作失败'))
    else after?.()
  }
  const install = () => {
    setShowLog(true)
    void act(() => window.ccshell.claudeCode.install(), onInstalled)
  }
  const installing = info.running === 'install' || info.running === 'update'
  const updateAvailable = !!(info.own?.version && info.latest && newer(info.latest, info.own.version))
  if (!compact) return <FullPanel {...{ info, reload, error, act, install, installing, updateAvailable, showLog, setShowLog, logBox }} />

  return (
    <div className="flex flex-col gap-3">
      {info.nodeProblem ? (
        <div className="rounded-md border border-warning/40 bg-warning/10 px-4 py-3 text-[13px] text-text">
          <p className="select-text">{info.nodeProblem}</p>
          <div className="mt-2 flex gap-2">
            <button className="btn btn-secondary h-8 gap-1.5 px-3 text-[13px]" onClick={() => void window.ccshell.app.openExternal(NODE_DOWNLOAD_URL)}>
              <ExternalLink size={14} />
              打开 Node.js 下载页
            </button>
            <button className="btn btn-ghost h-8 gap-1.5 px-3 text-[13px]" onClick={() => reload(true)}>
              <RefreshCw size={14} />
              重新检查
            </button>
          </div>
        </div>
      ) : (
        !compact && (
          <p className="text-xs text-text-3">
            使用本机 Node.js {info.node?.version ?? ''} 与 npm 安装至客户端数据目录；npm 源：<span className="font-mono">{info.registry}</span>（可在“网络”中修改）。
          </p>
        )
      )}

      {!compact && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px]">
          <span className="text-text-2">
            客户端版本：
            {info.own ? <span className="font-mono text-text">{info.own.version ?? '版本未知'}</span> : <span className="text-text-3">未安装</span>}
          </span>
          {info.latest && (
            <span className="text-text-2">
              最新版：<span className="font-mono text-text">{info.latest}</span>
              {info.checkedAt && <span className="text-text-3">（检查于 {when(info.checkedAt)}）</span>}
              {updateAvailable && <span className="ml-1.5 rounded-full bg-brand-soft px-2 py-0.5 text-xs text-brand-text">有新版本</span>}
              {info.own && info.latest && !updateAvailable && <span className="ml-1.5 text-xs text-success">已是最新</span>}
            </span>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {!info.own ? (
          <button className="btn btn-primary h-9 gap-1.5 px-4" disabled={busy || !!info.nodeProblem} onClick={install}>
            <Download size={15} />
            {info.running === 'install' ? '正在安装…' : '安装 Claude Code'}
          </button>
        ) : (
          <button className="btn btn-primary h-9 gap-1.5 px-4" disabled={busy || !!info.nodeProblem || info.inUse > 0} onClick={install} title={info.inUse ? '有会话正在使用，请先结束这些会话' : ''}>
            <Download size={15} />
            {info.running === 'update' ? '正在更新…' : '更新至最新版本'}
          </button>
        )}
        {installing && (
          <button className="btn btn-secondary anim-fade h-9 gap-1.5 px-3" onClick={() => void window.ccshell.claudeCode.cancel()}>
            <Square size={13} strokeWidth={2.2} className="fill-current" />
            停止
          </button>
        )}
        {!compact && (
          <>
            <button className="btn btn-secondary h-9 gap-1.5 px-3" disabled={busy || !!info.nodeProblem} onClick={() => void act(() => window.ccshell.claudeCode.checkUpdate())}>
              <RefreshCw size={15} className={info.running === 'check' ? 'animate-spin' : ''} />
              检查更新
            </button>
            {info.own && (
              <button
                className="btn btn-ghost h-9 gap-1.5 px-3 text-danger"
                disabled={busy || info.inUse > 0}
                onClick={async () => {
                  if (await confirmDialog({ title: '卸载 Claude Code', message: '对话记录与配置不受影响。', confirmText: '卸载', danger: true }))
                    void act(() => window.ccshell.claudeCode.uninstall())
                }}
              >
                <Trash2 size={15} />
                卸载
              </button>
            )}
            {!!info.log && (
              <button className="btn btn-ghost h-9 px-3 text-[13px]" onClick={() => setShowLog((v) => !v)}>
                {showLog ? '收起输出' : '查看输出'}
              </button>
            )}
          </>
        )}
      </div>
      {info.inUse > 0 && !compact && <p className="text-xs text-text-3">{info.inUse} 个会话正在使用客户端中的版本，结束后方可更新或卸载。</p>}
      {busy && <p className="text-xs text-text-2">{ACTION[info.running!]}</p>}
      {(error ?? info.error) && <p className="whitespace-pre-wrap text-[13px] text-danger select-text">{error ?? info.error}</p>}
      {showLog && !!info.log && (
        <pre ref={logBox} className="max-h-56 overflow-auto rounded-md border border-border bg-bg p-3 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap text-text-2 select-text">
          {info.log}
        </pre>
      )}
    </div>
  )
}

function FullPanel(p: {
  info: ClaudeInstallInfo
  reload: (force?: boolean) => void
  error: string | null
  act: (fn: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) => Promise<void>
  install: () => void
  installing: boolean
  updateAvailable: boolean
  showLog: boolean
  setShowLog: (f: (v: boolean) => boolean) => void
  logBox: React.RefObject<HTMLPreElement | null>
}) {
  const { info, act } = p
  const busy = !!info.running
  const note = `使用本机 Node.js ${info.node?.version ?? ''} 与 npm 安装至客户端数据目录；npm 源：${info.registry}（可在“网络”中修改）`
  return (
    <div className="flex flex-col gap-3 border-t border-border pt-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-[13px] text-text">
            客户端安装
            {!info.nodeProblem && (
              <span title={note} tabIndex={0} aria-label={note} className="inline-flex cursor-help text-text-3 transition-colors outline-none hover:text-text-2">
                <Info size={13} strokeWidth={1.9} />
              </span>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[12px] text-text-3">
            {info.own ? (
              <span>
                已安装 <span className="font-mono text-text-2">{info.own.version ?? '版本未知'}</span>
              </span>
            ) : (
              <span>未安装</span>
            )}
            {info.latest && (
              <>
                <span aria-hidden>·</span>
                <span>
                  最新 <span className="font-mono text-text-2">{info.latest}</span>
                </span>
              </>
            )}
            {p.updateAvailable && <span className="rounded-full bg-brand-soft px-2 py-px text-[11px] text-brand-text">有新版本</span>}
            {info.own && info.latest && !p.updateAvailable && <span className="text-success">已是最新</span>}
            {info.checkedAt && (
              <>
                <span aria-hidden>·</span>
                <span>检查于 {when(info.checkedAt)}</span>
              </>
            )}
            {!!info.log && (
              <>
                <span aria-hidden>·</span>
                <button className="text-text-2 underline-offset-2 hover:text-text hover:underline" onClick={() => p.setShowLog((v) => !v)}>
                  {p.showLog ? '收起输出' : '查看输出'}
                </button>
              </>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {info.own && (
            <button
              className="btn btn-ghost h-8 gap-1.5 px-2.5 text-[13px] text-text-3 hover:text-danger"
              disabled={busy || info.inUse > 0}
              title={info.inUse ? '有会话正在使用，请先结束这些会话' : '卸载客户端安装的 Claude Code'}
              onClick={async () => {
                if (await confirmDialog({ title: '卸载 Claude Code', message: '对话记录与配置不受影响。', confirmText: '卸载', danger: true }))
                  void act(() => window.ccshell.claudeCode.uninstall())
              }}
            >
              <Trash2 size={14} />
              卸载
            </button>
          )}
          <button className="btn btn-secondary h-8 gap-1.5 px-3 text-[13px]" disabled={busy || !!info.nodeProblem} onClick={() => void act(() => window.ccshell.claudeCode.checkUpdate())}>
            <RefreshCw size={14} className={info.running === 'check' ? 'animate-spin' : ''} />
            检查更新
          </button>
          {p.installing && (
            <button className="btn btn-secondary anim-fade h-8 gap-1.5 px-3 text-[13px]" onClick={() => void window.ccshell.claudeCode.cancel()}>
              <Square size={12} strokeWidth={2.2} className="fill-current" />
              停止
            </button>
          )}
          <button
            className="btn btn-primary h-8 gap-1.5 px-3.5 text-[13px]"
            disabled={busy || !!info.nodeProblem || (!!info.own && info.inUse > 0)}
            title={info.own && info.inUse ? '有会话正在使用，请先结束这些会话' : ''}
            onClick={p.install}
          >
            <Download size={14} />
            {!info.own ? (info.running === 'install' ? '正在安装…' : '安装') : info.running === 'update' ? '正在更新…' : '更新'}
          </button>
        </div>
      </div>

      {info.nodeProblem && (
        <div className="rounded-md border border-warning/40 bg-warning/10 px-4 py-3 text-[13px] text-text">
          <p className="select-text">{info.nodeProblem}</p>
          <div className="mt-2 flex gap-2">
            <button className="btn btn-secondary h-8 gap-1.5 px-3 text-[13px]" onClick={() => void window.ccshell.app.openExternal(NODE_DOWNLOAD_URL)}>
              <ExternalLink size={14} />
              打开 Node.js 下载页
            </button>
            <button className="btn btn-ghost h-8 gap-1.5 px-3 text-[13px]" onClick={() => p.reload(true)}>
              <RefreshCw size={14} />
              重新检查
            </button>
          </div>
        </div>
      )}
      {info.inUse > 0 && <p className="text-xs text-text-3">{info.inUse} 个会话正在使用客户端中的版本，结束后方可更新或卸载。</p>}
      {busy && <p className="text-xs text-text-2">{ACTION[info.running!]}</p>}
      {(p.error ?? info.error) && <p className="whitespace-pre-wrap text-[13px] text-danger select-text">{p.error ?? info.error}</p>}
      {p.showLog && !!info.log && (
        <pre ref={p.logBox} className="max-h-56 overflow-auto rounded-md border border-border bg-bg p-3 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap text-text-2 select-text">
          {info.log}
        </pre>
      )}
    </div>
  )
}
