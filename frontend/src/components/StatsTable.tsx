import { useEffect, useState, useCallback, useRef, type ComponentType } from 'react'
import { api } from '../lib/api'
import { formatZtfHours, formatZtfRate } from '../lib/ztfHealthDisplay'
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from 'recharts'
import {
  Activity,
  BookOpen,
  CheckCircle2,
  Clock3,
  Copy,
  Database,
  ExternalLink,
  HeartPulse,
  Play,
  Server,
  Terminal,
} from 'lucide-react'

type ViewMode = 'total' | 'daily' | 'monthly'
type PlaygroundKind = 'health' | 'sources' | 'source-detail' | 'prediction' | 'observability' | 'stats-daily' | 'stats-total' | 'stats-csv'

type StatsProps = { uiRevision?: number }

const PUBLIC_ORIGIN = 'https://snclock.com'
const PUBLIC_API_BASE = `${PUBLIC_ORIGIN}/api/v1`
const PLAYGROUND_ENDPOINTS: { value: PlaygroundKind; label: string; description: string }[] = [
  { value: 'health', label: 'Health', description: 'GET /api/v1/health' },
  { value: 'sources', label: 'Source List', description: 'GET /api/v1/sources' },
  { value: 'source-detail', label: 'Source Detail', description: 'GET /api/v1/sources/{name}' },
  { value: 'prediction', label: 'Prediction', description: 'GET /api/v1/sources/{name}/prediction' },
  { value: 'observability', label: 'Observability', description: 'GET /api/v1/sources/{name}/observability' },
  { value: 'stats-daily', label: 'Daily Stats', description: 'GET /api/v1/stats' },
  { value: 'stats-total', label: 'Total Stats', description: 'GET /api/v1/stats' },
  { value: 'stats-csv', label: 'CSV Download', description: 'GET /api/stats/export' },
]

export default function StatsTable({ uiRevision }: StatsProps) {
  const lastUiRevision = useRef<number | null>(null)
  const tableRequestId = useRef(0)
  const [mode, setMode] = useState<ViewMode>('total')
  const [dateFilter, setDateFilter] = useState('')
  const [columns, setColumns] = useState<string[]>([])
  const [rows, setRows] = useState<Record<string, unknown>[]>([])
  const [count, setCount] = useState(0)
  const [loading, setLoading] = useState(true)

  const [daily, setDaily] = useState<{ date: string; count: number }[]>([])
  const [cumulative, setCumulative] = useState<{ date: string; total: number }[]>([])
  const [health, setHealth] = useState<Record<string, unknown> | null>(null)
  const [ztfHealth, setZtfHealth] = useState<Record<string, unknown> | null>(null)
  const [copiedApi, setCopiedApi] = useState<string | null>(null)
  const [playgroundKind, setPlaygroundKind] = useState<PlaygroundKind>('sources')
  const [playgroundSource, setPlaygroundSource] = useState('AT 2026mwd')
  const [playgroundLimit, setPlaygroundLimit] = useState('20')
  const [playgroundDate, setPlaygroundDate] = useState(formatDateKey(new Date()))
  const [playgroundLoading, setPlaygroundLoading] = useState(false)
  const [playgroundStatus, setPlaygroundStatus] = useState<string | null>(null)
  const [playgroundResult, setPlaygroundResult] = useState<string>('')

  const loadTable = useCallback(async () => {
    const requestId = ++tableRequestId.current
    setLoading(true)
    try {
      const d = await api.stats.table(mode, dateFilter || undefined)
      if (requestId !== tableRequestId.current) return
      setColumns(d.columns)
      setRows(d.rows)
      setCount(d.count)
    } catch (e) {
      console.error('Stats load failed', e)
    } finally {
      if (requestId === tableRequestId.current) setLoading(false)
    }
  }, [mode, dateFilter])

  const loadHistory = useCallback(async () => {
    try {
      const h = await api.stats.discoveryHistory(30)
      setDaily(h.daily)
      setCumulative(h.cumulative)
    } catch (e) {
      console.debug('Discovery history load failed', e)
    }
  }, [])

  const loadHealth = useCallback(async () => {
    try {
      const [systemHealth, ztf] = await Promise.allSettled([
        api.system.health(),
        api.ztf.health(),
      ])
      setHealth(systemHealth.status === 'fulfilled' ? systemHealth.value : null)
      setZtfHealth(ztf.status === 'fulfilled' ? ztf.value : null)
    } catch {
      setHealth(null)
      setZtfHealth(null)
    }
  }, [])

  useEffect(() => { loadTable() }, [loadTable])
  useEffect(() => { loadHistory() }, [loadHistory])
  useEffect(() => {
    void loadHealth()
    const iv = window.setInterval(() => void loadHealth(), 30000)
    return () => window.clearInterval(iv)
  }, [loadHealth])

  useEffect(() => {
    if (uiRevision === undefined) return
    if (lastUiRevision.current === null) {
      lastUiRevision.current = uiRevision
      return
    }
    if (lastUiRevision.current !== uiRevision) {
      lastUiRevision.current = uiRevision
      void loadTable()
      void loadHistory()
    }
  }, [uiRevision, loadTable, loadHistory])

  const displayCols = columns.filter((c) =>
    ['source_name', 'tns_name', 'source_group_name', 'ra_deg', 'dec_deg',
     'host_name', 'host_redshift', 'host_galactic_b', 'discovery_iso', 'discoverydate',
     'discoverymag', 'last_non_detection', 'atlas_last_non_detection',
     'ztfplan_last_non_detection', 'ztf_forced_last_non_detection',
     'Report_TNS', 'Report_ATLAS', 'Report_ZTF_Schedule', 'Report_ZTF_Forced',
     'reporter', 'discoverer', 'type'].includes(c)
  )
  // Explosion-time columns are appended after the core whitelist so they
  // render once the backend starts persisting them.
  const explosionCols = columns.filter((c) =>
    ['explosion_t0_days', 'explosion_t0_uncertainty', 'explosion_fit_quality',
     'explosion_n_detections', 'explosion_n_nondetections'].includes(c)
  )
  const displayColsWithExplosion = [...displayCols, ...explosionCols]
  const shownCols = displayColsWithExplosion.length > 0 ? displayColsWithExplosion : columns.slice(0, 12)
  const dailyChart = fillRecentDailySeries(daily, 30)
  const cumulativeChart = buildCumulativeSeries(cumulative, dailyChart)
  const totalSources = cumulativeChart[cumulativeChart.length - 1]?.total ?? count
  const todayCount = dailyChart[dailyChart.length - 1]?.count ?? 0
  const weekCount = dailyChart.slice(-7).reduce((sum, item) => sum + item.count, 0)
  const peakDaily = Math.max(1, ...dailyChart.map((item) => item.count))
  const checks = getChecks(health)
  const snClockModels = getSnClockModels(health)
  const catalogEntries = getCatalogEntries(health)
  const lsstRows = getLsstRows(health)
  const overallStatus = getString(health?.status) || 'unknown'
  const playgroundRequest = buildPlaygroundRequest({
    kind: playgroundKind,
    source: playgroundSource,
    limit: playgroundLimit,
    date: playgroundDate,
  })
  const apiExamples = [
    { label: 'Health', method: 'GET', path: '/api/v1/health', note: 'Public service health' },
    { label: 'Sources', method: 'GET', path: '/api/v1/sources?limit=50&offset=0', note: 'Paged candidate list' },
    { label: 'Source Detail', method: 'GET', path: '/api/v1/sources/AT%202026mwd?include_photometry=true', note: 'Single source plus optional photometry' },
    { label: 'Prediction', method: 'GET', path: '/api/v1/sources/AT%202026mwd/prediction', note: 'Multi-model SN Clock output' },
    { label: 'Observability', method: 'GET', path: '/api/v1/sources/AT%202026mwd/observability', note: 'Altitude and scheduling metrics' },
    { label: 'Stats', method: 'GET', path: '/api/v1/stats?mode=daily&date_filter=2026-05-18', note: 'Versioned statistics table' },
  ]
  const downloadExamples = [
    { label: 'Total CSV', path: '/api/stats/export?mode=total', note: 'All rows in statistics view' },
    { label: 'Daily CSV', path: '/api/stats/export?mode=daily&date_filter=2026-05-18', note: 'Date-filtered statistics table' },
    { label: 'HTML Report', path: '/api/export/dashboard?table_limit=100&max_cards=8&include_cards=true&download=true', note: 'Dashboard snapshot for sharing' },
    { label: 'Lightcurve Page PNG', path: '/api/plots/lightcurve/AT%202026mwd/page.png', note: 'Full page light-curve snapshot' },
    { label: 'Interactive Lightcurve', path: '/api/plots/lightcurve/AT%202026mwd/interactive.html', note: 'Plotly HTML from candidate page' },
  ]

  function copyApi(text: string, id: string) {
    void navigator.clipboard?.writeText(text).then(() => {
      setCopiedApi(id)
      window.setTimeout(() => setCopiedApi(null), 1400)
    })
  }

  async function runPlayground() {
    setPlaygroundLoading(true)
    setPlaygroundStatus(null)
    setPlaygroundResult('')
    try {
      const res = await fetch(playgroundRequest.runtimePath, {
        method: 'GET',
        headers: { Accept: playgroundRequest.download ? 'text/csv,*/*' : 'application/json' },
      })
      const contentType = res.headers.get('content-type') || ''
      const body = contentType.includes('application/json')
        ? JSON.stringify(await res.json(), null, 2)
        : await res.text()
      setPlaygroundStatus(`${res.status} ${res.statusText || (res.ok ? 'OK' : 'Error')}`)
      setPlaygroundResult(body.slice(0, 6000))
    } catch (e) {
      setPlaygroundStatus('request failed')
      setPlaygroundResult(e instanceof Error ? e.message : String(e))
    } finally {
      setPlaygroundLoading(false)
    }
  }

  const colLabel: Record<string, string> = {
    source_name: 'Source', tns_name: 'Name', source_group_name: 'Reporter',
    ra_deg: 'RA', dec_deg: 'Dec', host_name: 'Host', host_redshift: 'Host z',
    host_galactic_b: 'Host b', discovery_iso: 'Discovery', discoverydate: 'Discovery',
    discoverymag: 'Mag', last_non_detection: 'Last NonDet', reporter: 'Reporter',
    discoverer: 'Discoverer', type: 'Type',
    atlas_last_non_detection: 'ATLAS NonDet', ztfplan_last_non_detection: 'ZTF-Sched NonDet',
    ztf_forced_last_non_detection: 'ZTF-Forced NonDet',
    Report_TNS: 'Report TNS', Report_ATLAS: 'Report ATLAS',
    explosion_t0_days: 'Explosion t0 (d)', explosion_t0_uncertainty: 't0 ± (d)',
    explosion_fit_quality: 't0 Model', explosion_n_detections: 't0 Dets',
    explosion_n_nondetections: 't0 Limits',
    Report_ZTF_Schedule: 'Report ZTF-Sched', Report_ZTF_Forced: 'Report ZTF-Forced',
  }

  return (
    <div className="space-y-5">
      <h2 className="text-[20px] font-semibold tracking-tight text-[#1d1d1f] dark:text-[#f5f5f7]">
        Statistical Views (Daily / Monthly / Total)
      </h2>

      {/* Controls */}
      <div className="flex flex-wrap items-end gap-4">
        <div>
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-[#6e6e73] dark:text-[#86868b]">View Mode</p>
          <div className="flex rounded-xl overflow-hidden border border-black/[0.1] dark:border-white/[0.15]">
            {(['daily', 'monthly', 'total'] as ViewMode[]).map((m) => (
              <button
                key={m}
                onClick={() => {
                  if (m !== mode) setDateFilter('')
                  setMode(m)
                }}
                className={`px-4 py-1.5 text-[12px] font-medium capitalize transition ${
                  mode === m
                    ? 'bg-[#0071e3] text-white'
                    : 'bg-white dark:bg-[#121212] text-[#6e6e73] dark:text-[#86868b] hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7] hover:bg-[#f5f5f7] dark:hover:bg-[#1c1c1e]'
                }`}
              >
                {m}
              </button>
            ))}
          </div>
        </div>

        {mode === 'daily' && (
          <div>
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-[#6e6e73] dark:text-[#86868b]">Date (YYYY-MM-DD)</p>
            <input
              type="date" value={dateFilter} onChange={(e) => setDateFilter(e.target.value)}
              className="h-8 rounded-lg border border-black/[0.1] dark:border-white/[0.15] bg-white dark:bg-[#121212] px-3 text-[12px] text-[#1d1d1f] dark:text-[#f5f5f7] outline-none"
            />
          </div>
        )}
        {mode === 'monthly' && (
          <div>
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-[#6e6e73] dark:text-[#86868b]">Month (YYYY-MM)</p>
            <input
              type="month" value={dateFilter} onChange={(e) => setDateFilter(e.target.value)}
              className="h-8 rounded-lg border border-black/[0.1] dark:border-white/[0.15] bg-white dark:bg-[#121212] px-3 text-[12px] text-[#1d1d1f] dark:text-[#f5f5f7] outline-none"
            />
          </div>
        )}

        <button
          onClick={loadTable}
          className="rounded-full bg-[#0071e3] px-4 py-1.5 text-[12px] font-semibold text-white hover:bg-[#0077ed] active:scale-[0.97]"
        >
          Refresh
        </button>

        <a
          href={api.stats.exportUrl(mode, dateFilter || undefined)}
          className="rounded-full border border-black/[0.1] dark:border-white/[0.15] bg-white dark:bg-[#121212] px-4 py-1.5 text-[12px] font-medium text-[#1d1d1f] dark:text-[#f5f5f7] hover:bg-[#f5f5f7] dark:hover:bg-[#1c1c1e]"
        >
          Export CSV
        </a>
      </div>

      {/* Stats Table */}
      <div className="glass overflow-hidden rounded-2xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[11px]">
            <thead>
              <tr className="border-b border-black/[0.08] dark:border-white/[0.12]">
                {shownCols.map((c) => (
                  <th key={c} className="px-3 py-2.5 text-[9px] font-semibold uppercase tracking-widest text-[#6e6e73] dark:text-[#86868b] whitespace-nowrap">
                    {colLabel[c] ?? c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={shownCols.length} className="px-4 py-16 text-center text-[#6e6e73] dark:text-[#86868b]">
                  <div className="mx-auto h-5 w-5 animate-spin rounded-full border-2 border-[#0071e3] border-t-transparent" />
                </td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={shownCols.length} className="px-4 py-16 text-center text-[#6e6e73] dark:text-[#86868b]">
                  No data for this filter
                </td></tr>
              ) : rows.slice(0, 200).map((r, i) => (
                <tr key={i} className={`border-b border-black/[0.04] dark:border-white/[0.06] hover:bg-black/[0.02] dark:hover:bg-white/[0.03] ${i % 2 ? 'bg-black/[0.01] dark:bg-white/[0.01]' : ''}`}>
                  {shownCols.map((c) => (
                    <td key={c} className="px-3 py-2 text-[#1d1d1f] dark:text-[#f5f5f7] whitespace-nowrap max-w-[180px] truncate tabular-nums">
                      {formatCell(r[c], c)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {count > 0 && (
          <div className="border-t border-black/[0.06] dark:border-white/[0.10] px-4 py-2 text-[10px] text-[#6e6e73] dark:text-[#86868b]">
            {count} rows total {rows.length > 200 && `(showing first 200)`}
          </div>
        )}
      </div>

      {/* Charts Section */}
      {(daily.length > 0 || cumulative.length > 0) && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <MetricTile icon={Activity} label="Today" value={String(todayCount)} sublabel="new sources" tone="blue" />
            <MetricTile icon={Clock3} label="Last 7 days" value={String(weekCount)} sublabel="discoveries" tone="amber" />
            <MetricTile icon={Database} label="Total" value={String(totalSources)} sublabel="tracked sources" tone="green" />
            <MetricTile icon={CheckCircle2} label="Current table" value={String(count)} sublabel={`${mode} view`} tone="slate" />
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.15fr_0.85fr]">
          {/* Discovery History Chart */}
          {daily.length > 0 && (
            <div className="glass rounded-2xl p-5">
              <SectionTitle title="Discovery Activity" subtitle="30-day cadence, zero days included" />
              <ResponsiveContainer width="100%" height={230}>
                <BarChart data={dailyChart} margin={{ top: 12, right: 12, left: -18, bottom: 2 }} barCategoryGap="34%">
                  <CartesianGrid strokeDasharray="4 6" stroke="rgba(110,110,115,0.16)" vertical={false} />
                  <XAxis
                    dataKey="date"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 10, fill: '#6e6e73' }}
                    tickFormatter={(v: string) => v.slice(5)}
                    interval={6}
                  />
                  <YAxis
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 10, fill: '#6e6e73' }}
                    allowDecimals={false}
                    domain={[0, Math.max(3, peakDaily + 1)]}
                  />
                  <Tooltip content={<StatsTooltip valueLabel="discoveries" />} cursor={{ fill: 'rgba(0,113,227,0.06)' }} />
                  <ReferenceLine y={1} stroke="rgba(0,113,227,0.18)" strokeDasharray="4 5" />
                  <Bar dataKey="count" name="Discoveries" fill="url(#dailyBarGradient)" radius={[4, 4, 0, 0]} maxBarSize={18} />
                  <defs>
                    <linearGradient id="dailyBarGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#0ea5e9" />
                      <stop offset="100%" stopColor="#2563eb" />
                    </linearGradient>
                  </defs>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Cumulative Chart */}
          {cumulative.length > 0 && (
            <div className="glass rounded-2xl p-5">
              <SectionTitle title="Cumulative Pipeline Count" subtitle="Running total from current history" />
              <ResponsiveContainer width="100%" height={230}>
                <AreaChart data={cumulativeChart} margin={{ top: 12, right: 12, left: -18, bottom: 2 }}>
                  <CartesianGrid strokeDasharray="4 6" stroke="rgba(110,110,115,0.16)" vertical={false} />
                  <XAxis
                    dataKey="date"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 10, fill: '#6e6e73' }}
                    tickFormatter={(v: string) => v.slice(5)}
                    interval={6}
                  />
                  <YAxis
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 10, fill: '#6e6e73' }}
                    allowDecimals={false}
                    domain={[0, Math.max(3, totalSources + 1)]}
                  />
                  <Tooltip content={<StatsTooltip valueLabel="total sources" />} cursor={{ stroke: 'rgba(16,185,129,0.22)', strokeWidth: 1 }} />
                  <Area type="monotone" dataKey="total" stroke="#10b981" fill="url(#totalAreaGradient)" strokeWidth={2.5} dot={{ r: 2.5, strokeWidth: 1 }} activeDot={{ r: 5 }} />
                  <defs>
                    <linearGradient id="totalAreaGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#10b981" stopOpacity={0.22} />
                      <stop offset="100%" stopColor="#10b981" stopOpacity={0.015} />
                    </linearGradient>
                  </defs>
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.05fr_0.95fr]">
        <section className="glass rounded-2xl p-5">
          <div className="mb-4 flex items-start justify-between gap-3">
            <SectionTitle title="Public Read-Only API" subtitle={`Base URL ${PUBLIC_API_BASE}`} />
            <div className="flex gap-2">
              <a className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-black/[0.08] px-2.5 text-[11px] font-semibold text-[#0071e3] hover:bg-[#0071e3]/8 dark:border-white/[0.12]" href={`${PUBLIC_ORIGIN}/docs`} target="_blank" rel="noreferrer" title="Open FastAPI docs">
                <BookOpen className="h-4 w-4" />
                Docs
              </a>
              <a className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-black/[0.08] px-2.5 text-[11px] font-semibold text-[#0071e3] hover:bg-[#0071e3]/8 dark:border-white/[0.12]" href={`${PUBLIC_ORIGIN}/openapi.json`} target="_blank" rel="noreferrer" title="Open OpenAPI JSON">
                <ExternalLink className="h-4 w-4" />
                OpenAPI
              </a>
            </div>
          </div>
          <p className="mb-3 text-[11px] leading-relaxed text-[#6e6e73] dark:text-[#86868b]">
            Public endpoints are query/download oriented. Operational actions such as refresh, broker scans, and follow-up execution stay out of this public surface.
          </p>
          <div className="overflow-hidden rounded-xl border border-black/[0.07] dark:border-white/[0.10]">
            {apiExamples.map((item) => (
              <div key={item.path} className="grid gap-2 border-b border-black/[0.05] px-3 py-3 last:border-b-0 dark:border-white/[0.08] md:grid-cols-[112px_minmax(0,1fr)_96px] md:items-center">
                <div className="flex items-center gap-2">
                  <span className="rounded-md bg-[#10b981]/10 px-2 py-1 text-[10px] font-bold text-[#047857]">{item.method}</span>
                  <span className="text-[11px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">{item.label}</span>
                </div>
                <div className="min-w-0">
                  <code className="block overflow-hidden text-ellipsis whitespace-nowrap rounded-lg bg-black/[0.035] px-2 py-1.5 text-[11px] text-[#374151] dark:bg-white/[0.07] dark:text-[#d1d5db]">
                    {item.path}
                  </code>
                  <div className="mt-1 text-[10px] text-[#6e6e73] dark:text-[#86868b]">{item.note}</div>
                </div>
                <button
                  className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-black/[0.08] px-2.5 text-[11px] font-semibold text-[#0071e3] hover:bg-[#0071e3]/8 dark:border-white/[0.12]"
                  onClick={() => copyApi(`${PUBLIC_ORIGIN}${item.path}`, item.path)}
                  title={`Copy ${item.label} URL`}
                >
                  <Copy className="h-3.5 w-3.5" />
                  {copiedApi === item.path ? 'Copied' : 'Copy'}
                </button>
              </div>
            ))}
          </div>
          <div className="mt-4">
            <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">
              <Database className="h-4 w-4 text-[#0071e3]" />
              Downloads
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {downloadExamples.map((item) => (
                <button
                  key={item.path}
                  className="min-w-0 rounded-xl border border-black/[0.07] bg-white/[0.55] px-3 py-2 text-left hover:bg-[#0071e3]/6 dark:border-white/[0.10] dark:bg-white/[0.04]"
                  onClick={() => copyApi(`${PUBLIC_ORIGIN}${item.path}`, item.path)}
                  title={`Copy ${item.label} URL`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">{item.label}</span>
                    <span className="text-[10px] font-semibold text-[#0071e3]">{copiedApi === item.path ? 'Copied' : 'Copy'}</span>
                  </div>
                  <code className="mt-1 block overflow-hidden text-ellipsis whitespace-nowrap text-[10px] text-[#6e6e73] dark:text-[#86868b]">{item.path}</code>
                  <div className="mt-1 text-[10px] text-[#6e6e73] dark:text-[#86868b]">{item.note}</div>
                </button>
              ))}
            </div>
          </div>
          <div className="mt-4 rounded-xl bg-[#111827] p-4 text-[11px] text-[#e5e7eb]">
            <div className="mb-2 flex items-center gap-2 text-[#93c5fd]">
              <Terminal className="h-4 w-4" />
              <span className="font-semibold">curl</span>
            </div>
            <code className="block whitespace-pre-wrap break-words leading-relaxed">
              curl -s {PUBLIC_API_BASE}/sources?limit=20{'\n'}curl -L -o snclock_stats_total.csv "{PUBLIC_ORIGIN}/api/stats/export?mode=total"
            </code>
          </div>
        </section>

        <div className="space-y-4">
          <section className="glass rounded-2xl p-5">
            <div className="mb-4 flex items-start justify-between gap-3">
              <SectionTitle title="Health Monitor" subtitle="API, catalog, model, broker, and forced-photometry status" />
              <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase ${overallStatus === 'ok' ? 'bg-[#10b981]/10 text-[#047857]' : 'bg-[#ff9f0a]/12 text-[#9a3412]'}`}>
                {overallStatus}
              </span>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <HealthItem icon={Server} label="API" ok={checks.api} value="reachable" />
              <HealthItem icon={Database} label="Candidates" ok={checks.candidate_state} value={`${getCandidateCount(health)} active`} />
              <HealthItem icon={Clock3} label="TNS Cycle" ok={checks.tns_cycle} value={getCycleRunning(health) ? 'running' : 'idle'} />
              <HealthItem icon={Database} label="Local Catalog" ok={checks.local_catalog} value={catalogEntries ? `${formatInt(catalogEntries)} rows` : 'ready'} />
              <HealthItem icon={Activity} label="SN Clock" ok={checks.sn_clock_models} value={`${snClockModels.enabled}/${snClockModels.total} models`} />
              <HealthItem icon={HeartPulse} label="LSST Broker" ok={lsstRows > 0} value={`${lsstRows || 0} rows`} />
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3 border-t border-black/[0.06] pt-4 text-[11px] dark:border-white/[0.10]">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-widest text-[#6e6e73] dark:text-[#86868b]">ZTF 数据返回率（含等待）</div>
                <div className="mt-1 text-[18px] font-bold tabular-nums text-[#1d1d1f] dark:text-[#f5f5f7]">{formatZtfRate(ztfHealth?.data_return_rate)}</div>
              </div>
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-widest text-[#6e6e73] dark:text-[#86868b]">Avg response</div>
                <div className="mt-1 text-[18px] font-bold tabular-nums text-[#1d1d1f] dark:text-[#f5f5f7]">{formatZtfHours(ztfHealth?.avg_response_time)}</div>
              </div>
            </div>
          </section>

          <section className="glass rounded-2xl p-5">
            <div className="mb-4 flex items-start justify-between gap-3">
              <SectionTitle title="API Playground" subtitle="Manual read-only GET test" />
              <span className="rounded-full bg-[#0071e3]/10 px-2.5 py-1 text-[10px] font-bold text-[#0071e3]">REST</span>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="text-[10px] font-semibold uppercase tracking-widest text-[#6e6e73] dark:text-[#86868b]">
                Endpoint
                <select
                  value={playgroundKind}
                  onChange={(e) => setPlaygroundKind(e.target.value as PlaygroundKind)}
                  className="mt-1 h-9 w-full rounded-lg border border-black/[0.1] bg-white px-2 text-[12px] normal-case tracking-normal text-[#1d1d1f] outline-none dark:border-white/[0.15] dark:bg-[#121212] dark:text-[#f5f5f7]"
                >
                  {PLAYGROUND_ENDPOINTS.map((item) => (
                    <option key={item.value} value={item.value}>{item.label}</option>
                  ))}
                </select>
              </label>
              <label className="text-[10px] font-semibold uppercase tracking-widest text-[#6e6e73] dark:text-[#86868b]">
                Source
                <input
                  value={playgroundSource}
                  onChange={(e) => setPlaygroundSource(e.target.value)}
                  disabled={!playgroundRequest.usesSource}
                  className="mt-1 h-9 w-full rounded-lg border border-black/[0.1] bg-white px-2 text-[12px] normal-case tracking-normal text-[#1d1d1f] outline-none disabled:opacity-45 dark:border-white/[0.15] dark:bg-[#121212] dark:text-[#f5f5f7]"
                />
              </label>
              <label className="text-[10px] font-semibold uppercase tracking-widest text-[#6e6e73] dark:text-[#86868b]">
                Limit
                <input
                  type="number"
                  min="1"
                  max="200"
                  value={playgroundLimit}
                  onChange={(e) => setPlaygroundLimit(e.target.value)}
                  disabled={!playgroundRequest.usesLimit}
                  className="mt-1 h-9 w-full rounded-lg border border-black/[0.1] bg-white px-2 text-[12px] normal-case tracking-normal text-[#1d1d1f] outline-none disabled:opacity-45 dark:border-white/[0.15] dark:bg-[#121212] dark:text-[#f5f5f7]"
                />
              </label>
              <label className="text-[10px] font-semibold uppercase tracking-widest text-[#6e6e73] dark:text-[#86868b]">
                Date
                <input
                  type="date"
                  value={playgroundDate}
                  onChange={(e) => setPlaygroundDate(e.target.value)}
                  disabled={!playgroundRequest.usesDate}
                  className="mt-1 h-9 w-full rounded-lg border border-black/[0.1] bg-white px-2 text-[12px] normal-case tracking-normal text-[#1d1d1f] outline-none disabled:opacity-45 dark:border-white/[0.15] dark:bg-[#121212] dark:text-[#f5f5f7]"
                />
              </label>
            </div>
            <div className="mt-3 rounded-xl border border-black/[0.07] bg-black/[0.025] p-3 dark:border-white/[0.10] dark:bg-white/[0.05]">
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-widest text-[#6e6e73] dark:text-[#86868b]">Request</span>
                <span className="text-[10px] text-[#6e6e73] dark:text-[#86868b]">{PLAYGROUND_ENDPOINTS.find((item) => item.value === playgroundKind)?.description}</span>
              </div>
              <code className="block overflow-hidden text-ellipsis whitespace-nowrap text-[11px] text-[#374151] dark:text-[#d1d5db]">
                GET {playgroundRequest.publicUrl}
              </code>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                onClick={runPlayground}
                disabled={playgroundLoading}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[#0071e3] px-3 text-[12px] font-semibold text-white hover:bg-[#0077ed] disabled:cursor-wait disabled:opacity-60"
              >
                <Play className="h-3.5 w-3.5" />
                {playgroundLoading ? 'Sending' : 'Send GET'}
              </button>
              <button
                onClick={() => copyApi(playgroundRequest.publicUrl, 'playground-url')}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-black/[0.08] px-3 text-[12px] font-semibold text-[#0071e3] hover:bg-[#0071e3]/8 dark:border-white/[0.12]"
              >
                <Copy className="h-3.5 w-3.5" />
                {copiedApi === 'playground-url' ? 'Copied' : 'Copy URL'}
              </button>
              {playgroundRequest.download && (
                <a
                  href={playgroundRequest.runtimePath}
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-black/[0.08] px-3 text-[12px] font-semibold text-[#0071e3] hover:bg-[#0071e3]/8 dark:border-white/[0.12]"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  Open
                </a>
              )}
            </div>
            {(playgroundStatus || playgroundResult) && (
              <div className="mt-3 overflow-hidden rounded-xl bg-[#111827] text-[11px] text-[#e5e7eb]">
                <div className="border-b border-white/10 px-3 py-2 text-[#93c5fd]">{playgroundStatus}</div>
                <pre className="max-h-[260px] overflow-auto whitespace-pre-wrap break-words px-3 py-3">{playgroundResult || 'No response body'}</pre>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}

type IconType = ComponentType<{ className?: string }>

function SectionTitle({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div>
      <h3 className="text-[14px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">{title}</h3>
      <p className="mt-1 text-[11px] text-[#6e6e73] dark:text-[#86868b]">{subtitle}</p>
    </div>
  )
}

function MetricTile({
  icon: Icon,
  label,
  value,
  sublabel,
  tone,
}: {
  icon: IconType
  label: string
  value: string
  sublabel: string
  tone: 'blue' | 'green' | 'amber' | 'slate'
}) {
  const tones = {
    blue: 'bg-[#0ea5e9]/10 text-[#0369a1]',
    green: 'bg-[#10b981]/10 text-[#047857]',
    amber: 'bg-[#f59e0b]/12 text-[#92400e]',
    slate: 'bg-[#64748b]/10 text-[#475569]',
  }
  return (
    <div className="glass rounded-2xl px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-widest text-[#6e6e73] dark:text-[#86868b]">{label}</div>
          <div className="mt-1 text-[24px] font-bold leading-none tabular-nums text-[#1d1d1f] dark:text-[#f5f5f7]">{value}</div>
        </div>
        <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${tones[tone]}`}>
          <Icon className="h-4 w-4" />
        </div>
      </div>
      <div className="mt-2 text-[11px] text-[#6e6e73] dark:text-[#86868b]">{sublabel}</div>
    </div>
  )
}

function HealthItem({ icon: Icon, label, ok, value }: { icon: IconType; label: string; ok: boolean; value: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-black/[0.06] bg-white/[0.55] px-3 py-3 dark:border-white/[0.10] dark:bg-white/[0.04]">
      <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${ok ? 'bg-[#10b981]/10 text-[#047857]' : 'bg-[#ff9f0a]/12 text-[#9a3412]'}`}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <div className="text-[11px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">{label}</div>
        <div className="truncate text-[10px] text-[#6e6e73] dark:text-[#86868b]">{value}</div>
      </div>
      <div className={`ml-auto h-2.5 w-2.5 rounded-full ${ok ? 'bg-[#10b981]' : 'bg-[#ff9f0a]'}`} />
    </div>
  )
}

function StatsTooltip({ active, payload, label, valueLabel }: {
  active?: boolean
  payload?: { value?: number }[]
  label?: string
  valueLabel: string
}) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-xl border border-black/[0.08] bg-white px-3 py-2 text-[11px] shadow-xl dark:border-white/[0.12] dark:bg-[#1c1c1e]">
      <div className="font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">{label}</div>
      <div className="mt-1 tabular-nums text-[#6e6e73] dark:text-[#86868b]">{payload[0].value ?? 0} {valueLabel}</div>
    </div>
  )
}

function buildPlaygroundRequest({
  kind,
  source,
  limit,
  date,
}: {
  kind: PlaygroundKind
  source: string
  limit: string
  date: string
}) {
  const sourceId = encodeURIComponent(source.trim() || 'AT 2026mwd')
  const boundedLimit = Math.min(200, Math.max(1, Number(limit) || 20))
  const safeDate = date || formatDateKey(new Date())
  const base = { usesSource: false, usesLimit: false, usesDate: false, download: false }
  let path = '/api/v1/health'

  if (kind === 'sources') {
    path = `/api/v1/sources?limit=${boundedLimit}&offset=0`
    return { ...base, usesLimit: true, runtimePath: path, publicUrl: `${PUBLIC_ORIGIN}${path}` }
  }
  if (kind === 'source-detail') {
    path = `/api/v1/sources/${sourceId}?include_photometry=true`
    return { ...base, usesSource: true, runtimePath: path, publicUrl: `${PUBLIC_ORIGIN}${path}` }
  }
  if (kind === 'prediction') {
    path = `/api/v1/sources/${sourceId}/prediction`
    return { ...base, usesSource: true, runtimePath: path, publicUrl: `${PUBLIC_ORIGIN}${path}` }
  }
  if (kind === 'observability') {
    path = `/api/v1/sources/${sourceId}/observability`
    return { ...base, usesSource: true, runtimePath: path, publicUrl: `${PUBLIC_ORIGIN}${path}` }
  }
  if (kind === 'stats-daily') {
    path = `/api/v1/stats?mode=daily&date_filter=${safeDate}`
    return { ...base, usesDate: true, runtimePath: path, publicUrl: `${PUBLIC_ORIGIN}${path}` }
  }
  if (kind === 'stats-total') {
    path = '/api/v1/stats?mode=total'
    return { ...base, runtimePath: path, publicUrl: `${PUBLIC_ORIGIN}${path}` }
  }
  if (kind === 'stats-csv') {
    path = `/api/stats/export?mode=daily&date_filter=${safeDate}`
    return { ...base, usesDate: true, download: true, runtimePath: path, publicUrl: `${PUBLIC_ORIGIN}${path}` }
  }

  return { ...base, runtimePath: path, publicUrl: `${PUBLIC_ORIGIN}${path}` }
}

function formatCell(v: unknown, col: string): string {
  if (v === null || v === undefined || v === 'nan' || v === 'None') return '—'
  if (typeof v === 'number') {
    if (['ra_deg', 'dec_deg'].includes(col)) return v.toFixed(4)
    if (['host_redshift'].includes(col)) return v.toFixed(5)
    if (['host_galactic_b', 'discoverymag'].includes(col)) return v.toFixed(2)
    if (col.includes('Report_') || col.includes('non_detection')) return v.toFixed(2)
    return String(v)
  }
  const s = String(v)
  if (s.length > 30) return s.slice(0, 27) + '...'
  return s
}

function fillRecentDailySeries(series: { date: string; count: number }[], days: number) {
  const byDate = new Map(series.map((item) => [item.date, Number(item.count) || 0]))
  const end = new Date()
  end.setHours(0, 0, 0, 0)
  return Array.from({ length: days }, (_, index) => {
    const d = new Date(end)
    d.setDate(end.getDate() - (days - 1 - index))
    const date = formatDateKey(d)
    return { date, count: byDate.get(date) ?? 0 }
  })
}

function buildCumulativeSeries(
  cumulative: { date: string; total: number }[],
  dailySeries: { date: string; count: number }[],
) {
  if (dailySeries.length === 0) return cumulative
  const sourceTotal = cumulative[cumulative.length - 1]?.total ?? dailySeries.reduce((sum, item) => sum + item.count, 0)
  const dailyTotal = dailySeries.reduce((sum, item) => sum + item.count, 0)
  let running = Math.max(0, sourceTotal - dailyTotal)
  return dailySeries.map((item) => {
    running += item.count
    return { date: item.date, total: running }
  })
}

function formatDateKey(date: Date): string {
  const y = date.getFullYear()
  const m = `${date.getMonth() + 1}`.padStart(2, '0')
  const d = `${date.getDate()}`.padStart(2, '0')
  return `${y}-${m}-${d}`
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function getString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function getNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value)
    return Number.isFinite(n) ? n : null
  }
  return null
}

function getChecks(health: Record<string, unknown> | null) {
  const checks = asRecord(health?.checks)
  const ok = (key: string) => Boolean(asRecord(checks?.[key])?.ok)
  return {
    api: ok('api'),
    candidate_state: ok('candidate_state'),
    tns_cycle: ok('tns_cycle'),
    local_catalog: ok('local_catalog'),
    sn_clock_models: ok('sn_clock_models'),
  }
}

function getCandidateCount(health: Record<string, unknown> | null): number {
  const checks = asRecord(health?.checks)
  return getNumber(asRecord(checks?.candidate_state)?.n_candidates) ?? 0
}

function getCycleRunning(health: Record<string, unknown> | null): boolean {
  const checks = asRecord(health?.checks)
  return Boolean(asRecord(checks?.tns_cycle)?.running)
}

function getCatalogEntries(health: Record<string, unknown> | null): number | null {
  const checks = asRecord(health?.checks)
  return getNumber(asRecord(checks?.local_catalog)?.runtime_entries)
}

function getSnClockModels(health: Record<string, unknown> | null): { enabled: number; total: number } {
  const checks = asRecord(health?.checks)
  const models = asRecord(checks?.sn_clock_models)?.models
  if (!Array.isArray(models)) return { enabled: 0, total: 0 }
  return {
    enabled: models.filter((item) => Boolean(asRecord(item)?.enabled)).length,
    total: models.length,
  }
}

function getLsstRows(health: Record<string, unknown> | null): number {
  const checks = asRecord(health?.checks)
  const brokers = asRecord(checks?.brokers)
  const lsst = asRecord(brokers?.lsst)
  return getNumber(lsst?.last_total_rows) ?? 0
}

function formatInt(value: number): string {
  return new Intl.NumberFormat('en-US').format(value)
}
