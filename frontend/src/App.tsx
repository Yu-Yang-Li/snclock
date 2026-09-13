import { useState, useCallback, useEffect, createContext, lazy, Suspense } from 'react'
import { useWebSocket } from './hooks/useWebSocket'
import { api } from './lib/api'
import type { SystemStatus } from './lib/types'
import TopBar from './components/TopBar'
import RunSummary from './components/RunSummary'
import CelestialMap from './components/CelestialMap'
import CandidateList from './components/CandidateList'
import { useToast } from './components/Toast'
import { ToastProvider } from './components/ToastProvider'

type RuntimeSystemStatus = SystemStatus & {
  last_cycle_completed_at?: string
  consecutive_empty_cycles?: number
}

// tab panels load on demand; StatsTable alone pulls in recharts
const StatsTable = lazy(() => import('./components/StatsTable'))
const ZTFMonitorPanel = lazy(() => import('./components/ZTFMonitorPanel'))

function TabFallback() {
  return (
    <div className="flex items-center justify-center py-24">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#0071e3] border-t-transparent" />
    </div>
  )
}

type TabId = 'candidates' | 'stats' | 'ztf'

const TABS: { id: TabId; label: string; icon: string }[] = [
  { id: 'candidates', label: 'Sources', icon: 'M12 3v18m-6-6h12' },
  { id: 'stats', label: 'Statistics', icon: 'M3 3v18h18M9 17V9m4 8V5m4 12v-4' },
  { id: 'ztf', label: 'ZTF Monitor', icon: 'M15 12a3 3 0 11-6 0 3 3 0 016 0zM2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z' },
]

const THEME_STORAGE_KEY = 'snc:theme'

const ThemeContext = createContext<{ darkMode: boolean }>({ darkMode: false })

function parseSourceLocator(): string | null {
  const m = window.location.hash.match(/^#source=(.+)$/)
  if (m) return decodeURIComponent(m[1])

  const prefix = '/source/'
  if (!window.location.pathname.startsWith(prefix)) return null
  const encodedName = window.location.pathname.slice(prefix.length).replace(/\/$/, '')
  if (!encodedName) return null
  try {
    return decodeURIComponent(encodedName)
  } catch {
    return encodedName
  }
}

function AppContent() {
  const [activeTab, setActiveTab] = useState<TabId>('candidates')
  const [status, setStatus] = useState<RuntimeSystemStatus | null>(null)
  const [darkMode, setDarkMode] = useState(false)
  const [focusSource, setFocusSource] = useState<string | null>(() => parseSourceLocator())
  const { showToast } = useToast()

  useEffect(() => {
    const onHash = () => {
      const name = parseSourceLocator()
      if (name) {
        setActiveTab('candidates')
        setFocusSource(name)
      }
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const onMessage = useCallback(() => {
    api.system.status().then(setStatus).catch(() => {})
  }, [])

  const { connected } = useWebSocket(onMessage)

  useEffect(() => {
    api.system.status().then(setStatus).catch(() => {})
    const iv = setInterval(() => {
      api.system.status().then(setStatus).catch(() => {})
    }, 10000)
    return () => clearInterval(iv)
  }, [])

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(THEME_STORAGE_KEY)
      if (saved !== null) {
        const isDark = saved === 'dark'
        setDarkMode(isDark)
        if (isDark) {
          document.documentElement.classList.add('dark')
        }
      } else {
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
        if (prefersDark) {
          setDarkMode(true)
          document.documentElement.classList.add('dark')
        }
      }
    } catch (e) {
      console.warn('Failed to load theme preference', e)
    }
  }, [])

  useEffect(() => {
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, darkMode ? 'dark' : 'light')
      if (darkMode) {
        document.documentElement.classList.add('dark')
      } else {
        document.documentElement.classList.remove('dark')
      }
    } catch (e) {
      console.warn('Failed to save theme preference', e)
    }
  }, [darkMode])

  function toggleDarkMode() {
    setDarkMode(!darkMode)
    showToast(!darkMode ? 'Switched to dark mode' : 'Switched to light mode', 'info', 2000)
  }

  return (
    <ThemeContext.Provider value={{ darkMode }}>
      <div className={`min-h-screen ${darkMode ? 'bg-[#0d0d0d]' : 'bg-[#f5f5f7]'}`}>
        <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
          <div className="absolute -left-32 -top-32 h-[600px] w-[600px] rounded-full bg-[#0071e3]/[0.03] blur-[150px]" />
          <div className="absolute -right-32 top-1/4 h-[500px] w-[500px] rounded-full bg-[#af52de]/[0.02] blur-[150px]" />
        </div>

        <div className="relative z-10">
          <TopBar status={status} connected={connected} darkMode={darkMode} onToggleDarkMode={toggleDarkMode} />

          <RunSummary status={status} darkMode={darkMode} />
          <BrokerSummary status={status} darkMode={darkMode} />

          <CelestialMap status={status} />

          <div className={`sticky top-0 z-30 border-b backdrop-blur-2xl ${darkMode ? 'border-white/[0.12] bg-[#121212]/90' : 'border-black/[0.08] bg-white/90'}`}>
            <div className="mx-auto flex max-w-[1440px] items-center px-6">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setActiveTab(t.id)}
                  className={`relative flex items-center gap-2 px-5 py-3.5 text-[13px] font-medium tracking-wide transition-colors ${
                    activeTab === t.id
                      ? (darkMode ? 'text-[#f5f5f7]' : 'text-[#1d1d1f]')
                      : (darkMode ? 'text-[#86868b] hover:text-[#f5f5f7]' : 'text-[#6e6e73] hover:text-[#1d1d1f]')
                  }`}
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d={t.icon} />
                  </svg>
                  {t.label}
                  {activeTab === t.id && (
                    <span className="absolute bottom-0 left-3 right-3 h-[2px] rounded-full bg-[#0071e3] tab-active-bar" />
                  )}
                </button>
              ))}
            </div>
          </div>

          <div className="mx-auto max-w-[1440px] px-6 py-6">
            <div className="animate-in">
              {activeTab === 'candidates' && (
                <CandidateList
                  uiRevision={status?.ui_revision}
                  lastCycleCompletedAt={status?.last_cycle_completed_at}
                  consecutiveEmptyCycles={status?.consecutive_empty_cycles}
                  focusSource={focusSource}
                  onFocusConsumed={() => {
                    setFocusSource(null)
                    if (window.location.hash.startsWith('#source=')) {
                      history.replaceState(null, '', window.location.pathname + window.location.search)
                    }
                  }}
                />
              )}
              {activeTab === 'stats' && (
                <Suspense fallback={<TabFallback />}>
                  <StatsTable uiRevision={status?.ui_revision} />
                </Suspense>
              )}
              {activeTab === 'ztf' && (
                <Suspense fallback={<TabFallback />}>
                  <ZTFMonitorPanel uiRevision={status?.ui_revision} />
                </Suspense>
              )}
            </div>
          </div>

          <footer className={`border-t py-6 text-center space-y-2 ${darkMode ? 'border-white/[0.08] bg-[#121212]/50' : 'border-black/[0.06] bg-white/50'}`}>
            <p className={`text-[11px] ${darkMode ? 'text-[#86868b]' : 'text-[#6e6e73]'}`}>
              SN Clock · Explosion Time Prediction Pipeline
            </p>
            <div className="flex flex-wrap items-center justify-center gap-3 text-[11px]">
              <a
                href="/api/export/dashboard?table_limit=100&max_cards=8&include_cards=true&download=false"
                target="_blank"
                rel="noreferrer"
                className="text-[#0071e3] hover:underline"
              >
                Open HTML report
              </a>
              <a
                href="/api/export/dashboard?table_limit=100&max_cards=8&include_cards=true&download=true"
                className="text-[#0071e3] hover:underline"
              >
                Download HTML
              </a>
            </div>
          </footer>

        </div>
      </div>
    </ThemeContext.Provider>
  )
}

function BrokerSummary({ status, darkMode }: { status: SystemStatus | null; darkMode: boolean }) {
  const lsst = status?.broker_status?.lsst
  if (!lsst) return null
  const brokers = lsst.brokers ?? []
  return (
    <section className={`border-b ${darkMode ? 'border-white/[0.08] bg-[#121212]/60' : 'border-black/[0.06] bg-white/60'}`}>
      <div className="mx-auto flex max-w-[1440px] flex-wrap items-center gap-2 px-6 py-2">
        <span className={`text-[10px] font-semibold uppercase tracking-[0.16em] ${darkMode ? 'text-[#86868b]' : 'text-[#6e6e73]'}`}>
          Broker status
        </span>
        <span className={`text-[11px] ${darkMode ? 'text-[#d1d5db]' : 'text-[#374151]'}`}>
          {lsst.summary_zh ?? 'LSST broker status unavailable'}
        </span>
        <div className="flex flex-wrap gap-1.5">
          {brokers.map((broker) => (
            <span
              key={broker.name}
              className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${
                broker.enabled
                  ? broker.last_ok === false
                    ? 'border-[#ff3b30]/25 bg-[#ff3b30]/10 text-[#b91c1c]'
                    : broker.state === 'upstream_stale'
                      ? 'border-[#f59e0b]/30 bg-[#f59e0b]/10 text-[#92400e]'
                      : 'border-[#34c759]/25 bg-[#34c759]/10 text-[#166534]'
                  : darkMode
                    ? 'border-white/[0.10] bg-white/[0.04] text-[#86868b]'
                    : 'border-black/[0.08] bg-black/[0.03] text-[#6e6e73]'
              }`}
              title={broker.last_error || broker.base_url || broker.name}
            >
              {broker.name}: {broker.enabled ? (broker.last_rows ?? 0) : 'off'}
            </span>
          ))}
        </div>
      </div>
    </section>
  )
}

export default function App() {
  return (
    <ToastProvider>
      <AppContent />
    </ToastProvider>
  )
}
