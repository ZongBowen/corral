import type { BrowserWindow } from 'electron'
import type { StoreService } from './services/store'
import type { VaultService } from './services/vault'
import type { KnownHostsService } from './services/knownHosts'
import type { SshService } from './services/ssh'
import type { HostKeyBroker } from './services/hostKeyBroker'
import type { RunManager } from './services/runner'
import type { LogStore } from './services/logStore'

export interface AppContext {
  dataDir: string
  store: StoreService
  vault: VaultService
  knownHosts: KnownHostsService
  ssh: SshService
  hostKeys: HostKeyBroker
  logs: LogStore
  runner: RunManager
  getWindow: () => BrowserWindow | null
}
