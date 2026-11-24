import { basename } from 'node:path'
import type { Client, ClientChannel, SFTPWrapper } from 'ssh2'
import { AppError, describeExitCode } from '@shared/errors'
import { EV } from '@shared/ipc'
import {
  buildExecScript,
  assertTargetDir,
  buildPathCheckScript,
  extractVariables,
  joinRemote,
  parsePathCheckOutput,
  resolveCommandVariables,
  resolveVariables,
  shellQuote
} from '@shared/command'
import { newId } from '@shared/id'
import type {
  DevEnv,
  EnvAction,
  ManualUploadFile,
  Run,
  RunFilter,
  RunPrecheck,
  RunPrecheckItem,
  RunStatus,
  RunUploadMode,
  Server,
  Settings,
  UploadItem
} from '@shared/types'
import { isTerminal } from '@shared/types'
import type { StoreService } from './store'
import type { VaultService } from './vault'
import type { SshConnectOptions, SshService } from './ssh'
import type { LogStore, LogWriter } from './logStore'
import { buildUploadPlan, type UploadPlan } from './uploadPlan'
import { OutputBatcher } from './batcher'
import { createTextDecoder, type TextDecoderLike } from './textDecoder'
import { Uploader } from './upload'

const MAX_CONCURRENT = 4

const ALLOWED: Record<RunStatus, RunStatus[]> = {
  queued: ['connecting', 'canceled'],
  connecting: ['validating', 'uploading', 'running', 'failed', 'canceled', 'disconnected'],
  validating: ['uploading', 'running', 'failed', 'canceled', 'disconnected'],
  uploading: ['running', 'failed', 'timeout', 'canceled', 'disconnected'],
  running: ['success', 'failed', 'timeout', 'canceled', 'disconnected'],
  success: [],
  failed: [],
  timeout: [],
  canceled: [],
  disconnected: []
}

export interface RunnerDeps {
  store: StoreService
  vault: Pick<VaultService, 'getPassword'>
  ssh: SshService
  logs: LogStore
  settings: () => Settings
  emit: (channel: string, payload: unknown) => void
  now?: () => number
}

interface QueueEntry {
  runId: string
  envId: string
}

interface ActiveRun {
  run: Run
  env: DevEnv
  action: EnvAction
  uploadPlan: UploadPlan
  uploadVariables: Record<string, string>
  executionCommand: string
  server: Server
  password: string | null
  force: boolean
  abort: AbortController
  client: Client | null
  stream: ClientChannel | null
  sftp: SFTPWrapper | null
  pid: number | null
  writer: LogWriter | null
  batcher: OutputBatcher | null
  timers: Set<NodeJS.Timeout>
  startedAtMs: number
  cancelRequested: boolean
  timedOut: boolean
}

export class RunManager {
  private active = new Map<string, ActiveRun>()
  private envLocks = new Set<string>()
  private queue: QueueEntry[] = []
  private runningCount = 0

  constructor(private readonly deps: RunnerDeps) {}

  private now(): number {
    return this.deps.now ? this.deps.now() : Date.now()
  }

  async precheck(
    envId: string,
    actionId: string,
    uploads: UploadItem[] = [],
    uploadMode: RunUploadMode = 'upload',
    manualUploadFiles: ManualUploadFile[] = []
  ): Promise<RunPrecheck> {
    const env = this.findEnv(envId)
    const action = this.findAction(env, actionId)
    const vars = buildVars(env)
    this.validateUploads(action, uploads, uploadMode, manualUploadFiles)
    const plan = await buildUploadPlan(uploads, vars)
    const uploadVariables =
      uploadMode === 'skip'
        ? buildManualUploadVariables(action, vars, manualUploadFiles)
        : buildUploadVariables(action, plan)
    const resolved = resolveCommandVariables(action.command, vars, uploadVariables)
    if (resolved.missing.length > 0) {
      throw new AppError('config', '命令引用了未定义的变量：' + resolved.missing.join(', '))
    }
    const items: RunPrecheckItem[] = plan.items.map((item) => ({
      localPath: item.item.localPath,
      kind: item.item.kind,
      targetPath:
        item.item.kind === 'file' ? (item.files[0]?.targetPath ?? item.targetDir) : item.targetDir,
      exists: !plan.missing.includes(item.item.localPath),
      bytes: item.totalBytes,
      fileCount: item.files.length
    }))
    return {
      resolvedCommand: resolved.preview,
      uploadVariables,
      items,
      totalBytes: plan.totalBytes,
      fileCount: plan.fileCount,
      missing: plan.missing,
      warnings: plan.warnings
    }
  }

  async start(
    envId: string,
    actionId: string,
    uploads: UploadItem[] = [],
    force = false,
    uploadMode: RunUploadMode = 'upload',
    manualUploadFiles: ManualUploadFile[] = []
  ): Promise<{ runId: string }> {
    if (this.envLocks.has(envId)) {
      throw new AppError('config', '该环境已有执行中的任务')
    }
    const env = this.findEnv(envId)
    const action = this.findAction(env, actionId)
    const server = this.findServer(env.serverId)
    const vars = buildVars(env)
    this.validateUploads(action, uploads, uploadMode, manualUploadFiles)
    const uploadSnapshot = uploads.map((item) => ({ ...item }))
    const manualUploadSnapshot = manualUploadFiles.map((item) => ({ ...item }))
    const uploadPlan = await buildUploadPlan(uploadSnapshot, vars)
    if (uploadPlan.missing.length > 0) {
      throw new AppError('upload', '本地文件不存在：' + uploadPlan.missing.join('、'))
    }
    const uploadVariables =
      uploadMode === 'skip'
        ? buildManualUploadVariables(action, vars, manualUploadFiles)
        : buildUploadVariables(action, uploadPlan)
    const resolved = resolveCommandVariables(action.command, vars, uploadVariables)
    if (resolved.missing.length > 0) {
      throw new AppError('config', '命令引用了未定义的变量：' + resolved.missing.join(', '))
    }

    const run: Run = {
      id: newId(),
      envId: env.id,
      envName: env.name,
      serverId: server.id,
      serverName: server.name,
      actionId: action.id,
      actionName: action.name,
      command: action.command,
      resolvedCommand: resolved.preview,
      uploadMode,
      manualUploadFiles: manualUploadSnapshot,
      uploadVariables,
      uploads: uploadSnapshot,
      status: 'queued',
      startedAt: new Date(this.now()).toISOString()
    }

    const ctx: ActiveRun = {
      run,
      env,
      action,
      uploadPlan,
      uploadVariables,
      executionCommand: resolved.command,
      server,
      password: await this.deps.vault.getPassword(server.id),
      force,
      abort: new AbortController(),
      client: null,
      stream: null,
      sftp: null,
      pid: null,
      writer: this.deps.logs.open(run.id),
      batcher: null,
      timers: new Set(),
      startedAtMs: this.now(),
      cancelRequested: false,
      timedOut: false
    }

    this.envLocks.add(envId)
    this.active.set(run.id, ctx)
    await this.deps.store.mutate((state) => {
      state.runs.push(run)
    })
    await this.deps.store.flush()

    this.queue.push({ runId: run.id, envId })
    this.pump()
    return { runId: run.id }
  }

  async cancel(runId: string): Promise<void> {
    const ctx = this.active.get(runId)
    if (!ctx) return
    if (isTerminal(ctx.run.status)) return

    if (ctx.run.status === 'queued') {
      this.queue = this.queue.filter((entry) => entry.runId !== runId)
      this.setStatus(ctx, 'canceled')
      await this.finalize(ctx)
      return
    }

    ctx.cancelRequested = true
    ctx.abort.abort()
    if (ctx.stream) {
      await this.terminate(ctx)
      return
    }
    if (ctx.sftp) {
      try {
        ctx.sftp.end()
      } catch {
        // ignore
      }
      return
    }
    if (ctx.client) {
      try {
        ctx.client.end()
      } catch {
        // ignore
      }
    }
  }

  async cancelAll(): Promise<void> {
    const ids = [...this.active.keys()]
    await Promise.allSettled(ids.map((id) => this.cancel(id)))
    this.queue = []
  }

  getActiveRunIds(): string[] {
    return [...this.active.values()]
      .filter((ctx) => !isTerminal(ctx.run.status))
      .map((ctx) => ctx.run.id)
  }

  list(filter: RunFilter = {}): Run[] {
    const runs = this.deps.store.getState().runs
    const from = filter.from ? new Date(filter.from).getTime() : null
    const to = filter.to ? new Date(filter.to).getTime() : null
    const keyword = filter.keyword?.trim().toLowerCase()

    const result = runs
      .filter((run) => {
        if (filter.envId && run.envId !== filter.envId) return false
        if (filter.serverId && run.serverId !== filter.serverId) return false
        if (filter.status && run.status !== filter.status) return false
        const started = new Date(run.startedAt).getTime()
        if (from !== null && started < from) return false
        if (to !== null && started > to) return false
        if (
          keyword &&
          !run.actionName.toLowerCase().includes(keyword) &&
          !run.envName.toLowerCase().includes(keyword)
        ) {
          return false
        }
        return true
      })
      .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())

    const offset = filter.offset ?? 0
    const limit = filter.limit ?? result.length
    return result.slice(offset, offset + limit)
  }

  isEnvRunning(envId: string): boolean {
    return this.envLocks.has(envId)
  }

  private pump(): void {
    while (this.runningCount < MAX_CONCURRENT) {
      const entry = this.queue.shift()
      if (!entry) return
      const ctx = this.active.get(entry.runId)
      if (!ctx || ctx.run.status !== 'queued') continue
      this.runningCount += 1
      void this.execute(ctx).finally(() => {
        this.runningCount -= 1
        this.pump()
      })
    }
  }

  private async execute(ctx: ActiveRun): Promise<void> {
    let finished = false
    ctx.batcher = new OutputBatcher((stream, data) => {
      const kind = stream === 'stdout' ? 'out' : stream === 'stderr' ? 'err' : 'sys'
      ctx.writer?.append({ t: Math.max(0, this.now() - ctx.startedAtMs), s: kind, d: data })
      this.deps.emit(EV.runOutput, { runId: ctx.run.id, stream, data })
    })
    try {
      this.setStatus(ctx, 'connecting')
      if (ctx.abort.signal.aborted) throw new AppError('canceled', '已取消')
      if (!ctx.password) {
        throw new AppError('auth', '密码不可用，请重新输入密码')
      }

      const settings = this.deps.settings()
      const client = await this.deps.ssh.connect(this.buildConnectOptions(ctx, settings))
      ctx.client = client
      if (ctx.abort.signal.aborted) throw new AppError('canceled', '已取消')

      if (settings.validatePathsBeforeRun && !ctx.force) {
        this.setStatus(ctx, 'validating')
        await this.validatePaths(ctx, settings)
      }
      if (ctx.abort.signal.aborted) throw new AppError('canceled', '已取消')

      if (ctx.uploadPlan.items.length > 0) {
        this.setStatus(ctx, 'uploading')
        await this.upload(ctx, settings)
      } else if (ctx.run.uploadMode === 'skip' && ctx.action.uploadRules.length > 0) {
        this.system(
          ctx,
          ctx.run.manualUploadFiles?.length
            ? '本次跳过执行前上传，使用手工指定的远程文件名'
            : '本次跳过执行前上传'
        )
      }
      if (ctx.abort.signal.aborted) throw new AppError('canceled', '已取消')

      this.setStatus(ctx, 'running')
      await this.runCommand(ctx, settings)
      finished = true
    } catch (error) {
      finished = true
      this.handleFailure(ctx, error)
    } finally {
      if (!finished) {
        this.handleFailure(ctx, new AppError('unknown', '执行意外结束'))
      }
      await this.finalize(ctx)
    }
  }

  private async validatePaths(ctx: ActiveRun, settings: Settings): Promise<void> {
    if (!ctx.client) return
    const entries = ctx.env.paths.map((entry) => ({ key: entry.key, path: entry.path }))
    const script = buildPathCheckScript(entries)
    const result = await this.deps.ssh.execCapture(ctx.client, 'bash -lc ' + shellQuote(script), {
      timeoutMs: 15_000,
      encoding: settings.outputEncoding
    })
    const checks = parsePathCheckOutput(result.stdout)
    const bad = entries
      .map((entry) => checks.find((item) => item.key === entry.key))
      .filter((item): item is NonNullable<typeof item> => Boolean(item))
      .filter((item) => item.status !== 'ok')
    const missingResults = entries.filter((entry) => !checks.some((item) => item.key === entry.key))
    for (const entry of missingResults) {
      bad.push({ key: entry.key, path: entry.path, status: 'missing' })
    }
    if (bad.length > 0) {
      const detail = bad
        .map((item) => item.path + (item.status === 'missing' ? ' 不存在' : ' 只读'))
        .join('；')
      throw new AppError('config', '目录校验失败：' + detail)
    }
    this.system(ctx, '目录校验通过')
  }

  private async upload(ctx: ActiveRun, settings: Settings): Promise<void> {
    if (!ctx.client) throw new AppError('upload', '连接已关闭')
    const plan = ctx.uploadPlan
    const sftp = await this.deps.ssh.openSftp(ctx.client)
    ctx.sftp = sftp
    const uploader = new Uploader()
    let lastProgressAt = 0
    const stats = await uploader.run(ctx.client, sftp, plan, {
      runId: ctx.run.id,
      signal: ctx.abort.signal,
      idleTimeoutMs: settings.uploadIdleTimeoutSec * 1000,
      onProgress: (progress) => {
        const now = this.now()
        if (progress.transferredBytes < progress.totalBytes && now - lastProgressAt < 100) return
        lastProgressAt = now
        this.deps.emit(EV.runProgress, {
          runId: ctx.run.id,
          phase: 'upload',
          ...progress
        })
      },
      onSystem: (text) => this.system(ctx, text)
    })
    ctx.run.uploadStats = stats
    try {
      sftp.end()
    } catch {
      // ignore
    }
    ctx.sftp = null
  }

  private async runCommand(ctx: ActiveRun, settings: Settings): Promise<void> {
    if (!ctx.client) throw new AppError('network', '连接已关闭')
    this.system(ctx, '开始执行：' + ctx.action.name)
    const stream = await this.deps.ssh.execStream(
      ctx.client,
      buildExecScript(ctx.executionCommand, ctx.uploadVariables)
    )
    ctx.stream = stream
    if (ctx.abort.signal.aborted) {
      void this.terminate(ctx)
    }

    const stdoutDecoder = createTextDecoder(settings.outputEncoding)
    const stderrDecoder = createTextDecoder(settings.outputEncoding)
    const pidParser = new PidMarkerParser()

    await new Promise<void>((resolve) => {
      let settled = false
      let exitCode: number | null = null

      const finish = (): void => {
        if (settled) return
        settled = true
        if (ctx.batcher) {
          const outTail = stdoutDecoder.end()
          const errTail = stderrDecoder.end()
          const pidTail = pidParser.flush()
          if (outTail) ctx.batcher.push('stdout', outTail)
          if (errTail) ctx.batcher.push('stderr', errTail)
          if (pidTail) ctx.batcher.push('stderr', pidTail)
          ctx.batcher.flush()
        }
        if (ctx.timedOut) {
          ctx.run.exitCode = exitCode ?? undefined
          this.setStatus(ctx, 'timeout', { errorKind: 'remote', errorMessage: '命令执行超时' })
        } else if (ctx.cancelRequested || ctx.abort.signal.aborted) {
          this.setStatus(ctx, 'canceled', { errorMessage: '已取消' })
        } else if (exitCode === null) {
          this.setStatus(ctx, 'disconnected', { errorKind: 'network', errorMessage: '连接中断' })
        } else if (exitCode === 0) {
          this.setStatus(ctx, 'success', { exitCode })
        } else {
          this.setStatus(ctx, 'failed', {
            exitCode,
            errorKind: 'remote',
            errorMessage: describeExitCode(exitCode)
          })
        }
        resolve()
      }

      stream.on('data', (data: Buffer) => {
        const text = stdoutDecoder.write(data)
        if (text) ctx.batcher?.push('stdout', text)
      })
      stream.stderr.on('data', (data: Buffer) => {
        let text = stderrDecoder.write(data)
        text = pidParser.push(text)
        if (pidParser.pid && ctx.pid === null) {
          ctx.pid = pidParser.pid
          ctx.run.remotePid = pidParser.pid
        }
        if (text) ctx.batcher?.push('stderr', text)
      })
      stream.on('close', (code: number | null) => {
        exitCode = typeof code === 'number' ? code : null
        finish()
      })
      stream.on('error', () => {
        if (ctx.timedOut) return
        ctx.cancelRequested = false
        exitCode = null
        finish()
      })

      const timeoutSec = ctx.action.timeoutSec
      if (timeoutSec > 0) {
        const timer = setTimeout(() => {
          if (settled) return
          ctx.timedOut = true
          this.system(ctx, '命令执行超时（' + String(timeoutSec) + 's），正在终止')
          void this.terminate(ctx)
        }, timeoutSec * 1000)
        ctx.timers.add(timer)
      }
    })
  }

  private async terminate(ctx: ActiveRun): Promise<void> {
    const settings = this.deps.settings()
    if (ctx.pid && ctx.password) {
      try {
        await this.deps.ssh.killRemoteProcess(this.buildConnectOptions(ctx, settings), ctx.pid)
      } catch {
        // best effort
      }
    }
    try {
      ctx.stream?.close()
    } catch {
      // ignore
    }
  }

  private handleFailure(ctx: ActiveRun, error: unknown): void {
    if (isTerminal(ctx.run.status)) return
    if (ctx.cancelRequested || ctx.abort.signal.aborted) {
      this.setStatus(ctx, 'canceled', { errorMessage: '已取消' })
      return
    }
    if (error instanceof AppError && error.code === 'timeout') {
      this.setStatus(ctx, 'timeout', { errorMessage: error.message })
      return
    }
    if (error instanceof AppError && error.code === 'network' && ctx.run.status === 'uploading') {
      this.system(ctx, '上传连接中断')
      this.setStatus(ctx, 'disconnected', { errorKind: 'network', errorMessage: error.message })
      return
    }
    const appError =
      error instanceof AppError
        ? error
        : new AppError('unknown', error instanceof Error ? error.message : String(error))
    this.system(ctx, '执行失败：' + appError.message)
    const kind =
      appError.code === 'canceled' || appError.code === 'timeout' ? 'unknown' : appError.code
    this.setStatus(ctx, 'failed', {
      errorKind: kind === 'internal' ? 'unknown' : (kind as Run['errorKind']),
      errorMessage: appError.message
    })
  }

  private setStatus(
    ctx: ActiveRun,
    status: RunStatus,
    extra: { exitCode?: number; errorKind?: Run['errorKind']; errorMessage?: string } = {}
  ): void {
    const current = ctx.run.status
    if (current === status) return
    if (!ALLOWED[current].includes(status)) {
      if (!isTerminal(current)) {
        return
      }
      return
    }
    ctx.run.status = status
    if (extra.exitCode !== undefined) ctx.run.exitCode = extra.exitCode
    if (extra.errorKind) ctx.run.errorKind = extra.errorKind
    if (extra.errorMessage) ctx.run.errorMessage = extra.errorMessage
    if (isTerminal(status)) {
      const ended = this.now()
      ctx.run.endedAt = new Date(ended).toISOString()
      ctx.run.durationMs = Math.max(0, ended - ctx.startedAtMs)
    }
    this.deps.emit(EV.runStatus, {
      runId: ctx.run.id,
      status,
      errorKind: ctx.run.errorKind,
      errorMessage: ctx.run.errorMessage,
      exitCode: ctx.run.exitCode,
      durationMs: ctx.run.durationMs
    })
    void this.deps.store.mutate(() => undefined)
  }

  private async finalize(ctx: ActiveRun): Promise<void> {
    for (const timer of ctx.timers) clearTimeout(timer)
    ctx.timers.clear()
    ctx.batcher?.dispose()
    if (ctx.writer) {
      ctx.run.logBytes = ctx.writer.bytes()
      await ctx.writer.close()
    }
    if (ctx.sftp) {
      try {
        ctx.sftp.end()
      } catch {
        // ignore
      }
      ctx.sftp = null
    }
    if (ctx.client) {
      try {
        ctx.client.end()
      } catch {
        // ignore
      }
      ctx.client = null
    }
    ctx.stream = null
    this.envLocks.delete(ctx.env.id)
    this.active.delete(ctx.run.id)
    await this.deps.store.flush()
    this.deps.emit(EV.runDone, ctx.run)
  }

  private system(ctx: ActiveRun, text: string): void {
    ctx.batcher?.push('system', '\n[corral] ' + text + '\n')
  }

  private buildConnectOptions(ctx: ActiveRun, settings: Settings): SshConnectOptions {
    return {
      host: ctx.server.host,
      port: ctx.server.port,
      username: ctx.server.username,
      password: ctx.password ?? '',
      legacyAlgorithms: settings.legacySshAlgorithms
    }
  }

  private validateUploads(
    action: EnvAction,
    uploads: UploadItem[],
    uploadMode: RunUploadMode,
    manualUploadFiles: ManualUploadFile[]
  ): void {
    if (uploadMode === 'skip') {
      if (action.uploadRules.length === 0) throw new AppError('config', '该操作未配置执行前上传')
      if (uploads.length > 0) throw new AppError('config', '跳过上传时不能包含上传项')

      const manualRuleIds = new Set<string>()
      for (const manual of manualUploadFiles) {
        const rule = action.uploadRules.find((item) => item.id === manual.ruleId)
        if (!rule?.variableKey) throw new AppError('config', '手工文件项未关联有效的命令变量规则')
        if (manualRuleIds.has(rule.id))
          throw new AppError('config', '同一上传规则不能重复录入文件名')
        assertManualUploadFileName(manual.fileName)
        manualRuleIds.add(rule.id)
      }

      const commandVariables = extractVariables(action.command)
      const missing = action.uploadRules.filter((rule) => {
        if (!rule.variableKey || manualRuleIds.has(rule.id)) return false
        return (
          commandVariables.includes(rule.variableKey + 'Name') ||
          commandVariables.includes(rule.variableKey + 'Path')
        )
      })
      if (missing.length > 0) {
        const names = missing
          .flatMap((rule) => [rule.variableKey + 'Name', rule.variableKey + 'Path'])
          .map((key) => '${' + key + '}')
          .join('、')
        throw new AppError('config', '跳过上传无法确定 ' + names + '，请录入已上传文件名')
      }
      return
    }

    if (manualUploadFiles.length > 0) {
      throw new AppError('config', '上传模式不能包含手工文件名')
    }

    const rules = new Map(action.uploadRules.map((rule) => [rule.id, rule]))
    if (rules.size === 0) {
      if (uploads.length > 0) throw new AppError('config', '该操作未配置执行前上传')
      return
    }

    const selectedRuleIds = new Set<string>()
    for (const item of uploads) {
      const rule = item.ruleId ? rules.get(item.ruleId) : undefined
      if (!rule) throw new AppError('config', '上传项未关联有效的上传目标')
      if (item.targetDir !== rule.targetDir || item.conflict !== rule.conflict) {
        throw new AppError('config', '上传项与当前操作规则不一致，请重新选择')
      }
      selectedRuleIds.add(rule.id)
    }

    const missing = action.uploadRules.filter((rule) => !selectedRuleIds.has(rule.id))
    if (missing.length > 0) {
      throw new AppError(
        'config',
        '请为每个上传目标选择本地文件或目录：' + missing.map((rule) => rule.targetDir).join('、')
      )
    }

    for (const rule of action.uploadRules) {
      if (!rule.variableKey) continue
      const selected = uploads.filter((item) => item.ruleId === rule.id)
      if (selected.length !== 1 || selected[0].kind !== 'file') {
        throw new AppError('config', '绑定命令变量的上传目标必须选择一个文件：' + rule.targetDir)
      }
    }
  }

  private findEnv(envId: string): DevEnv {
    const env = this.deps.store.getState().envs.find((item) => item.id === envId)
    if (!env) throw new AppError('config', '环境不存在')
    return env
  }

  private findAction(env: DevEnv, actionId: string): EnvAction {
    const action = env.actions.find((item) => item.id === actionId)
    if (!action) throw new AppError('config', '操作不存在')
    return action
  }

  private findServer(serverId: string): Server {
    const server = this.deps.store.getState().servers.find((item) => item.id === serverId)
    if (!server) throw new AppError('config', '服务器不存在')
    return server
  }
}

function assertManualUploadFileName(fileName: string): void {
  if (
    !fileName ||
    fileName.length > 255 ||
    fileName === '.' ||
    fileName === '..' ||
    /[/\\\0\n\r]/.test(fileName)
  ) {
    throw new AppError('config', '手工文件名不能包含路径、控制字符或路径穿越')
  }
}

function buildManualUploadVariables(
  action: EnvAction,
  vars: Record<string, string>,
  manualUploadFiles: ManualUploadFile[]
): Record<string, string> {
  const variables: Record<string, string> = {}
  for (const manual of manualUploadFiles) {
    const rule = action.uploadRules.find((item) => item.id === manual.ruleId)
    if (!rule?.variableKey) throw new AppError('config', '手工文件项未关联有效的命令变量规则')
    assertManualUploadFileName(manual.fileName)
    const target = resolveVariables(rule.targetDir, vars)
    if (target.missing.length > 0) {
      throw new AppError('config', '上传目标目录引用了未定义的变量：' + target.missing.join('、'))
    }
    assertTargetDir(target.text)
    variables[rule.variableKey + 'Name'] = manual.fileName
    variables[rule.variableKey + 'Path'] = joinRemote(target.text, manual.fileName)
  }
  return variables
}

function buildUploadVariables(action: EnvAction, plan: UploadPlan): Record<string, string> {
  const variables: Record<string, string> = {}
  for (const rule of action.uploadRules) {
    if (!rule.variableKey) continue
    const plannedItems = plan.items.filter((item) => item.item.ruleId === rule.id)
    if (plannedItems.length !== 1 || plannedItems[0].item.kind !== 'file') {
      throw new AppError('config', '无法为上传变量确定唯一文件：' + rule.variableKey)
    }
    const planned = plannedItems[0]
    const file = planned.files[0]
    const name = file?.rel ?? basename(planned.item.localPath)
    if (!name) throw new AppError('config', '无法为上传变量确定文件名：' + rule.variableKey)
    variables[rule.variableKey + 'Name'] = name
    variables[rule.variableKey + 'Path'] = file?.targetPath ?? joinRemote(planned.targetDir, name)
  }
  return variables
}

export function buildVars(env: DevEnv): Record<string, string> {
  const vars: Record<string, string> = { envName: env.name }
  for (const entry of env.paths) {
    vars[entry.key] = entry.path
  }
  return vars
}

export class PidMarkerParser {
  private buffer = ''
  private done = false
  pid: number | null = null

  push(text: string): string {
    if (this.done) return text
    this.buffer += text
    // eslint-disable-next-line no-control-regex -- The PID marker uses the record separator as a delimiter.
    const match = /\x1eCORRAL_PID:(\d+)\x1e\n?/.exec(this.buffer)
    if (match) {
      this.done = true
      this.pid = Number(match[1])
      const cleaned = this.buffer.replace(match[0], '')
      this.buffer = ''
      return cleaned
    }
    if (this.buffer.length > 4096) {
      this.done = true
      const out = this.buffer
      this.buffer = ''
      return out
    }
    return ''
  }

  flush(): string {
    if (this.done) return ''
    this.done = true
    const out = this.buffer
    this.buffer = ''
    return out
  }
}
