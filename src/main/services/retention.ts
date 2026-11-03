import type { Run, Settings } from '@shared/types'
import type { LogStore } from './logStore'
import type { StoreService } from './store'

export interface RetentionResult {
  removed: Run[]
  kept: Run[]
}

export function pruneRunList(runs: Run[], settings: Settings, now = Date.now()): RetentionResult {
  const cutoff = now - settings.logRetentionDays * 24 * 60 * 60 * 1000
  const sorted = [...runs].sort(
    (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
  )
  const kept: Run[] = []
  const removed: Run[] = []
  sorted.forEach((run, index) => {
    const started = new Date(run.startedAt).getTime()
    if (index < settings.logRetentionCount && started >= cutoff) {
      kept.push(run)
    } else {
      removed.push(run)
    }
  })
  return { removed, kept }
}

export async function applyRetention(
  store: StoreService,
  logs: LogStore,
  now = Date.now()
): Promise<RetentionResult> {
  const state = store.getState()
  const result = pruneRunList(state.runs, state.settings, now)
  if (result.removed.length === 0) return result

  const removedIds = new Set(result.removed.map((run) => run.id))
  await store.mutate((current) => {
    current.runs = current.runs.filter((run) => !removedIds.has(run.id))
  })
  await Promise.all(result.removed.map((run) => logs.remove(run.id)))
  await store.flush()
  return result
}
