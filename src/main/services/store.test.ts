import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PathCheck } from '@shared/types'
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

  it('reports a failed write and persists later snapshots in submission order', async () => {
    const store = new StoreService(dir)
    await store.init()
    await store.flush()
    const existing = await readFile(store.filePath, 'utf8')
    const error = new Error('rename failed')
    const rename = vi.spyOn(fs, 'rename').mockRejectedValueOnce(error)

    await store.updateSettings({ defaultTimeoutSec: 400 })
    await expect(store.flush()).rejects.toBe(error)
    expect(await readFile(store.filePath, 'utf8')).toBe(existing)
    expect(await readdir(dir)).toEqual(['store.json'])

    await store.updateSettings({ defaultTimeoutSec: 500 })
    const first = store.flush()
    await store.updateSettings({ defaultTimeoutSec: 600 })
    const second = store.flush()
    await Promise.all([first, second])
    expect(rename).toHaveBeenCalledTimes(3)
    expect(JSON.parse(await readFile(store.filePath, 'utf8')).settings.defaultTimeoutSec).toBe(600)
  })

  it('handles a failed debounced write and saves again after a later mutation', async () => {
    const store = new StoreService(dir)
    await store.init()
    const error = new Error('rename failed')
    vi.spyOn(fs, 'rename').mockRejectedValueOnce(error)
    const report = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await store.updateSettings({ defaultTimeoutSec: 400 })
    await vi.waitFor(() => expect(report).toHaveBeenCalledWith(expect.any(String), error))
    await store.updateSettings({ defaultTimeoutSec: 500 })
    await store.flush()
    expect(JSON.parse(await readFile(store.filePath, 'utf8')).settings.defaultTimeoutSec).toBe(500)
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
    expect(action.uploadRules).toEqual([])
    expect(store.getState().settings.defaultTimeoutSec).toBe(300)
    expect(store.getState().pathChecks).toEqual({})
  })

  it('migrates legacy local uploads into deduplicated target rules', async () => {
    const legacy = {
      schemaVersion: 2,
      envs: [
        {
          id: 'e1',
          serverId: 's1',
          name: 'env',
          paths: [{ key: 'workDir', label: '工作目录', path: '/opt/app', required: true }],
          actions: [
            {
              id: 'a1',
              name: '更新',
              command: 'echo hi',
              timeoutSec: 300,
              confirm: true,
              uploads: [
                {
                  id: 'u1',
                  kind: 'file',
                  localPath: 'D:/one.jar',
                  targetDir: '${workDir}/lib',
                  conflict: 'backup'
                },
                {
                  id: 'u2',
                  kind: 'file',
                  localPath: 'D:/two.jar',
                  targetDir: '${workDir}/lib',
                  conflict: 'backup'
                },
                {
                  id: 'u3',
                  kind: 'dir',
                  localPath: 'D:/dist',
                  targetDir: '${workDir}/static',
                  conflict: 'overwrite'
                }
              ]
            }
          ],
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z'
        }
      ]
    }
    await writeFile(join(dir, 'store.json'), JSON.stringify(legacy), 'utf8')
    const store = new StoreService(dir)

    await store.init()

    const action = store.getState().envs[0].actions[0]
    expect(action.uploadRules).toEqual([
      { id: 'u1', targetDir: '${workDir}/lib', conflict: 'backup' },
      { id: 'u3', targetDir: '${workDir}/static', conflict: 'overwrite' }
    ])
    expect(action).not.toHaveProperty('uploads')
    expect(JSON.stringify(action)).not.toContain('D:/')
    expect(store.getState().schemaVersion).toBe(3)
  })

  it('persists path check snapshots and drops orphaned entries on reload', async () => {
    const check: PathCheck = {
      key: 'workDir',
      label: '工作目录',
      path: '/opt/app',
      status: 'ok',
      checkedAt: '2026-01-01T00:00:00.000Z'
    }
    const store = new StoreService(dir)
    await store.init()
    await store.mutate((state) => {
      state.envs.push({
        id: 'e1',
        serverId: 's1',
        name: 'env',
        paths: [{ key: 'workDir', label: '工作目录', path: '/opt/app', required: true }],
        actions: [],
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z'
      })
      state.pathChecks = { e1: [check], missing: [check] }
    })
    await store.flush()

    const reloaded = new StoreService(dir)
    await reloaded.init()
    expect(reloaded.getState().pathChecks).toEqual({ e1: [check] })
    expect(reloaded.exportConfig('0.1.0')).not.toHaveProperty('pathChecks')
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
