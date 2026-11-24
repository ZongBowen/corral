import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ipcMain } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CH } from '@shared/ipc'
import type { Server } from '@shared/types'
import type { AppContext } from '../context'
import { KnownHostsService } from '../services/knownHosts'
import { StoreService } from '../services/store'
import { VaultService } from '../services/vault'
import { registerServerIpc } from './server'

vi.mock('electron', async (importOriginal) => ({
  ...(await importOriginal<typeof import('electron')>()),
  BrowserWindow: { fromWebContents: () => ({}) }
}))

const hostA = 'a.example'
const hostB = 'b.example'
const settings = { name: 'server', host: hostA, port: 22, username: 'user', tags: [] }
let dir: string
let store: StoreService
let knownHosts: KnownHostsService

function server(id: string, changes: Partial<Server> = {}): Server {
  const now = new Date().toISOString()
  return { ...settings, id, createdAt: now, updatedAt: now, ...changes }
}

async function invoke(channel: string, payload: unknown): Promise<unknown> {
  const handler = vi
    .mocked(ipcMain.handle)
    .mock.calls.find(([registered]) => registered === channel)?.[1]
  if (!handler) throw new Error('Missing IPC handler ' + channel)
  return await handler({ sender: { id: 1 } } as Electron.IpcMainInvokeEvent, payload)
}

async function reloadHosts(): Promise<KnownHostsService> {
  const reloaded = new KnownHostsService(dir)
  await reloaded.init()
  return reloaded
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'corral-server-ipc-'))
  store = new StoreService(dir)
  knownHosts = new KnownHostsService(dir)
  const vault = new VaultService(dir)
  await Promise.all([store.init(), knownHosts.init(), vault.init()])
  await store.mutate((state) => state.servers.push(server('s1')))
  await store.flush()
  for (const [host, port, name] of [
    [hostA, 22, 'a22'],
    [hostA, 2222, 'a2222'],
    [hostB, 22, 'b22']
  ] as const) {
    await knownHosts.trust({
      host,
      port,
      keyType: 'ssh-ed25519',
      fingerprint: 'SHA256:' + name,
      firstSeenAt: '',
      lastSeenAt: ''
    })
  }
  vi.mocked(ipcMain.handle).mockClear()
  registerServerIpc({
    store,
    knownHosts,
    vault,
    getWindow: () => ({ webContents: { id: 1 } })
  } as AppContext)
})

afterEach(async () => {
  await store.close()
  await rm(dir, { recursive: true, force: true })
})

describe('server IPC host keys', () => {
  it.each([
    [hostB, 22, 'b22'],
    [hostA, 2222, 'a2222']
  ] as const)('preserves the trust at the new endpoint %s:%s', async (host, port, fingerprint) => {
    expect(
      await invoke(CH.serverUpdate, { id: 's1', input: { ...settings, host, port } })
    ).toMatchObject({ ok: true })
    const persisted = await reloadHosts()
    expect(persisted.get(host, port)?.fingerprint).toBe('SHA256:' + fingerprint)
    expect(persisted.get(hostA, 22)).toBeUndefined()
  })

  it('keeps a shared address until its last configuration is removed', async () => {
    await store.mutate((state) => state.servers.push(server('s2'), server('s3')))
    expect(
      await invoke(CH.serverUpdate, { id: 's1', input: { ...settings, host: hostB } })
    ).toMatchObject({ ok: true })
    expect(await invoke(CH.serverRemove, 's2')).toMatchObject({ ok: true })
    expect((await reloadHosts()).get(hostA, 22)?.fingerprint).toBe('SHA256:a22')
    expect(await invoke(CH.serverRemove, 's3')).toMatchObject({ ok: true })
    expect((await reloadHosts()).get(hostA, 22)).toBeUndefined()
  })

  it('retains the key when only the username changes or the configuration write fails', async () => {
    expect(
      await invoke(CH.serverUpdate, { id: 's1', input: { ...settings, username: 'new' } })
    ).toMatchObject({ ok: true })
    expect((await reloadHosts()).get(hostA, 22)?.fingerprint).toBe('SHA256:a22')
    vi.spyOn(store, 'flush').mockRejectedValueOnce(new Error('disk write failed'))
    expect(
      await invoke(CH.serverUpdate, { id: 's1', input: { ...settings, host: hostB } })
    ).toMatchObject({ ok: false })
    const persisted = await reloadHosts()
    expect(persisted.get(hostA, 22)?.fingerprint).toBe('SHA256:a22')
    expect(persisted.get(hostB, 22)?.fingerprint).toBe('SHA256:b22')
  })

  it('rechecks references after waiting for the server configuration write', async () => {
    let resume!: () => void
    const pending = new Promise<void>((resolve) => {
      resume = resolve
    })
    const flush = vi.spyOn(store, 'flush').mockReturnValueOnce(pending)
    const updating = invoke(CH.serverUpdate, { id: 's1', input: { ...settings, host: hostB } })
    await vi.waitFor(() => expect(flush).toHaveBeenCalledOnce())
    await store.mutate((state) => state.servers.push(server('s2')))
    await store.flush()
    resume()
    expect(await updating).toMatchObject({ ok: true })
    expect((await reloadHosts()).get(hostA, 22)?.fingerprint).toBe('SHA256:a22')
  })
})
