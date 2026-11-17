import { PageActions } from '../components/PageActions'
import { Segmented } from '../components/Segmented'
import { RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { UsageRange, UsageRow, UsageSummary } from '../../../shared/maintenance'
import { formatMoney } from '../account'

const RANGES: [UsageRange, string][] = [
  ['5h', '近 5 小时'],
  ['today', '今天'],
  ['7d', '近 7 天'],
  ['30d', '近 30 天']
]

const fmt = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e4 ? `${(n / 1e3).toFixed(1)}k` : n.toLocaleString('zh-CN'))
const SOURCE = { code: 'Claude Code', chat: '对话' } as const

export function UsagePage() {
  const [range, setRange] = useState<UsageRange>('today')
  const [data, setData] = useState<UsageSummary | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = (r = range) => {
    setLoading(true)
    setError(null)
    void window.ccshell.maintenance.usage(r).then((res) => {
      setLoading(false)
      if (res.ok) setData(res.data)
      else setError(res.error)
    })
  }
  useEffect(() => load(range), [range])

  const total = (data?.rows ?? []).reduce(
    (a, r) => ({ requests: a.requests + r.requests, input: a.input + r.input, output: a.output + r.output, cacheRead: a.cacheRead + r.cacheRead, cacheWrite: a.cacheWrite + r.cacheWrite }),
    { requests: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
  )
  const cell = 'px-3 py-2 text-right font-mono text-[12.5px] tabular-nums'
  const row = (r: Pick<UsageRow, 'requests' | 'input' | 'output' | 'cacheRead' | 'cacheWrite'> & { cost?: UsageRow['cost'] }) => (
    <>
      <td className={cell}>{r.requests.toLocaleString('zh-CN')}</td>
      <td className={cell}>{fmt(r.input)}</td>
      <td className={cell}>{fmt(r.output)}</td>
      <td className={cell}>{fmt(r.cacheWrite)}</td>
      <td className={cell}>{fmt(r.cacheRead)}</td>
      <td className={cell}>{r.cost ? formatMoney(r.cost) : '—'}</td>
    </>
  )

  return (
    <div className="h-full overflow-y-auto">
      <div className="flex max-w-4xl flex-col gap-5 px-8 py-6">
        <p className="text-[12.5px] text-text-3">基于本机记录统计，实际扣费以 CC Shell 账户为准。</p>
        <PageActions>
          <Segmented value={range} onChange={setRange} options={RANGES.map(([v, label]) => ({ value: v, label }))} />
          <button className="btn btn-secondary h-8 gap-1.5 px-3 text-[13px]" onClick={() => load()} disabled={loading}>
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            刷新
          </button>
        </PageActions>
        {error && <p className="text-[13px] text-danger select-text">{error}</p>}

        <div className="overflow-x-auto rounded-lg border border-border bg-surface shadow-[var(--shadow-card)]">
          <table className="w-full border-collapse" aria-label="按模型的用量">
            <thead>
              <tr className="border-b border-border text-[12px] text-text-3">
                <th className="px-3 py-2 text-left font-normal">模型</th>
                <th className="px-3 py-2 text-left font-normal">来源</th>
                <th className="px-3 py-2 text-right font-normal">请求</th>
                <th className="px-3 py-2 text-right font-normal">输入</th>
                <th className="px-3 py-2 text-right font-normal">输出</th>
                <th className="px-3 py-2 text-right font-normal">缓存写入</th>
                <th className="px-3 py-2 text-right font-normal">缓存读取</th>
                <th className="px-3 py-2 text-right font-normal">估算费用</th>
              </tr>
            </thead>
            <tbody>
              {data?.rows.map((r) => (
                <tr key={r.source + r.model} className="border-b border-border/60 text-text">
                  <td className="px-3 py-2 font-mono text-[12.5px]">{r.model}</td>
                  <td className="px-3 py-2 text-[12.5px] text-text-2">{SOURCE[r.source]}</td>
                  {row(r)}
                </tr>
              ))}
              {data && !data.rows.length && (
                <tr>
                  <td colSpan={8} className="px-3 py-10 text-center text-[13px] text-text-3">
                    该时段无用量
                  </td>
                </tr>
              )}
            </tbody>
            {!!data?.rows.length && (
              <tfoot>
                <tr className="font-semibold text-text">
                  <td className="px-3 py-2 text-[12.5px]" colSpan={2}>
                    合计
                  </td>
                  {row({ ...total, cost: data.totalCost })}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
        {data && (
          <p className="text-xs text-text-3">
            已读取 {data.files} 个 Claude Code 对话记录，耗时 {data.ms} 毫秒。费用按 CC Shell 价格表逐次估算；未登录或缺少该模型价格时显示“—”。
          </p>
        )}
      </div>
    </div>
  )
}
