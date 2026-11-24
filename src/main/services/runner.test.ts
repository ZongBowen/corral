import { EventEmitter } from 'node:events'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Client, ClientChannel } from 'ssh2'
import { AppError } from '@shared/errors'
import { EV } from '@shared/ipc'
import {
  DEFAULT_SETTINGS,
  type DevEnv,
  type RunStatus,
  type Server,
  type UploadItem
} from '@shared/types'
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

class FakeClient extends EventEmitter {
  end = vi.fn()
}

class FakeSsh {
  connect = vi.fn(async () => {
    if (this.mode === 'refused') throw new AppError('refused', '端口拒绝连接')
    return new FakeClient() as unknown as Client
  })

  execStream = vi.fn<(client: Client, command: string) => Promise<ClientChannel>>(async () => {
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
        command: 'cd "${workDir}" && ./restart.sh',
        timeoutSec: 300,
        confirm: true,
        uploadRules: []
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
  vi.useRealTimers()
  await store.close()
  await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
})

function createManager(ssh: FakeSsh, emit = vi.fn(), getPassword = async () => 'pw'): RunManager {
  return new RunManager({
    store,
    vault: { getPassword },
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
  it('holds the environment before awaiting credentials and through execution', async () => {
    let ready!: (password: string) => void
    const password = new Promise<string>((resolve) => {
      ready = resolve
    })
    const ssh = new FakeSsh('success')
    const manager = createManager(ssh, vi.fn(), () => password)
    const start = manager.start(env.id, 'a1')
    await expect(manager.start(env.id, 'a1')).rejects.toThrow('该环境已有执行中的任务')
    expect(store.getState().runs).toHaveLength(0)
    ready('pw')
    const { runId } = await start
    await expect(manager.start(env.id, 'a1')).rejects.toThrow('该环境已有执行中的任务')
    await waitDone(manager, runId)
    expect(store.getState().runs).toHaveLength(1)
    expect(ssh.connect).toHaveBeenCalledTimes(1)
  })

  it('releases startup lock after validation and credential errors', async () => {
    const ssh = new FakeSsh('success')
    const getPassword = vi.fn(async () => 'pw').mockRejectedValueOnce(new Error('vault failed'))
    const manager = createManager(ssh, vi.fn(), getPassword)
    await expect(manager.start(env.id, 'missing')).rejects.toThrow()
    await expect(manager.start(env.id, 'a1')).rejects.toThrow('vault failed')
    expect(ssh.connect).not.toHaveBeenCalled()
    expect(store.getState().runs).toHaveLength(0)
    const { runId } = await manager.start(env.id, 'a1')
    await waitDone(manager, runId)
    expect(ssh.connect).toHaveBeenCalledTimes(1)
  })

  it('rolls back a failed queue write and permits the same environment to retry', async () => {
    const ssh = new FakeSsh('success')
    const manager = createManager(ssh)
    vi.spyOn(store, 'flush').mockRejectedValueOnce(new Error('disk write failed'))
    await expect(manager.start(env.id, 'a1')).rejects.toThrow('disk write failed')
    expect(store.getState().runs).toEqual([])
    expect(JSON.parse(await readFile(store.filePath, 'utf8')).runs).toEqual([])
    expect(await readdir(join(dir, 'logs'))).toEqual([])
    expect(ssh.connect).not.toHaveBeenCalled()
    const { runId } = await manager.start(env.id, 'a1')
    await waitDone(manager, runId)
    expect(ssh.connect).toHaveBeenCalledTimes(1)
  })

  it('publishes the terminal run and releases its lock even if terminal persistence fails', async () => {
    const ssh = new FakeSsh('success')
    const emit = vi.fn()
    const manager = createManager(ssh, emit)
    const flush = store.flush.bind(store)
    vi.spyOn(store, 'flush')
      .mockImplementationOnce(flush)
      .mockRejectedValueOnce(new Error('disk write failed'))
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { runId } = await manager.start(env.id, 'a1')
    await vi.waitFor(() =>
      expect(emit).toHaveBeenCalledWith(
        EV.runDone,
        expect.objectContaining({ id: runId, status: 'success' })
      )
    )
    expect(emit).toHaveBeenCalledWith(EV.appNotice, expect.objectContaining({ level: 'error' }))
    const retry = await manager.start(env.id, 'a1')
    await waitDone(manager, retry.runId)
    expect(ssh.connect).toHaveBeenCalledTimes(2)
  })

  it('releases a canceled queued run without starting an SSH connection for it', async () => {
    const ssh = new FakeSsh('success')
    const connect = ssh.connect.getMockImplementation()!
    let resume!: () => void
    const blocked = new Promise<void>((resolve) => {
      resume = resolve
    })
    ssh.connect.mockImplementation(async () => {
      await blocked
      return await connect()
    })
    const manager = createManager(ssh)
    const otherEnvs = [1, 2, 3, 4].map((number) => ({ ...env, id: 'other-' + number }))
    await store.mutate((state) => state.envs.push(...otherEnvs))
    const active = await Promise.all(otherEnvs.map((item) => manager.start(item.id, 'a1')))
    const queued = await manager.start(env.id, 'a1')
    await manager.cancel(queued.runId)
    expect(ssh.connect).toHaveBeenCalledTimes(4)
    expect(manager.list({ status: 'canceled' }).map((run) => run.id)).toEqual([queued.runId])
    const retry = await manager.start(env.id, 'a1')
    resume()
    await Promise.all([...active, retry].map(({ runId }) => waitDone(manager, runId)))
    expect(ssh.connect).toHaveBeenCalledTimes(5)
  })

  it('prechecks command variables', async () => {
    const manager = createManager(new FakeSsh('success'))
    const result = await manager.precheck('e1', 'a1')
    expect(result.resolvedCommand).toBe('cd "/opt/app" && ./restart.sh')
    expect(result.missing).toEqual([])
  })

  it('prechecks runtime upload selections', async () => {
    env.actions[0].command = 'unzip "${packagePath}"'
    env.actions[0].uploadRules = [
      { id: 'r1', targetDir: '${workDir}/lib', conflict: 'backup', variableKey: 'package' }
    ]
    const localPath = join(dir, 'app.jar')
    await writeFile(localPath, 'abc', 'utf8')
    const upload: UploadItem = {
      id: 'u1',
      ruleId: 'r1',
      kind: 'file',
      localPath,
      targetDir: '${workDir}/lib',
      conflict: 'backup'
    }
    const manager = createManager(new FakeSsh('success'))

    const result = await manager.precheck('e1', 'a1', [upload])

    expect(result.items).toEqual([
      expect.objectContaining({
        localPath,
        kind: 'file',
        targetPath: '/opt/app/lib/app.jar',
        bytes: 3,
        fileCount: 1
      })
    ])
    expect(result.uploadVariables).toEqual({
      packageName: 'app.jar',
      packagePath: '/opt/app/lib/app.jar'
    })
    expect(result.resolvedCommand).toBe('unzip "/opt/app/lib/app.jar"')
  })

  it('requires a local selection for every upload rule', async () => {
    env.actions[0].uploadRules = [{ id: 'r1', targetDir: '${workDir}/lib', conflict: 'backup' }]
    const manager = createManager(new FakeSsh('success'))

    await expect(manager.precheck('e1', 'a1', [])).rejects.toThrow('请为每个上传目标选择')
  })

  it('requires exactly one file for an upload variable', async () => {
    env.actions[0].uploadRules = [
      { id: 'r1', targetDir: '${workDir}/lib', conflict: 'backup', variableKey: 'package' }
    ]
    const upload: UploadItem = {
      id: 'u1',
      ruleId: 'r1',
      kind: 'dir',
      localPath: dir,
      targetDir: '${workDir}/lib',
      conflict: 'backup'
    }
    const manager = createManager(new FakeSsh('success'))

    await expect(manager.precheck('e1', 'a1', [upload])).rejects.toThrow('必须选择一个文件')
  })

  it('rejects skip mode when the command references upload variables', async () => {
    env.actions[0].command = 'unzip "${packagePath}"'
    env.actions[0].uploadRules = [
      { id: 'r1', targetDir: '${workDir}/lib', conflict: 'backup', variableKey: 'package' }
    ]
    const manager = createManager(new FakeSsh('success'))

    await expect(manager.precheck('e1', 'a1', [], 'skip')).rejects.toThrow('跳过上传无法确定')
  })

  it('allows skipping configured uploads for one run', async () => {
    env.actions[0].uploadRules = [
      { id: 'r1', targetDir: '${workDir}/lib', conflict: 'backup', variableKey: 'package' }
    ]
    const ssh = new FakeSsh('success')
    const manager = createManager(ssh)

    const precheck = await manager.precheck('e1', 'a1', [], 'skip')
    expect(precheck.items).toEqual([])
    expect(precheck.fileCount).toBe(0)

    const { runId } = await manager.start('e1', 'a1', [], false, 'skip')
    await waitStatus(runId, 'success')
    await waitDone(manager, runId)

    const run = store.getState().runs.find((item) => item.id === runId)!
    expect(run.uploadMode).toBe('skip')
    expect(run.uploads).toEqual([])
    expect(ssh.openSftp).not.toHaveBeenCalled()
    const chunk = await logs.readChunk(runId, 0, 4096)
    expect(chunk.content).toContain('本次跳过执行前上传')
  })

  it('builds command variables from a manual file name without uploading', async () => {
    env.actions[0].command = 'unzip "${packagePath}"'
    env.actions[0].uploadRules = [
      { id: 'r1', targetDir: '${workDir}/lib', conflict: 'backup', variableKey: 'package' }
    ]
    const manualUploadFiles = [{ ruleId: 'r1', fileName: 'app 2026.zip' }]
    const ssh = new FakeSsh('success')
    const manager = createManager(ssh)

    const precheck = await manager.precheck('e1', 'a1', [], 'skip', manualUploadFiles)
    expect(precheck.uploadVariables).toEqual({
      packageName: 'app 2026.zip',
      packagePath: '/opt/app/lib/app 2026.zip'
    })
    expect(precheck.resolvedCommand).toBe('unzip "/opt/app/lib/app 2026.zip"')

    const { runId } = await manager.start('e1', 'a1', [], false, 'skip', manualUploadFiles)
    await waitStatus(runId, 'success')
    await waitDone(manager, runId)

    const run = store.getState().runs.find((item) => item.id === runId)!
    expect(run.manualUploadFiles).toEqual(manualUploadFiles)
    expect(run.uploadVariables).toEqual(precheck.uploadVariables)
    expect(ssh.openSftp).not.toHaveBeenCalled()
    const script = ssh.execStream.mock.calls[0][1]
    expect(script).toContain('packagePath=')
    expect(script).toContain('${packagePath}')
    const chunk = await logs.readChunk(runId, 0, 4096)
    expect(chunk.content).toContain('使用手工指定的远程文件名')
  })

  it('validates manual file input and mode consistency', async () => {
    env.actions[0].uploadRules = [
      { id: 'r1', targetDir: '${workDir}/lib', conflict: 'backup', variableKey: 'package' }
    ]
    const manager = createManager(new FakeSsh('success'))

    await expect(
      manager.precheck('e1', 'a1', [], 'skip', [{ ruleId: 'r1', fileName: '../app.zip' }])
    ).rejects.toThrow('手工文件名')
    await expect(
      manager.precheck('e1', 'a1', [], 'skip', [
        { ruleId: 'r1', fileName: 'a.zip' },
        { ruleId: 'r1', fileName: 'b.zip' }
      ])
    ).rejects.toThrow('不能重复')
    await expect(
      manager.precheck('e1', 'a1', [], 'skip', [{ ruleId: 'unknown', fileName: 'a.zip' }])
    ).rejects.toThrow('未关联有效')
    await expect(
      manager.precheck('e1', 'a1', [], 'upload', [{ ruleId: 'r1', fileName: 'a.zip' }])
    ).rejects.toThrow('上传模式不能包含手工文件名')
  })

  it('rejects upload selections in skip mode', async () => {
    env.actions[0].uploadRules = [{ id: 'r1', targetDir: '${workDir}/lib', conflict: 'backup' }]
    const upload: UploadItem = {
      id: 'u1',
      ruleId: 'r1',
      kind: 'file',
      localPath: join(dir, 'app.jar'),
      targetDir: '${workDir}/lib',
      conflict: 'backup'
    }
    const manager = createManager(new FakeSsh('success'))

    await expect(manager.precheck('e1', 'a1', [upload], 'skip')).rejects.toThrow(
      '跳过上传时不能包含上传项'
    )
  })

  it('revalidates local sources before creating a run', async () => {
    env.actions[0].uploadRules = [{ id: 'r1', targetDir: '${workDir}/lib', conflict: 'backup' }]
    const upload: UploadItem = {
      id: 'u1',
      ruleId: 'r1',
      kind: 'file',
      localPath: join(dir, 'missing.jar'),
      targetDir: '${workDir}/lib',
      conflict: 'backup'
    }
    const ssh = new FakeSsh('success')
    const manager = createManager(ssh)

    await expect(manager.start('e1', 'a1', [upload])).rejects.toThrow('本地文件不存在')
    expect(store.getState().runs).toEqual([])
    expect(ssh.connect).not.toHaveBeenCalled()
  })

  it('records the upload selection on the run', async () => {
    env.actions[0].command = 'unzip "${packagePath}"'
    env.actions[0].uploadRules = [
      { id: 'r1', targetDir: '${workDir}/lib', conflict: 'backup', variableKey: 'package' }
    ]
    const localPath = join(dir, 'app.jar')
    await writeFile(localPath, 'abc', 'utf8')
    const upload: UploadItem = {
      id: 'u1',
      ruleId: 'r1',
      kind: 'file',
      localPath,
      targetDir: '${workDir}/lib',
      conflict: 'backup'
    }
    const ssh = new FakeSsh('success')
    ssh.openSftp.mockRejectedValue(new AppError('upload', '测试上传失败'))
    const manager = createManager(ssh)

    const { runId } = await manager.start('e1', 'a1', [upload])
    const savedRun = store.getState().runs.find((item) => item.id === runId)
    expect(savedRun?.uploads).toEqual([upload])
    expect(savedRun?.uploadVariables).toEqual({
      packageName: 'app.jar',
      packagePath: '/opt/app/lib/app.jar'
    })
    expect(savedRun?.resolvedCommand).toBe('unzip "/opt/app/lib/app.jar"')

    await waitStatus(runId, 'failed')
    await waitDone(manager, runId)
    expect(ssh.openSftp).toHaveBeenCalled()
    expect(store.getState().runs.find((item) => item.id === runId)?.errorKind).toBe('upload')
  })

  it('releases upload locks and SSH slots when SFTP never opens', async () => {
    vi.useFakeTimers()
    const ordinaryAction = { ...env.actions[0] }
    const rule = { id: 'r1', targetDir: '${workDir}/lib', conflict: 'backup' as const }
    env.actions[0].uploadRules = [rule]
    const localPath = join(dir, 'app.jar')
    await writeFile(localPath, 'abc')
    const upload: UploadItem = {
      id: 'u1',
      ruleId: rule.id,
      kind: 'file',
      localPath,
      targetDir: rule.targetDir,
      conflict: rule.conflict
    }
    const others = [2, 3, 4].map((number) => ({ ...env, id: 'e' + number }))
    const queuedEnv = { ...env, id: 'e5', actions: [ordinaryAction] }
    await store.mutate((state) => state.envs.push(...others, queuedEnv))

    const end = vi.fn()
    let openLate!: (session: { end: typeof end }) => void
    const lateSession = new Promise<{ end: typeof end }>((resolve) => {
      openLate = resolve
    })
    const ssh = new FakeSsh('success')
    ssh.openSftp
      .mockReturnValueOnce(lateSession)
      .mockImplementation(() => new Promise(() => undefined))
    const emit = vi.fn()
    const manager = createManager(ssh, emit)
    const runs = await Promise.all(
      [env, ...others].map((item) => manager.start(item.id, 'a1', [upload]))
    )
    const queued = await manager.start(queuedEnv.id, 'a1')
    expect(ssh.openSftp).toHaveBeenCalledTimes(4)
    expect(ssh.execStream).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(DEFAULT_SETTINGS.uploadIdleTimeoutSec * 1000 + 10)
    vi.useRealTimers()
    await vi.waitFor(() =>
      expect(emit.mock.calls.filter(([event]) => event === EV.runDone)).toHaveLength(5)
    )
    expect(runs.map(({ runId }) => manager.list().find((run) => run.id === runId)?.status)).toEqual(
      Array(4).fill('timeout')
    )
    expect(manager.list().find((run) => run.id === queued.runId)?.status).toBe('success')
    expect(ssh.execStream).toHaveBeenCalledOnce()
    openLate({ end })
    await vi.waitFor(() => expect(end).toHaveBeenCalledOnce())
    expect(manager.isEnvRunning(env.id)).toBe(false)
    const retry = await manager.start(env.id, 'a1', [], false, 'skip')
    await waitStatus(retry.runId, 'success')
    await waitDone(manager, retry.runId)
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
    expect(emit).toHaveBeenCalledWith(
      'run:status',
      expect.objectContaining({ runId, status: 'success' })
    )

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
    const ssh = new FakeSsh('refused')
    const manager = createManager(ssh)
    const { runId } = await manager.start('e1', 'a1')
    await waitStatus(runId, 'failed')
    await waitDone(manager, runId)
    const run = store.getState().runs.find((item) => item.id === runId)!
    expect(run.errorKind).toBe('refused')

    const chunk = await logs.readChunk(runId, 0, 4096)
    expect(chunk.content).toContain('执行失败')
    ssh.mode = 'success'
    const retry = await manager.start('e1', 'a1')
    await waitStatus(retry.runId, 'success')
    await waitDone(manager, retry.runId)
  })

  it('rejects a second run on the same environment', async () => {
    const manager = createManager(new FakeSsh('success'))
    const { runId } = await manager.start('e1', 'a1')
    await expect(manager.start('e1', 'a1')).rejects.toThrow('该环境已有执行中的任务')
    await waitStatus(runId, 'success')
    await waitDone(manager, runId)
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
