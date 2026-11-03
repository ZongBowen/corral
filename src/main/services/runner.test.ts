import { EventEmitter } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Client, ClientChannel } from 'ssh2'
import { AppError } from '@shared/errors'
import { DEFAULT_SETTINGS, type DevEnv, type RunStatus, type Server } from '@shared/types'
import type { SshService } from './ssh'
import { StoreService } from './store'
import { LogStore } from './logStore'
import { RunManager, PidMarkerParser } from './runner'

class FakeStream extends EventEmitter {
  stderr = new EventEmitter()
  close = vi.fn((): void => {
    this.emit('close', null)
  })
}

class FakeClient {
  end = vi.fn()
}

class FakeSsh {
  connect = vi.fn(async () => {
    if (this.mode === 'refused') throw new AppError('refused', '端口拒绝连接')
    return new FakeClient() as unknown as Client
  })

  execStream = vi.fn(async () => {
    const stream = new FakeStream()
    setTimeout(() => {
      stream.emit('data', Buffer.from('hello\n'))
      stream.stderr.emit('data', Buffer.from('\x1eCORRAL_PID:4321\x1e\n'))
      stream.emit('close', this.mode === 'success' ? 0 : 3)
    }, 5)
    return stream as unknown as ClientChannel
  })

  openSftp = vi.fn()
  killRemoteProcess = vi.fn(async () => undefined)
  execCapture = vi.fn(async () => ({ stdout: '', stderr: '', code: 0 }))
  testConnection = vi.fn()

  constructor(public mode: 'success' | 'failure' | 'refused') {}
}

let dir = ''
let store: StoreService
let logs: LogStore
let env: DevEnv

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'corral-runner-'))
  store = new StoreService(dir)
  await store.init()
  logs = new LogStore(join(dir, 'logs'))
  await logs.init()

  const now = new Date().toISOString()
  const server: Server = {
    id: 's1',
    name: 'server',
    host: '127.0.0.1',
    port: 22,
    username: 'root',
    tags: [],
    createdAt: now,
    updatedAt: now
  }
  env = {
    id: 'e1',
    serverId: 's1',
    name: 'env',
    paths: [{ key: 'workDir', label: '工作目录', path: '/opt/app', required: true }],
    actions: [
      {
        id: 'a1',
        name: '更新',
        command: 'cd "\${workDir}" && ./restart.sh',
        timeoutSec: 300,
        confirm: true,
        uploads: []
      }
    ],
    createdAt: now,
    updatedAt: now
  }
  await store.mutate((state) => {
    state.servers.push(server)
    state.envs.push(env)
  })
  await store.flush()
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
})

function createManager(ssh: FakeSsh, emit = vi.fn()): RunManager {
  return new RunManager({
    store,
    vault: { getPassword: async () => 'pw' },
    ssh: ssh as unknown as SshService,
    logs,
    settings: () => ({ ...DEFAULT_SETTINGS, validatePathsBeforeRun: false }),
    emit
  })
}

async function waitDone(manager: RunManager, runId: string): Promise<void> {
  for (let index = 0; index < 200; index += 1) {
    if (!manager.getActiveRunIds().includes(runId)) {
      await new Promise((resolve) => setTimeout(resolve, 50))
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

async function waitStatus(runId: string, status: RunStatus): Promise<void> {
  for (let index = 0; index < 200; index += 1) {
    const run = store.getState().runs.find((item) => item.id === runId)
    if (run?.status === status) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  const run = store.getState().runs.find((item) => item.id === runId)
  throw new Error('run did not reach ' + status + ', current=' + String(run?.status))
}

describe('RunManager', () => {
  it('prechecks command variables', async () => {
    const manager = createManager(new FakeSsh('success'))
    const result = await manager.precheck('e1', 'a1')
    expect(result.resolvedCommand).toBe('cd "/opt/app" && ./restart.sh')
    expect(result.missing).toEqual([])
  })

  it('runs a command and records success', async () => {
    const emit = vi.fn()
    const ssh = new FakeSsh('success')
    const manager = createManager(ssh, emit)
    const { runId } = await manager.start('e1', 'a1')

    await waitStatus(runId, 'success')
    await waitDone(manager, runId)
    const run = store.getState().runs.find((item) => item.id === runId)!
    expect(run.exitCode).toBe(0)
    expect(run.remotePid).toBe(4321)
    expect(run.logBytes).toBeGreaterThan(0)
    expect(emit).toHaveBeenCalledWith('run:status', expect.objectContaining({ runId, status: 'success' }))

    const chunk = await logs.readChunk(runId, 0, 4096)
    expect(chunk.content).toContain('hello')
    expect(chunk.content).not.toContain('CORRAL_PID')
  })

  it('marks non-zero exit as failed', async () => {
    const manager = createManager(new FakeSsh('failure'))
    const { runId } = await manager.start('e1', 'a1')
    await waitStatus(runId, 'failed')
    await waitDone(manager, runId)
    const run = store.getState().runs.find((item) => item.id === runId)!
    expect(run.exitCode).toBe(3)
    expect(run.errorKind).toBe('remote')
  })

  it('classifies connection failures', async () => {
    const manager = createManager(new FakeSsh('refused'))
    const { runId } = await manager.start('e1', 'a1')
    await waitStatus(runId, 'failed')
    await waitDone(manager, runId)
    const run = store.getState().runs.find((item) => item.id === runId)!
    expect(run.errorKind).toBe('refused')

    const chunk = await logs.readChunk(runId, 0, 4096)
    expect(chunk.content).toContain('执行失败')
    await expect(manager.start('e1', 'a1')).resolves.toBeTruthy()
  })

  it('rejects a second run on the same environment', async () => {
    const manager = createManager(new FakeSsh('success'))
    await manager.start('e1', 'a1')
    await expect(manager.start('e1', 'a1')).rejects.toThrow('该环境已有执行中的任务')
  })
})

describe('PidMarkerParser', () => {
  it('extracts and strips pid marker across chunks', () => {
    const parser = new PidMarkerParser()
    expect(parser.push('\x1eCORRAL')).toBe('')
    const rest = parser.push('_PID:99\x1e\nactual output')
    expect(parser.pid).toBe(99)
    expect(rest).toBe('actual output')
    expect(parser.push(' more')).toBe(' more')
  })
})
