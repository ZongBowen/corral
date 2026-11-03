import { create } from 'zustand'
import { DEFAULT_SETTINGS, type Settings } from '@shared/types'
import { unwrap } from '../api'

interface SettingsState {
  settings: Settings
  loaded: boolean
  load: () => Promise<void>
  update: (patch: Partial<Settings>) => Promise<void>
}

export const useSettingsStore = create<SettingsState>((set) => ({
  settings: { ...DEFAULT_SETTINGS },
  loaded: false,
  load: async () => {
    const settings = await unwrap(window.api.settings.get())
    set({ settings, loaded: true })
  },
  update: async (patch) => {
    const settings = await unwrap(window.api.settings.update(patch))
    set({ settings, loaded: true })
  }
}))
