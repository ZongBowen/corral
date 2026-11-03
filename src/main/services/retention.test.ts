import { describe, expect, it } from 'vitest'
import type { Run, Settings } from '@shared/types'
import { DEFAULT_SETTINGS } from '@shared/types'
import { pruneRunList } from './retention'

function run(id: string, startedAt: string): Run {
  return {
    id,
    envId: 'e1',
    envName: 'env',
    serverId: 's1',
    serverName: 'server',
    actionId: 'a1',
    actionName: 'action',
    command: 'echo',
    resolvedCommand: 'echo',
    status: 'success',
    startedAt
  }
}

describe('pruneRunList', () => {
  const now = Date.parse('2026-10-29T00:00:00.000Z')
  const settings: Settings = { ...DEFAULT_SETTINGS, logRetentionCount: 3, logRetentionDays: 30 }

  it('keeps the newest N within the day limit (intersection)', () => {
    const runs = [
      run('a', '2026-10-28T00:00:00.000Z'),
      run('b', '2026-10-27T00:00:00.000Z'),
      run('c', '2026-10-26T00:00:00.000Z'),
      run('d', '2026-10-25T00:00:00.000Z'),
      run('old', '2026-08-01T00:00:00.000Z')
    ]
    const result = pruneRunList(runs, settings, now)
    expect(result.kept.map((item) => item.id)).toEqual(['a', 'b', 'c'])
    expect(result.removed.map((item) => item.id)).toEqual(['d', 'old'])
  })

  it('drops runs older than the day limit even when count allows', () => {
    const runs = [
      run('old1', '2026-08-01T00:00:00.000Z'),
      run('old2', '2026-08-02T00:00:00.000Z')
    ]
    const result = pruneRunList(runs, { ...settings, logRetentionCount: 10 }, now)
    expect(result.kept).toHaveLength(0)
    expect(result.removed).toHaveLength(2)
  })
})
