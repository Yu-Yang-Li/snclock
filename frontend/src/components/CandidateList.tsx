import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import React from 'react'
import { useToast } from './Toast'
import { api } from '../lib/api'
import type { CandidateSummary } from '../lib/types'
import { getCandidateEmptyState } from './candidateEmptyState'
import CandidateCard from './CandidateCard'

const VIEWED_STORAGE_KEY = 'snc:viewed-candidates'

type Props = {
  uiRevision?: number
  lastCycleCompletedAt?: string | null
  consecutiveEmptyCycles?: number
  focusSource?: string | null
  onFocusConsumed?: () => void
}

export default function CandidateList({
  uiRevision,
  lastCycleCompletedAt,
  consecutiveEmptyCycles,
  focusSource,
  onFocusConsumed,
}: Props) {
  const [candidates, setCandidates] = useState<CandidateSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [viewedSet, setViewedSet] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState('')
  const [highlighted, setHighlighted] = useState<string | null>(null)
  const lastUiRevision = useRef<number | null>(null)
  const { showToast } = useToast()

  const load = useCallback(async (notify = true) => {
    if (notify) showToast('Loading candidates...', 'info')
    try {
      setCandidates(await api.candidates.list(200))
      if (notify) showToast('Candidates loaded', 'success', 2000)
    } catch (e) {
      console.error('Load candidates failed', e)
      if (notify) showToast('Failed to load candidates', 'error', 3000)
    } finally {
      setLoading(false)
    }
  }, [showToast])

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(VIEWED_STORAGE_KEY)
      if (!raw) return
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        setViewedSet(new Set(parsed.filter((item): item is string => typeof item === 'string')))
      }
    } catch (e) {
      console.warn('Failed to restore viewed candidates', e)
    }
  }, [])

  useEffect(() => {
    try {
      window.localStorage.setItem(VIEWED_STORAGE_KEY, JSON.stringify([...viewedSet]))
    } catch (e) {
      console.warn('Failed to persist viewed candidates', e)
    }
  }, [viewedSet])

  useEffect(() => {
    void load(false)
    const iv = setInterval(() => void load(false), 20000)
    return () => clearInterval(iv)
  }, [load])

  /** 从天球或跨系统链接进入候选：展开、滚动到卡片并高亮几秒。 */
  useEffect(() => {
    if (!focusSource || loading) return
    const match = candidates.find(
      (c) => c.tns_name === focusSource || c.tns_name.replace(/\s+/g, '') === focusSource.replace(/\s+/g, '')
    )
    if (!match) return
    setSearch('')
    setExpanded(match.tns_name)
    setHighlighted(match.tns_name)
    window.setTimeout(() => {
      document.getElementById(`cand-${match.tns_name.replace(/\s+/g, '_')}`)?.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      })
    }, 120)
    window.setTimeout(() => setHighlighted(null), 5000)
    onFocusConsumed?.()
  }, [focusSource, loading, candidates, onFocusConsumed])

  /** 后端 30min 周期（及 ZTF 等）结束时会 bump ui_revision；列表与之间对齐，不必再等最多 20s 轮询 */
  useEffect(() => {
    if (uiRevision === undefined) return
    if (lastUiRevision.current === null) {
      lastUiRevision.current = uiRevision
      return
    }
    if (lastUiRevision.current !== uiRevision) {
      lastUiRevision.current = uiRevision
      void load(false)
    }
  }, [uiRevision, load])

  const filtered = useMemo(() => {
    // 先过滤：只有有红移的源才显示
    const withRedshift = candidates.filter((c) => c.host_redshift != null || c.redshift != null)
    if (!search.trim()) return withRedshift
    const q = search.toLowerCase()
    return withRedshift.filter((c) =>
      c.tns_name.toLowerCase().includes(q) ||
      c.object_type?.toLowerCase().includes(q) ||
      c.hostname?.toLowerCase().includes(q) ||
      c.reporter?.toLowerCase().includes(q) ||
      c.internal_name?.toLowerCase().includes(q)
    )
  }, [candidates, search])

  const displayedCandidates = useMemo(() => {
    return candidates.filter((c) => c.host_redshift != null || c.redshift != null)
  }, [candidates])

  const withType = displayedCandidates.filter((c) => c.object_type).length
  const withZ = displayedCandidates.filter((c) => c.host_redshift != null || c.redshift != null).length
  const totalPhot = displayedCandidates.reduce((s, c) => s + c.n_tns + c.n_atlas + c.n_ztf, 0)
  const emptyState = getCandidateEmptyState({
    lastCycleCompletedAt,
    consecutiveEmptyCycles,
  })

  function toggle(name: string) {
    setExpanded(expanded === name ? null : name)
  }

  function markViewed(name: string) {
    setViewedSet((s) => {
      if (s.has(name)) return s
      return new Set(s).add(name)
    })
  }

  if (loading) {
    return (
      <div className="space-y-3">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="glass overflow-hidden rounded-2xl">
            <div className="flex items-start gap-4 px-5 py-4">
              {/* Stamp placeholder */}
              <div className="shimmer relative h-[64px] w-[64px] shrink-0 overflow-hidden rounded-xl bg-[#f0f0f2] dark:bg-[#1c1c1e]" />

              <div className="min-w-0 flex-1 space-y-2">
                {/* Title row */}
                <div className="flex items-center gap-2.5">
                  <div className="shimmer h-4 w-32 rounded" />
                  <div className="shimmer h-5 w-16 rounded-full" />
                </div>
                {/* Meta chips */}
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  <div className="shimmer h-5 w-24 rounded-full" />
                  <div className="shimmer h-5 w-28 rounded-full" />
                  <div className="shimmer h-5 w-20 rounded-full" />
                </div>
                {/* More meta */}
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <div className="shimmer h-5 w-20 rounded-full" />
                  <div className="shimmer h-5 w-16 rounded-full" />
                </div>
              </div>

              {/* Altitude preview placeholder (hidden on mobile) */}
              <div className="hidden w-[208px] shrink-0 lg:block">
                <div className="shimmer h-[92px] w-full overflow-hidden rounded-xl border border-black/[0.08] dark:border-white/[0.12] bg-white dark:bg-[#121212]" />
              </div>

              {/* Metrics block */}
              <div className="flex shrink-0 items-center gap-3">
                <div className="shimmer h-6 w-12 rounded" />
                <div className="shimmer h-6 w-12 rounded" />
                <div className="shimmer h-6 w-12 rounded" />
              </div>
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (candidates.length === 0) {
    const cycleCompleted = emptyState.phase === 'completed-empty'
    return (
      <div className="flex flex-col items-center justify-center py-24 animate-in">
        <div className="mb-4 text-4xl">🔭</div>
        <p className="text-[16px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">
          {cycleCompleted ? 'No candidates match the current filters' : 'No candidates yet'}
        </p>
        <p className="mt-1 text-[13px] text-[#6e6e73] dark:text-[#86868b]">
          {cycleCompleted
            ? `Latest cycle completed successfully with no matching sources.${
                emptyState.emptyCycleCount > 1
                  ? ` ${emptyState.emptyCycleCount} consecutive cycles have returned no matches.`
                  : ''
              }`
            : 'Waiting for the first TNS data cycle to complete...'}
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Header row */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-[22px] font-bold tracking-tight text-[#1d1d1f] dark:text-[#f5f5f7]">
            Candidates
          </h2>
          <div className="mt-1 flex items-center gap-3">
            <Badge color="#0a84ff" label="Total" value={displayedCandidates.length} />
            <Badge color="#30d158" label="Typed" value={withType} />
            <Badge color="#bf5af2" label="With z" value={withZ} />
            <Badge color="#ff9f0a" label="Photometry" value={totalPhot} />
          </div>
          {displayedCandidates.length < candidates.length && (
            <p className="mt-1 text-[11px] text-[#6e6e73] dark:text-[#86868b]">
              （已隐藏 {candidates.length - displayedCandidates.length} 个无红移的源）
            </p>
          )}
        </div>

        {/* Search + reload */}
        <div className="flex items-center gap-2">
          <div className="relative">
            <svg className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#48484a] dark:text-[#86868b]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <circle cx="11" cy="11" r="8" />
              <path strokeLinecap="round" d="M21 21l-4.35-4.35" />
            </svg>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, type, host..."
              className="h-8 w-56 rounded-full border border-black/[0.1] dark:border-white/[0.15] bg-white dark:bg-[#121212] pl-9 pr-3 text-[12px] text-[#1d1d1f] dark:text-[#f5f5f7] placeholder-[#6e6e73] dark:placeholder-[#86868b] outline-none transition focus:border-[#0071e3]/50 focus:ring-1 focus:ring-[#0071e3]/20"
            />
          </div>
          <button
            onClick={() => void load(true)}
            className="flex h-8 w-8 items-center justify-center rounded-full border border-black/[0.1] dark:border-white/[0.15] bg-white dark:bg-[#121212] text-[#6e6e73] dark:text-[#86868b] transition hover:bg-[#f5f5f7] dark:hover:bg-[#1c1c1e] hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7] active:scale-95"
            aria-label="Reload candidates"
            title="Reload"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h5M20 20v-5h-5M20.49 9A9 9 0 005.64 5.64L4 4m16 16l-1.64-1.64A9 9 0 014.51 15" />
            </svg>
          </button>
        </div>
      </div>

      {/* Filtered count */}
      {search.trim() && (
        <p className="text-[12px] text-[#6e6e73] dark:text-[#86868b]">
          Showing {filtered.length} of {candidates.length} sources
        </p>
      )}

      {/* Cards */}
      <div className="space-y-2.5">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 animate-in">
            <div className="mb-4 text-4xl">🔭</div>
            <p className="text-[16px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">No candidates with redshift</p>
            <p className="mt-1 text-[13px] text-[#6e6e73] dark:text-[#86868b]">
              {candidates.length > 0
                ? `Only ${candidates.length} candidates without redshift found`
                : emptyState.phase === 'completed-empty'
                  ? 'Latest cycle completed successfully with no matching sources.'
                  : 'Waiting for the first TNS data cycle to complete...'}
            </p>
          </div>
        ) : (
          filtered.map((c) => (
            <div
              key={c.tns_name}
              id={`cand-${c.tns_name.replace(/\s+/g, '_')}`}
              className={
                highlighted === c.tns_name
                  ? 'rounded-2xl ring-2 ring-[#30d158] ring-offset-2 ring-offset-transparent transition-shadow duration-500'
                  : 'transition-shadow duration-500'
              }
            >
              <CandidateCard
                c={c}
                isExpanded={expanded === c.tns_name}
                isViewed={viewedSet.has(c.tns_name)}
                onToggle={() => toggle(c.tns_name)}
                onMarkViewed={() => markViewed(c.tns_name)}
              />
            </div>
          ))
        )}
      </div>
    </div>
  )
}

const Badge = React.memo(function Badge({ color, label, value }: { color: string; label: string; value: number }) {
  return (
      <span className="flex items-center gap-1 text-[11px] text-[#6e6e73] dark:text-[#86868b]">
      <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} />
      {label}
      <span className="font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] tabular-nums">{value}</span>
    </span>
  )
})
