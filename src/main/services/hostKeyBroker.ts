import type { BrowserWindow } from 'electron'
import type { HostKeyChallenge } from '@shared/types'
import { EV } from '@shared/ipc'

interface PendingChallenge {
  resolve: (accepted: boolean) => void
  timer: NodeJS.Timeout
}

export class HostKeyBroker {
  private pending = new Map<string, PendingChallenge>()

  constructor(private readonly getWindow: () => BrowserWindow | null) {}

  request(challenge: HostKeyChallenge): Promise<boolean> {
    const win = this.getWindow()
    if (!win || win.isDestroyed()) return Promise.resolve(false)

    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => this.settle(challenge.challengeId, false), 30_000)
      this.pending.set(challenge.challengeId, { resolve, timer })
      win.webContents.send(EV.hostkeyChallenge, challenge)
    })
  }

  decide(challengeId: string, accept: boolean): void {
    this.settle(challengeId, accept)
  }

  dispose(): void {
    for (const id of [...this.pending.keys()]) {
      this.settle(id, false)
    }
  }

  private settle(challengeId: string, accepted: boolean): void {
    const item = this.pending.get(challengeId)
    if (!item) return
    this.pending.delete(challengeId)
    clearTimeout(item.timer)
    item.resolve(accepted)
  }
}
