import { Loading } from '../../components/Loading'
import { Check, Copy, ExternalLink, KeyRound, LoaderCircle, LogOut, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import type { AccountOverview, ApiKeyInfo, KeyStatus } from '../../../../shared/ccshell'
import { formatMoney, useAccount } from '../../account'

const KEY_STATUS: Record<KeyStatus, { label: string; cls: string }> = {
  active: { label: '可用', cls: 'text-success border-success/40' },
  disabled: { label: '已停用', cls: 'text-text-3 border-border-strong' },
  expired: { label: '已过期', cls: 'text-warning border-warning/40' },
  exhausted: { label: '额度耗尽', cls: 'text-danger border-danger/40' }
}

const timeFmt = new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })

export function AccountDashboard({ onLogout }: { onLogout: () => void }) {
  const account = useAccount()
  const [data, setData] = useState<AccountOverview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const r = await window.ccshell.account.overview()
    setLoading(false)
    if (r.ok) {
      setData(r.data)
      setError(null)
    } else setError(r.error)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const run = async (action: () => Promise<{ ok: boolean; error?: string }>, done?: string) => {
    const r = await action()
    if (!r.ok) setError(r.error ?? '操作失败')
    else {
      if (done) {
        setNotice(done)
        setTimeout(() => setNotice(null), 2000)
      }
      void load()
    }
  }

  const user = account.user!
  const name = user.displayName || user.username

  return (
    <div className="h-full overflow-auto">
      <div className="flex max-w-4xl flex-col gap-5 px-8 py-6">
        <header className="flex items-center gap-3">
          <div className="flex size-11 items-center justify-center rounded-full bg-brand-soft text-lg font-semibold text-brand-text">
            {name.slice(0, 1).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="truncate font-serif text-[22px] font-semibold leading-tight">{name}</h1>
            <p className="truncate text-[13px] text-text-3">
              {user.email || user.username} · 分组 {user.group}
            </p>
          </div>
          <button className="btn btn-ghost h-9 px-3" onClick={() => void load()} disabled={loading} title="刷新">
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
          </button>
          <button className="btn btn-secondary h-9 px-3" onClick={() => void window.ccshell.account.openSite('/dashboard/overview')}>
            <ExternalLink size={15} />
            网页控制台
          </button>
          <button className="btn btn-ghost h-9 px-3" onClick={onLogout}>
            <LogOut size={15} />
            退出
          </button>
        </header>

        {error && (
          <div role="alert" className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-[13px] text-danger">
            {error}
          </div>
        )}

        {!data ? (
          loading ? (
            <Loading label="正在加载" className="py-16" />
          ) : (
            <div className="flex items-center justify-center py-16 text-text-3">暂无数据</div>
          )
        ) : (
          <>
            <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Stat label="余额" value={formatMoney(data.balance)} highlight>
                <button className="self-start text-xs text-brand-text hover:underline" onClick={() => void window.ccshell.account.openSite('/wallet')}>
                  充值 →
                </button>
              </Stat>
              <Stat label="近 30 天消费" value={formatMoney(sumMoney(data))} />
              <Stat label="累计消费" value={formatMoney(data.totalSpent)} />
              <Stat label="累计请求" value={data.requestCount.toLocaleString('zh-CN')} />
            </section>

            <Card
              title="API 密钥"
              note="每个账号限 1 个密钥，与 Claude Code 等工具共用，在本机加密保存。"
              action={
                <button className="text-xs text-text-3 hover:text-text" onClick={() => void window.ccshell.account.openSite('/keys')}>
                  在网页中管理 →
                </button>
              }
            >
              {data.keys.length === 0 ? (
                <div className="flex items-center justify-between gap-3">
                  <span className="text-text-2">该账号暂无密钥。</span>
                  <button className="btn btn-primary h-9" onClick={() => void run(window.ccshell.account.ensureKey, '已创建并保存密钥')}>
                    <KeyRound size={15} />
                    创建密钥
                  </button>
                </div>
              ) : (
                data.keys.map((k) => (
                  <KeyRow
                    key={k.id}
                    info={k}
                    inUse={account.activeKey?.id === k.id}
                    onUse={() => void run(() => window.ccshell.account.selectKey(k.id), '已保存到本机')}
                    onCopy={() => void run(window.ccshell.account.copyKey, '已复制到剪贴板')}
                  />
                ))
              )}
              {notice && (
                <p className="mt-2 flex items-center gap-1 text-xs text-success">
                  <Check size={13} />
                  {notice}
                </p>
              )}
            </Card>

            <Card title="近 30 天按模型">
              {data.last30Days.length === 0 ? (
                <p className="text-text-3">近 30 天无调用记录。</p>
              ) : (
                <ul className="flex flex-col gap-2.5">
                  {data.last30Days.map((m) => {
                    const max = data.last30Days[0].cost.amount || 1
                    return (
                      <li key={m.model} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1">
                        <span className="truncate font-mono text-[13px]">{m.model}</span>
                        <span className="font-mono text-[13px]">
                          {formatMoney(m.cost)} <span className="text-text-3">· {m.requests} 次</span>
                        </span>
                        <div className="col-span-2 h-1.5 overflow-hidden rounded-full bg-surface-2">
                          <div className="h-full rounded-full bg-brand" style={{ width: `${(m.cost.amount / max) * 100}%` }} />
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
            </Card>

            <Card
              title="最近调用"
              action={
                <button className="text-xs text-text-3 hover:text-text" onClick={() => void window.ccshell.account.openSite('/usage-logs')}>
                  全部记录 →
                </button>
              }
            >
              {data.recentLogs.length === 0 ? (
                <p className="text-text-3">暂无调用记录。</p>
              ) : (
                <table className="w-full text-[13px]">
                  <thead className="text-left text-xs text-text-3">
                    <tr>
                      <th className="pb-2 font-normal">时间</th>
                      <th className="pb-2 font-normal">模型</th>
                      <th className="pb-2 text-right font-normal">输入 / 输出</th>
                      <th className="pb-2 text-right font-normal">耗时</th>
                      <th className="pb-2 text-right font-normal">费用</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.recentLogs.map((l) => (
                      <tr key={l.id} className="border-t border-border">
                        <td className="py-2 text-text-2">{timeFmt.format(l.time)}</td>
                        <td className="py-2 font-mono">
                          {l.model}
                          {l.status === 'error' && <span className="ml-2 text-xs text-danger">失败</span>}
                        </td>
                        <td className="py-2 text-right font-mono text-text-2">
                          {l.inputTokens.toLocaleString()} / {l.outputTokens.toLocaleString()}
                        </td>
                        <td className="py-2 text-right font-mono text-text-2">{(l.durationMs / 1000).toFixed(1)}s</td>
                        <td className="py-2 text-right font-mono">{formatMoney(l.cost)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
          </>
        )}
      </div>
    </div>
  )
}

function sumMoney(d: AccountOverview) {
  const symbol = d.balance.symbol
  return { symbol, amount: d.last30Days.reduce((s, m) => s + m.cost.amount, 0) }
}

function Stat(props: { label: string; value: string; highlight?: boolean; children?: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-border bg-surface p-4">
      <span className="text-xs text-text-3">{props.label}</span>
      <span className={'font-mono text-[22px] leading-tight ' + (props.highlight ? 'text-brand-text' : '')}>{props.value}</span>
      {props.children}
    </div>
  )
}

function Card(props: { title: string; note?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-surface p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-[14px] font-semibold text-text">{props.title}</h2>
        {props.action}
      </div>
      {props.note && <p className="-mt-2 mb-3 text-xs text-text-3">{props.note}</p>}
      {props.children}
    </section>
  )
}

function KeyRow(props: { info: ApiKeyInfo; inUse: boolean; onUse: () => void; onCopy: () => void }) {
  const k = props.info
  const st = KEY_STATUS[k.status]
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <KeyRound size={16} className="text-text-3" />
      <span className="font-medium">{k.name || '未命名密钥'}</span>
      <span className="font-mono text-[13px] text-text-2">{k.masked}</span>
      <span className={'rounded-full border px-2 text-xs ' + st.cls}>{st.label}</span>
      {props.inUse && <span className="rounded-full bg-brand-soft px-2 text-xs text-brand-text">客户端使用中</span>}
      <div className="flex-1" />
      {props.inUse ? (
        <button className="btn btn-ghost h-8 px-3 text-xs" onClick={props.onCopy}>
          <Copy size={14} />
          复制完整密钥
        </button>
      ) : (
        <button className="btn btn-secondary h-8 px-3 text-xs" onClick={props.onUse}>
          在客户端使用
        </button>
      )}
      <p className="basis-full pl-7 text-xs text-text-3">
        {k.quota ? `额度 ${formatMoney(k.quota)}，已用 ${formatMoney(k.used)}` : `不限额度，已用 ${formatMoney(k.used)}`}
        {' · '}
        {k.models.length ? `限 ${k.models.length} 个模型：${k.models.join('、')}` : '不限模型'}
        {k.expiresAt ? ` · ${new Date(k.expiresAt).toLocaleDateString('zh-CN')} 到期` : ''}
      </p>
    </div>
  )
}
