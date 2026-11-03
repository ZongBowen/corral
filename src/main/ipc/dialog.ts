import { dialog } from 'electron'
import { AppError } from '@shared/errors'
import { CH } from '@shared/ipc'
import { dialogPickFilesSchema } from '@shared/schema'
import type { AppContext } from '../context'
import { handle } from './index'

export function registerDialogIpc(ctx: AppContext): void {
  handle(ctx, CH.dialogPickFiles, dialogPickFilesSchema, async (options) => {
    const win = ctx.getWindow()
    if (!win) throw new AppError('internal', '窗口不可用')
    const result = await dialog.showOpenDialog(win, {
      properties: options?.multiple ? ['openFile', 'multiSelections'] : ['openFile']
    })
    return result.canceled ? [] : result.filePaths
  })

  handle(ctx, CH.dialogPickDirectory, null, async () => {
    const win = ctx.getWindow()
    if (!win) throw new AppError('internal', '窗口不可用')
    const result = await dialog.showOpenDialog(win, { properties: ['openDirectory'] })
    return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0]
  })
}
