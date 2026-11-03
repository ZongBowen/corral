import type { PathCheck } from '@shared/types'
import { AppError } from '@shared/errors'
import { CH } from '@shared/ipc'
import { newId } from '@shared/id'
import { buildPathCheckScript, parsePathCheckOutput, shellQuote } from '@shared/command'
import { devEnvInputSchema, envUpdatePayloadSchema, envValidatePayloadSchema, idSchema } from '@shared/schema'
import type { AppContext } from '../context'
import { handle } from './index'

export function registerEnvIpc(ctx: AppContext): void {
  handle(ctx, CH.envList, null, (serverId?: string) => {
    const envs = ctx.store.getState().envs
    return serverId ? envs.filter((env) => env.serverId === serverId) : envs
  })

  handle(ctx, CH.envCreate, devEnvInputSchema, async (input) => {
    const server = ctx.store.getState().servers.find((item) => item.id === input.serverId)
    if (!server) throw new AppError('config', '所属服务器不存在')
    const now = new Date().toISOString()
    const env = { ...input, id: newId(), createdAt: now, updatedAt: now }
    await ctx.store.mutate((state) => {
      state.envs.push(env)
    })
    await ctx.store.flush()
    return env
  })

  handle(ctx, CH.envUpdate, envUpdatePayloadSchema, async ({ id, input }) => {
    const existing = ctx.store.getState().envs.find((item) => item.id === id)
    if (!existing) throw new AppError('config', '环境不存在')
    await ctx.store.mutate((state) => {
      const target = state.envs.find((item) => item.id === id)
      if (!target) return
      Object.assign(target, input, { updatedAt: new Date().toISOString() })
    })
    await ctx.store.flush()
    return ctx.store.getState().envs.find((item) => item.id === id)!
  })

  handle(ctx, CH.envRemove, idSchema, async (id) => {
    const existing = ctx.store.getState().envs.find((item) => item.id === id)
    if (!existing) throw new AppError('config', '环境不存在')
    await ctx.store.mutate((state) => {
      state.envs = state.envs.filter((env) => env.id !== id)
    })
    await ctx.store.flush()
  })

  handle(ctx, CH.envValidatePaths, envValidatePayloadSchema, async ({ envId }) => {
    const env = ctx.store.getState().envs.find((item) => item.id === envId)
    if (!env) throw new AppError('config', '环境不存在')
    const server = ctx.store.getState().servers.find((item) => item.id === env.serverId)
    if (!server) throw new AppError('config', '所属服务器不存在')
    const password = await ctx.vault.getPassword(server.id)
    if (!password) throw new AppError('auth', '密码不可用，请重新输入密码')

    const settings = ctx.store.getSettings()
    const client = await ctx.ssh.connect({
      host: server.host,
      port: server.port,
      username: server.username,
      password,
      legacyAlgorithms: settings.legacySshAlgorithms,
      readyTimeoutMs: 8_000
    })
    try {
      const script = buildPathCheckScript(env.paths.map((entry) => ({ key: entry.key, path: entry.path })))
      const result = await ctx.ssh.execCapture(client, 'bash -lc ' + shellQuote(script), {
        timeoutMs: 10_000,
        encoding: settings.outputEncoding
      })
      const checks = parsePathCheckOutput(result.stdout)
      const checkedAt = new Date().toISOString()
      return env.paths.map<PathCheck>((entry) => {
        const check = checks.find((item) => item.key === entry.key)
        return {
          key: entry.key,
          label: entry.label,
          path: entry.path,
          status: check ? check.status : 'unknown',
          checkedAt,
          error: check ? undefined : '未获取到校验结果'
        }
      })
    } finally {
      try {
        client.end()
      } catch {
        // ignore
      }
    }
  })
}
