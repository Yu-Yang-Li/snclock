export type CandidateEmptyPhase = 'initializing' | 'completed-empty'

type CandidateEmptyStateInput = {
  lastCycleCompletedAt?: string | null
  consecutiveEmptyCycles?: number
}

export function getCandidateEmptyState({
  lastCycleCompletedAt,
  consecutiveEmptyCycles,
}: CandidateEmptyStateInput): {
  phase: CandidateEmptyPhase
  emptyCycleCount: number
} {
  if (!lastCycleCompletedAt) {
    return { phase: 'initializing', emptyCycleCount: 0 }
  }

  return {
    phase: 'completed-empty',
    emptyCycleCount: Math.max(0, consecutiveEmptyCycles ?? 0),
  }
}
