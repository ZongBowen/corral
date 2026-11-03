import { create } from 'zustand'
import type { DevEnv, PathCheck } from '@shared/types'
import { unwrap } from '../api'

interface EnvsState {
  envs: DevEnv[]
  loading: boolean
  loaded: boolean
  pathChecks: Record<string, PathCheck[]>
  load: (force?: boolean) => Promise<void>
  upsert: (env: DevEnv) => void
  remove: (id: string) => void
  setChecks: (envId: string, checks: PathCheck[]) => void
}

export const useEnvsStore = create<EnvsState>((set, get) => ({
  envs: [],
  loading: false,
  loaded: false,
  pathChecks: {},
  load: async (force = false) => {
    if (get().loading) return
    if (get().loaded && !force) return
    set({ loading: true })
    try {
      const envs = await unwrap(window.api.env.list())
      set({ envs, loaded: true })
    } finally {
      set({ loading: false })
    }
  },
  upsert: (env) => {
    set((state) => {
      const exists = state.envs.some((item) => item.id === env.id)
      return {
        envs: exists ? state.envs.map((item) => (item.id === env.id ? env : item)) : [...state.envs, env]
      }
    })
  },
  remove: (id) => {
    set((state) => ({ envs: state.envs.filter((item) => item.id !== id) }))
  },
  setChecks: (envId, checks) => {
    set((state) => ({ pathChecks: { ...state.pathChecks, [envId]: checks } }))
  }
}))
