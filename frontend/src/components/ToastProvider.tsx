import { useState, useCallback, useRef, useEffect } from 'react'
import { ToastContext } from './Toast'
import type { Toast, ToastType } from './Toast'

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const timeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  const hideToast = useCallback((id: string) => {
    const timeout = timeoutsRef.current.get(id)
    if (timeout) {
      clearTimeout(timeout)
      timeoutsRef.current.delete(id)
    }
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const showToast = useCallback((message: string, type: ToastType = 'info', duration: number = 4000) => {
    const id = Math.random().toString(36).substring(2, 9)
    const toast: Toast = { id, message, type, duration }

    setToasts((prev) => [...prev, toast])

    if (duration > 0) {
      const timeout = setTimeout(() => hideToast(id), duration)
      timeoutsRef.current.set(id, timeout)
    }

    return id
  }, [hideToast])

  useEffect(() => {
    const timeouts = timeoutsRef.current
    return () => {
      timeouts.forEach((timeout) => clearTimeout(timeout))
      timeouts.clear()
    }
  }, [])

  return (
    <ToastContext.Provider value={{ toasts, showToast, hideToast }}>
      {children}
      <ToastContainer toasts={toasts} onHide={hideToast} />
    </ToastContext.Provider>
  )
}

function ToastContainer({ toasts, onHide }: { toasts: Toast[]; onHide: (id: string) => void }) {
  if (toasts.length === 0) return null

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onHide={onHide} />
      ))}
    </div>
  )
}

function ToastItem({ toast, onHide }: { toast: Toast; onHide: (id: string) => void }) {
  const { id, message, type } = toast

  const styles: Record<ToastType, { bg: string; border: string; text: string; icon: string }> = {
    success: {
      bg: 'bg-[#34c759]/10 dark:bg-[#34c759]/15',
      border: 'border-[#34c759]/20',
      text: 'text-[#248a3d]',
      icon: '✓',
    },
    error: {
      bg: 'bg-[#ff453a]/10 dark:bg-[#ff453a]/15',
      border: 'border-[#ff453a]/20',
      text: 'text-[#d70015]',
      icon: '✕',
    },
    warning: {
      bg: 'bg-[#ff9f0a]/10 dark:bg-[#ff9f0a]/15',
      border: 'border-[#ff9f0a]/20',
      text: 'text-[#c93400]',
      icon: '⚠',
    },
    info: {
      bg: 'bg-[#0071e3]/10 dark:bg-[#0071e3]/15',
      border: 'border-[#0071e3]/20',
      text: 'text-[#0071e3]',
      icon: 'ℹ',
    },
  }

  const style = styles[type]

  return (
    <div
      className={`animate-in flex items-center gap-3 rounded-xl border px-4 py-3 shadow-lg ${style.bg} ${style.border}`}
      style={{ animation: 'fade-in-up 200ms ease-out' }}
    >
      <span className={`text-lg font-bold ${style.text}`}>{style.icon}</span>
      <span className={`text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7]`}>{message}</span>
      <button
        onClick={() => onHide(id)}
        className={`ml-2 h-6 w-6 rounded-full flex items-center justify-center text-[#6e6e73] dark:text-[#86868b] hover:bg-black/[0.05] dark:hover:bg-white/[0.10] transition-colors`}
      >
        ✕
      </button>
    </div>
  )
}
