import { BrowserWindow, ipcMain } from 'electron'
import { ZodError, type ZodType } from 'zod'
import { AppError, trimError } from '@shared/errors'
import type { AppContext } from '../context'
import { registerServerIpc } from './server'
import { registerEnvIpc } from './env'
import { registerRunIpc } from './run'
import { registerSettingsIpc } from './settings'
import { registerAppIpc } from './app'
import { registerHostKeyIpc } from './hostkey'
import { registerDialogIpc } from './dialog'

export type IpcHandler<T> = (payload: T) => Promise<unknown> | unknown

export function registerIpc(ctx: AppContext): void {
  registerServerIpc(ctx)
  registerEnvIpc(ctx)
  registerRunIpc(ctx)
  registerSettingsIpc(ctx)
  registerAppIpc(ctx)
  registerHostKeyIpc(ctx)
  registerDialogIpc(ctx)
}

export function handle<T>(
  ctx: AppContext,
  channel: string,
  schema: ZodType<T> | null,
  fn: (payload: T) => Promise<unknown> | unknown
): void {
  ipcMain.handle(channel, async (event, rawPayload: unknown) => {
    try {
      const win = BrowserWindow.fromWebContents(event.sender)
      if (!win || ctx.getWindow()?.webContents.id !== event.sender.id) {
        throw new AppError('internal', '非法调用来源')
      }
      let payload: T
      if (schema) {
        try {
          payload = schema.parse(rawPayload)
        } catch (error) {
          if (error instanceof ZodError) {
            throw new AppError('config', error.issues[0]?.message ?? '参数校验失败')
          }
          throw error
        }
      } else {
        payload = rawPayload as T
      }
      const data = await fn(payload)
      return { ok: true, data }
    } catch (error) {
      return { ok: false, error: trimError(error) }
    }
  })
}
