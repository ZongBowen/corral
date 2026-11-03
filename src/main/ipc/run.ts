import { dialog } from 'electron'
import { AppError } from '@shared/errors'
import { CH } from '@shared/ipc'
import {
  idSchema,
  runCancelSchema,
  runFilterSchema,
  runIdSchema,
  runPrecheckSchema,
  runReadLogSchema,
  runStartSchema
} from '@shared/schema'
import type { AppContext } from '../context'
import { handle } from './index'

export function registerRunIpc(ctx: AppContext): void {
  handle(ctx, CH.runPrecheck, runPrecheckSchema, async ({ envId, actionId }) => {
    return await ctx.runner.precheck(envId, actionId)
  })

  handle(ctx, CH.runStart, runStartSchema, async ({ envId, actionId, force }) => {
    return await ctx.runner.start(envId, actionId, force ?? false)
  })

  handle(ctx, CH.runCancel, runCancelSchema, async ({ runId }) => {
    await ctx.runner.cancel(runId)
  })

  handle(ctx, CH.runList, runFilterSchema, (filter) => {
    return ctx.runner.list(filter ?? {})
  })

  handle(ctx, CH.runReadLog, runReadLogSchema, async ({ runId, offset, limit }) => {
    return await ctx.logs.readChunk(runId, offset, limit)
  })

  handle(ctx, CH.runExportLog, idSchema, async (runId) => {
    const run = ctx.store.getState().runs.find((item) => item.id === runId)
    if (!run) throw new AppError('config', '执行记录不存在')
    const win = ctx.getWindow()
    if (!win) throw new AppError('internal', '窗口不可用')
    const safeName = (run.envName + '-' + run.actionName).replace(/[\\\\/:*?"<>|]/g, '_')
    const result = await dialog.showSaveDialog(win, {
      defaultPath: safeName + '-' + runId.slice(0, 8) + '.log',
      filters: [{ name: '日志文件', extensions: ['log', 'txt'] }]
    })
    if (result.canceled || !result.filePath) return null
    await ctx.logs.exportTo(runId, result.filePath)
    return { filePath: result.filePath }
  })

  handle(ctx, CH.runRemove, runIdSchema, async ({ runId }) => {
    await ctx.store.mutate((state) => {
      state.runs = state.runs.filter((run) => run.id !== runId)
    })
    await ctx.logs.remove(runId)
    await ctx.store.flush()
  })

  handle(ctx, CH.runClear, runFilterSchema, async (filter) => {
    const runs = ctx.runner.list({ ...(filter ?? {}), offset: 0, limit: undefined })
    const ids = new Set(runs.map((run) => run.id))
    await ctx.store.mutate((state) => {
      state.runs = state.runs.filter((run) => !ids.has(run.id))
    })
    await Promise.all(runs.map((run) => ctx.logs.remove(run.id)))
    await ctx.store.flush()
  })
}
