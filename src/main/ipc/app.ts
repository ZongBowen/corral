import { app, clipboard, dialog, shell } from 'electron'
import { AppError } from '@shared/errors'
import { CH } from '@shared/ipc'
import type { AppContext } from '../context'
import { handle } from './index'
import { writeFileAtomic } from '../utils/atomicFile'

export function registerAppIpc(ctx: AppContext): void {
  handle(ctx, CH.appGetBootState, null, async () => {
    return {
      dataDir: ctx.dataDir,
      servers: await Promise.all(
        ctx.store.getState().servers.map(async (server) => ({
          ...server,
          hasPassword: ctx.vault.has(server.id),
          credentialBroken: await ctx.vault.isBroken(server.id)
        }))
      ),
      envs: ctx.store.getState().envs,
      settings: ctx.store.getSettings(),
      activeRunIds: ctx.runner.getActiveRunIds()
    }
  })

  handle(ctx, CH.appOpenDataDir, null, async () => {
    const error = await shell.openPath(ctx.dataDir)
    if (error) throw new AppError('internal', error)
  })

  handle(ctx, CH.appCopyText, null, (text: string) => {
    if (typeof text !== 'string') throw new AppError('config', '复制内容无效')
    clipboard.writeText(text)
  })

  handle(ctx, CH.appExportConfig, null, async () => {
    const win = ctx.getWindow()
    if (!win) throw new AppError('internal', '窗口不可用')
    const stamp = new Date().toISOString().slice(0, 10)
    const result = await dialog.showSaveDialog(win, {
      defaultPath: 'corral-config-' + stamp + '.json',
      filters: [{ name: '配置文件', extensions: ['json'] }]
    })
    if (result.canceled || !result.filePath) return null
    const config = ctx.store.exportConfig(app.getVersion())
    await writeFileAtomic(result.filePath, JSON.stringify(config, null, 2))
    return { filePath: result.filePath }
  })
}
