import { create } from 'zustand'
import type { Run, RunOutputEvent, RunProgress, RunStatus } from '@shared/types'

export interface StreamLine {
  stream: 'stdout' | 'stderr' | 'system'
  text: string
}

export interface RunStream {
  runId: string
  envId: string | null
  actionId: string | null
  status: RunStatus
  lines: StreamLine[]
  bytes: number
  progress?: RunProgress
  run?: Run
  exitCode?: number
  errorMessage?: string
  durationMs?: number
}

const MAX_BYTES = 2 * 1024 * 1024
const MAX_LINES = 2000
const ACTIVE_STATUSES: RunStatus[] = ['queued', 'connecting', 'validating', 'uploading', 'running']

interface RunStreamState {
  activeRunId: string | null
  activeByEnv: Record<string, string>
  streams: Record<string, RunStream>
  begin: (runId: string, envId: string, actionId: string) => void
  setActive: (runId: string | null) => void
  append: (runId: string, stream: StreamLine['stream'], text: string) => void
  output: (event: RunOutputEvent) => void
  setStatus: (runId: string, status: RunStatus, extra?: Partial<RunStream>) => void
  setProgress: (progress: RunProgress) => void
  setDone: (run: Run) => void
  clear: (runId: string) => void
  getActiveForEnv: (envId: string) => RunStream | null
  isEnvRunning: (envId: string) => boolean
}

function byteLength(text: string): number {
  try {
    return new TextEncoder().encode(text).length
  } catch {
    return text.length
  }
}

export const useRunStreamStore = create<RunStreamState>((set, get) => ({
  activeRunId: null,
  activeByEnv: {},
  streams: {},
  begin: (runId, envId, actionId) => {
    set((state) => {
      const existing = state.streams[runId]
      const stream: RunStream = existing
        ? { ...existing, envId, actionId }
        : { runId, envId, actionId, status: 'queued', lines: [], bytes: 0 }
      return {
        activeRunId: runId,
        activeByEnv: { ...state.activeByEnv, [envId]: runId },
        streams: { ...state.streams, [runId]: stream }
      }
    })
  },
  setActive: (runId) => set({ activeRunId: runId }),
  append: (runId, stream, text) => {
    if (!text) return
    set((state) => {
      const current = state.streams[runId] ?? {
        runId,
        envId: null,
        actionId: null,
        status: 'running' as RunStatus,
        lines: [],
        bytes: 0
      }
      const lines = [...current.lines, { stream, text }]
      let bytes = current.bytes + byteLength(text)
      while ((bytes > MAX_BYTES || lines.length > MAX_LINES) && lines.length > 1) {
        const removed = lines.shift()
        if (removed) bytes -= byteLength(removed.text)
      }
      return { streams: { ...state.streams, [runId]: { ...current, lines, bytes } } }
    })
  },
  output: (event) => get().append(event.runId, event.stream, event.data),
  setStatus: (runId, status, extra = {}) => {
    set((state) => {
      const current = state.streams[runId] ?? {
        runId,
        envId: null,
        actionId: null,
        status,
        lines: [],
        bytes: 0
      }
      return { streams: { ...state.streams, [runId]: { ...current, ...extra, status } } }
    })
  },
  setProgress: (progress) => {
    set((state) => {
      const current = state.streams[progress.runId]
      if (!current) return state
      return { streams: { ...state.streams, [progress.runId]: { ...current, progress } } }
    })
  },
  setDone: (run) => {
    set((state) => {
      const current = state.streams[run.id] ?? {
        runId: run.id,
        envId: run.envId,
        actionId: run.actionId,
        status: run.status,
        lines: [],
        bytes: 0
      }
      return {
        streams: {
          ...state.streams,
          [run.id]: {
            ...current,
            envId: run.envId,
            actionId: run.actionId,
            status: run.status,
            run,
            exitCode: run.exitCode,
            errorMessage: run.errorMessage,
            durationMs: run.durationMs
          }
        }
      }
    })
  },
  clear: (runId) => {
    set((state) => {
      const current = state.streams[runId]
      if (!current) return state
      return { streams: { ...state.streams, [runId]: { ...current, lines: [], bytes: 0 } } }
    })
  },
  getActiveForEnv: (envId) => {
    const state = get()
    const runId = state.activeByEnv[envId]
    if (!runId) return null
    return state.streams[runId] ?? null
  },
  isEnvRunning: (envId) => {
    const state = get()
    const runId = state.activeByEnv[envId]
    if (!runId) return false
    const stream = state.streams[runId]
    return Boolean(stream && ACTIVE_STATUSES.includes(stream.status))
  }
}))
