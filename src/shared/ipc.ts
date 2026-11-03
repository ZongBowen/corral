import type {
  AppNotice,
  BootState,
  DevEnv,
  DevEnvInput,
  HostKeyChallenge,
  IpcResult,
  LogChunk,
  Run,
  RunFilter,
  RunOutputEvent,
  RunPrecheck,
  RunProgress,
  RunStatusEvent,
  ServerInput,
  ServerSummary,
  ServerUpdateInput,
  Settings,
  TestResult
} from './types'

export const CH = {
  serverList: 'server:list',
  serverCreate: 'server:create',
  serverUpdate: 'server:update',
  serverRemove: 'server:remove',
  serverTest: 'server:test',
  serverTrustHostKey: 'server:trustHostKey',

  envList: 'env:list',
  envCreate: 'env:create',
  envUpdate: 'env:update',
  envRemove: 'env:remove',
  envValidatePaths: 'env:validatePaths',

  runPrecheck: 'run:precheck',
  runStart: 'run:start',
  runCancel: 'run:cancel',
  runList: 'run:list',
  runReadLog: 'run:readLog',
  runExportLog: 'run:exportLog',
  runRemove: 'run:remove',
  runClear: 'run:clear',

  settingsGet: 'settings:get',
  settingsUpdate: 'settings:update',
  appGetBootState: 'app:getBootState',
  appOpenDataDir: 'app:openDataDir',
  appExportConfig: 'app:exportConfig',
  appCopyText: 'app:copyText',

  hostkeyDecision: 'hostkey:decision',

  dialogPickFiles: 'dialog:pickFiles',
  dialogPickDirectory: 'dialog:pickDirectory'
} as const

export const EV = {
  runStatus: 'run:status',
  runOutput: 'run:output',
  runProgress: 'run:progress',
  runDone: 'run:done',
  hostkeyChallenge: 'hostkey:challenge',
  appNotice: 'app:notice'
} as const

export interface ServerTestPayload {
  id?: string
  input?: ServerInput
}

export interface ServerUpdatePayload {
  id: string
  input: ServerUpdateInput
}

export interface EnvUpdatePayload {
  id: string
  input: DevEnvInput
}

export interface RunStartPayload {
  envId: string
  actionId: string
  force?: boolean
}

export interface RunPrecheckPayload {
  envId: string
  actionId: string
}

export interface RunReadLogPayload {
  runId: string
  offset?: number
  limit?: number
}

export interface HostKeyDecisionPayload {
  challengeId: string
  accept: boolean
}

export interface CorralApi {
  server: {
    list: () => Promise<IpcResult<ServerSummary[]>>
    create: (input: ServerInput) => Promise<IpcResult<ServerSummary>>
    update: (payload: ServerUpdatePayload) => Promise<IpcResult<ServerSummary>>
    remove: (id: string) => Promise<IpcResult<void>>
    test: (payload: ServerTestPayload) => Promise<IpcResult<TestResult>>
    trustHostKey: (payload: { host: string; port: number }) => Promise<IpcResult<void>>
  }
  env: {
    list: (serverId?: string) => Promise<IpcResult<DevEnv[]>>
    create: (input: DevEnvInput) => Promise<IpcResult<DevEnv>>
    update: (payload: EnvUpdatePayload) => Promise<IpcResult<DevEnv>>
    remove: (id: string) => Promise<IpcResult<void>>
    validatePaths: (payload: { envId: string }) => Promise<IpcResult<import('./types').PathCheck[]>>
  }
  run: {
    precheck: (payload: RunPrecheckPayload) => Promise<IpcResult<RunPrecheck>>
    start: (payload: RunStartPayload) => Promise<IpcResult<{ runId: string }>>
    cancel: (runId: string) => Promise<IpcResult<void>>
    list: (filter?: RunFilter) => Promise<IpcResult<Run[]>>
    readLog: (payload: RunReadLogPayload) => Promise<IpcResult<LogChunk>>
    exportLog: (runId: string) => Promise<IpcResult<{ filePath: string } | null>>
    remove: (runId: string) => Promise<IpcResult<void>>
    clear: (filter?: RunFilter) => Promise<IpcResult<void>>
  }
  settings: {
    get: () => Promise<IpcResult<Settings>>
    update: (patch: Partial<Settings>) => Promise<IpcResult<Settings>>
  }
  app: {
    getBootState: () => Promise<IpcResult<BootState>>
    openDataDir: () => Promise<IpcResult<void>>
    exportConfig: () => Promise<IpcResult<{ filePath: string } | null>>
    copyText: (text: string) => Promise<IpcResult<void>>
  }
  hostkey: {
    decide: (payload: HostKeyDecisionPayload) => Promise<IpcResult<void>>
  }
  dialog: {
    pickFiles: (options?: { multiple?: boolean }) => Promise<IpcResult<string[]>>
    pickDirectory: () => Promise<IpcResult<string | null>>
  }
  events: {
    onRunStatus: (callback: (event: RunStatusEvent) => void) => () => void
    onRunOutput: (callback: (event: RunOutputEvent) => void) => () => void
    onRunProgress: (callback: (event: RunProgress) => void) => () => void
    onRunDone: (callback: (run: Run) => void) => () => void
    onHostKeyChallenge: (callback: (event: HostKeyChallenge) => void) => () => void
    onAppNotice: (callback: (event: AppNotice) => void) => () => void
  }
}
