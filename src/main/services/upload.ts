import { posix } from 'node:path'
import type { Client, ClientChannel, SFTPWrapper, Stats } from 'ssh2'
import { AppError } from '@shared/errors'
import { assertSafeRemotePath, joinRemote, shellQuote } from '@shared/command'
import type { UploadStats } from '@shared/types'
import type { PlannedItem, UploadPlan } from './uploadPlan'
import { waitForUpload } from './uploadWait'

const CLEANUP_TIMEOUT_MS = 10_000
type WaitForStep = <T>(
  phase: string,
  start: (signal: AbortSignal, activity: () => void) => Promise<T>
) => Promise<T>

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
    const tempPaths = new Set<string>()
    const backups: string[] = []
    const totalBytes = plan.totalBytes
    let completedBytes = 0
    let fileIndex = 0
    let sequence = 0
    const wait: WaitForStep = (phase, start) => waitForUpload({ client, phase, ...options }, start)

    try {
      for (const item of plan.items) {
        await mkdirp(sftp, item.targetDir, wait)
        for (const dir of item.dirs) {
          await mkdirp(sftp, joinRemote(item.targetDir, dir), wait)
        }

        for (const file of item.files) {
          fileIndex += 1
          const tempPath = joinRemote(
            posix.dirname(file.targetPath),
            '.corral-tmp-' + options.runId + '-' + String(sequence)
          )
          sequence += 1
          tempPaths.add(tempPath)

          let stepBytes = 0
          await fastPut(sftp, file.localPath, tempPath, wait, (transferred) => {
            stepBytes = transferred
            options.onProgress({
              fileIndex,
              fileCount: plan.fileCount,
              fileName: file.rel,
              transferredBytes: Math.min(completedBytes + stepBytes, totalBytes),
              totalBytes
            })
          })

          const remoteStat = await wait('校验上传大小', () => stat(sftp, tempPath))
          if (remoteStat.size !== file.size) {
            throw new AppError('upload', '上传字节数不一致：' + file.rel)
          }

          await assertReplaceTarget(sftp, file.targetPath, wait)
          const backupCopy = tempPath + '.bak'
          let backup: string | undefined
          let phase = '备份'
          let dispatched = false
          try {
            if (item.item.conflict === 'backup') {
              tempPaths.add(backupCopy)
              backup = await wait('远端备份', (signal, activity) => {
                dispatched = true
                return backupFile(
                  client,
                  sftp,
                  file.targetPath,
                  backupCopy,
                  signal,
                  activity,
                  options.idleTimeoutMs
                )
              })
              tempPaths.delete(backupCopy)
              if (backup) backups.push(backup)
            }
            phase = '替换'
            dispatched = false
            await wait('远端替换', (signal) => {
              dispatched = true
              return execScript(
                client,
                'mv -fT -- ' + shellQuote(tempPath) + ' ' + shellQuote(file.targetPath),
                signal
              )
            })
            tempPaths.delete(tempPath)
          } catch (error) {
            const uncertain = dispatched && !(error instanceof RemoteExitError)
            if (uncertain) {
              tempPaths.delete(tempPath)
              tempPaths.delete(backupCopy)
            }
            const detail =
              phase +
              (uncertain ? '结果未知' : '失败') +
              '，目标：' +
              file.targetPath +
              '，临时文件：' +
              tempPath +
              (backup ? '，备份：' + backup : '') +
              (phase === '备份' ? '，备份临时文件：' + backupCopy : '')
            options.onSystem(detail)
            throw new AppError(
              error instanceof AppError ? error.code : 'upload',
              detail + '。' + errorMessage(error)
            )
          }

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
      try {
        sftp.end()
      } catch {
        // The SSH connection may already be closed.
      }
      if (tempPaths.size > 0) {
        try {
          if (error instanceof AppError && error.code === 'network') throw error
          await waitForUpload(
            { client, phase: '清理临时文件', idleTimeoutMs: CLEANUP_TIMEOUT_MS },
            (signal) =>
              execScript(client, 'rm -f -- ' + [...tempPaths].map(shellQuote).join(' '), signal)
          )
        } catch (cleanupError) {
          options.onSystem(
            '临时文件清理未确认：' + [...tempPaths].join('、') + '。' + errorMessage(cleanupError)
          )
        }
      }
      if (error instanceof AppError) throw error
      const message = errorMessage(error)
      if (
        /econnreset|timed out|timeout|channel closed|connection lost|socket hang up/i.test(message)
      ) {
        throw new AppError('network', '上传连接中断：' + message)
      }
      throw new AppError('upload', '上传失败：' + message)
    }
  }
}

function fastPut(
  sftp: SFTPWrapper,
  localPath: string,
  remotePath: string,
  wait: WaitForStep,
  onBytes: (transferred: number) => void
): Promise<void> {
  return wait(
    '文件传输',
    (signal, activity) =>
      new Promise<void>((resolve, reject) => {
        let lastBytes = 0
        let done = false
        sftp.fastPut(
          localPath,
          remotePath,
          {
            mode: 0o644,
            concurrency: 8,
            step: (transferred: number) => {
              if (done || signal.aborted || transferred <= lastBytes) return
              lastBytes = transferred
              activity()
              onBytes(transferred)
            }
          },
          (error) => {
            done = true
            if (error) reject(error)
            else resolve()
          }
        )
      })
  )
}

async function mkdirp(sftp: SFTPWrapper, dir: string, wait: WaitForStep): Promise<void> {
  assertSafeRemotePath(dir)
  if (dir === '/') return
  const parts = dir.split('/').filter(Boolean)
  let current = ''
  for (const part of parts) {
    current += '/' + part
    try {
      const info = await wait('检查远端目录', () => lstat(sftp, current))
      if (info.isSymbolicLink()) {
        throw new AppError('upload', '目标路径包含符号链接：' + current)
      }
      if (!info.isDirectory()) {
        throw new AppError('upload', '目标路径不是目录：' + current)
      }
    } catch (error) {
      if (isNotFound(error)) {
        await wait('创建远端目录', () => mkdir(sftp, current))
        continue
      }
      throw error
    }
  }
}

async function assertReplaceTarget(
  sftp: SFTPWrapper,
  target: string,
  wait: WaitForStep
): Promise<void> {
  try {
    const info = await wait('检查替换目标', () => lstat(sftp, target))
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

async function backupFile(
  client: Client,
  sftp: SFTPWrapper,
  target: string,
  copyPath: string,
  signal: AbortSignal,
  activity: () => void,
  idleTimeoutMs: number
): Promise<string | undefined> {
  const stamp = formatTimestamp()
  const script = [
    'target=' + shellQuote(target),
    'copy=' + shellQuote(copyPath),
    'base="$target.bak-' + stamp + '"',
    '[ -e "$target" ] || [ -L "$target" ] || exit 0',
    '[ -f "$target" ] && [ ! -L "$target" ] || exit 3',
    'b="$base"',
    'i=0',
    'while true; do',
    '  if [ ! -e "$b" ] && [ ! -L "$b" ]; then',
    '    if [ ! -e "$copy" ] && ln -T -- "$target" "$b" 2>/dev/null; then break; fi',
    '    if [ ! -e "$b" ] && [ ! -L "$b" ]; then',
    '      [ -e "$copy" ] || cp -pT -- "$target" "$copy" || exit 3',
    '      if mv -nT -- "$copy" "$b" && [ ! -e "$copy" ]; then break; fi',
    '      [ -e "$copy" ] || exit 3',
    '      [ -e "$b" ] || [ -L "$b" ] || exit 3',
    '    fi',
    '  fi',
    '  i=$((i+1))',
    '  b="$base-$i"',
    'done',
    'printf "CORRAL_BAK:%s\\n" "$b"'
  ].join('\n')

  let checking = false
  let copiedBytes = 0
  const progress = setInterval(
    () => {
      if (checking) return
      checking = true
      void stat(sftp, copyPath)
        .then(
          (info) => {
            if (signal.aborted || info.size <= copiedBytes) return
            copiedBytes = info.size
            activity()
          },
          () => undefined
        )
        .finally(() => {
          checking = false
        })
    },
    Math.max(1, Math.min(1000, idleTimeoutMs / 4))
  )

  try {
    const stdout = await execScript(client, script, signal)
    const backup = stdout.split(/\r?\n/).find((line) => line.startsWith('CORRAL_BAK:'))
    return backup?.slice('CORRAL_BAK:'.length)
  } finally {
    clearInterval(progress)
  }
}

class RemoteExitError extends AppError {
  constructor(code: number, stderr: string) {
    super('upload', '远端命令失败（退出码 ' + String(code) + '）：' + stderr)
  }
}

async function execScript(client: Client, script: string, signal: AbortSignal): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    let channel: ClientChannel | undefined
    let settled = false
    const close = (): void => {
      try {
        channel?.close()
      } catch {
        // The channel may already be closed.
      }
    }
    const done = (complete: () => void): void => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', abort)
      complete()
    }
    const abort = (): void =>
      done(() => {
        reject(signal.reason)
        close()
      })
    signal.addEventListener('abort', abort, { once: true })
    try {
      client.exec('bash -lc ' + shellQuote(script), { pty: false }, (error, stream) => {
        if (signal.aborted) {
          if (!error) {
            channel = stream
            stream.on('error', () => undefined)
            close()
          }
          return
        }
        if (error) {
          done(() => reject(new AppError('upload', '远端命令执行失败：' + error.message)))
          return
        }
        channel = stream
        const out: Buffer[] = []
        const err: Buffer[] = []
        stream.on('data', (data: Buffer) => {
          if (!settled) out.push(data)
        })
        stream.stderr.on('data', (data: Buffer) => {
          if (!settled) err.push(data)
        })
        stream.on('close', (code?: number | null) => {
          done(() => {
            if (typeof code !== 'number') reject(new AppError('network', '远端命令未返回退出状态'))
            else if (code !== 0)
              reject(new RemoteExitError(code, Buffer.concat(err).toString('utf8').trim()))
            else resolve(Buffer.concat(out).toString('utf8'))
          })
        })
        stream.on('error', (streamError: Error) => {
          done(() => {
            reject(new AppError('network', '远端命令中断：' + streamError.message))
            close()
          })
        })
      })
    } catch (error) {
      done(() => reject(error))
    }
  })
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
