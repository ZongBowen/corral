import { EventEmitter } from 'node:events'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Client, SFTPWrapper } from 'ssh2'
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
    (localPath: string, remotePath: string, options: { step?: (n: number, c: number, t: number) => void }, callback: (error?: Error | null) => void) => {
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

class FakeClient {
  commands: string[] = []

  exec = vi.fn((command: string, _options: unknown, callback: (error: Error | undefined, stream?: unknown) => void) => {
    this.commands.push(command)
    const stream = new EventEmitter() as EventEmitter & { stderr: EventEmitter }
    stream.stderr = new EventEmitter()
    callback(undefined, stream)
    setImmediate(() => {
      if (command.includes('CORRAL_BAK')) {
        stream.emit('data', Buffer.from('CORRAL_BAK:/opt/app/lib/app.jar.bak-20261029-120000\n'))
      }
      stream.emit('close', 0)
    })
  })
}

const UPLOAD_SIZE = 5
let dir = ''

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'corral-upload-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 30 })
})

function makePlan(conflict: 'backup' | 'overwrite', targetPath = '/opt/app/lib/app.jar'): UploadPlan {
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
  it('uploads a file and reports progress', async () => {
    await writeFile(join(dir, 'app.jar'), 'hello')
    const sftp = new FakeSftp()
    const client = new FakeClient()
    const progress = vi.fn()
    const system = vi.fn()
    const uploader = new Uploader()

    const stats = await uploader.run(client as unknown as Client, sftp as unknown as SFTPWrapper, makePlan('overwrite'), {
      runId: 'run-12345678',
      signal: new AbortController().signal,
      idleTimeoutMs: 60_000,
      onProgress: progress,
      onSystem: system
    })

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
    const client = new FakeClient()
    const uploader = new Uploader()

    const stats = await uploader.run(client as unknown as Client, sftp as unknown as SFTPWrapper, makePlan('backup'), {
      runId: 'run-12345678',
      signal: new AbortController().signal,
      idleTimeoutMs: 60_000,
      onProgress: vi.fn(),
      onSystem: vi.fn()
    })

    expect(stats.backups).toEqual(['/opt/app/lib/app.jar.bak-20261029-120000'])
    expect(client.commands.some((command) => command.includes('CORRAL_BAK'))).toBe(true)
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
