import type { LsstRejection, SystemStatus } from '../lib/types'
import { formatRedshiftDiagnostics } from './redshiftDiagnostics'

interface PipelineNode {
  key: string
  label: string
  value: number
  note: string
  kind: 'source' | 'merge' | 'filter' | 'final'
  tone?: string
  title?: string
}

export default function RunSummary({ status, darkMode }: { status: SystemStatus | null; darkMode: boolean }) {
  const summary = status?.cycle_summary
  const filters = summary?.filters ?? []
  const fetch = summary?.fetch
  const dateStage = findStage(filters, '日期后')
  const redshiftStage = findStage(filters, '红移后')
  const galacticStage = findStage(filters, '银纬后')
  const initialStage = findStage(filters, '规范化后')
  const lastRun = summary?.last_run_at || status?.last_tns_cycle
  const tnsCount = safeCount(fetch?.tns)
  const ztfCount = safeCount(fetch?.ztf)
  const lsstCount = safeCount(fetch?.lsst)
  const finalCount = safeCount(summary?.final ?? status?.n_candidates)
  const redshiftExplanation = formatRedshiftDiagnostics(summary?.redshift_diagnostics)
  const galacticCount = safeCount(galacticStage?.total ?? finalCount)
  const mergedCount = safeCount(
    (initialStage?.total && initialStage.total > 0)
      ? initialStage.total
      : ((fetch?.merged_total && fetch.merged_total > 0) ? fetch.merged_total : fetch?.total),
  )

  const nodes = buildPipelineNodes({
    tns: tnsCount,
    ztf: ztfCount,
    lsst: lsstCount,
    merged: mergedCount,
    recent: safeCount(dateStage?.total),
    redshift: safeCount(redshiftStage?.total),
    galactic: galacticCount,
    final: finalCount,
    dateLabel: dateStage?.label,
    redshiftLabel: redshiftStage?.label,
    galacticLabel: galacticStage?.label,
  })
  const lsstFilterStages = summary?.lsst_filters?.length
    ? summary.lsst_filters
    : (galacticCount > finalCount
      ? [{
          label: 'LSST host offset + host z/type',
          before_total: galacticCount,
          after_total: finalCount,
          lsst_before: galacticCount,
          lsst_after: finalCount,
          dropped: galacticCount - finalCount,
          criteria: 'host offset, redshift, host type',
        }]
      : [])
  const lsstRejections = summary?.lsst_rejections ?? []
  const visibleLsstRejections = lsstRejections.slice(0, 18)
  const rejectionStageCounts = lsstRejections.reduce<Record<string, number>>((acc, item) => {
    const key = item.stage || 'unknown'
    acc[key] = (acc[key] ?? 0) + 1
    return acc
  }, {})

  return (
    <section className={`border-b ${darkMode ? 'border-white/[0.08] bg-[#121212]/70' : 'border-black/[0.06] bg-white/70'}`}>
      <div className="mx-auto grid max-w-[1440px] gap-3 px-6 py-3 lg:grid-cols-[minmax(220px,0.8fr)_2.4fr] lg:items-center">
        <div className="min-w-0">
          <div className={`text-[10px] font-semibold uppercase tracking-[0.16em] ${darkMode ? 'text-[#86868b]' : 'text-[#6e6e73]'}`}>
            Last TNS cycle
          </div>
          <div className={`mt-1 truncate text-[13px] font-semibold tabular-nums ${darkMode ? 'text-[#f5f5f7]' : 'text-[#1d1d1f]'}`}>
            {lastRun ? formatDateTime(lastRun) : 'not completed yet'}
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex flex-wrap items-stretch gap-1.5">
            {nodes.map((node, index) => (
              <div key={node.key} className="flex items-center gap-1.5">
                <PipelineCard node={node} darkMode={darkMode} />
                {index < nodes.length - 1 && (
                  <div className={`px-0.5 text-[13px] font-semibold ${darkMode ? 'text-[#86868b]' : 'text-[#8e8e93]'}`}>
                    {index < 2 ? '+' : '→'}
                  </div>
                )}
              </div>
            ))}
          </div>
          {redshiftExplanation && (
            <div className={`text-[10px] ${darkMode ? 'text-[#d1d5db]' : 'text-[#374151]'}`}>
              <span className={`font-semibold uppercase tracking-[0.14em] ${darkMode ? 'text-[#86868b]' : 'text-[#6e6e73]'}`}>
                Redshift exclusions
              </span>
              {' · '}{redshiftExplanation}
            </div>
          )}
          {lsstFilterStages.length > 0 && (
            <div className={`flex flex-wrap gap-1.5 text-[10px] ${darkMode ? 'text-[#d1d5db]' : 'text-[#374151]'}`}>
              <span className={`font-semibold uppercase tracking-[0.14em] ${darkMode ? 'text-[#86868b]' : 'text-[#6e6e73]'}`}>Final filters</span>
              {lsstFilterStages.map((stage) => {
                const totalBefore = stage.before_total ?? stage.lsst_before
                const totalAfter = stage.after_total ?? stage.lsst_after
                return (
                  <span
                    key={`${stage.label}-${stage.lsst_before}-${stage.lsst_after}`}
                    className={`rounded-full border px-2 py-0.5 ${darkMode ? 'border-white/[0.10] bg-white/[0.04]' : 'border-black/[0.08] bg-black/[0.03]'}`}
                    title={stage.criteria}
                  >
                    {stage.label}: all {totalBefore}{' -> '}{totalAfter}
                    {' · '}LSST {stage.lsst_before}{' -> '}{stage.lsst_after}
                    {stage.dropped ? ` (-${stage.dropped})` : ' (-0)'}
                  </span>
                )
              })}
            </div>
          )}
          <LsstRejectionDetails
            darkMode={darkMode}
            rejections={lsstRejections}
            visibleRejections={visibleLsstRejections}
          stageCounts={rejectionStageCounts}
        />
        </div>
      </div>
    </section>
  )
}

function buildPipelineNodes(input: {
  tns: number
  ztf: number
  lsst: number
  merged: number
  recent: number
  redshift: number
  galactic: number
  final: number
  dateLabel?: string
  redshiftLabel?: string
  galacticLabel?: string
}): PipelineNode[] {
  const rawTotal = input.tns + input.ztf + input.lsst
  return [
    { key: 'tns', label: 'TNS', value: input.tns, note: 'raw source', kind: 'source', tone: 'text-[#0a84ff]' },
    { key: 'ztf', label: 'ZTF', value: input.ztf, note: 'raw source', kind: 'source', tone: 'text-[#ff9f0a]' },
    { key: 'lsst', label: 'LSST', value: input.lsst, note: 'raw source', kind: 'source', tone: 'text-[#bf5af2]' },
    { key: 'merged', label: 'MERGED', value: input.merged, note: `dedup -${drop(rawTotal, input.merged)}`, kind: 'merge' },
    { key: 'recent', label: 'RECENT', value: input.recent, note: `filter -${drop(input.merged, input.recent)}`, kind: 'filter', title: input.dateLabel },
    { key: 'redshift', label: 'REDSHIFT', value: input.redshift, note: `filter -${drop(input.recent, input.redshift)}`, kind: 'filter', title: input.redshiftLabel },
    { key: 'galactic', label: 'GAL LAT', value: input.galactic, note: `filter -${drop(input.redshift, input.galactic)}`, kind: 'filter', title: input.galacticLabel },
    { key: 'final', label: 'FINAL', value: input.final, note: `filter -${drop(input.galactic, input.final)}`, kind: 'final' },
  ]
}

function PipelineCard({ node, darkMode }: { node: PipelineNode; darkMode: boolean }) {
  const isFinal = node.kind === 'final'
  const cardClass = isFinal
    ? 'border-[#34c759]/30 bg-[#34c759]/10'
    : darkMode
      ? 'border-white/[0.1] bg-[#1c1c1e]'
      : 'border-black/[0.06] bg-[#f5f5f7]'

  return (
    <div title={node.title} className={`w-[104px] rounded-md border px-3 py-2 ${cardClass}`}>
      <div className={`truncate text-[10px] font-semibold uppercase ${darkMode ? 'text-[#86868b]' : 'text-[#6e6e73]'}`}>
        {node.label}
      </div>
      <div className={`mt-1 text-[18px] font-bold tabular-nums ${node.tone ?? (isFinal ? 'text-[#34c759]' : darkMode ? 'text-[#f5f5f7]' : 'text-[#1d1d1f]')}`}>
        {node.value}
      </div>
      <div className={`mt-0.5 truncate text-[10px] tabular-nums ${node.note.endsWith('-0') ? (darkMode ? 'text-[#86868b]' : 'text-[#6e6e73]') : 'text-[#ff453a]'}`}>
        {node.note}
      </div>
    </div>
  )
}

function LsstRejectionDetails({
  darkMode,
  rejections,
  visibleRejections,
  stageCounts,
}: {
  darkMode: boolean
  rejections: LsstRejection[]
  visibleRejections: LsstRejection[]
  stageCounts: Record<string, number>
}) {
  if (visibleRejections.length === 0) return null
  return (
    <details className={`rounded-md border px-3 py-2 text-[10px] ${darkMode ? 'border-white/[0.10] bg-white/[0.03] text-[#d1d5db]' : 'border-black/[0.08] bg-black/[0.02] text-[#374151]'}`}>
      <summary className={`cursor-pointer select-none font-semibold uppercase tracking-[0.12em] ${darkMode ? 'text-[#86868b]' : 'text-[#6e6e73]'}`}>
        LSST rejected candidates {rejections.length}
      </summary>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {Object.entries(stageCounts).map(([stage, count]) => (
          <span key={stage} className={`rounded-full border px-2 py-0.5 ${darkMode ? 'border-white/[0.08] bg-black/[0.12]' : 'border-black/[0.06] bg-white/[0.65]'}`}>
            {stage}: {count}
          </span>
        ))}
      </div>
      <div className="mt-2 grid gap-1.5">
        {visibleRejections.map((item, index) => (
          <LsstRejectionRow key={`${item.tns_name || item.internal_name}-${item.stage}-${index}`} item={item} index={index} darkMode={darkMode} />
        ))}
      </div>
    </details>
  )
}

function LsstRejectionRow({ item, index, darkMode }: { item: LsstRejection; index: number; darkMode: boolean }) {
  const name = item.tns_name || item.internal_name || `LSST ${index + 1}`
  const host = item.host_name && item.host_name !== 'N/A' ? item.host_name : 'no host'
  const z = formatAuditNumber(item.host_redshift, 5)
  const dlr = formatAuditNumber(item.host_dlr, 2)
  const pcc = formatAuditNumber(item.host_pcc_bloom, 3)
  const comp = formatAuditNumber(item.host_competition, 2)
  const offset = formatAuditNumber(item.host_offset_arcsec, 1)
  return (
    <div
      className={`grid gap-1 rounded border px-2 py-1.5 sm:grid-cols-[1.1fr_1.5fr_1.7fr] ${darkMode ? 'border-white/[0.08] bg-black/[0.12]' : 'border-black/[0.06] bg-white/[0.65]'}`}
      title={`stage=${item.stage}; failed=${item.failed_checks?.join(', ') || ''}; source=${item.data_source || ''}`}
    >
      <span className="truncate font-semibold text-[#ff453a]">{name}</span>
      <span className="truncate">
        <span className="font-semibold">{item.stage}</span>
        {' · '}
        {formatLsstFailureReason(item)}
      </span>
      <span className="truncate tabular-nums">
        host={host}; type={item.host_type || '-'}; z={z ?? '-'} {item.z_quality || '-'}; DLR={dlr ?? '-'} {item.host_dlr_grade || '-'}; Pcc={pcc ?? '-'}; comp={comp ?? '-'}; off={offset ?? '-'}
      </span>
    </div>
  )
}

function findStage(
  stages: NonNullable<SystemStatus['cycle_summary']>['filters'],
  needle: string,
) {
  return stages?.find((stage) => stage.label.includes(needle))
}

function safeCount(value: number | undefined | null): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0
  return Math.max(0, Math.round(value))
}

function drop(before: number, after: number): number {
  return Math.max(0, before - after)
}

function formatDateTime(value: string): string {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleString(undefined, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function formatAuditNumber(value: number | string | undefined, digits: number): string | null {
  if (value === undefined || value === null) return null
  const n = Number(value)
  if (!Number.isFinite(n)) return null
  return n.toFixed(digits)
}

function formatLsstFailureReason(item: LsstRejection): string {
  const failed = new Set(item.failed_checks ?? [])
  const pieces: string[] = []

  if (failed.has('discovery_age')) pieces.push('discovery age > 3 d')
  if (failed.has('z_range')) {
    const z = formatAuditNumber(item.host_redshift, 5)
    pieces.push(z ? `z ${z} outside 0.002-0.02` : 'z missing')
  }
  if (failed.has('host_type')) pieces.push(`type ${item.host_type || 'missing'} not G`)
  if (failed.has('host_offset')) {
    const offset = formatAuditNumber(item.host_offset_arcsec, 1)
    const limit = item.stage === 'LSST host offset' ? '60' : '30'
    pieces.push(offset ? `offset ${offset}" > ${limit}"` : 'offset missing')
  }
  if (failed.has('dlr')) {
    const dlr = formatAuditNumber(item.host_dlr, 2)
    pieces.push(dlr ? `DLR ${dlr} > 2` : 'DLR missing')
  }
  if (failed.has('dlr_grade')) pieces.push(`DLR grade ${item.host_dlr_grade || 'missing'} not core/disk`)
  if (failed.has('z_quality')) pieces.push(`z quality ${item.z_quality || 'missing'} not spec/photo`)
  if (failed.has('pcc')) {
    const pcc = formatAuditNumber(item.host_pcc_bloom, 3)
    pieces.push(pcc ? `Pcc ${pcc} > 0.2` : 'Pcc missing')
  }
  if (failed.has('competition')) {
    const comp = formatAuditNumber(item.host_competition, 2)
    pieces.push(comp ? `competition ${comp} < 1.2` : 'competition missing')
  }
  if (pieces.length > 0) return pieces.join('; ')
  return item.failed_checks?.length ? item.failed_checks.join(', ') : (item.stage || 'rejected')
}
