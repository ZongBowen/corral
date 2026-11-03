import { create } from 'zustand'
import type { Run, RunFilter } from '@shared/types'
import { unwrap } from '../api'

interface RunsState {
  runs: Run[]
  loading: boolean
  filter: RunFilter
  load: (filter?: RunFilter) => Promise<void>
  remove: (runId: string) => Promise<void>
  clear: (filter?: RunFilter) => Promise<void>
  setFilter: (filter: RunFilter) => void
}

export const useRunsStore = create<RunsState>((set, get) => ({
  runs: [],
  loading: false,
  filter: {},
  load: async (filter) => {
    const next = filter ?? get().filter
    set({ loading: true, filter: next })
    try {
      const runs = await unwrap(window.api.run.list(next))
      set({ runs })
    } finally {
      set({ loading: false })
    }
  },
  remove: async (runId) => {
    await unwrap(window.api.run.remove(runId))
    set((state) => ({ runs: state.runs.filter((run) => run.id !== runId) }))
  },
  clear: async (filter) => {
    await unwrap(window.api.run.clear(filter ?? {}))
    await get().load()
  },
  setFilter: (filter) => set({ filter })
}))
