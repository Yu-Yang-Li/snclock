import { useEffect, useState, useRef } from 'react'
import { api } from '../lib/api'
import type { SystemStatus } from '../lib/types'

interface Props { status: SystemStatus | null }

function withMapReadySignal(html: string): string {
  const readyScript = `
<script>
(function () {
  var sent = false;
  function signalReady() {
    if (sent) return;
    sent = true;
    try {
      window.parent.postMessage({ type: 'snclock-map-ready' }, '*');
    } catch (error) {}
  }
  window.addEventListener('load', function () {
    setTimeout(signalReady, 100);
  });
  document.addEventListener('DOMContentLoaded', function () {
    setTimeout(signalReady, 1200);
  });
  setTimeout(signalReady, 6000);
})();
</script>`
  return `${html}${readyScript}`
}

export default function CelestialMap({ status }: Props) {
  const [mapHtml, setMapHtml] = useState<string>('')
  const [mapImageSrc, setMapImageSrc] = useState<string>('')
  const [interactiveReady, setInteractiveReady] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>('')
  const [projection, setProjection] = useState<string>('earth_surface')
  const prevRevision = useRef(0)
  const requestSeq = useRef(0)
  const iframeRef = useRef<HTMLIFrameElement | null>(null)

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'snclock-focus-source' && typeof event.data.name === 'string') {
        window.location.hash = 'source=' + encodeURIComponent(event.data.name)
        return
      }
      if (event.source !== iframeRef.current?.contentWindow) return
      if (event.data?.type === 'snclock-map-ready') setInteractiveReady(true)
    }

    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [])

  useEffect(() => {
    if (!mapHtml || mapImageSrc || interactiveReady) return
    const timeout = window.setTimeout(() => setInteractiveReady(true), 8000)
    return () => window.clearTimeout(timeout)
  }, [mapHtml, mapImageSrc, interactiveReady])

  useEffect(() => {
    if (projection === 'sky_3d') { setLoading(false); setError(''); return }
    const rev = status?.ui_revision ?? 0
    if (mapHtml && rev === prevRevision.current) return
    prevRevision.current = rev

    const seq = requestSeq.current + 1
    requestSeq.current = seq
    setLoading(true)
    setError('')
    api.plots.celestialMap(projection)
      .then((d) => {
        if (seq !== requestSeq.current) return
        const html = (d.html || '').trim()
        const match = html.match(/<img[^>]+src=["']([^"']+)["']/i)
        const inlineImage = match?.[1] || ''
        if (html) {
          setMapHtml(withMapReadySignal(html))
          setMapImageSrc(d.renderer === 'plotly' ? '' : inlineImage)
          setInteractiveReady(false)
          setError('')
        } else {
          setError('Map unavailable')
        }
      })
      .catch(() => {
        if (seq === requestSeq.current) setError('Map unavailable')
      })
      .finally(() => {
        if (seq === requestSeq.current) setLoading(false)
      })
  }, [status?.ui_revision, projection, mapHtml])

  const n = status?.n_candidates ?? 0

  return (
    <div className="mx-auto max-w-[1440px] px-6 py-4">
      <div className="glass overflow-hidden rounded-2xl">
          <div className="flex flex-col md:flex-row">
            {/* Map area */}
          <div className="relative flex-1 overflow-hidden bg-[#071022] min-h-[360px] md:min-h-[620px]">
            {loading && (
              <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/60 dark:bg-[#121212]/60">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#0071e3] border-t-transparent" />
              </div>
            )}
            {projection === 'sky_3d' ? (
              <div className="relative h-[360px] w-full md:h-[620px]">
                <iframe
                  title="3D Earth sky view"
                  src="/api/sky/earth"
                  sandbox="allow-scripts allow-popups"
                  className="absolute inset-0 block h-full w-full border-0"
                />
              </div>
            ) : mapImageSrc ? (
              <img
                src={mapImageSrc}
                alt="Celestial source map"
                className="block h-full min-h-[360px] w-full object-contain md:min-h-[620px]"
                onError={() => {
                  setMapImageSrc('')
                  if (!mapHtml) setError('Map unavailable')
                }}
              />
            ) : mapHtml ? (
              <div className="relative h-[360px] w-full md:h-[620px]">
                {!interactiveReady && (
                  <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-[#071022] text-white">
                    <div className="h-7 w-7 animate-spin rounded-full border-2 border-[#60a5fa] border-t-transparent" />
                    <div className="text-[12px] font-medium tracking-wide text-white/75">
                      Loading full interactive map...
                    </div>
                  </div>
                )}
                <iframe
                  ref={iframeRef}
                  title="Interactive celestial source map"
                  srcDoc={mapHtml}
                  sandbox="allow-scripts allow-popups"
                  onLoad={() => window.setTimeout(() => setInteractiveReady(true), 1200)}
                  className="absolute inset-0 block h-full w-full border-0"
                />
              </div>
            ) : (
              <div className="flex h-full items-center justify-center text-[#6e6e73] dark:text-[#86868b]">
                {loading ? 'Rendering map...' : (error || 'Map data will appear after the next sync')}
              </div>
            )}
          </div>

          {/* Sidebar */}
          <div className="flex w-full shrink-0 flex-col gap-4 border-t border-black/[0.08] bg-white/50 p-4 dark:border-white/[0.12] dark:bg-[#121212]/50 md:w-52 md:border-l md:border-t-0">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-[#6e6e73] dark:text-[#86868b] mb-2">Projection</p>
              {['sky_3d', 'earth_surface', 'mollweide', 'hammer'].map((p) => (
                <label key={p} className="flex items-center gap-2 cursor-pointer py-1">
                  <input
                    type="radio" name="projection" value={p}
                    checked={projection === p}
                    onChange={() => { setProjection(p); prevRevision.current = -1 }}
                    className="accent-[#0071e3]"
                  />
                  <span className="text-[12px] text-[#1d1d1f] dark:text-[#f5f5f7] capitalize">
                    {p === 'sky_3d' ? '3D Earth View' : p.replace('_', ' ')}
                  </span>
                </label>
              ))}
              {projection === 'sky_3d' && (
                <a
                  href="/api/sky/earth"
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 block text-[11px] text-[#0071e3] hover:underline"
                >
                  Open fullscreen ↗
                </a>
              )}
            </div>

            <div className="space-y-2">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-[#6e6e73] dark:text-[#86868b]">Status</p>
              <Stat label="Sources" value={String(n)} />
              <Stat label="Revision" value={String(status?.ui_revision ?? 0)} />
              <Stat label="ZTF Active" value={status?.ztf_scheduler_active ? 'Yes' : 'No'} />
            </div>

            <div className="mt-auto pt-3 border-t border-black/[0.08] dark:border-white/[0.12]">
              <p className="text-[10px] text-[#6e6e73] dark:text-[#86868b]">
                Last sync {status?.last_tns_cycle
                  ? new Date(status.last_tns_cycle).toLocaleTimeString()
                  : '—'}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between">
      <span className="text-[11px] text-[#6e6e73] dark:text-[#86868b]">{label}</span>
      <span className="text-[13px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] tabular-nums">{value}</span>
    </div>
  )
}
