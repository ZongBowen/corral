import type { CorralApi } from '@shared/ipc'

declare global {
  interface Window {
    api: CorralApi
  }
}

export {}
