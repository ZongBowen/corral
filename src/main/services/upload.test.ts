import { EventEmitter } from 'node:events'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Client, SFTPWrapper } from 'ssh2'
import type { UploadStats } from '@shared/types'
import { Uploader } from './upload'
import type { UploadPlan } from './uploadPlan'

class FakeSftp {
  dirs = new Set<string>(['/', '/opt', '/opt/app', '/opt/app/lib'])
  files = new Map<string, number>()
  ended = false

  lstat = vi.fn((path: string, callback: (error: Error | undefined, stats?: unknown) => void) => {
    if (this.dirs.has(path)) {
      callback(undefined, {
        isDirectory: () => true,
        isSymbolicLink: () => false,
        size: 0
      })
      return
    }
    if (this.files.has(path)) {
      callback(undefined, {
        isDirectory: () => false,
        isSymbolicLink: () => false,
        size: this.files.get(path)
      })
      return
    }
    const error = new Error('No such file') as Error & { code: number }
    error.code = 2
    callback(error)
  })

  stat = vi.fn((path: string, callback: (error: Error | undefined, stats?: unknown) => void) => {
    this.lstat(path, callback)
  })

  mkdir = vi.fn((path: string, _attrs: unknown, callback: (error?: Error) => void) => {
    this.dirs.add(path)
    callback(undefined)
  })

  fastPut = vi.fn(
    (
      _localPath: string,
      remotePath: string,
      options: { step?: (n: number, c: number, t: number) => void },
      callback: (error?: Error | null) => void
    ) => {
      const size = UPLOAD_SIZE
      this.files.set(remotePath, size)
      options.step?.(size, size, size)
      setImmediate(() => callback(null))
    }
  )

  end = vi.fn(() => {
    this.ended = true
  })
}

class FakeClient extends EventEmitter {
  commands: string[] = []
  replaceExit = 0
  stall: 'open' | 'exit' | 'cleanup' | undefined
  lateOpen?: () => void
  closeChannel = vi.fn()

  constructor(private readonly sftp = new FakeSftp()) {
    super()
  }

  exec = vi.fn(
    (
      command: string,
      _options: unknown,
      callback: (error: Error | undefined, stream?: unknown) => void
    ) => {
      this.commands.push(command)
      const stream = Object.assign(new EventEmitter(), {
        stderr: new EventEmitter(),
        close: this.closeChannel
      })
      if (this.stall === 'open') {
        this.lateOpen = () => callback(undefined, stream)
        return
      }
      callback(undefined, stream)
      if (this.stall === 'exit' || (this.stall === 'cleanup' && command.includes('rm -f'))) return
      setImmediate(() => {
        const target = '/opt/app/lib/app.jar'
        if (command.includes('CORRAL_BAK')) {
          const size = this.sftp.files.get(target)
          if (size !== undefined) {
            this.sftp.files.set(target + '.bak-20261029-120000', size)
            stream.emit(
              'data',
              Buffer.from('CORRAL_BAK:/opt/app/lib/app.jar.bak-20261029-120000\n')
            )
          }
        } else if (command.includes('mv -fT')) {
          if (this.replaceExit === 0) this.sftp.files.set(target, UPLOAD_SIZE)
          stream.emit('close', this.replaceExit)
          return
        }
        stream.emit('close', 0)
      })
    }
  )
}

const UPLOAD_SIZE = 5
let dir = ''

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'corral-upload-'))
})

afterEach(async () => {
  vi.useRealTimers()
  await rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 30 })
})

function makePlan(
  conflict: 'backup' | 'overwrite',
  targetPath = '/opt/app/lib/app.jar'
): UploadPlan {
  const file = join(dir, 'app.jar')
  return {
    items: [
      {
        item: {
          id: 'u1',
          kind: 'file',
          localPath: file,
          targetDir: '/opt/app/lib',
          conflict
        },
        targetDir: '/opt/app/lib',
        dirs: [],
        totalBytes: UPLOAD_SIZE,
        files: [{ localPath: file, rel: 'app.jar', targetPath, size: UPLOAD_SIZE }]
      }
    ],
    totalBytes: UPLOAD_SIZE,
    fileCount: 1,
    missing: [],
    warnings: []
  }
}

describe('Uploader', () => {
  function runUpload(
    sftp: FakeSftp,
    client: FakeClient,
    controller = new AbortController(),
    system = vi.fn()
  ): Promise<UploadStats> {
    return new Uploader().run(
      client as unknown as Client,
      sftp as unknown as SFTPWrapper,
      makePlan('overwrite'),
      {
        runId: 'deadline-test',
        signal: controller.signal,
        idleTimeoutMs: 100,
        onProgress: vi.fn(),
        onSystem: system
      }
    )
  }

  it.each(['lstat', 'mkdir', 'stat', 'fastPut'] as const)(
    'times out if %s never calls back',
    async (method) => {
      vi.useFakeTimers()
      const sftp = new FakeSftp()
      const client = new FakeClient(sftp)
      if (method === 'mkdir') sftp.dirs.delete('/opt/app/lib')
      sftp[method].mockImplementation(() => undefined)

      const result = expect(runUpload(sftp, client)).rejects.toMatchObject({ code: 'timeout' })
      await vi.advanceTimersByTimeAsync(101)
      await result
      expect(sftp.end).toHaveBeenCalledOnce()
    }
  )

  it.each(['open', 'exit'] as const)(
    'times out remote replacement waiting for %s',
    async (stall) => {
      vi.useFakeTimers()
      const sftp = new FakeSftp()
      const client = new FakeClient(sftp)
      client.stall = stall
      const system = vi.fn()
      const result = expect(runUpload(sftp, client, undefined, system)).rejects.toMatchObject({
        code: 'timeout'
      })
      await vi.advanceTimersByTimeAsync(101)
      await result
      client.lateOpen?.()
      expect(client.closeChannel).toHaveBeenCalledOnce()
      expect(client.commands).toHaveLength(1)
      expect(system).toHaveBeenCalledWith(expect.stringContaining('替换结果未知'))
      expect(client.listenerCount('close')).toBe(0)
    }
  )

  it('bounds cleanup and keeps the timeout that preceded a later cancel', async () => {
    vi.useFakeTimers()
    const sftp = new FakeSftp()
    sftp.stat.mockImplementation(() => undefined)
    const client = new FakeClient(sftp)
    client.stall = 'cleanup'
    const controller = new AbortController()
    const system = vi.fn()
    const result = expect(runUpload(sftp, client, controller, system)).rejects.toMatchObject({
      code: 'timeout'
    })
    await vi.advanceTimersByTimeAsync(101)
    controller.abort()
    await vi.advanceTimersByTimeAsync(10_000)
    await result
    expect(client.closeChannel).toHaveBeenCalledOnce()
    expect(system).toHaveBeenCalledWith(expect.stringContaining('临时文件清理未确认'))
  })

  it.each([true, false])(
    'renews the transfer timeout only when bytes increase (%s)',
    async (increasing) => {
      vi.useFakeTimers()
      const sftp = new FakeSftp()
      sftp.fastPut.mockImplementation((_local, remote, options, callback) => {
        sftp.files.set(remote, UPLOAD_SIZE)
        options.step?.(1, 1, UPLOAD_SIZE)
        setTimeout(() => options.step?.(increasing ? 3 : 1, 2, UPLOAD_SIZE), 60)
        setTimeout(() => callback(null), 130)
      })
      const upload = runUpload(sftp, new FakeClient(sftp))
      const result = increasing
        ? expect(upload).resolves.toMatchObject({ transferredBytes: UPLOAD_SIZE })
        : expect(upload).rejects.toMatchObject({ code: 'timeout' })
      await vi.advanceTimersByTimeAsync(150)
      await result
    }
  )

  it.each(['canceled', 'network'])('settles a blocked metadata request on %s', async (cause) => {
    const sftp = new FakeSftp()
    sftp.stat.mockImplementation(() => undefined)
    const client = new FakeClient(sftp)
    const controller = new AbortController()
    const result = expect(runUpload(sftp, client, controller)).rejects.toMatchObject({
      code: cause
    })
    await vi.waitFor(() => expect(sftp.stat).toHaveBeenCalled())
    if (cause === 'canceled') controller.abort()
    else client.emit('close')
    await result
    expect(client.listenerCount('close')).toBe(0)
  })

  it('uploads a file and reports progress', async () => {
    await writeFile(join(dir, 'app.jar'), 'hello')
    const sftp = new FakeSftp()
    const client = new FakeClient(sftp)
    const progress = vi.fn()
    const system = vi.fn()
    const uploader = new Uploader()

    const stats = await uploader.run(
      client as unknown as Client,
      sftp as unknown as SFTPWrapper,
      makePlan('overwrite'),
      {
        runId: 'run-12345678',
        signal: new AbortController().signal,
        idleTimeoutMs: 60_000,
        onProgress: progress,
        onSystem: system
      }
    )

    expect(stats.fileCount).toBe(1)
    expect(stats.transferredBytes).toBe(UPLOAD_SIZE)
    expect(stats.backups).toEqual([])
    expect(progress).toHaveBeenCalled()
    expect(system).toHaveBeenCalledWith(expect.stringContaining('app.jar'))
    expect(client.commands.some((command) => command.includes('mv -f'))).toBe(true)
    expect(sftp.files.size).toBeGreaterThan(0)
  })

  it('records backup path when target exists', async () => {
    await writeFile(join(dir, 'app.jar'), 'hello')
    const sftp = new FakeSftp()
    sftp.files.set('/opt/app/lib/app.jar', 4)
    const client = new FakeClient(sftp)
    const uploader = new Uploader()

    const stats = await uploader.run(
      client as unknown as Client,
      sftp as unknown as SFTPWrapper,
      makePlan('backup'),
      {
        runId: 'run-12345678',
        signal: new AbortController().signal,
        idleTimeoutMs: 60_000,
        onProgress: vi.fn(),
        onSystem: vi.fn()
      }
    )

    expect(stats.backups).toEqual(['/opt/app/lib/app.jar.bak-20261029-120000'])
    expect(client.commands.some((command) => command.includes('CORRAL_BAK'))).toBe(true)
    expect(sftp.files.get('/opt/app/lib/app.jar')).toBe(UPLOAD_SIZE)
  })

  it('keeps the old target and backup when the install exits unsuccessfully', async () => {
    const target = '/opt/app/lib/app.jar'
    const sftp = new FakeSftp()
    sftp.files.set(target, 4)
    const client = new FakeClient(sftp)
    client.replaceExit = 1
    const system = vi.fn()
    await expect(
      new Uploader().run(
        client as unknown as Client,
        sftp as unknown as SFTPWrapper,
        makePlan('backup'),
        {
          runId: 'run-failed',
          signal: new AbortController().signal,
          idleTimeoutMs: 60_000,
          onProgress: vi.fn(),
          onSystem: system
        }
      )
    ).rejects.toThrow('替换失败')
    expect(sftp.files.get(target)).toBe(4)
    expect(sftp.files.get(target + '.bak-20261029-120000')).toBe(4)
    expect(system).toHaveBeenCalledWith(expect.stringContaining('备份：' + target))
    expect(client.commands.at(-1)).toContain('rm -f')
  })

  it('uploads nested files into a temporary path in the final directory', async () => {
    const sftp = new FakeSftp()
    sftp.dirs.add('/opt/app/lib/nested')
    const plan = makePlan('backup', '/opt/app/lib/nested/app.jar')
    const client = new FakeClient(sftp)
    const stats = await new Uploader().run(
      client as unknown as Client,
      sftp as unknown as SFTPWrapper,
      plan,
      {
        runId: 'run-nested',
        signal: new AbortController().signal,
        idleTimeoutMs: 60_000,
        onProgress: vi.fn(),
        onSystem: vi.fn()
      }
    )
    expect(sftp.fastPut).toHaveBeenCalledWith(
      expect.any(String),
      '/opt/app/lib/nested/.corral-tmp-run-nested-0',
      expect.any(Object),
      expect.any(Function)
    )
    expect(stats.backups).toEqual([])
  })

  it('aborts when the signal is already aborted', async () => {
    await writeFile(join(dir, 'app.jar'), 'hello')
    const controller = new AbortController()
    controller.abort()
    const uploader = new Uploader()
    await expect(
      uploader.run(
        new FakeClient() as unknown as Client,
        new FakeSftp() as unknown as SFTPWrapper,
        makePlan('overwrite'),
        {
          runId: 'run-12345678',
          signal: controller.signal,
          idleTimeoutMs: 60_000,
          onProgress: vi.fn(),
          onSystem: vi.fn()
        }
      )
    ).rejects.toThrow('上传已取消')
  })
})
