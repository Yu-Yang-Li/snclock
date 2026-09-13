import type {
  CandidateSummary,
  CandidateDetail,
  ArchiveCoverage,
  GottaAlertPreview,
  FollowupPreview,
  SiTianClawUiBundle,
  SNClockModelResult,
  SNClockInputEvidence,
  SNClockPrediction,
  ZTFMonitorSummary,
  SystemStatus,
  ObservabilityMetrics,
} from './types'

const BASE = '/api'

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`)
  if (!res.ok) throw new Error(`API ${res.status}: ${res.statusText}`)
  return res.json()
}

export const api = {
  candidates: {
    list: (limit = 50, offset = 0) =>
      get<CandidateSummary[]>(`/candidates?limit=${limit}&offset=${offset}`),
    get: (name: string) =>
      get<CandidateDetail>(`/candidates/${encodeURIComponent(name)}`),
    snClock: (name: string) =>
      get<SNClockPrediction | null>(`/candidates/${encodeURIComponent(name)}/sn_clock`),
    gottaPreview: (name: string) =>
      get<GottaAlertPreview>(`/candidates/${encodeURIComponent(name)}/gotta-alert`),
    archiveCoverage: (name: string) =>
      get<ArchiveCoverage>(`/candidates/${encodeURIComponent(name)}/archive-coverage`),
  },
  /** SiTianClaw：预警界面聚合 + 后随预览 */
  sitianClaw: {
    /** 整页快照（无 tns_name）：列表 + 天图 + 系统 + 各源光变/SN Clock 等 */
    uiDashboard: (opts?: {
      candidateLimit?: number
      includePlots?: boolean
      maxPlotSources?: number
      celestialProjection?: string
    }) => {
      const q = new URLSearchParams()
      if (opts?.candidateLimit != null) q.set('candidate_limit', String(opts.candidateLimit))
      if (opts?.includePlots === false) q.set('include_plots', 'false')
      if (opts?.maxPlotSources != null) q.set('max_plot_sources', String(opts.maxPlotSources))
      if (opts?.celestialProjection) q.set('celestial_projection', opts.celestialProjection)
      const qs = q.toString()
      return get<Record<string, unknown>>(`/sitian-claw/ui${qs ? `?${qs}` : ''}`)
    },
    uiBundle: (name: string) =>
      get<SiTianClawUiBundle>(`/sitian-claw/${encodeURIComponent(name)}/ui`),
    followupPreview: (name: string) =>
      get<FollowupPreview>(`/sitian-claw/${encodeURIComponent(name)}/followup`),
  },
  plots: {
    celestialMap: (projection = 'earth_surface') =>
      get<{ html: string; renderer?: string; fallback_image?: string }>(`/plots/celestial-map?projection=${projection}`),
    lightcurve: (name: string) =>
      get<{ image: string; path?: string }>(`/plots/lightcurve/${encodeURIComponent(name)}`),
    altitude: (name: string) =>
      get<{ image: string | null; error?: string }>(`/plots/altitude/${encodeURIComponent(name)}`),
    nondetection: (name: string) =>
      get<{ html: string }>(`/plots/nondetection/${encodeURIComponent(name)}`),
    snClockViz: (name: string) =>
      get<{
        prediction?: {
          texp: number
          ci_lower: number
          ci_upper: number
          ci_width?: number
          n_features?: number
          feature_completeness?: number
          model_features_present?: number
          model_features_total?: number
          input_evidence?: SNClockInputEvidence
        }
        prediction_error?: string
        convergence_png?: string | null
        convergence_gif?: string | null
        snclock_lightcurve?: string | null
        viz_html?: string
        models?: SNClockModelResult[]
      }>(`/plots/sn-clock/${encodeURIComponent(name)}`),
    candidateCard: (name: string) =>
      get<{ html: string }>(`/plots/candidate-card/${encodeURIComponent(name)}?include_texp_analysis=false`),
    dynamicLightcurve: (name: string) =>
      get<{ html: string; metadata: Record<string, unknown> }>(`/plots/dynamic-lightcurve/${encodeURIComponent(name)}`),
    crossmatch: (name: string) =>
      get<{ tns_name: string; ra: number; dec: number; results: Record<string, unknown> }>(`/plots/crossmatch/${encodeURIComponent(name)}`),
    hostGalaxy: (name: string) =>
      get<Record<string, unknown>>(`/plots/host-galaxy/${encodeURIComponent(name)}`),
    eruptionAnalysis: (name: string) =>
      get<{ tns_name: string; analysis: Record<string, unknown> }>(`/plots/eruption-analysis/${encodeURIComponent(name)}`),
    /** 可观测性量化（含兴隆 primary 调度判定） */
    observabilityMetrics: (name: string) =>
      get<ObservabilityMetrics>(`/plots/observability-metrics/${encodeURIComponent(name)}`),
  },
  stats: {
    table: (mode = 'total', dateFilter?: string) => {
      let url = `/stats/table?mode=${mode}`
      if (dateFilter) url += `&date_filter=${dateFilter}`
      return get<{ columns: string[]; rows: Record<string, unknown>[]; count: number }>(url)
    },
    discoveryHistory: (days = 30) =>
      get<{
        daily: { date: string; count: number }[]
        cumulative: { date: string; total: number }[]
        by_group: Record<string, { date: string; count: number }[]>
      }>(`/stats/discovery-history?days=${days}`),
    exportUrl: (mode = 'total', dateFilter?: string) => {
      let url = `${BASE}/stats/export?mode=${mode}`
      if (dateFilter) url += `&date_filter=${dateFilter}`
      return url
    },
  },
  ztf: {
    status: () => get<ZTFMonitorSummary>('/ztf/status'),
    detail: () => get<{
      stats_html: string
      pending_rows: unknown[][]
      completed_rows: unknown[][]
      failed_rows: unknown[][]
      estimate_html: string
      pending_count: number
      completed_count: number
      failed_count: number
    }>('/ztf/detail'),
    health: () => get<Record<string, unknown>>('/ztf/health'),
    classificationSummary: () =>
      get<Record<string, unknown>>('/ztf/classification-summary'),
  },
  system: {
    status: () => get<SystemStatus>('/system/status'),
    health: () => get<Record<string, unknown>>('/system/health'),
  },
  v1: {
    root: () => get<Record<string, unknown>>('/v1'),
    health: () => get<Record<string, unknown>>('/v1/health'),
  },
  snClock: {
    audit: (name: string) =>
      get<Record<string, unknown>>(`/sn-clock/audit/${encodeURIComponent(name)}`),
  },
}
