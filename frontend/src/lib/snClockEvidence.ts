import type { SNClockInputEvidence } from './types'

interface SNClockInputLike {
  feature_completeness?: number
  model_features_present?: number
  model_features_total?: number
  n_features?: number
  input_evidence?: SNClockInputEvidence
}

export interface SNClockInputDisplay {
  label: string
  value: string
  detail?: string
  tableMetric: string
  tableCount: string
}

function plural(value: number, singular: string, pluralForm: string): string {
  return `${value} ${value === 1 ? singular : pluralForm}`
}

export function formatSnClockInput(prediction?: SNClockInputLike): SNClockInputDisplay {
  const evidence = prediction?.input_evidence
  if (evidence?.kind === 'observations') {
    return {
      label: 'model evidence',
      value: plural(evidence.count, 'observation', 'observations'),
      detail: `${plural(evidence.detections, 'detection', 'detections')} · ${plural(evidence.limits, 'limit', 'limits')}`,
      tableMetric: `${evidence.detections} det · ${evidence.limits} lim`,
      tableCount: `${evidence.count} obs`,
    }
  }

  const completeness = prediction?.feature_completeness
  const percentage = completeness == null || Number.isNaN(Number(completeness))
    ? null
    : `${(Number(completeness) * 100).toFixed(0)}%`
  const count = prediction?.model_features_present != null && prediction?.model_features_total != null
    ? `${prediction.model_features_present}/${prediction.model_features_total}`
    : prediction?.n_features != null
      ? String(prediction.n_features)
      : '--'

  return {
    label: 'features',
    value: percentage ? `${percentage} (${count})` : count,
    detail: undefined,
    tableMetric: percentage ?? '--',
    tableCount: count,
  }
}
