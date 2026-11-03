import { CH } from '@shared/ipc'
import { settingsUpdateSchema } from '@shared/schema'
import type { AppContext } from '../context'
import { handle } from './index'

export function registerSettingsIpc(ctx: AppContext): void {
  handle(ctx, CH.settingsGet, null, () => ctx.store.getSettings())

  handle(ctx, CH.settingsUpdate, settingsUpdateSchema, async (patch) => {
    const settings = await ctx.store.updateSettings(patch)
    await ctx.store.flush()
    return settings
  })
}
