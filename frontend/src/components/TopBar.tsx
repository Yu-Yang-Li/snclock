import type { SystemStatus } from '../lib/types'

interface TopBarProps {
  status: SystemStatus | null
  connected: boolean
  darkMode: boolean
  onToggleDarkMode: () => void
}

export default function TopBar({ status, connected, darkMode, onToggleDarkMode }: TopBarProps) {
  const uptime = status ? formatUptime(status.uptime_seconds) : null

  return (
    <header className={`border-b backdrop-blur-2xl ${darkMode ? 'border-white/[0.12] bg-[#121212]/90' : 'border-black/[0.08] bg-white/90'}`}>
      <div className="mx-auto flex max-w-[1440px] flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        {/* Left: Logo + Title — SN Clock, minimal premium icon */}
        <div className="flex min-w-0 items-center gap-3">
          <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${darkMode ? 'bg-[#f5f5f7] text-[#0d0d0d]' : 'bg-[#1d1d1f] text-white'}`}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 6v6l4 2" />
            </svg>
          </div>
          <div className="min-w-0">
            <h1 className={`text-[16px] font-bold tracking-tight ${darkMode ? 'text-[#f5f5f7]' : 'text-[#1d1d1f]'}`}>
              SN Clock
            </h1>
            <p className={`hidden text-[11px] sm:block ${darkMode ? 'text-[#86868b]' : 'text-[#6e6e73]'}`}>
              Explosion Time Prediction for Transient Sources
            </p>
          </div>
        </div>

        {/* Right: Status indicators */}
        <div className="flex w-full flex-wrap items-center justify-between gap-2 sm:w-auto sm:justify-end sm:gap-4">
          <div className="flex items-center gap-2">
            <span className={`h-2 w-2 rounded-full ${connected ? 'bg-[#34c759] live-pulse' : 'bg-[#ff3b30]'}`} />
	            <span className={`text-[11px] font-medium ${darkMode ? 'text-[#86868b]' : 'text-[#6e6e73]'}`}>
              {connected ? 'Connected' : 'Disconnected'}
            </span>
          </div>

          {uptime && (
	            <span className={`hidden text-[11px] tabular-nums sm:inline ${darkMode ? 'text-[#86868b]' : 'text-[#6e6e73]'}`}>{uptime}</span>
          )}

          {status && (
            <div className={`flex items-center gap-1.5 rounded-full px-3 py-1 border ${darkMode ? 'bg-[#1c1c1e] border-white/[0.12]' : 'bg-[#f5f5f7] border-black/[0.06]'}`}>
              <span className={`text-[12px] font-bold tabular-nums ${darkMode ? 'text-[#f5f5f7]' : 'text-[#1d1d1f]'}`}>{status.n_candidates}</span>
              <span className={`text-[11px] ${darkMode ? 'text-[#86868b]' : 'text-[#6e6e73]'}`}>sources</span>
            </div>
          )}

          {status?.tns_cycle_running && (
            <div className="flex items-center gap-1.5 rounded-full bg-[#0071e3]/10 px-3 py-1 border border-[#0071e3]/20">
              <div className="h-1.5 w-1.5 animate-spin rounded-full border border-[#0071e3] border-t-transparent" />
              <span className="text-[11px] font-medium text-[#0071e3]">Syncing</span>
            </div>
          )}

          <nav aria-label="主导航" className="flex flex-wrap gap-1 text-[12px]">
            {[
              ['/', '首页'], ['/targets/', '目标'], ['/observations/list/', '观测'],
              ['/telescope-data/', '望远镜数据'], ['/dataproducts/data/', '数据'],
              ['/users/profile/', '账户'],
            ].map(([href, label]) => (
              <a key={href} href={href} className={`rounded-md px-2 py-2 ${darkMode ? 'text-[#f5f5f7] hover:bg-white/10' : 'text-[#374151] hover:bg-black/5'}`}>{label}</a>
            ))}
          </nav>

          <button
            onClick={onToggleDarkMode}
            className={`flex h-8 w-8 items-center justify-center rounded-full border transition-all hover:scale-[0.96] ${darkMode ? 'border-white/[0.15] bg-[#1c1c1e] text-[#f5f5f7] hover:bg-[#2c2c2e]' : 'border-black/[0.1] bg-white text-[#6e6e73] hover:bg-[#f5f5f7] hover:text-[#1d1d1f]'}`}
            aria-label={darkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
            title={darkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
          >
            {darkMode ? (
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v2.25M18.364 5.636l-1.591 1.591M21 12h-2.25M18.364 18.364l-1.591-1.591M12 18.75V21M7.227 16.773 5.636 18.364M5.25 12H3M7.227 7.227 5.636 5.636M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            ) : (
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21.752 15.002A9.718 9.718 0 0118 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 003 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 009.002-5.998z" />
              </svg>
            )}
          </button>

        </div>
      </div>
    </header>
  )
}

function formatUptime(s: number): string {
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (h > 0) return `${h}h ${m}m up`
  return `${m}m up`
}
