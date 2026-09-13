export type ZtfHealthBadgeTone = 'ok' | 'warning' | 'error' | 'neutral'

export type ZtfHealthBadge = {
  label: string
  value: string
  tone: ZtfHealthBadgeTone
}

export function formatZtfRate(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
    ? `${(value * 100).toFixed(1)}%` : '—'
}

export function formatZtfHours(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? `${value.toFixed(1)}h` : '—'
}

export function getZtfHealthBadges(
  health: Record<string, unknown> | null,
): ZtfHealthBadge[] {
  const runtimeBadge: ZtfHealthBadge = typeof health?.is_healthy === 'boolean'
    ? health.is_healthy
      ? { label: '运行状态', value: '正常', tone: 'ok' }
      : { label: '运行状态', value: '异常', tone: 'error' }
    : { label: '运行状态', value: '未知', tone: 'neutral' }

  const yieldBadge: ZtfHealthBadge = health?.data_yield_status === 'ok'
    ? { label: '数据产出', value: '正常', tone: 'ok' }
    : health?.data_yield_status === 'backlog'
      ? { label: '数据产出', value: '等待积压', tone: 'warning' }
    : health?.data_yield_status === 'degraded'
      ? { label: '数据产出', value: '需关注', tone: 'warning' }
      : health?.data_yield_status === 'pending'
        ? { label: '数据产出', value: '等待结果', tone: 'neutral' }
        : { label: '数据产出', value: '未知', tone: 'neutral' }

  return [runtimeBadge, yieldBadge]
}
