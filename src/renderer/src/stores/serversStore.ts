import { create } from 'zustand'
import type { ServerSummary, TestResult } from '@shared/types'
import { unwrap } from '../api'

export type ConnState = 'unknown' | 'checking' | 'online' | 'offline'

interface ServersState {
  servers: ServerSummary[]
  loading: boolean
  loaded: boolean
  statuses: Record<string, ConnState>
  load: (force?: boolean) => Promise<void>
  upsert: (server: ServerSummary) => void
  remove: (id: string) => void
  setStatus: (id: string, status: ConnState) => void
  test: (id: string) => Promise<TestResult>
}

export const useServersStore = create<ServersState>((set, get) => ({
  servers: [],
  loading: false,
  loaded: false,
  statuses: {},
  load: async (force = false) => {
    if (get().loading) return
    if (get().loaded && !force) return
    set({ loading: true })
    try {
      const servers = await unwrap(window.api.server.list())
      set({ servers, loaded: true })
    } finally {
      set({ loading: false })
    }
  },
  upsert: (server) => {
    set((state) => {
      const exists = state.servers.some((item) => item.id === server.id)
      return {
        servers: exists
          ? state.servers.map((item) => (item.id === server.id ? server : item))
          : [...state.servers, server]
      }
    })
  },
  remove: (id) => {
    set((state) => ({
      servers: state.servers.filter((item) => item.id !== id),
      statuses: { ...state.statuses, [id]: 'unknown' }
    }))
  },
  setStatus: (id, status) => {
    set((state) => ({ statuses: { ...state.statuses, [id]: status } }))
  },
  test: async (id) => {
    get().setStatus(id, 'checking')
    try {
      const result = await unwrap(window.api.server.test({ id }))
      get().setStatus(id, result.ok ? 'online' : 'offline')
      return result
    } catch (error) {
      get().setStatus(id, 'offline')
      throw error
    }
  }
}))
