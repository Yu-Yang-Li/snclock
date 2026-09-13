import { useEffect, useRef, useCallback, useState } from 'react'

interface WSMessage {
  event: string
  revision?: number
  n_candidates?: number
  status?: string
}

export function useWebSocket(onMessage?: (msg: WSMessage) => void) {
  const wsRef = useRef<WebSocket | null>(null)
  const [connected, setConnected] = useState(false)
  const [revision, setRevision] = useState(0)
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const connect = useCallback(() => {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    const url = `${proto}://${location.host}/api/system/ws`
    const ws = new WebSocket(url)

    ws.onopen = () => setConnected(true)
    ws.onclose = () => {
      setConnected(false)
      reconnectTimer.current = setTimeout(connect, 3000)
    }
    ws.onerror = () => ws.close()
    ws.onmessage = (ev) => {
      try {
        const msg: WSMessage = JSON.parse(ev.data)
        if (msg.revision) setRevision(msg.revision)
        onMessage?.(msg)
      } catch { /* ignore parse errors */ }
    }

    wsRef.current = ws
  }, [onMessage])

  useEffect(() => {
    connect()
    return () => {
      clearTimeout(reconnectTimer.current)
      wsRef.current?.close()
    }
  }, [connect])

  return { connected, revision }
}
