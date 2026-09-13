import { useEffect, useState, useCallback, useRef } from 'react'
import { api } from '../lib/api'
import type { ZTFMonitorSummary, ZTFRequest } from '../lib/types'
import { formatZtfHours, formatZtfRate, getZtfHealthBadges, type ZtfHealthBadgeTone } from '../lib/ztfHealthDisplay'

type TabId = 'pending' | 'completed' | 'failed'

type ZtfProps = { uiRevision?: number }

const healthBadgeToneClasses: Record<ZtfHealthBadgeTone, string> = {
  ok: 'border-[#30d158]/25 bg-[#30d158]/10 text-[#16803c]',
  warning: 'border-[#ff9f0a]/25 bg-[#ff9f0a]/10 text-[#9a5b00]',
  error: 'border-[#ff453a]/25 bg-[#ff453a]/10 text-[#b42318]',
  neutral: 'border-black/[0.08] bg-black/[0.03] text-[#6e6e73] dark:border-white/[0.10] dark:bg-white/[0.05] dark:text-[#a1a1a6]',
}

type SupplementBatch = {
  started_at: string
  total_sources: number
  accepted_sources: number
  processing_sources: number
  awaiting_confirmation_sources: number
  successful_sources: number
  failed_sources: number
  queue_unconfirmed_sources: number
}

export default function ZTFMonitorPanel({ uiRevision }: ZtfProps) {
  const lastUiRevision = useRef<number | null>(null)
  const [summary, setSummary] = useState<ZTFMonitorSummary | null>(null)
  const [estimateHtml, setEstimateHtml] = useState('')
  const [tab, setTab] = useState<TabId>('pending')
  const [health, setHealth] = useState<Record<string, unknown> | null>(null)

  const load = useCallback(async () => {
    try {
      const [s, d, h] = await Promise.allSettled([
        api.ztf.status(),
        api.ztf.detail(),
        api.ztf.health(),
      ])
      if (s.status === 'fulfilled') setSummary(s.value)
      if (d.status === 'fulfilled') {
        setEstimateHtml(d.value.estimate_html)
      }
      if (h.status === 'fulfilled') setHealth(h.value)
    } catch (error) {
      console.error('Load ZTF monitor failed', error)
    }
  }, [])

  useEffect(() => {
    load()
    const iv = setInterval(load, 30000)
    return () => clearInterval(iv)
  }, [load])

  useEffect(() => {
    if (uiRevision === undefined) return
    if (lastUiRevision.current === null) {
      lastUiRevision.current = uiRevision
      return
    }
    if (lastUiRevision.current !== uiRevision) {
      lastUiRevision.current = uiRevision
      void load()
    }
  }, [uiRevision, load])

  if (!summary) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-[#0071e3] border-t-transparent" />
      </div>
    )
  }

  const pending = summary.requests.filter(
    (r) => r.status === 'unconfirmed' || r.status === 'submitted' || r.status === 'processing'
  )
  const completed = summary.requests.filter((r) => r.status === 'completed')
  const failed = summary.requests.filter((r) => r.status === 'timeout' || r.status === 'failed')
  const visibleWithData = summary.requests.filter((r) => r.status === 'completed' && r.has_data).length

  const avgResponse = health?.avg_response_time
  const dataReturnRate = health?.data_return_rate
  const supplementBatch = health?.latest_supplement_batch as SupplementBatch | undefined
  const healthBadges = getZtfHealthBadges(health)
  const recentTotalRequests = typeof health?.recent_total_requests === 'number'
    ? health.recent_total_requests
    : summary.total_pending + summary.total_completed + summary.total_failed
  const recentWithData = typeof health?.recent_with_data === 'number'
    ? health.recent_with_data
    : visibleWithData
  const visibleRequestCount = summary.requests.length

  const tabDefs: { id: TabId; label: string; count: number }[] = [
    { id: 'pending', label: 'Pending', count: pending.length },
    { id: 'completed', label: 'Completed', count: completed.length },
    { id: 'failed', label: 'Failed', count: failed.length },
  ]

  const reqs: Record<TabId, ZTFRequest[]> = { pending, completed, failed }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-[20px] font-semibold tracking-tight text-[#1d1d1f] dark:text-[#f5f5f7]">
            ZTF Forced Photometry Request Monitor
          </h2>
          <p className="mt-0.5 text-[12px] text-[#6e6e73] dark:text-[#86868b]">
            Monitor the status of ZTF forced photometry requests in real-time. Updates every 30 minutes automatically.
          </p>
        </div>
        <div className="flex justify-end">
          <button
            onClick={load}
            className="min-h-9 rounded-full border border-black/[0.1] dark:border-white/[0.15] bg-white dark:bg-[#121212] px-4 py-1.5 text-[12px] font-medium text-[#1d1d1f] dark:text-[#f5f5f7] hover:bg-[#f5f5f7] dark:hover:bg-[#1c1c1e]"
          >
            Refresh Now
          </button>
        </div>
      </div>

      {health && (
        <div className="flex flex-wrap gap-2">
          {healthBadges.map((badge) => (
            <span
              key={badge.label}
              className={`rounded-full border px-3 py-1 text-[11px] font-medium ${healthBadgeToneClasses[badge.tone]}`}
            >
              {badge.label} · {badge.value}
            </span>
          ))}
        </div>
      )}

      {supplementBatch && (
        <div className="glass rounded-2xl border border-[#0071e3]/15 bg-[#0071e3]/[0.035] p-4">
          <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-[13px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">最新补数批次</h3>
              <p className="text-[11px] text-[#6e6e73] dark:text-[#86868b]">
                {new Date(supplementBatch.started_at).toLocaleString()} 提交
              </p>
            </div>
            <p className="text-[11px] text-[#6e6e73] dark:text-[#86868b]">
              未被 ZTF 队列确认 {supplementBatch.queue_unconfirmed_sources}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-6">
            <BatchMetric label="本批目标" value={supplementBatch.total_sources} />
            <BatchMetric label="官方已受理" value={supplementBatch.accepted_sources} />
            <BatchMetric label="有效返回" value={supplementBatch.successful_sources} emphasis />
            <BatchMetric label="已受理处理中" value={supplementBatch.processing_sources} />
            <BatchMetric label="待队列确认" value={supplementBatch.awaiting_confirmation_sources} />
            <BatchMetric label="未受理 / 失败" value={supplementBatch.failed_sources} />
          </div>
        </div>
      )}

      <div>
        <h3 className="text-[13px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">近10天全量请求</h3>
        <p className="mt-0.5 text-[11px] text-[#6e6e73] dark:text-[#86868b]">
          汇总全部 {recentTotalRequests} 条；下方明细表仅展示最近 {visibleRequestCount} 条。
          {' '}数据返回率 = 匹配本地数据的完成请求 / 全部请求（含等待）。
          {' '}已结束请求完成率 {formatZtfRate(health?.success_rate)}（不含等待，不等于数据返回）。
          {typeof health?.recent_pending_over_48h === 'number' && (
            <> 等待超过48小时 {health.recent_pending_over_48h} 条；最长 {formatZtfHours(health.oldest_pending_hours)}。</>
          )}
        </p>
      </div>

      {/* Summary cards - row 1 */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <SummaryCard label="Pending" value={summary.total_pending} color="text-[#ff9f0a]" bg="bg-[#ff9f0a]/[0.06]" />
        <SummaryCard label="Completed" value={summary.total_completed} color="text-[#30d158]" bg="bg-[#30d158]/[0.06]" />
        <SummaryCard label="With Data" value={recentWithData} color="text-[#0a84ff]" bg="bg-[#0a84ff]/[0.06]" />
        <SummaryCard label="Failed" value={summary.total_failed} color="text-[#ff453a]" bg="bg-[#ff453a]/[0.06]" />
      </div>

      {/* Summary cards - row 2 (health stats) */}
      {health && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <SummaryCard
            label="Avg Response"
            value={formatZtfHours(avgResponse)}
            color="text-[#1d1d1f] dark:text-[#f5f5f7]" bg="bg-[#f5f5f7] dark:bg-[#1c1c1e]"
          />
          <SummaryCard
            label="数据返回率（含等待）"
            value={formatZtfRate(dataReturnRate)}
            color="text-[#1d1d1f] dark:text-[#f5f5f7]" bg="bg-[#f5f5f7] dark:bg-[#1c1c1e]"
          />
          <SummaryCard label="Total Requests" value={recentTotalRequests} color="text-[#1d1d1f] dark:text-[#f5f5f7]" bg="bg-[#f5f5f7] dark:bg-[#1c1c1e]" />
          <SummaryCard
            label="Incremental"
            value={health.incremental_pct != null ? `${health.incremental_pct}%` : '—'}
            color="text-[#1d1d1f] dark:text-[#f5f5f7]" bg="bg-[#f5f5f7] dark:bg-[#1c1c1e]"
          />
        </div>
      )}

      {/* Tabs */}
      <h3 className="text-[13px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">
        最近 {visibleRequestCount} 条请求明细
      </h3>
      <div className="flex gap-0 overflow-x-auto border-b border-black/[0.08] dark:border-white/[0.12]">
        {tabDefs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`relative shrink-0 px-4 py-2.5 text-[12px] font-medium ${
              tab === t.id ? 'text-[#1d1d1f] dark:text-[#f5f5f7]' : 'text-[#6e6e73] dark:text-[#86868b] hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7]'
            }`}
          >
            {t.label}
            <span className="ml-1.5 text-[10px] text-[#6e6e73] dark:text-[#86868b]">{t.count}</span>
            {tab === t.id && (
              <span className="absolute bottom-0 left-2 right-2 h-[2px] rounded-full bg-[#0071e3]" />
            )}
          </button>
        ))}
      </div>

      {/* Request Table */}
      <div className="glass overflow-hidden rounded-2xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[11px]">
            <thead>
              <tr className="border-b border-black/[0.08] dark:border-white/[0.12] text-[9px] uppercase tracking-wider text-[#6e6e73] dark:text-[#86868b]">
                <th className="px-3 py-2.5 font-medium">Source</th>
                <th className="px-3 py-2.5 font-medium">Request ID</th>
                <th className="px-3 py-2.5 font-medium">Status</th>
                <th className="px-3 py-2.5 font-medium text-center">Data</th>
                <th className="px-3 py-2.5 font-medium text-right">RA</th>
                <th className="px-3 py-2.5 font-medium text-right">Dec</th>
                <th className="px-3 py-2.5 font-medium">Submitted</th>
                <th className="px-3 py-2.5 font-medium">Completed</th>
              </tr>
            </thead>
            <tbody>
              {reqs[tab].length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-12 text-center text-[#6e6e73] dark:text-[#86868b]">No requests</td></tr>
              ) : reqs[tab].map((r, i) => (
                <tr
                  key={r.request_id}
                  className={`border-b border-black/[0.04] dark:border-white/[0.06] transition-colors hover:bg-black/[0.02] dark:hover:bg-white/[0.03] ${i % 2 === 0 ? '' : 'bg-black/[0.01] dark:bg-white/[0.01]'}`}
                >
                  <td className="px-3 py-2 font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">{r.source_name}</td>
                  <td className="px-3 py-2 font-mono text-[9px] text-[#6e6e73] dark:text-[#86868b] max-w-[160px] truncate">{r.request_id}</td>
                  <td className="px-3 py-2"><StatusPill status={r.status} /></td>
                  <td className="px-3 py-2 text-center">
                    {r.has_data ? <span className="text-[#34c759]">●</span> : <span className="text-[#6e6e73] dark:text-[#86868b]">○</span>}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-[#6e6e73] dark:text-[#86868b]">{r.ra?.toFixed(3) ?? '—'}</td>
                  <td className="px-3 py-2 text-right font-mono text-[#6e6e73] dark:text-[#86868b]">{r.dec?.toFixed(3) ?? '—'}</td>
                  <td className="px-3 py-2 text-[#6e6e73] dark:text-[#86868b]">{r.submit_time ? new Date(r.submit_time).toLocaleString() : '—'}</td>
                  <td className="px-3 py-2 text-[#6e6e73] dark:text-[#86868b]">{r.complete_time ? new Date(r.complete_time).toLocaleString() : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Estimate */}
      {estimateHtml && (
        <div className="glass rounded-2xl p-4">
          <iframe title="ZTF 返回时间说明" className="ztf-embed w-full min-h-[220px] border-0" srcDoc={estimateHtml} sandbox="" />
        </div>
      )}
    </div>
  )
}

function BatchMetric({ label, value, emphasis = false }: { label: string; value: number; emphasis?: boolean }) {
  return (
    <div className="rounded-xl border border-black/[0.06] bg-white/70 px-3 py-2.5 dark:border-white/[0.08] dark:bg-white/[0.04]">
      <p className={`text-[22px] font-bold tabular-nums ${emphasis ? 'text-[#30d158]' : 'text-[#1d1d1f] dark:text-[#f5f5f7]'}`}>{value}</p>
      <p className="text-[10px] font-medium text-[#6e6e73] dark:text-[#86868b]">{label}</p>
    </div>
  )
}

function SummaryCard({ label, value, color, bg }: { label: string; value: number | string; color: string; bg: string }) {
  return (
    <div className={`glass rounded-2xl p-4 text-center ${bg}`}>
      <p className={`text-[28px] font-bold tracking-tight tabular-nums ${color}`}>{value}</p>
      <p className="mt-0.5 break-words text-[11px] font-medium text-[#6e6e73] dark:text-[#86868b]">{label}</p>
    </div>
  )
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, { bg: string; text: string }> = {
    unconfirmed: {
      bg: 'bg-[#6e6e73]/10 dark:bg-[#86868b]/10',
      text: 'text-[#6e6e73] dark:text-[#86868b]',
    },
    submitted: { bg: 'bg-[#6e6e73]/10 dark:bg-[#86868b]/10', text: 'text-[#6e6e73] dark:text-[#86868b]' },
    processing: { bg: 'bg-[#ff9f0a]/10', text: 'text-[#ff9f0a]' },
    completed: { bg: 'bg-[#34c759]/10', text: 'text-[#34c759]' },
    timeout: { bg: 'bg-[#ff9f0a]/10', text: 'text-[#ff9f0a]' },
    failed: { bg: 'bg-[#ff453a]/10', text: 'text-[#ff453a]' },
  }
  const s = map[status] || map.submitted
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold capitalize ${s.bg} ${s.text}`}>
      {status}
    </span>
  )
}
