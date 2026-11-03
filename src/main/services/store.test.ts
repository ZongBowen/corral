import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { StoreService } from './store'

let dir = ''

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'corral-store-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('StoreService', () => {
  it('starts with defaults when no file exists', async () => {
    const store = new StoreService(dir)
    await store.init()
    expect(store.getState().servers).toEqual([])
    expect(store.getState().settings.defaultTimeoutSec).toBe(300)
  })

  it('persists mutations atomically', async () => {
    const store = new StoreService(dir)
    await store.init()
    await store.mutate((state) => {
      state.servers.push({
        id: 's1',
        name: 'test',
        host: '10.0.0.1',
        port: 22,
        username: 'root',
        tags: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      })
    })
    await store.flush()
    const raw = await readFile(join(dir, 'store.json'), 'utf8')
    expect(raw).toContain('"id": "s1"')
    const files = await readdir(dir)
    expect(files.some((name) => name.includes('.tmp-'))).toBe(false)
  })

  it('backs up corrupt json and starts empty', async () => {
    await writeFile(join(dir, 'store.json'), '{ not json', 'utf8')
    const store = new StoreService(dir)
    await store.init()
    expect(store.wasCorruptOnLoad()).toBe(true)
    expect(store.getState().servers).toEqual([])
    const files = await readdir(dir)
    expect(files.some((name) => name.startsWith('store.corrupt-'))).toBe(true)
  })

  it('migrates env actions missing new fields', async () => {
    const legacy = {
      schemaVersion: 0,
      servers: [
        {
          id: 's1',
          name: 'test',
          host: '10.0.0.1',
          port: 22,
          username: 'root',
          tags: [],
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z'
        }
      ],
      envs: [
        {
          id: 'e1',
          serverId: 's1',
          name: 'env',
          paths: [{ key: 'workDir', label: '工作目录', path: '/opt/app', required: true }],
          actions: [{ id: 'a1', name: '更新', command: 'echo hi' }],
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z'
        }
      ],
      runs: [],
      settings: {}
    }
    await writeFile(join(dir, 'store.json'), JSON.stringify(legacy), 'utf8')
    const store = new StoreService(dir)
    await store.init()
    const action = store.getState().envs[0].actions[0]
    expect(action.timeoutSec).toBe(300)
    expect(action.confirm).toBe(true)
    expect(action.uploads).toEqual([])
    expect(store.getState().settings.defaultTimeoutSec).toBe(300)
  })

  it('updates settings', async () => {
    const store = new StoreService(dir)
    await store.init()
    const settings = await store.updateSettings({ theme: 'dark' })
    expect(settings.theme).toBe('dark')
    await store.flush()
    const reloaded = new StoreService(dir)
    await reloaded.init()
    expect(reloaded.getSettings().theme).toBe('dark')
  })
})
