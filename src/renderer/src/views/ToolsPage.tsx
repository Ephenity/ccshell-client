import { Loading } from '../components/Loading'
import { useTween } from '../components/anim'
import { PageActions } from '../components/PageActions'
import { confirmDialog } from '../components/Dialog'
import { Check, Copy, Eye, FolderOpen, Info, OctagonX, RefreshCw, Search, Send, SquarePlus, TriangleAlert } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { PeerEntry, PeerMode } from '../../../shared/peers'
import type { CleanupItem, EnvCheck, LogFileInfo } from '../../../shared/maintenance'
import { useSettings } from '../terminal/state'

type Tab = 'cleanup' | 'logs' | 'env' | 'peers'

const size = (n: number) => (n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(1)} GB` : n >= 1024 ** 2 ? `${(n / 1024 ** 2).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`)

export function ToolsPage({ tab }: { tab: Tab }) {
  return <div className="h-full">{tab === 'cleanup' ? <Cleanup /> : tab === 'logs' ? <Logs /> : tab === 'env' ? <Env /> : <PeerLog />}</div>
}

function Cleanup() {
  const s = useSettings()
  const [items, setItems] = useState<CleanupItem[] | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [sweeping, setSweeping] = useState<Set<string>>(new Set())
  const [done, setDone] = useState<{ ids: Set<string>; key: number } | null>(null)
  const [result, setResult] = useState<{ count: number; bytes: number; skipped: number; key: number } | null>(null)
  const [note, setNote] = useState<string | null>(null)

  const scan = () =>
    window.ccshell.maintenance.scanCleanup().then((r) => {
      if (!r.ok) return setNote(r.error)
      setItems(r.data)
      setPicked((p) => (p.size ? p : new Set(r.data.filter((i) => i.defaultOn).map((i) => i.id))))
    })
  useEffect(() => void scan(), [])

  const run = async () => {
    const ids = new Set(picked)
    setBusy(true)
    setNote(null)
    setResult(null)
    setDone(null)
    setSweeping(ids)
    const t0 = Date.now()
    const r = await window.ccshell.maintenance.runCleanup([...ids])
    await new Promise((res) => setTimeout(res, Math.max(0, 1100 - (Date.now() - t0))))
    await scan()
    setSweeping(new Set())
    setBusy(false)
    if (r.ok) {
      setDone({ ids, key: Date.now() })
      setResult({ ...r.data, key: Date.now() })
    } else setNote(r.error)
  }
  const total = (items ?? []).filter((i) => picked.has(i.id)).reduce((a, i) => a + i.bytes, 0)

  return (
    <div className="h-full overflow-y-auto">
      <div className="flex max-w-4xl flex-col gap-4 px-8 py-6">
        <p className="text-[13px] text-text-2">不删除对话；1 小时内修改过或正在使用的文件不受影响。</p>
        {s && (
          <label className="flex items-center gap-2 rounded-md border border-border bg-surface px-4 py-2.5 text-[13px]">
            <input type="checkbox" className="accent-[var(--brand)]" checked={s.cleanup.daily} onChange={(e) => void window.ccshell.settings.update({ cleanup: { daily: e.target.checked } })} />
            每日自动清理标记为“每日”的项目
            <span className="ml-auto text-xs text-text-3">{s.cleanup.lastRun ? `上次清理 ${new Date(s.cleanup.lastRun).toLocaleString('zh-CN', { hour12: false })}：${s.cleanup.lastResult ?? ''}` : '尚未自动清理'}</span>
          </label>
        )}
        <div className="flex flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-[var(--shadow-card)]">
          {!items && <Loading label="正在扫描" size={36} className="py-8" />}
          <div className="anim-stagger flex flex-col">
            {items?.map((i, n) => (
              <CleanupRow
                key={i.id}
                item={i}
                index={n}
                checked={picked.has(i.id)}
                sweeping={sweeping.has(i.id)}
                justDone={!!done?.ids.has(i.id)}
                disabled={busy}
                onToggle={(on) =>
                  setPicked((p) => {
                    const x = new Set(p)
                    if (on) x.add(i.id)
                    else x.delete(i.id)
                    return x
                  })
                }
              />
            ))}
          </div>
        </div>
        <div className="flex min-h-9 items-center gap-3">
          <button className="btn btn-primary h-9 px-4" disabled={busy || !picked.size || !items} onClick={() => void run()}>
            {busy ? '正在清理…' : `清理所选项${total ? `（${size(total)}）` : ''}`}
          </button>
          <button className="btn btn-ghost h-9 gap-1.5 px-3 text-[13px]" disabled={busy} onClick={() => void scan()}>
            <RefreshCw size={14} />
            重新扫描
          </button>
          {result && <CleanupResult key={result.key} count={result.count} bytes={result.bytes} skipped={result.skipped} />}
          {note && <span className="text-[13px] text-text-2 select-text">{note}</span>}
        </div>
      </div>
    </div>
  )
}

function CleanupRow(p: { item: CleanupItem; index: number; checked: boolean; sweeping: boolean; justDone: boolean; disabled: boolean; onToggle: (on: boolean) => void }) {
  const i = p.item
  const bytes = useTween(i.bytes)
  const count = useTween(i.count)
  return (
    <label
      style={{ ['--i' as string]: p.index }}
      className={
        'flex cursor-pointer items-start gap-3 border-b border-border/60 px-4 py-3 last:border-0 hover:bg-surface-2/50 ' +
        (p.sweeping ? 'clean-sweep ' : '') +
        (p.justDone ? 'clean-done' : '')
      }
    >
      <input type="checkbox" className="mt-1 accent-[var(--brand)]" checked={p.checked} disabled={p.disabled} onChange={(e) => p.onToggle(e.target.checked)} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2 text-[13px] text-text">
          {i.label}
          {i.daily && <span className="rounded-full border border-border px-1.5 text-[10.5px] text-text-3">每日</span>}
        </span>
        <span className="mt-0.5 block text-xs text-text-3">{i.desc}</span>
      </span>
      <span className={'shrink-0 text-right font-mono text-[12px] tabular-nums transition-colors ' + (p.sweeping ? 'text-text-3' : 'text-text-2')}>
        {Math.round(count) ? `${Math.round(count)} 项` : '无'}
        {bytes >= 1 && <span className="block text-text-3">{size(Math.round(bytes))}</span>}
      </span>
    </label>
  )
}

function CleanupResult({ count, bytes, skipped }: { count: number; bytes: number; skipped: number }) {
  const b = useTween(bytes, 800, 0)
  return (
    <span className="anim-rise flex items-center gap-1.5 text-[13px] text-text-2 select-text">
      <span className="flex size-[18px] items-center justify-center rounded-full bg-success/15 text-success">
        <Check size={12} strokeWidth={2.5} />
      </span>
      已清理 {count} 项，释放 <span className="font-mono tabular-nums text-text">{size(Math.round(b))}</span>
      {skipped ? <span className="text-text-3">；{skipped} 项正在使用，将在下次清理</span> : null}
    </span>
  )
}

const BAD = /失败|出错|错误|异常|未完成|error|fail|exception|拒绝|没有完成|退出码 [1-9-]|超时/i
const WARN = /卡住|停滞|未收到|重试|暂停|跳过|自动继续|warn|没有收到|没有用|中断/i

function Logs() {
  const [files, setFiles] = useState<LogFileInfo[]>([])
  const [name, setName] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [filter, setFilter] = useState('')
  const [problems, setProblems] = useState(false)

  const loadFiles = () =>
    void window.ccshell.maintenance.logs().then((r) => {
      if (!r.ok) return
      setFiles(r.data)
      setName((n) => n ?? r.data[0]?.name ?? null)
    })
  useEffect(loadFiles, [])
  const load = () => {
    if (name) void window.ccshell.maintenance.readLog(name).then((r) => setText(r.ok ? r.data : r.error))
  }
  useEffect(load, [name])

  const lines = useMemo(() => {
    const words = filter.toLowerCase().split(/\s+/).filter(Boolean)
    return text
      .split('\n')
      .filter((l) => l.trim())
      .filter((l) => words.every((w) => l.toLowerCase().includes(w)))
      .filter((l) => !problems || BAD.test(l) || WARN.test(l))
      .slice(-3000)
  }, [text, filter, problems])

  return (
    <div className="flex h-full">
      <div className="flex w-56 shrink-0 flex-col gap-1 border-r border-border p-3">
        {files.map((f) => (
          <button key={f.name} onClick={() => setName(f.name)} className={'rounded-sm px-2.5 py-2 text-left transition-colors ' + (f.name === name ? 'bg-brand-soft [&_span]:!text-brand-text' : 'hover:bg-surface-2')}>
            <span className="block font-mono text-[12.5px] text-text">{f.name}</span>
            <span className="block text-[11px] text-text-3">{f.about || size(f.size)}</span>
          </button>
        ))}
        {!files.length && <p className="px-2 py-4 text-xs text-text-3">暂无日志</p>}
        <button className="mt-auto flex items-center gap-1.5 px-2 text-xs text-text-3 hover:text-text" onClick={() => void window.ccshell.maintenance.openLogDir()}>
          <FolderOpen size={13} />
          打开日志文件夹
        </button>
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-3 border-b border-border px-4 py-2">
          <div className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md border border-border-strong bg-bg-raised px-2.5 focus-within:border-brand">
            <Search size={14} className="text-text-3" />
            <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="筛选（多个关键词以空格分隔）" className="min-w-0 flex-1 bg-transparent text-[13px] outline-none focus-visible:shadow-none" />
          </div>
          <label className="flex items-center gap-1.5 text-[13px] text-text-2">
            <input type="checkbox" className="accent-[var(--brand)]" checked={problems} onChange={(e) => setProblems(e.target.checked)} />
            仅显示异常
          </label>
          <button title="刷新" className="flex size-8 items-center justify-center rounded-sm text-text-3 hover:bg-surface-2 hover:text-text" onClick={load}>
            <RefreshCw size={14} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto bg-bg px-4 py-2 font-mono text-[12px] leading-relaxed select-text" aria-label="日志内容">
          {!lines.length && <p className="py-6 text-center font-sans text-xs text-text-3">{text ? '无匹配内容' : '（空）'}</p>}
          {lines.map((l, i) => (
            <div key={i} className={'whitespace-pre-wrap ' + (BAD.test(l) ? 'text-danger' : WARN.test(l) ? 'text-warning' : 'text-text-2')}>
              {l}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

const ENV_ICON = {
  ok: { icon: Check, cls: 'text-success', label: '正常' },
  info: { icon: Info, cls: 'text-text-3', label: '提示' },
  warn: { icon: TriangleAlert, cls: 'text-warning', label: '注意' },
  error: { icon: OctagonX, cls: 'text-danger', label: '错误' }
} as const

function Env() {
  const [checks, setChecks] = useState<EnvCheck[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const check = async () => {
    setBusy(true)
    const r = await window.ccshell.maintenance.envCheck()
    setBusy(false)
    if (r.ok) setChecks(r.data)
    else setNote(r.error)
  }
  useEffect(() => void check(), [])
  const groups = [...new Set((checks ?? []).map((c) => c.group))]

  return (
    <div className="h-full overflow-y-auto">
      <div className="flex max-w-4xl flex-col gap-4 px-8 py-6">
        <PageActions>
          <button className="btn btn-secondary h-8 gap-1.5 px-3 text-[13px]" disabled={busy} onClick={() => void check()}>
            <RefreshCw size={14} className={busy ? 'animate-spin' : ''} />
            重新检查
          </button>
          <button
            className="btn btn-secondary h-8 gap-1.5 px-3 text-[13px]"
            onClick={async () => {
              const r = await window.ccshell.maintenance.copyEnvReport()
              setNote(r.ok ? '报告已复制到剪贴板' : r.error)
            }}
          >
            <Copy size={14} />
            复制报告
          </button>
        </PageActions>
        {note && <p className="text-xs text-text-2">{note}</p>}
        {!checks && <Loading label="正在检查" />}
        {groups.map((g) => (
          <section key={g} className="overflow-hidden rounded-lg border border-border bg-surface shadow-[var(--shadow-card)]">
            <h2 className="border-b border-border px-4 py-2 text-[12px] text-text-3">{g}</h2>
            {checks!
              .filter((c) => c.group === g)
              .map((c) => {
                const st = ENV_ICON[c.status]
                const Icon = st.icon
                return (
                  <div key={c.id} className="flex gap-3 border-b border-border/60 px-4 py-2.5 last:border-0">
                    <Icon size={16} className={'mt-0.5 shrink-0 ' + st.cls} aria-label={st.label} />
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] text-text">{c.label}</div>
                      <div className="text-xs whitespace-pre-line break-all text-text-2 select-text">{c.detail}</div>
                      {c.fix && <div className="mt-1 text-xs text-text-3 select-text">建议：{c.fix}</div>}
                    </div>
                  </div>
                )
              })}
          </section>
        ))}
      </div>
    </div>
  )
}

const PEER_KIND = {
  send: { icon: Send, label: '发送消息' },
  start: { icon: SquarePlus, label: '新建会话' },
  read: { icon: Eye, label: '读取对话' }
} as const
const PEER_MODE: Record<PeerMode, string> = { queue: '排队', now: '立即发送', interrupt: '中断后发送' }

function PeerLog() {
  const [list, setList] = useState<PeerEntry[]>([])
  const [kind, setKind] = useState<'all' | PeerEntry['kind']>('all')
  const [refused, setRefused] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  useEffect(() => {
    void window.ccshell.peers.list().then((r) => r.ok && setList(r.data))
    return window.ccshell.peers.onChanged(setList)
  }, [])
  const shown = list.filter((e) => (kind === 'all' || e.kind === kind) && (!refused || !e.ok))
  const when = (t: number) => new Date(t).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border px-4 py-2">
        {(['all', 'send', 'start', 'read'] as const).map((k) => (
          <button
            key={k}
            onClick={() => setKind(k)}
            className={'rounded-sm px-2.5 py-1 text-[13px] ' + (kind === k ? 'bg-surface-2 text-text ring-1 ring-border' : 'text-text-3 hover:text-text')}
          >
            {k === 'all' ? '全部' : PEER_KIND[k].label}
          </button>
        ))}
        <label className="ml-2 flex items-center gap-1.5 text-[13px] text-text-2">
          <input type="checkbox" className="accent-[var(--brand)]" checked={refused} onChange={(e) => setRefused(e.target.checked)} />
          仅显示被拒绝的
        </label>
        <span className="ml-auto text-xs text-text-3">会话之间通过 ccshell 工具协作的记录，保留 7 天</span>
        <button
          disabled={!list.length}
          className="rounded-sm px-2 py-1 text-xs text-text-3 hover:bg-surface-2 hover:text-text disabled:opacity-40"
          onClick={async () => {
            if (await confirmDialog({ title: '清空协作记录', message: '一小时内的发送次数限额将一并重置。', confirmText: '清空', danger: true })) void window.ccshell.peers.clear()
          }}
        >
          清空
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-4 py-2" aria-label="协作记录">
        {!shown.length && (
          <p className="py-10 text-center text-xs leading-relaxed text-text-3">
            {list.length ? '无符合条件的记录' : '暂无协作记录。可在会话中要求 Claude 查看其他会话、向其他会话发送结论或新建会话执行任务。'}
          </p>
        )}
        <ul className="divide-y divide-border">
          {shown.map((e) => {
            const K = PEER_KIND[e.kind]
            const expanded = open === e.id
            return (
              <li key={e.id} className="flex gap-3 py-2.5">
                <K.icon size={14} className={'mt-0.5 shrink-0 ' + (e.ok ? 'text-text-3' : 'text-danger')} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 text-[13px]">
                    <span className="font-medium text-text">{e.fromTitle}</span>
                    <span className="text-text-3">{e.kind === 'start' ? '新建' : e.kind === 'read' ? '读取' : '→'}</span>
                    <span className="font-medium text-text">{e.toTitle || e.to || '（无）'}</span>
                    {e.kind === 'read' && <span className="text-text-3">的对话</span>}
                    {e.mode && <span className="rounded-sm bg-surface-2 px-1 text-[11px] text-text-2">{PEER_MODE[e.mode]}</span>}
                    {!e.ok && <span className="rounded-sm bg-danger/10 px-1 text-[11px] text-danger">被拒绝</span>}
                    <span className="ml-auto font-mono text-[11px] text-text-3">{when(e.at)}</span>
                  </div>
                  {e.text && (
                    <button
                      title={expanded ? '收起' : '展开'}
                      onClick={() => setOpen(expanded ? null : e.id)}
                      className={'mt-0.5 block w-full text-left text-[12.5px] whitespace-pre-wrap break-all text-text-2 ' + (expanded ? '' : 'line-clamp-2')}
                    >
                      {e.text}
                    </button>
                  )}
                  {e.error && <div className="mt-0.5 text-[12px] text-danger">{e.error}</div>}
                  {e.delivery && <div className="mt-0.5 text-[11.5px] text-text-3">{e.delivery}</div>}
                </div>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}
