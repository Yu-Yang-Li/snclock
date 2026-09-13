import { useState, useRef, useEffect, useCallback } from 'react'
import React from 'react'
import { ExternalLink } from 'lucide-react'
import { useToast } from './Toast'
import { api } from '../lib/api'
import { ASASSN_SKY_PATROL_URL, buildAsassnRequest } from '../lib/asassnRequest'
import { formatSnClockInput } from '../lib/snClockEvidence'
import type {
  ArchiveCoverage,
  CandidateSummary,
  ObservabilityMetrics,
  SNClockModelDisagreement,
  SNClockModelResult,
  SNClockInputEvidence,
  SNClockPrediction,
} from '../lib/types'

interface Props {
  c: CandidateSummary
  isExpanded: boolean
  isViewed: boolean
  onToggle: () => void
  onMarkViewed: () => void
}

const STAMP_URL = (tnsName: string) =>
  `/api/plots/stamp/${encodeURIComponent(tnsName)}?size=120`

const PREVIEW_FALLBACK =
  `data:image/svg+xml;utf8,${encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120"><rect width="100%" height="100%" fill="#0b0b0b"/><text x="50%" y="52%" dominant-baseline="middle" text-anchor="middle" fill="#ffffff" font-family="Arial" font-size="16">CDS</text></svg>',
  )}`

const ALADIN_URL = (ra: number, dec: number) =>
  `https://aladin.u-strasbg.fr/AladinLite/?target=${ra}+${dec}&fov=0.05&survey=P/DSS2/color`

const ALTITUDE_URL = (tnsName: string) =>
  `/api/plots/altitude/${encodeURIComponent(tnsName)}?raw=1`

const ALTITUDE_THUMB_URL = (tnsName: string) =>
  `/api/plots/altitude-thumbnail/${encodeURIComponent(tnsName)}?width=240&height=96`

const TNS_OBJECT_URL = (tnsName: string) => {
  const objectId = tnsName.replace(/^(AT|SN)\s+/i, '').replace(/\s+/g, '')
  return `https://www.wis-tns.org/object/${encodeURIComponent(objectId)}`
}

const TOM_TARGET_URL = (tnsName: string) =>
  `/from-snclock/${encodeURIComponent(tnsName)}/`

type SnClockVizPayload = {
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
  model_disagreement?: SNClockModelDisagreement
  cache?: { hit?: boolean; generated_at?: string; ttl_seconds?: number }
}

const snClockSummaryCache = new Map<string, SNClockPrediction | null>()
const snClockSummaryInflight = new Map<string, Promise<SNClockPrediction | null>>()

function sanitizeEmbeddedDetailHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  doc.querySelectorAll('.source-analysis').forEach((section) => section.remove())
  if (!html.includes('Explosion Time Prediction') && !html.includes('SN Clock')) {
    return doc.body.innerHTML || html
  }
  doc
    .querySelectorAll('[class*="source_analysis"], [class*="sn-clock"], [class*="sn_clock"]')
    .forEach((section) => {
      if (section.textContent?.match(/Explosion Time Prediction|SN Clock/i)) section.remove()
    })
  doc.querySelectorAll('h1,h2,h3,h4,h5,summary').forEach((heading) => {
    if (!heading.textContent?.match(/Explosion Time Prediction|SN Clock/i)) return
    const wrapper = heading.closest('details,section,article,[class],div')
    ;(wrapper ?? heading).remove()
  })
  return doc.body.innerHTML || html
}

function fetchSnClockSummary(tnsName: string): Promise<SNClockPrediction | null> {
  const cached = snClockSummaryCache.get(tnsName)
  if (cached !== undefined) return Promise.resolve(cached)

  const inflight = snClockSummaryInflight.get(tnsName)
  if (inflight) return inflight

  const request = api.candidates.snClock(tnsName)
    .then((result) => {
      const normalized = result ?? null
      snClockSummaryCache.set(tnsName, normalized)
      snClockSummaryInflight.delete(tnsName)
      return normalized
    })
    .catch(() => {
      snClockSummaryCache.set(tnsName, null)
      snClockSummaryInflight.delete(tnsName)
      return null
    })

  snClockSummaryInflight.set(tnsName, request)
  return request
}

export default function CandidateCard({
  c, isExpanded, isViewed, onToggle, onMarkViewed,
}: Props) {
  const cardRef = useRef<HTMLDivElement>(null)
  const [cardHtml, setCardHtml] = useState<string | null>(null)
  const [snClockViz, setSnClockViz] = useState<SnClockVizPayload | null>(null)
  const [selectedSnClockModelId, setSelectedSnClockModelId] = useState<string>('current_catboost')
  const [snClockSummary, setSnClockSummary] = useState<SNClockPrediction | null>(c.sn_clock ?? null)
  const [snClockLoading, setSnClockLoading] = useState(false)
  const [shouldPrefetchSnClock, setShouldPrefetchSnClock] = useState(false)
  const [expandedLoaded, setExpandedLoaded] = useState(false)
  const [loading, setLoading] = useState(false)
  const [loadLabel, setLoadLabel] = useState('Ready')
  const [loadProgress, setLoadProgress] = useState(0)
  const [altitudeBroken, setAltitudeBroken] = useState(false)
  const [obsMetrics, setObsMetrics] = useState<ObservabilityMetrics | null>(null)
  const [obsMetricsLoading, setObsMetricsLoading] = useState(false)
  const [archiveCoverage, setArchiveCoverage] = useState<ArchiveCoverage | null>(null)
  const [archiveCoverageLoading, setArchiveCoverageLoading] = useState(false)
  const { showToast } = useToast()

  const tnsUrl = TNS_OBJECT_URL(c.tns_name)
  const aladinUrl = ALADIN_URL(c.ra, c.dec)
  const altitudeUrl = ALTITUDE_URL(c.tns_name)
  const altitudeThumbUrl = ALTITUDE_THUMB_URL(c.tns_name)
  const [altitudePreviewSrc, setAltitudePreviewSrc] = useState(altitudeThumbUrl)
  const reporter = c.reporter || c.source_group || null
  const hostName = c.hostname && c.hostname !== 'N/A' && c.hostname !== 'NaN' ? c.hostname : null
  const summaryRedshift = c.host_redshift ?? c.redshift ?? null
  const summaryRedshiftLabel = c.host_redshift != null ? 'host z' : 'z'
  const hostDlrLabel =
    c.host_dlr != null
      ? `${c.host_dlr_grade || 'dlr'} ${c.host_dlr.toFixed(2)}`
      : null
  const hostPccLabel =
    c.host_pcc_bloom != null
      ? c.host_pcc_bloom < 0.001
        ? c.host_pcc_bloom.toExponential(1)
        : c.host_pcc_bloom.toFixed(3)
      : null
  const hostCompetitionLabel =
    c.host_competition != null
      ? `${c.host_competition.toFixed(2)}x${c.host_confidence_grade ? ` · ${c.host_confidence_grade}` : ''}`
      : c.host_confidence_grade || null
  const hostZQualityLabel =
    c.z_quality && c.z_quality !== 'N/A'
      ? `${c.z_quality}${c.z_quality_tier != null ? ` T${c.z_quality_tier.toFixed(0)}` : ''}${c.z_source ? ` · ${c.z_source}` : ''}`
      : null
  const hostQualityLow =
    c.host_confidence_grade === 'D' ||
    c.host_confidence_grade === 'X' ||
    c.host_dlr_grade === 'hostless' ||
    (c.host_dlr != null && c.host_dlr >= 4) ||
    (c.host_pcc_bloom != null && c.host_pcc_bloom > 0.2)
  const hostQualityTone = hostQualityLow
    ? 'ring-1 ring-[#ff9f0a]/45 bg-[#fff7ed]/50 dark:bg-[#2a1a08]/25'
    : ''
  const hostQualityLabel =
    c.host_confidence_grade || c.host_dlr_grade
      ? `low host confidence: ${c.host_confidence_grade || c.host_dlr_grade}`
      : 'low host confidence'
  const discoveryDays = c.discovery_date ? daysSinceNumber(c.discovery_date) : null
  const dataFreshness = c.last_update ? formatRelativeTime(c.last_update) : null
  const totalPhotometryCount = (c.n_tns || 0) + (c.n_atlas || 0) + (c.n_ztf || 0)
  const selectedSnClockModel =
    snClockViz?.models?.find((model) => model.model_id === selectedSnClockModelId)
    ?? snClockViz?.models?.find((model) => model.available && model.prediction)
    ?? snClockViz?.models?.[0]
  const summaryPrediction = selectedSnClockModel?.prediction ?? snClockViz?.prediction ?? snClockSummary
  const predictedExplosionDays =
    discoveryDays != null && summaryPrediction?.texp != null
      ? discoveryDays - summaryPrediction.texp
      : null
  const showModelExplosionAge =
    predictedExplosionDays != null
    && Number.isFinite(predictedExplosionDays)
    && predictedExplosionDays >= 0
  const displayedAgeDays = showModelExplosionAge ? predictedExplosionDays : discoveryDays
  const displayedAgeLabel = showModelExplosionAge ? 'model age' : 'disc. age'
  const modelDiscoveryRelation = (summaryPrediction?.texp ?? 0) <= 0 ? 'before' : 'after'
  const displayedAgeTitle = showModelExplosionAge
    ? `SN Clock predicted explosion age. Discovery was ${formatDays(discoveryDays ?? 0)} ago; the explosion is estimated ${Math.abs(summaryPrediction?.texp ?? 0).toFixed(2)} d ${modelDiscoveryRelation} discovery.`
    : 'Time since TNS discovery; SN Clock prediction is not available yet.'
  const rankedObsSites = [...(obsMetrics?.sites ?? [])]
    .filter((site) => !site.error)
    .sort((a, b) => {
      const bh = Number(b.hours_3nights_strict ?? b.total_observable_hours_3day ?? 0)
      const ah = Number(a.hours_3nights_strict ?? a.total_observable_hours_3day ?? 0)
      return bh - ah
    })
  const obsSummary = obsMetrics?.summary_zh ?? obsMetrics?.primary?.summary_zh
  useEffect(() => {
    setAltitudeBroken(false)
    setAltitudePreviewSrc(altitudeThumbUrl)
  }, [altitudeThumbUrl])

  useEffect(() => {
    setObsMetrics(null)
    setObsMetricsLoading(false)
    const el = cardRef.current
    if (!el) return
    const io = new IntersectionObserver(
      ([e]) => {
        if (!e.isIntersecting) return
        io.disconnect()
        setObsMetricsLoading(true)
        void api.plots
          .observabilityMetrics(c.tns_name)
          .then((r) => setObsMetrics(r))
          .catch(() => setObsMetrics(null))
          .finally(() => setObsMetricsLoading(false))
      },
      { rootMargin: '120px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [c.tns_name])

  useEffect(() => {
    setArchiveCoverage(null)
    setArchiveCoverageLoading(false)
    const el = cardRef.current
    if (!el) return
    let cancelled = false
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return
        io.disconnect()
        setArchiveCoverageLoading(true)
        void api.candidates
          .archiveCoverage(c.tns_name)
          .then((result) => {
            if (!cancelled) setArchiveCoverage(result)
          })
          .catch(() => {
            if (!cancelled) setArchiveCoverage(null)
          })
          .finally(() => {
            if (!cancelled) setArchiveCoverageLoading(false)
          })
      },
      { rootMargin: '300px' },
    )
    io.observe(el)
    return () => {
      cancelled = true
      io.disconnect()
    }
  }, [c.tns_name])

  useEffect(() => {
    setSnClockSummary(c.sn_clock ?? snClockSummaryCache.get(c.tns_name) ?? null)
  }, [c.sn_clock, c.tns_name])

  useEffect(() => {
    setSelectedSnClockModelId('current_catboost')
    setSnClockViz(null)
    setCardHtml(null)
    setExpandedLoaded(false)
  }, [c.tns_name])

  useEffect(() => {
    const node = cardRef.current
    if (!node || shouldPrefetchSnClock) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setShouldPrefetchSnClock(true)
          observer.disconnect()
        }
      },
      { rootMargin: '300px 0px' },
    )

    observer.observe(node)
    return () => observer.disconnect()
  }, [shouldPrefetchSnClock])

  useEffect(() => {
    if (!shouldPrefetchSnClock || snClockLoading || summaryPrediction?.texp != null) return
    if (snClockSummaryCache.has(c.tns_name)) {
      setSnClockSummary(snClockSummaryCache.get(c.tns_name) ?? null)
      return
    }

    let cancelled = false
    setSnClockLoading(true)
    fetchSnClockSummary(c.tns_name)
      .then((result) => {
        if (!cancelled) setSnClockSummary(result)
      })
      .finally(() => {
        if (!cancelled) setSnClockLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [c.tns_name, shouldPrefetchSnClock, snClockLoading, summaryPrediction?.texp])

  const loadContent = useCallback(async () => {
    if (loading || expandedLoaded) return
    setLoading(true)
    setLoadProgress(10)
    setLoadLabel('Running explosion-time estimate')
    try {
      let hasSnClockModelPanel = false
      const snClockVizRequest = api.plots.snClockViz(c.tns_name)
      const candidateCardRequest = api.plots.candidateCard(c.tns_name)

      try {
        const res = await snClockVizRequest
        hasSnClockModelPanel = Boolean(res.models?.length)
        setSnClockViz(res)
        const firstModel = res.models?.find((model) => model.model_id === 'current_catboost' && model.prediction)
          ?? res.models?.find((model) => model.available && model.prediction)
          ?? res.models?.[0]
        if (firstModel) setSelectedSnClockModelId(firstModel.model_id)
        if (res?.prediction) {
          const summary: SNClockPrediction = {
            texp: res.prediction.texp,
            ci_lower: res.prediction.ci_lower,
            ci_upper: res.prediction.ci_upper,
            feature_completeness: res.prediction.feature_completeness,
            model_features_present: res.prediction.model_features_present,
            model_features_total: res.prediction.model_features_total,
            input_evidence: res.prediction.input_evidence,
          }
          snClockSummaryCache.set(c.tns_name, summary)
          setSnClockSummary(summary)
        }
      } catch (error) {
        setSnClockViz({
          prediction_error: error instanceof Error ? error.message : 'Prediction unavailable',
        })
      }

      setLoadProgress(55)
      setLoadLabel('Loading full source details')
      try {
        const res = await candidateCardRequest
        if (res?.html) {
          const sanitized = hasSnClockModelPanel
            ? sanitizeEmbeddedDetailHtml(res.html)
            : res.html
          setCardHtml(sanitized)
        }
      } catch {
        setCardHtml(null)
      }

      setExpandedLoaded(true)
      setLoadProgress(100)
      setLoadLabel('Ready')
    } finally {
      setLoading(false)
    }
  }, [c.tns_name, expandedLoaded, loading])

  useEffect(() => {
    if (isExpanded) void loadContent()
  }, [isExpanded, loadContent])

  function handleToggle() {
    onToggle()
    if (!isExpanded) loadContent()
  }

  const handleAsassnRequest = useCallback(() => {
    let request
    try {
      request = buildAsassnRequest(c.ra, c.dec)
    } catch {
      showToast('当前源缺少有效坐标，无法打开 ASAS-SN 查询。', 'error')
      return
    }

    showToast(request.guidance, 'info', 8000)
    const copy = navigator.clipboard?.writeText(request.clipboardText)
    if (!copy) {
      showToast(`${request.clipboardText.replace('\n', ' · ')}；${request.guidance}`, 'warning', 9000)
      return
    }
    void copy.catch(() => {
      showToast(`${request.clipboardText.replace('\n', ' · ')}；请手动复制坐标。`, 'warning', 9000)
    })
  }, [c.dec, c.ra, showToast])

  return (
    <div
      ref={cardRef}
      className={`glass rounded-2xl transition-all duration-300 ${
      isExpanded ? 'overflow-visible ring-1 ring-[#0071e3]/30' : 'card-hover overflow-hidden'
    } ${hostQualityTone} ${isViewed ? 'opacity-75' : ''}`}
    >
      <div
        className="grid cursor-pointer grid-cols-[64px_minmax(0,1fr)_20px] gap-4 px-5 py-4 transition-colors hover:bg-black/[0.02] dark:hover:bg-white/[0.03] lg:flex lg:items-start"
        onClick={handleToggle}
      >
        <div className="relative col-start-1 row-start-1 h-[64px] w-[64px] shrink-0 overflow-hidden rounded-xl bg-[#f0f0f2] dark:bg-[#1c1c1e] ring-1 ring-black/[0.06] dark:ring-white/[0.12] lg:col-auto lg:row-auto">
          <img
            src={STAMP_URL(c.tns_name)}
            alt={`${c.tns_name} Aladin preview`} className="h-full w-full object-cover"
            loading="lazy"
            onError={(e) => { (e.target as HTMLImageElement).src = PREVIEW_FALLBACK }}
          />
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="absolute h-[1px] w-[14px] bg-red-500/90" />
            <div className="absolute h-[14px] w-[1px] bg-red-500/90" />
          </div>
          <div className="absolute bottom-1 left-1 rounded bg-black/55 px-1.5 py-0.5 text-[9px] font-medium text-white">
            CDS
          </div>
        </div>

        <div className="col-start-2 row-start-1 min-w-0 flex-1 lg:col-auto lg:row-auto">
          <div className="flex items-center gap-2.5">
            <span className="text-[15px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">{c.tns_name}</span>
            <a
              href={TOM_TARGET_URL(c.tns_name)}
              onClick={(event) => event.stopPropagation()}
              className="inline-flex h-6 items-center gap-1 rounded-md border border-[#0071e3]/20 bg-[#0071e3]/8 px-2 text-[10px] font-semibold text-[#0057b8] transition-colors hover:bg-[#0071e3]/14 dark:border-[#0a84ff]/30 dark:text-[#64a8ff]"
              title="查看该目标的观测与数据"
            >
              <ExternalLink className="h-3 w-3" aria-hidden="true" />
              观测管理
            </a>
            {c.object_type && (
              <span className="rounded-full bg-[#34c759]/15 px-2 py-[1px] text-[10px] font-semibold text-[#248a3d]">{c.object_type}</span>
            )}
            {hostQualityLow && (
              <span className="rounded-full bg-[#ff9f0a]/15 px-2 py-[1px] text-[10px] font-semibold text-[#b45309]">
                {hostQualityLabel}
              </span>
            )}
            {archiveCoverage?.has_pre_discovery_data && (
              <span
                className="rounded-full bg-[#ff3b30]/12 px-2 py-[1px] text-[10px] font-semibold text-[#c5221f] dark:text-[#ff6961]"
                title="公开且早于 TNS 发现时刻的空间望远镜档案"
              >
                档案命中 · {archiveCoverage.missions
                  .filter((mission) => mission.state === 'available')
                  .map((mission) => `${mission.mission} ${mission.observation_count}`)
                  .join(' / ')}
              </span>
            )}
            {c.internal_name && c.internal_name !== c.tns_name && (
              <span className="text-[10px] text-[#6e6e73] dark:text-[#86868b]">{c.internal_name}</span>
            )}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-[#6e6e73] dark:text-[#86868b]">
            <MetaChip label="RA" value={`${c.ra.toFixed(5)}°`} />
            <MetaChip label="Dec" value={`${c.dec.toFixed(5)}°`} />
            {c.discovery_date && <MetaChip label="Discovery" value={formatDiscovery(c.discovery_date)} />}
            {c.tns_received_at && (
              <MetaChip
                label="TNS received"
                value={formatBeijingTime(c.tns_received_at)}
                title="TNS received time, converted to Beijing time (UTC+8)"
              />
            )}
            {reporter && <MetaChip label="Discoverer" value={reporter} />}
            {hostName && <MetaChip label="Host" value={hostName} emph />}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-[#6e6e73] dark:text-[#86868b]">
            {summaryRedshift != null && (
              <MetaChip label={summaryRedshiftLabel.toUpperCase()} value={summaryRedshift.toFixed(4)} accent="purple" />
            )}
            {hostDlrLabel && <MetaChip label="Host DLR" value={hostDlrLabel} />}
            {hostPccLabel && <MetaChip label="Pcc" value={hostPccLabel} />}
            {hostCompetitionLabel && <MetaChip label="Comp" value={hostCompetitionLabel} />}
            {hostZQualityLabel && <MetaChip label="z quality" value={hostZQualityLabel} />}
            {c.discovery_mag != null && (
              <MetaChip
                label="Disc mag"
                value={`${c.discovery_mag.toFixed(1)}${c.discovery_mag >= 21 ? ' · deep' : ''}`}
                accent={c.discovery_mag >= 21 ? 'warn' : undefined}
                title={c.discovery_mag >= 21
                  ? 'Discovery magnitude is deep (>=21): likely beyond small-telescope follow-up reach'
                  : 'Discovery magnitude'}
              />
            )}
            {c.discovery_filter && <MetaChip label="Filter" value={c.discovery_filter} />}
            <MetaChip label="Phot" value={`${totalPhotometryCount} pts`} accent="blue" />
            {dataFreshness && <MetaChip label="Updated" value={dataFreshness} />}
          </div>
        </div>

        <div className="hidden w-[288px] shrink-0 lg:block">
          <div className="overflow-hidden rounded-xl border border-black/[0.08] dark:border-white/[0.12] bg-white dark:bg-[#121212]">
            {!altitudeBroken ? (
              <img
                src={altitudePreviewSrc}
                alt={`${c.tns_name} observability`}
                className="h-[92px] w-full bg-white dark:bg-[#121212] object-contain p-1"
                loading="lazy"
                onError={() => {
                  if (altitudePreviewSrc !== altitudeUrl) {
                    setAltitudePreviewSrc(altitudeUrl)
                    return
                  }
                  setAltitudeBroken(true)
                }}
              />
            ) : (
              <div className="flex h-[92px] items-center justify-center bg-[#f8fafc] dark:bg-[#1c1c1e] px-3 text-center text-[11px] text-[#6e6e73] dark:text-[#86868b]">
                Observability preview unavailable
              </div>
            )}
            <div className="border-t border-black/[0.06] dark:border-white/[0.08] px-2.5 py-1.5 text-[10px] text-[#6e6e73] dark:text-[#86868b]">
              {obsMetricsLoading ? (
                <span className="font-medium">兴隆…</span>
              ) : obsMetrics ? (
                <div className="space-y-1">
                  <p className="m-0 text-[9px] font-semibold leading-snug text-[#374151] dark:text-[#d1d5db]">
                    30°窗口 · ≥4h OK
                  </p>
                  {rankedObsSites.slice(0, 4).length > 0 && (
                    <div className="grid grid-cols-2 gap-1">
                      {rankedObsSites.slice(0, 4).map((site) => (
                        <div key={site.site ?? site.site_name} className="rounded-lg bg-[#f8fafc] px-1.5 py-1 dark:bg-white/[0.04]">
                          <div className="truncate font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">
                            {site.site ?? site.site_name}
                          </div>
                          {(site.horizon_windows ?? []).slice(0, 3).map((win) => (
                            <div key={`${site.site ?? site.site_name}-${win.months_ahead}`} className="flex items-center justify-between gap-1 tabular-nums">
                              <span className="truncate">{win.months_ahead === 0 ? '今' : `${win.months_ahead}月`}</span>
                              <span className={win.is_ok ? 'font-semibold text-[#248a3d]' : 'text-[#b45309]'}>
                                {Number(win.hours_30deg_dark ?? 0).toFixed(1)}h
                              </span>
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <span className="font-medium">Telescope observability</span>
              )}
            </div>
          </div>
        </div>

        <div className="col-span-3 row-start-2 flex shrink-0 items-center justify-between gap-3 border-t border-black/[0.06] pt-3 dark:border-white/[0.08] lg:col-auto lg:row-auto lg:justify-start lg:border-t-0 lg:pt-0">
          {c.discovery_mag != null && (
            <MetricBlock value={c.discovery_mag.toFixed(1)} label="mag" color="#ff9500" />
          )}
          {summaryRedshift != null && (
            <MetricBlock value={summaryRedshift.toFixed(4)} label={summaryRedshiftLabel} color="#af52de" />
          )}
          {displayedAgeDays != null && (
            <MetricBlock value={formatDays(displayedAgeDays)} label={displayedAgeLabel} color="#0071e3" title={displayedAgeTitle} />
          )}
        </div>

        <svg
          className={`col-start-3 row-start-1 h-4 w-4 shrink-0 self-center justify-self-end text-[#6e6e73] dark:text-[#86868b] transition-transform duration-300 lg:col-auto lg:row-auto ${isExpanded ? 'rotate-90' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
      </div>

      {isExpanded && (
        <div className="border-t border-black/[0.06] dark:border-white/[0.10] px-5 pb-6 pt-4 bg-white/[0.5] dark:bg-[#121212]/[0.5]">
          <div className="mb-4 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
            <Pill
              onClick={() => {
                if (!isViewed) {
                  showToast(`Marked ${c.tns_name} as viewed`, 'success', 2000)
                }
                onMarkViewed()
              }}
              label={isViewed ? 'Viewed' : 'Mark viewed'}
              active={isViewed}
            />
            <PillLink href={tnsUrl} label="TNS Page" />
            <PillLink
              href={ASASSN_SKY_PATROL_URL}
              label="ASAS-SN 强制测光"
              onClick={handleAsassnRequest}
            />
            <PillLink href={aladinUrl} label="Aladin Sky View" />
            <PillLink href={altitudeUrl} label="Altitude PNG" />
          </div>

          <ArchiveCoveragePanel
            coverage={archiveCoverage}
            loading={archiveCoverageLoading}
          />

          <LoadProgressCard progress={loadProgress} label={loadLabel} loading={loading} />

          {obsMetrics && (
            <div className="mb-4 rounded-2xl border border-black/[0.08] bg-white px-4 py-3 text-[12px] dark:border-white/[0.12] dark:bg-[#121212]">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-[13px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">30° Observability</div>
                  <div className="mt-0.5 text-[11px] text-[#6e6e73] dark:text-[#9ca3af]">
                    今晚 / 1月 / 2月 / 3月；≥4h 标记 OK。
                  </div>
                </div>
                {obsMetrics.best_site && (
                  <span className="rounded-full bg-[#0071e3]/10 px-2.5 py-1 text-[11px] font-medium text-[#0057b8]">
                    best: {obsMetrics.best_site}
                  </span>
                )}
              </div>
              {obsSummary && <p className="mb-3 text-[#374151] dark:text-[#d1d5db]">{obsSummary}</p>}
              <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
                {rankedObsSites.slice(0, 4).map((site) => {
                  const name = site.site ?? site.site_name ?? 'Site'
                  return (
                    <div key={name} className="rounded-xl border border-black/[0.06] bg-[#f8fafc] p-3 dark:border-white/[0.08] dark:bg-white/[0.04]">
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <span className="truncate font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">{name}</span>
                        {site.verdict_zh && <span className="shrink-0 text-[10px] text-[#6e6e73]">{site.verdict_zh}</span>}
                      </div>
                      <div className="space-y-1 text-[#4b5563] dark:text-[#cbd5e1]">
                        {site.horizon_windows && site.horizon_windows.length > 0 && (
                          <div className="mt-1 grid gap-1">
                            {site.horizon_windows.map((win) => (
                              <div key={`${name}-${win.months_ahead}`} className="flex items-center justify-between gap-2 rounded bg-white/70 px-1.5 py-1 dark:bg-black/20">
                                <span className="truncate">{win.label} {win.date}</span>
                                <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${win.is_ok ? 'bg-[#34c759]/15 text-[#248a3d]' : 'bg-[#ff9f0a]/15 text-[#b45309]'}`}>
                                  {Number(win.hours_30deg_dark ?? 0).toFixed(1)}h {win.is_ok ? 'OK' : '短'}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {loading && !cardHtml ? (
            <div className="flex items-center justify-center py-16">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-[#0071e3] border-t-transparent" />
              <span className="ml-3 text-[12px] text-[#6e6e73] dark:text-[#86868b]">Preparing full details...</span>
            </div>
          ) : cardHtml ? (
            <HtmlFrame
              html={cardHtml}
              title={`Full Details for ${c.tns_name}`}
              minHeight={420}
            />
          ) : (
            <EmptyStateText text="Detailed source card is not available yet." />
          )}

          {snClockViz?.models && snClockViz.models.length > 0 && (
            <SnClockModelPanel
              tnsName={c.tns_name}
              discoveryDays={discoveryDays}
              models={snClockViz.models}
              disagreement={snClockViz.model_disagreement}
              cache={snClockViz.cache}
              selectedModelId={selectedSnClockModelId}
              onSelect={setSelectedSnClockModelId}
            />
          )}
        </div>
      )}
    </div>
  )
}

const LoadProgressCard = React.memo(function LoadProgressCard({
  progress,
  label,
  loading,
}: {
  progress: number
  label: string
  loading: boolean
}) {
  return (
    <div className="mb-4 rounded-2xl border border-black/[0.08] dark:border-white/[0.12] bg-white dark:bg-[#121212] px-4 py-3">
      <div className="mb-2 flex items-center justify-between text-[12px]">
        <span className="font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">
          {loading ? `Loading sections: ${label}` : 'Sections loaded'}
        </span>
        <span className="tabular-nums text-[#6e6e73] dark:text-[#86868b]">{progress}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-[#e9edf3] dark:bg-[#2c2c2e]">
        <div
          className="h-full rounded-full bg-[#0071e3] transition-all duration-300"
          style={{ width: `${Math.max(progress, loading ? 8 : 100)}%` }}
        />
      </div>
    </div>
  )
})

const MetaChip = React.memo(function MetaChip({
  label,
  value,
  emph = false,
  accent,
  title,
}: {
  label: string
  value: string
  emph?: boolean
  accent?: 'purple' | 'blue' | 'warn'
  title?: string
}) {
  const accentClass = accent === 'purple'
    ? 'border-[#af52de]/20 dark:border-[#af52de]/30 bg-[#af52de]/8 dark:bg-[#af52de]/15 text-[#6d28d9]'
    : accent === 'blue'
      ? 'border-[#0071e3]/20 dark:border-[#0071e3]/30 bg-[#0071e3]/8 dark:bg-[#0071e3]/15 text-[#0057b8]'
      : accent === 'warn'
        ? 'border-[#ff9f0a]/30 dark:border-[#ff9f0a]/40 bg-[#ff9f0a]/12 dark:bg-[#ff9f0a]/18 text-[#b45309] dark:text-[#fbbf24]'
        : emph
          ? 'border-black/[0.08] dark:border-white/[0.12] bg-black/[0.03] dark:bg-white/[0.05] text-[#1d1d1f] dark:text-[#f5f5f7]'
          : 'border-black/[0.06] dark:border-white/[0.10] bg-white dark:bg-[#1c1c1e] text-[#4b5563] dark:text-[#9ca3af]'
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 ${accentClass}`} title={title}>
      <span className="text-[10px] font-medium uppercase tracking-wide opacity-70">{label}</span>
      <span className="max-w-[180px] truncate sm:max-w-[240px]">{value}</span>
    </span>
  )
})

const MetricBlock = React.memo(function MetricBlock({
  value,
  label,
  color,
  title,
}: {
  value: string
  label: string
  color: string
  title?: string
}) {
  return (
    <div className="min-w-[46px] text-right" title={title}>
      <p className="text-[15px] font-bold tabular-nums" style={{ color }}>{value}</p>
      <p className="text-[9px] text-[#6e6e73] dark:text-[#86868b]">{label}</p>
    </div>
  )
})

const ArchiveCoveragePanel = React.memo(function ArchiveCoveragePanel({
  coverage,
  loading,
}: {
  coverage: ArchiveCoverage | null
  loading: boolean
}) {
  if (loading) {
    return (
      <div className="mb-4 rounded-2xl border border-black/[0.08] bg-white px-4 py-3 text-[12px] text-[#6e6e73] dark:border-white/[0.12] dark:bg-[#121212] dark:text-[#86868b]">
        正在检查 HST / JWST / Euclid 发现前档案…
      </div>
    )
  }
  if (!coverage) return null

  const stateLabel = coverage.has_pre_discovery_data
    ? '发现前档案命中'
    : coverage.status === 'none'
      ? '未查到公开发现前档案'
      : coverage.status === 'partial' || coverage.status === 'unavailable'
        ? '部分档案通道暂不可用'
        : '档案检查未启用'
  const stateClass = coverage.has_pre_discovery_data
    ? 'text-[#c5221f] dark:text-[#ff6961]'
    : coverage.status === 'none'
      ? 'text-[#248a3d] dark:text-[#5dd879]'
      : 'text-[#b45309] dark:text-[#fbbf24]'
  const hasProviderError = coverage.missions.some((mission) => mission.state === 'error')
  const checkedRelative = coverage.checked_at ? formatRelativeTime(coverage.checked_at) : null
  const checkedLabel = checkedRelative === 'now'
    ? '刚刚检查'
    : checkedRelative
      ? `${checkedRelative} 前检查`
      : null

  return (
    <div className="mb-4 rounded-2xl border border-black/[0.08] bg-white px-4 py-3 text-[12px] dark:border-white/[0.12] dark:bg-[#121212]">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-[13px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">
            HST / JWST / Euclid 档案覆盖
          </div>
          <div className="mt-0.5 text-[10px] text-[#6e6e73] dark:text-[#86868b]">
            坐标独立查询，不依赖 SN Clock 爆发年龄{checkedLabel ? ` · ${checkedLabel}` : ''}
          </div>
        </div>
        <span className={`text-[11px] font-semibold ${stateClass}`}>{stateLabel}</span>
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        {coverage.missions.map((mission) => (
          <a
            key={mission.mission}
            href={mission.archive_url}
            target="_blank"
            rel="noreferrer"
            title={mission.state === 'error' ? mission.error ?? '上游档案服务暂时未响应' : undefined}
            className={`rounded-xl border px-3 py-2 transition-colors hover:bg-black/[0.02] dark:hover:bg-white/[0.04] ${
              mission.state === 'available'
                ? 'border-[#ff3b30]/30 bg-[#ff3b30]/[0.05]'
                : mission.state === 'error'
                  ? 'border-[#ff9f0a]/30 bg-[#ff9f0a]/[0.05]'
                  : 'border-black/[0.07] bg-[#f8fafc] dark:border-white/[0.10] dark:bg-white/[0.03]'
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">{mission.mission}</span>
              <ExternalLink className="h-3 w-3 text-[#6e6e73]" aria-hidden="true" />
            </div>
            <div className="mt-1 text-[10px] text-[#6e6e73] dark:text-[#86868b]">
              {mission.state === 'available'
                ? `${mission.observation_count} 条观测 · ${mission.imaging_count} 条成像`
                : mission.state === 'none'
                  ? '未命中'
                  : `${mission.mission === 'Euclid' ? 'ESA' : 'MAST'} 暂时失败 · 自动重试`}
            </div>
            {mission.instruments.length > 0 && (
              <div className="mt-1 truncate text-[10px] font-medium text-[#374151] dark:text-[#d1d5db]">
                {mission.instruments.join(' / ')}
              </div>
            )}
          </a>
        ))}
      </div>
      <p className="mb-0 mt-2 text-[10px] leading-relaxed text-[#6e6e73] dark:text-[#86868b]">
        {hasProviderError
          ? '“查询失败”表示上游档案服务暂时未响应，系统约 15 分钟后自动重试；“未命中”表示查询成功但暂无公开覆盖。'
          : '查询已完成；“未命中”表示该坐标在相应公开档案中没有发现时刻之前的观测。'}
        {' '}以 TNS 发现时刻为上限；是否真正属于爆发前前身星约束，仍需结合模型爆发时刻人工核对。
      </p>
    </div>
  )
})

const EmptyStateText = React.memo(function EmptyStateText({ text }: { text: string }) {
  return (
    <div className="flex min-h-[120px] items-center justify-center rounded-xl bg-[#f8fafc] dark:bg-[#1c1c1e] px-4 text-center text-[12px] text-[#6e6e73] dark:text-[#86868b]">
      {text}
    </div>
  )
})

function HtmlFrame({
  html,
  title,
  minHeight,
}: {
  html: string
  title: string
  minHeight: number
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const frameIdRef = useRef(`snclock-frame-${Math.random().toString(36).slice(2)}`)

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow) return
      const data = event.data
      if (!data || data.type !== 'snclock-frame-height' || data.id !== frameIdRef.current) return
      if (iframeRef.current && typeof data.height === 'number') {
        iframeRef.current.style.height = `${Math.max(data.height + 24, minHeight)}px`
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [minHeight])

  const frameId = frameIdRef.current
  const frameBase =
    typeof window !== 'undefined' && window.location?.origin
      ? `${window.location.origin}/`
      : '/'
  const srcDoc = `<!DOCTYPE html><html><head><meta charset="utf-8"><base href="${frameBase}"><meta name="color-scheme" content="light dark"><style>
      * { box-sizing: border-box; }
      body { margin: 0; padding: 16px; font-family: -apple-system, BlinkMacSystemFont, 'Inter', sans-serif;
             font-size: 14px; line-height: 1.5; color: #1d1d1f; background: #fafafa; }
      img { max-width: 100%; height: auto; }
      a { color: #0071e3; }
      table { border-collapse: collapse; width: 100%; font-size: 12px; }
      th, td { padding: 6px 8px; border: 1px solid #e5e7eb; text-align: left; }
      th { background: #f5f5f7; font-weight: 600; }
      details > summary { cursor: pointer; font-weight: 600; color: #1d4ed8; }
      .source-card { background: #fff !important; border-radius: 12px !important;
                     box-shadow: 0 2px 12px rgba(0,0,0,0.06) !important; padding: 20px !important; }
      @media (prefers-color-scheme: dark) {
        body { color: #f5f5f7; background: #1a1a1a; }
        th { background: #2c2c2e; }
        th, td { border-color: #3a3a3c; }
        .source-card { background: #1c1c1e !important; box-shadow: 0 2px 12px rgba(0,0,0,0.3) !important; }
      }
    </style></head><body>${html}<script>
      (() => {
        const id = ${JSON.stringify(frameId)};
        const send = () => {
          parent.postMessage({
            type: 'snclock-frame-height',
            id,
            height: Math.max(
              document.body ? document.body.scrollHeight : 0,
              document.documentElement ? document.documentElement.scrollHeight : 0
            )
          }, '*');
        };
        window.addEventListener('load', send);
        if (document.body && 'ResizeObserver' in window) {
          new ResizeObserver(send).observe(document.body);
        }
        setTimeout(send, 300);
        setTimeout(send, 1200);
      })();
    </script></body></html>`

  return (
    <iframe
      ref={iframeRef}
      srcDoc={srcDoc}
      className="w-full rounded-xl"
      style={{ minHeight: `${minHeight}px`, background: '#fafafa' }}
      title={title}
      sandbox="allow-scripts allow-popups"
    />
  )
}

const SnClockModelPanel = React.memo(function SnClockModelPanel({
  tnsName,
  discoveryDays,
  models,
  disagreement,
  cache,
  selectedModelId,
  onSelect,
}: {
  tnsName: string
  discoveryDays: number | null
  models: SNClockModelResult[]
  disagreement?: SNClockModelDisagreement
  cache?: { hit?: boolean; generated_at?: string; ttl_seconds?: number }
  selectedModelId: string
  onSelect: (modelId: string) => void
}) {
  const selected = models.find((model) => model.model_id === selectedModelId) ?? models[0]
  const pred = selected?.prediction
  const explosionAge = pred && discoveryDays != null ? discoveryDays - pred.texp : null
  const explosionAgeCi = pred && discoveryDays != null
    ? [discoveryDays - pred.ci_upper, discoveryDays - pred.ci_lower]
    : null
  const inputDisplay = formatSnClockInput(pred)
  const renderModelButton = (model: SNClockModelResult, compact = false) => {
    const active = selected?.model_id === model.model_id
    const label = snClockModelLabel(model)
    return (
      <button
        key={model.model_id}
        onClick={(e) => {
          e.stopPropagation()
          onSelect(model.model_id)
        }}
        className={`flex h-9 max-w-full items-center gap-2 rounded-full border px-3 text-[11px] font-semibold transition ${
          active
            ? 'border-[#0071e3] bg-[#0071e3] text-white shadow-sm'
            : model.available
              ? 'border-black/[0.10] bg-white text-[#1d1d1f] hover:bg-black/[0.03] dark:border-white/[0.14] dark:bg-[#121212] dark:text-[#f5f5f7] dark:hover:bg-white/[0.06]'
              : 'border-black/[0.06] bg-white text-[#8e8e93] dark:border-white/[0.10] dark:bg-[#121212] dark:text-[#6e6e73]'
        }`}
        title={model.reason ?? model.display_name}
      >
        <span className={`flex h-5 min-w-5 items-center justify-center rounded-full text-[10px] ${active ? 'bg-white/20' : 'bg-black/[0.06] dark:bg-white/[0.10]'}`}>
          {model.slot}
        </span>
        <span className={`${compact ? 'max-w-[150px] sm:max-w-[220px]' : 'max-w-[220px] sm:max-w-none'} truncate`}>
          {label}
        </span>
      </button>
    )
  }

  return (
    <div className="mb-4 overflow-visible rounded-2xl border border-black/[0.08] dark:border-white/[0.12] bg-white dark:bg-[#121212]">
        <div className="flex flex-wrap items-center gap-2 border-b border-black/[0.06] bg-white/95 px-4 py-3 backdrop-blur dark:border-white/[0.10] dark:bg-[#121212]/95">
          {models.map((model) => renderModelButton(model))}
        <div className="ml-1 min-w-0 text-[12px]">
          <div className="font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">
            {selected ? snClockModelLabel(selected) : 'SN Clock model'}
          </div>
          {selected?.reason && (
            <div className="text-[10px] text-[#b45309] dark:text-[#fbbf24]">{selected.reason}</div>
          )}
        </div>
        <a
          href={`/api/sn-clock/audit/${encodeURIComponent(tnsName)}`}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="ml-auto rounded-full border border-black/[0.08] px-3 py-1 text-[10px] font-semibold text-[#0071e3] hover:bg-[#0071e3]/8 dark:border-white/[0.12]"
          title="Open structured SN Clock input and model audit JSON"
        >
          Audit
        </a>
      </div>

      {pred ? (
        <div className="space-y-3 p-4">
          <div className="flex flex-wrap items-center gap-2">
            {disagreement && disagreement.status !== 'insufficient' && (
              <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${
                disagreement.status === 'high'
                  ? 'bg-[#ff3b30]/10 text-[#b91c1c]'
                  : disagreement.status === 'moderate'
                    ? 'bg-[#ff9f0a]/12 text-[#9a3412]'
                    : 'bg-[#34c759]/10 text-[#166534]'
              }`}>
                model disagreement: {disagreement.status} · delta {disagreement.max_delta_days.toFixed(2)}d
              </span>
            )}
            {cache?.hit && (
              <span className="rounded-full bg-[#0071e3]/10 px-2.5 py-1 text-[10px] font-semibold text-[#0057b8]">
                cached
              </span>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            <SnClockStat
              label={explosionAge != null ? 'Explosion age' : 'Explosion vs discovery'}
              value={explosionAge != null
                ? `${explosionAge.toFixed(2)} d ago`
                : `${Math.abs(pred.texp).toFixed(2)} d ${pred.texp <= 0 ? 'before' : 'after'} discovery`}
              detail={`${Math.abs(pred.texp).toFixed(2)} d ${pred.texp <= 0 ? 'before' : 'after'} discovery`}
            />
            <SnClockStat
              label={explosionAgeCi ? '68% age CI' : '68% CI vs discovery'}
              value={explosionAgeCi
                ? `${explosionAgeCi[0].toFixed(2)}–${explosionAgeCi[1].toFixed(2)} d ago`
                : `${Math.abs(pred.ci_upper).toFixed(2)}–${Math.abs(pred.ci_lower).toFixed(2)} d before discovery`}
            />
            <SnClockStat label={inputDisplay.label} value={inputDisplay.value} detail={inputDisplay.detail} />
          </div>
          <div className="overflow-hidden rounded-xl border border-black/[0.06] dark:border-white/[0.10]">
            {models.map((model) => {
              const p = model.prediction
              const modelInputDisplay = formatSnClockInput(p)
              return (
                <button
                  key={`row-${model.model_id}`}
                  onClick={(e) => {
                    e.stopPropagation()
                    onSelect(model.model_id)
                  }}
                  className={`grid w-full grid-cols-[1.2fr_0.7fr_0.7fr_0.7fr_0.7fr] items-center gap-2 border-b border-black/[0.04] px-3 py-2 text-left text-[11px] last:border-b-0 dark:border-white/[0.08] ${
                    selected?.model_id === model.model_id ? 'bg-[#0071e3]/8' : 'bg-white dark:bg-[#121212]'
                  }`}
                >
                  <span className="min-w-0 truncate font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">{snClockModelLabel(model)}</span>
                  <span className="tabular-nums text-[#0f766e]">
                    {p ? `${Math.abs(p.texp).toFixed(2)}d ${p.texp <= 0 ? 'pre' : 'post'}-disc.` : '--'}
                  </span>
                  <span className={`tabular-nums ${Math.abs(model.texp_delta_from_median ?? 0) >= 0.5 ? 'text-[#b91c1c]' : 'text-[#6e6e73] dark:text-[#86868b]'}`}>
                    {model.texp_delta_from_median == null ? '--' : `${model.texp_delta_from_median >= 0 ? '+' : ''}${model.texp_delta_from_median.toFixed(2)}`}
                  </span>
                  <span className="tabular-nums text-[#6366f1]">{modelInputDisplay.tableMetric}</span>
                  <span className="tabular-nums text-[#6e6e73] dark:text-[#86868b]">{modelInputDisplay.tableCount}</span>
                </button>
              )
            })}
          </div>
          {selected.viz_html ? (
            <HtmlFrame
              html={selected.viz_html}
              title={`${snClockModelLabel(selected)} SN Clock`}
              minHeight={360}
            />
          ) : selected.snclock_lightcurve || selected.convergence_gif || selected.convergence_png ? (
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              {selected.snclock_lightcurve && (
                <img
                  className="w-full rounded-xl border border-black/[0.06] dark:border-white/[0.10]"
                  src={`data:image/png;base64,${selected.snclock_lightcurve}`}
                  alt={`${snClockModelLabel(selected)} SN Clock`}
                />
              )}
              {selected.convergence_gif ? (
                <img
                  className="w-full rounded-xl border border-black/[0.06] dark:border-white/[0.10]"
                  src={`data:image/gif;base64,${selected.convergence_gif}`}
                  alt={`${snClockModelLabel(selected)} convergence`}
                />
              ) : selected.convergence_png ? (
                <img
                  className="w-full rounded-xl border border-black/[0.06] dark:border-white/[0.10]"
                  src={`data:image/png;base64,${selected.convergence_png}`}
                  alt={`${snClockModelLabel(selected)} convergence`}
                />
              ) : null}
            </div>
          ) : null}
          {selected.viz_error && (
            <div className="rounded-xl bg-[#ff9f0a]/10 px-3 py-2 text-[11px] text-[#9a3412] dark:text-[#fbbf24]">
              {selected.viz_error}
            </div>
          )}
        </div>
      ) : (
        <div className="p-4">
          <EmptyStateText text={selected?.reason ?? 'This SN Clock model is not available.'} />
        </div>
      )}
    </div>
  )
})

const SnClockStat = React.memo(function SnClockStat({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="rounded-xl bg-[#f8fafc] dark:bg-[#1c1c1e] px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-[#6e6e73] dark:text-[#86868b]">{label}</div>
      <div className="mt-0.5 break-words text-[14px] font-semibold tabular-nums text-[#1d1d1f] dark:text-[#f5f5f7] sm:text-[15px]">
        {value}
      </div>
      {detail && (
        <div className="mt-0.5 text-[10px] text-[#6e6e73] dark:text-[#86868b]">{detail}</div>
      )}
    </div>
  )
})

function snClockModelLabel(model: Pick<SNClockModelResult, 'slot'>): string {
  return `Model ${model.slot}`
}

function daysSinceNumber(iso: string): number | null {
  const trimmed = iso.trim()
  const hasTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(trimmed)
  const normalized = hasTimezone || !trimmed.includes('T') ? trimmed : `${trimmed}Z`
  const value = new Date(normalized).getTime()
  if (Number.isNaN(value)) return null
  return (Date.now() - value) / 86400000
}

function formatRelativeTime(iso: string): string {
  const value = new Date(iso).getTime()
  if (Number.isNaN(value)) return 'unknown'
  const minutes = Math.max(0, Math.floor((Date.now() - value) / 60000))
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}

function formatDays(value: number): string {
  if (value < 1) return `${Math.max(1, Math.round(value * 24))}h`
  return `${value.toFixed(1)}d`
}

function formatDiscovery(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString(undefined, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

function formatBeijingTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return `${date.toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })} 北京时间`
}

const Pill = React.memo(function Pill({
  onClick,
  label,
  active = false,
}: {
  onClick: () => void
  label: string
  active?: boolean
}) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick() }}
      className={`inline-flex min-h-9 items-center justify-center rounded-xl border px-3 py-1 text-center text-[11px] font-medium transition active:scale-[0.97] sm:rounded-full ${
        active
          ? 'border-[#34c759]/25 bg-[#34c759]/12 text-[#248a3d]'
          : 'border-black/[0.12] dark:border-white/[0.15] bg-white dark:bg-[#1c1c1e] text-[#1d1d1f] dark:text-[#f5f5f7] hover:bg-[#f5f5f7] dark:hover:bg-[#2c2c2e]'
      }`}
    >
      {label}
    </button>
  )
})

const PillLink = React.memo(function PillLink({
  href,
  label,
  onClick,
}: {
  href: string
  label: string
  onClick?: () => void
}) {
  return (
    <a
      href={href} target="_blank" rel="noopener"
      onClick={(e) => {
        e.stopPropagation()
        onClick?.()
      }}
      className="inline-flex min-h-9 items-center justify-center rounded-xl border border-black/[0.12] bg-white px-3 py-1 text-center text-[11px] font-medium text-[#1d1d1f] transition hover:bg-[#f5f5f7] dark:border-white/[0.15] dark:bg-[#1c1c1e] dark:text-[#f5f5f7] dark:hover:bg-[#2c2c2e] sm:rounded-full"
    >
      {label} ↗
    </a>
  )
})
