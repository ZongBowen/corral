import { basename } from 'node:path'
import type { Client, SFTPWrapper, Stats } from 'ssh2'
import { AppError } from '@shared/errors'
import { assertSafeRemotePath, joinRemote, shellQuote } from '@shared/command'
import type { UploadItem, UploadStats } from '@shared/types'
import type { PlannedItem, UploadPlan } from './uploadPlan'

export interface UploadProgress {
  fileIndex: number
  fileCount: number
  fileName: string
  transferredBytes: number
  totalBytes: number
}

export interface UploadOptions {
  runId: string
  signal: AbortSignal
  idleTimeoutMs: number
  onProgress: (progress: UploadProgress) => void
  onSystem: (text: string) => void
}

export class Uploader {
  async run(
    client: Client,
    sftp: SFTPWrapper,
    plan: UploadPlan,
    options: UploadOptions
  ): Promise<UploadStats> {
    const started = Date.now()
    const tempPaths: string[] = []
    const backups: string[] = []
    const totalBytes = plan.totalBytes
    let completedBytes = 0
    let fileIndex = 0
    let sequence = 0

    const checkAbort = (): void => {
      if (options.signal.aborted) throw new AppError('canceled', '上传已取消')
    }

    try {
      for (const item of plan.items) {
        checkAbort()
        await mkdirp(sftp, item.targetDir)
        for (const dir of item.dirs) {
          checkAbort()
          await mkdirp(sftp, joinRemote(item.targetDir, dir))
        }

        for (const file of item.files) {
          checkAbort()
          fileIndex += 1
          const tempPath = joinRemote(
            item.targetDir,
            '.corral-tmp-' + options.runId.slice(0, 8) + '-' + String(sequence) + '-' + basename(file.rel)
          )
          sequence += 1
          tempPaths.push(tempPath)

          let stepBytes = 0
          await fastPut(sftp, file.localPath, tempPath, options, (transferred) => {
            stepBytes = transferred
            options.onProgress({
              fileIndex,
              fileCount: plan.fileCount,
              fileName: file.rel,
              transferredBytes: Math.min(completedBytes + stepBytes, totalBytes),
              totalBytes
            })
          })

          const remoteStat = await stat(sftp, tempPath)
          if (remoteStat.size !== file.size) {
            throw new AppError('upload', '上传字节数不一致：' + file.rel)
          }

          await assertReplaceTarget(sftp, file.targetPath)
          const backup = await replaceFile(client, tempPath, file.targetPath, item.item, sftp)
          if (backup) backups.push(backup)

          completedBytes += file.size
          stepBytes = 0
          options.onProgress({
            fileIndex,
            fileCount: plan.fileCount,
            fileName: file.rel,
            transferredBytes: Math.min(completedBytes, totalBytes),
            totalBytes
          })
          options.onSystem('上传 ' + file.rel + ' → ' + file.targetPath)
        }
      }

      return {
        itemCount: plan.items.length,
        fileCount: plan.fileCount,
        totalBytes,
        transferredBytes: completedBytes,
        durationMs: Date.now() - started,
        backups: backups.slice(0, 200)
      }
    } catch (error) {
      await cleanup(client, tempPaths)
      if (options.signal.aborted) {
        throw new AppError('canceled', '上传已取消')
      }
      if (error instanceof AppError) throw error
      const message = errorMessage(error)
      if (/econnreset|timed out|timeout|channel closed|connection lost|socket hang up/i.test(message)) {
        throw new AppError('network', '上传连接中断：' + message)
      }
      throw new AppError('upload', '上传失败：' + message)
    }
  }
}

async function fastPut(
  sftp: SFTPWrapper,
  localPath: string,
  remotePath: string,
  options: UploadOptions,
  onBytes: (transferred: number) => void
): Promise<void> {
  let lastActivity = Date.now()
  let idle = false
  let aborted = false
  let settled = false

  const watchdog = setInterval(() => {
    if (Date.now() - lastActivity > options.idleTimeoutMs) {
      idle = true
      try {
        sftp.end()
      } catch {
        // ignore
      }
    }
  }, 1000)

  const abortHandler = (): void => {
    aborted = true
    try {
      sftp.end()
    } catch {
      // ignore
    }
  }
  options.signal.addEventListener('abort', abortHandler, { once: true })

  await new Promise<void>((resolve, reject) => {
    const done = (error?: Error | null): void => {
      if (settled) return
      settled = true
      clearInterval(watchdog)
      options.signal.removeEventListener('abort', abortHandler)
      if (error) {
        if (idle) {
          reject(new AppError('timeout', '上传空闲超时（' + String(Math.round(options.idleTimeoutMs / 1000)) + 's 无进度）'))
        } else if (aborted || options.signal.aborted) {
          reject(new AppError('canceled', '上传已取消'))
        } else {
          reject(error)
        }
        return
      }
      resolve()
    }

    try {
      sftp.fastPut(
        localPath,
        remotePath,
        {
          mode: 0o644,
          concurrency: 8,
          step: (transferred: number) => {
            lastActivity = Date.now()
            onBytes(transferred)
          }
        },
        (error) => done(error)
      )
    } catch (error) {
      done(error as Error)
    }
  })
}

export async function mkdirp(sftp: SFTPWrapper, dir: string): Promise<void> {
  assertSafeRemotePath(dir)
  if (dir === '/') return
  const parts = dir.split('/').filter(Boolean)
  let current = ''
  for (const part of parts) {
    current += '/' + part
    try {
      const info = await lstat(sftp, current)
      if (info.isSymbolicLink()) {
        throw new AppError('upload', '目标路径包含符号链接：' + current)
      }
      if (!info.isDirectory()) {
        throw new AppError('upload', '目标路径不是目录：' + current)
      }
    } catch (error) {
      if (isNotFound(error)) {
        await mkdir(sftp, current)
        continue
      }
      throw error
    }
  }
}

async function assertReplaceTarget(sftp: SFTPWrapper, target: string): Promise<void> {
  try {
    const info = await lstat(sftp, target)
    if (info.isSymbolicLink()) {
      throw new AppError('upload', '目标路径是符号链接，已中止：' + target)
    }
    if (info.isDirectory()) {
      throw new AppError('upload', '目标类型冲突（目标是目录）：' + target)
    }
  } catch (error) {
    if (isNotFound(error)) return
    throw error
  }
}

async function replaceFile(
  client: Client,
  tempPath: string,
  target: string,
  item: UploadItem,
  sftp: SFTPWrapper
): Promise<string | null> {
  if (item.conflict === 'overwrite') {
    await execScript(client, 'mv -f -- ' + shellQuote(tempPath) + ' ' + shellQuote(target))
    return null
  }

  const stamp = formatTimestamp()
  const script = [
    'target=' + shellQuote(target),
    'tmp=' + shellQuote(tempPath),
    'if [ -e "$target" ] || [ -L "$target" ]; then',
    '  b="$target.bak-' + stamp + '"',
    '  i=1',
    '  while [ -e "$b" ]; do b="$target.bak-' + stamp + '-$i"; i=$((i+1)); done',
    '  mv -- "$target" "$b" && echo "CORRAL_BAK:$b" || exit 3',
    'fi',
    'mv -f -- "$tmp" "$target"'
  ].join('\n')

  const result = await execScript(client, script)
  const backup = result.stdout
    .split(/\r?\n/)
    .find((line) => line.startsWith('CORRAL_BAK:'))
  return backup ? backup.slice('CORRAL_BAK:'.length) : null
}

async function execScript(client: Client, script: string): Promise<{ stdout: string; stderr: string }> {
  return await new Promise((resolve, reject) => {
    client.exec('bash -lc ' + shellQuote(script), { pty: false }, (error, stream) => {
      if (error) {
        reject(new AppError('upload', '远端命令执行失败：' + error.message))
        return
      }
      const out: Buffer[] = []
      const err: Buffer[] = []
      stream.on('data', (data: Buffer) => out.push(data))
      stream.stderr.on('data', (data: Buffer) => err.push(data))
      stream.on('close', (code: number | null) => {
        if (code !== 0) {
          reject(
            new AppError('upload', '远端替换失败（退出码 ' + String(code) + '）：' + Buffer.concat(err).toString('utf8').trim())
          )
          return
        }
        resolve({
          stdout: Buffer.concat(out).toString('utf8'),
          stderr: Buffer.concat(err).toString('utf8')
        })
      })
      stream.on('error', (streamError: Error) => {
        reject(new AppError('upload', '远端替换中断：' + streamError.message))
      })
    })
  })
}

async function cleanup(client: Client, tempPaths: string[]): Promise<void> {
  if (tempPaths.length === 0) return
  try {
    const command = 'rm -f -- ' + tempPaths.map(shellQuote).join(' ')
    await execScript(client, command)
  } catch {
    // best effort cleanup
  }
}

function lstat(sftp: SFTPWrapper, path: string): Promise<Stats> {
  return new Promise((resolve, reject) => {
    sftp.lstat(path, (error, info) => {
      if (error) reject(error)
      else resolve(info)
    })
  })
}

function stat(sftp: SFTPWrapper, path: string): Promise<Stats> {
  return new Promise((resolve, reject) => {
    sftp.stat(path, (error, info) => {
      if (error) reject(error)
      else resolve(info)
    })
  })
}

function mkdir(sftp: SFTPWrapper, path: string): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.mkdir(path, { mode: 0o755 }, (error) => {
      if (error) reject(error)
      else resolve()
    })
  })
}

function isNotFound(error: unknown): boolean {
  const value = error as { code?: number; message?: string }
  if (value.code === 2) return true
  return typeof value.message === 'string' && /no such file/i.test(value.message)
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

function formatTimestamp(date = new Date()): string {
  const pad = (value: number): string => String(value).padStart(2, '0')
  return (
    String(date.getFullYear()) +
    pad(date.getMonth() + 1) +
    pad(date.getDate()) +
    '-' +
    pad(date.getHours()) +
    pad(date.getMinutes()) +
    pad(date.getSeconds())
  )
}

export type { PlannedItem }
