import { create } from 'zustand'

export type Page = 'servers' | 'envs' | 'runs' | 'settings'

interface Route {
  page: Page
  envId: string | null
}

interface UiState {
  page: Page
  selectedEnvId: string | null
  history: Route[]
  navigate: (page: Page, envId?: string | null) => void
  selectEnv: (envId: string | null) => void
  back: () => void
}

export const useUiStore = create<UiState>((set, get) => ({
  page: 'servers',
  selectedEnvId: null,
  history: [],
  navigate: (page, envId = null) => {
    const current = { page: get().page, envId: get().selectedEnvId }
    set({
      page,
      selectedEnvId: page === 'envs' ? envId ?? get().selectedEnvId : get().selectedEnvId,
      history: [...get().history, current].slice(-20)
    })
  },
  selectEnv: (envId) => set({ selectedEnvId: envId }),
  back: () => {
    const history = [...get().history]
    const previous = history.pop()
    if (!previous) return
    set({ page: previous.page, selectedEnvId: previous.envId, history })
  }
}))
