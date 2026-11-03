import type { ServerSummary } from '@shared/types'
import { AppError } from '@shared/errors'
import { CH } from '@shared/ipc'
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
    const server = ctx.store.getState().servers.find((item) => item.id === id)
    if (!server) throw new AppError('config', '服务器不存在')
    const { password, clearPassword, ...rest } = input
    const now = new Date().toISOString()
    const hostChanged = server.host !== rest.host || server.port !== rest.port

    if (clearPassword) {
      await ctx.vault.remove(id)
    } else if (password) {
      await ctx.vault.setPassword(id, password)
    }

    await ctx.store.mutate((state) => {
      const target = state.servers.find((item) => item.id === id)
      if (!target) return
      Object.assign(target, rest, { tags: rest.tags ?? target.tags, updatedAt: now })
    })
    if (hostChanged) {
      await ctx.knownHosts.remove(server.host, server.port)
    }
    await ctx.store.flush()
    const updated = ctx.store.getState().servers.find((item) => item.id === id)
    return await summarize(ctx, updated!)
  })

  handle(ctx, CH.serverRemove, idSchema, async (id) => {
    const server = ctx.store.getState().servers.find((item) => item.id === id)
    if (!server) throw new AppError('config', '服务器不存在')
    await ctx.store.mutate((state) => {
      state.servers = state.servers.filter((item) => item.id !== id)
      state.envs = state.envs.filter((env) => env.serverId !== id)
    })
    await ctx.vault.remove(id)
    await ctx.knownHosts.remove(server.host, server.port)
    await ctx.store.flush()
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

async function summarize(ctx: AppContext, server: import('@shared/types').Server): Promise<ServerSummary> {
  return {
    ...server,
    hasPassword: ctx.vault.has(server.id),
    credentialBroken: await ctx.vault.isBroken(server.id)
  }
}
