import type { RedshiftDiagnostics } from '../lib/types'

export function formatRedshiftDiagnostics(
  diagnostics: RedshiftDiagnostics | undefined,
): string | null {
  if (!diagnostics) return null

  const reasons: string[] = []
  if (diagnostics.requires_redshift && diagnostics.missing_redshift > 0) {
    reasons.push(`${diagnostics.missing_redshift} missing z`)
  }
  if (diagnostics.below_min > 0) {
    reasons.push(`${diagnostics.below_min} below z=${diagnostics.min_redshift}`)
  }
  if (diagnostics.above_max > 0) {
    reasons.push(`${diagnostics.above_max} above z=${diagnostics.max_redshift}`)
  }

  return reasons.length > 0 ? reasons.join(' · ') : null
}
