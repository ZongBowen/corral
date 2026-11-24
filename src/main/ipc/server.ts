import type { Server, ServerSummary } from '@shared/types'
import { AppError } from '@shared/errors'
import { CH } from '@shared/ipc'
import { serverPathCheckTargetChanged } from '@shared/pathCheck'
import { newId } from '@shared/id'
import {
  idSchema,
  serverInputSchema,
  serverTestPayloadSchema,
  serverUpdatePayloadSchema
} from '@shared/schema'
import type { AppContext } from '../context'
import { handle } from './index'

export function registerServerIpc(ctx: AppContext): void {
  handle(ctx, CH.serverList, null, async () => {
    return await Promise.all(ctx.store.getState().servers.map((server) => summarize(ctx, server)))
  })

  handle(ctx, CH.serverCreate, serverInputSchema, async (input) => {
    const { password, ...rest } = input
    if (!password) throw new AppError('config', '密码不能为空')
    if (!ctx.vault.isAvailable()) {
      throw new AppError('config', '当前系统不支持安全存储，无法保存密码')
    }
    const now = new Date().toISOString()
    const server = {
      ...rest,
      id: newId(),
      tags: rest.tags ?? [],
      createdAt: now,
      updatedAt: now
    }
    await ctx.store.mutate((state) => {
      state.servers.push(server)
    })
    await ctx.vault.setPassword(server.id, password)
    await ctx.store.flush()
    return await summarize(ctx, server)
  })

  handle(ctx, CH.serverUpdate, serverUpdatePayloadSchema, async ({ id, input }) => {
    if (!ctx.store.getState().servers.some((item) => item.id === id)) {
      throw new AppError('config', '服务器不存在')
    }
    const { password, clearPassword, ...rest } = input
    const now = new Date().toISOString()

    if (clearPassword) {
      await ctx.vault.remove(id)
    } else if (password) {
      await ctx.vault.setPassword(id, password)
    }

    const target = ctx.store.getState().servers.find((item) => item.id === id)
    if (!target) throw new AppError('config', '服务器不存在')
    const oldEndpoint = { host: target.host, port: target.port }
    const hostChanged = oldEndpoint.host !== rest.host || oldEndpoint.port !== rest.port
    const pathCheckTargetChanged = serverPathCheckTargetChanged(target, rest)
    await ctx.store.mutate((state) => {
      Object.assign(target, rest, { tags: rest.tags ?? target.tags, updatedAt: now })
      if (pathCheckTargetChanged) {
        for (const env of state.envs) {
          if (env.serverId === id) delete state.pathChecks[env.id]
        }
      }
    })
    await ctx.store.flush()
    if (hostChanged) await removeUnreferencedHostKey(ctx, oldEndpoint)
    return await summarize(ctx, target)
  })

  handle(ctx, CH.serverRemove, idSchema, async (id) => {
    const server = ctx.store.getState().servers.find((item) => item.id === id)
    if (!server) throw new AppError('config', '服务器不存在')
    const oldEndpoint = { host: server.host, port: server.port }
    await ctx.store.mutate((state) => {
      state.servers = state.servers.filter((item) => item.id !== id)
      for (const env of state.envs) {
        if (env.serverId === id) delete state.pathChecks[env.id]
      }
      state.envs = state.envs.filter((env) => env.serverId !== id)
    })
    await ctx.vault.remove(id)
    await ctx.store.flush()
    await removeUnreferencedHostKey(ctx, oldEndpoint)
  })

  handle(ctx, CH.serverTest, serverTestPayloadSchema, async (payload) => {
    let server
    let password: string | null = null
    if (payload.id) {
      server = ctx.store.getState().servers.find((item) => item.id === payload.id)
      if (!server) throw new AppError('config', '服务器不存在')
      password = await ctx.vault.getPassword(server.id)
      if (!password) throw new AppError('auth', '密码不可用，请重新输入密码')
    } else if (payload.input) {
      const now = new Date().toISOString()
      server = {
        ...payload.input,
        id: 'temp',
        tags: payload.input.tags ?? [],
        createdAt: now,
        updatedAt: now
      }
      password = payload.input.password ?? null
      if (!password) throw new AppError('auth', '请输入密码')
    } else {
      throw new AppError('config', '缺少服务器信息')
    }

    const result = await ctx.ssh.testConnection(server, password)
    if (result.ok) {
      await ctx.store.mutate((state) => {
        const target = state.servers.find((item) => item.id === server.id)
        if (target) target.lastConnectedAt = new Date().toISOString()
      })
    }
    return result
  })

  handle(ctx, CH.serverTrustHostKey, null, async (payload: { host?: string; port?: number }) => {
    if (!payload || typeof payload.host !== 'string' || typeof payload.port !== 'number') {
      throw new AppError('config', '缺少主机信息')
    }
    await ctx.ssh.trustLastSeen(payload.host, payload.port)
  })
}

async function removeUnreferencedHostKey(
  ctx: AppContext,
  { host, port }: Pick<Server, 'host' | 'port'>
): Promise<void> {
  if (ctx.store.getState().servers.some((server) => server.host === host && server.port === port))
    return
  await ctx.knownHosts.remove(host, port)
}

async function summarize(ctx: AppContext, server: Server): Promise<ServerSummary> {
  return {
    ...server,
    hasPassword: ctx.vault.has(server.id),
    credentialBroken: await ctx.vault.isBroken(server.id)
  }
}
