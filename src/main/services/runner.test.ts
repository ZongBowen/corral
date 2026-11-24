import { EventEmitter } from 'node:events'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Client, ClientChannel } from 'ssh2'
import { AppError } from '@shared/errors'
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

class FakeClient {
  end = vi.fn()
}

class FakeSsh {
  connect = vi.fn(async () => {
    if (this.mode === 'refused') throw new AppError('refused', '端口拒绝连接')
    return new FakeClient() as unknown as Client
  })

  execStream = vi.fn(async (_client: Client, _command: string) => {
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
  await store.close()
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
