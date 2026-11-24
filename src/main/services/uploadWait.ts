import type { Client } from 'ssh2'
import { AppError } from '@shared/errors'

interface UploadWaitOptions {
  client: Client
  signal?: AbortSignal
  idleTimeoutMs: number
  phase: string
}

export async function waitForUpload<T>(
  { client, signal, idleTimeoutMs, phase }: UploadWaitOptions,
  start: (signal: AbortSignal, activity: () => void) => Promise<T>
): Promise<T> {
  if (signal?.aborted) throw new AppError('canceled', '上传已取消')

  return await new Promise<T>((resolve, reject) => {
    const operation = new AbortController()
    let settled = false
    let timer: NodeJS.Timeout

    const finish = (complete: () => void): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', cancel)
      client.off('end', disconnect).off('close', disconnect).off('error', disconnect)
      complete()
    }
    const stop = (error: AppError): void =>
      finish(() => {
        reject(error)
        operation.abort(error)
      })
    const cancel = (): void => stop(new AppError('canceled', '上传已取消'))
    const disconnect = (): void => stop(new AppError('network', phase + '期间 SSH 连接中断'))
    const activity = (): void => {
      if (settled) return
      clearTimeout(timer)
      timer = setTimeout(
        () => stop(new AppError('timeout', phase + '空闲超时（' + idleTimeoutMs / 1000 + 's）')),
        idleTimeoutMs
      )
    }

    signal?.addEventListener('abort', cancel, { once: true })
    client.on('end', disconnect).on('close', disconnect).on('error', disconnect)
    activity()
    void (async () => {
      try {
        const result = await start(operation.signal, activity)
        finish(() => resolve(result))
      } catch (error) {
        finish(() => reject(error))
      }
    })()
  })
}
