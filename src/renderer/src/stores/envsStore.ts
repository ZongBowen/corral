import { create } from 'zustand'
import type { DevEnv, PathCheck } from '@shared/types'
import { envPathCheckTargetChanged } from '@shared/pathCheck'
import { unwrap } from '../api'

interface EnvsState {
  envs: DevEnv[]
  loading: boolean
  loaded: boolean
  pathChecks: Record<string, PathCheck[]>
  load: (force?: boolean) => Promise<void>
  upsert: (env: DevEnv) => void
  remove: (id: string) => void
  clearServerChecks: (serverId: string) => void
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
      const envIds = new Set(envs.map((env) => env.id))
      set((state) => ({
        envs,
        loaded: true,
        pathChecks: Object.fromEntries(
          Object.entries(state.pathChecks).filter(([envId]) => envIds.has(envId))
        )
      }))
    } finally {
      set({ loading: false })
    }
  },
  upsert: (env) => {
    set((state) => {
      const previous = state.envs.find((item) => item.id === env.id)
      const pathChecks = { ...state.pathChecks }
      if (previous && envPathCheckTargetChanged(previous, env)) delete pathChecks[env.id]
      return {
        envs: previous
          ? state.envs.map((item) => (item.id === env.id ? env : item))
          : [...state.envs, env],
        pathChecks
      }
    })
  },
  remove: (id) => {
    set((state) => {
      const pathChecks = { ...state.pathChecks }
      delete pathChecks[id]
      return { envs: state.envs.filter((item) => item.id !== id), pathChecks }
    })
  },
  clearServerChecks: (serverId) => {
    set((state) => {
      const envIds = new Set(
        state.envs.filter((env) => env.serverId === serverId).map((env) => env.id)
      )
      return {
        pathChecks: Object.fromEntries(
          Object.entries(state.pathChecks).filter(([envId]) => !envIds.has(envId))
        )
      }
    })
  },
  setChecks: (envId, checks) => {
    set((state) => ({ pathChecks: { ...state.pathChecks, [envId]: checks } }))
  }
}))
