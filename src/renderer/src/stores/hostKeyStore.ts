import { create } from 'zustand'
import type { HostKeyChallenge } from '@shared/types'

interface HostKeyState {
  challenge: HostKeyChallenge | null
  setChallenge: (challenge: HostKeyChallenge | null) => void
}

export const useHostKeyStore = create<HostKeyState>((set) => ({
  challenge: null,
  setChallenge: (challenge) => set({ challenge })
}))
