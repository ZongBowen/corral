export interface Server {
  id: string
  name: string
  host: string
  port: number
  username: string
  description?: string
  tags: string[]
  createdAt: string
  updatedAt: string
  lastConnectedAt?: string
}

export interface ServerSummary extends Server {
  hasPassword: boolean
  credentialBroken: boolean
}

export interface PathEntry {
  key: string
  label: string
  path: string
  required?: boolean
}

export interface UploadItem {
  id: string
  kind: 'file' | 'dir'
  localPath: string
  targetDir: string
  conflict: 'backup' | 'overwrite'
}

export interface EnvAction {
  id: string
  name: string
  command: string
  timeoutSec: number
  confirm: boolean
  danger?: boolean
  uploads: UploadItem[]
}

export interface DevEnv {
  id: string
  serverId: string
  name: string
  description?: string
  paths: PathEntry[]
  actions: EnvAction[]
  createdAt: string
  updatedAt: string
}

export type RunStatus =
  | 'queued'
  | 'connecting'
  | 'validating'
  | 'uploading'
  | 'running'
  | 'success'
  | 'failed'
  | 'timeout'
  | 'canceled'
  | 'disconnected'

export const TERMINAL_STATUSES: RunStatus[] = [
  'success',
  'failed',
  'timeout',
  'canceled',
  'disconnected'
]

export function isTerminal(status: RunStatus): boolean {
  return TERMINAL_STATUSES.includes(status)
}

export type RunErrorKind =
  | 'dns'
  | 'connect-timeout'
  | 'refused'
  | 'auth'
  | 'hostkey'
  | 'network'
  | 'remote'
  | 'config'
  | 'upload'
  | 'unknown'

export interface UploadStats {
  itemCount: number
  fileCount: number
  totalBytes: number
  transferredBytes: number
  durationMs?: number
  backups: string[]
}

export interface RunPrecheckItem {
  localPath: string
  kind: 'file' | 'dir'
  targetPath: string
  exists: boolean
  bytes: number
  fileCount: number
}

export interface RunPrecheck {
  resolvedCommand: string
  items: RunPrecheckItem[]
  totalBytes: number
  fileCount: number
  missing: string[]
  warnings: string[]
}

export interface Run {
  id: string
  envId: string
  envName: string
  serverId: string
  serverName: string
  actionId: string
  actionName: string
  command: string
  resolvedCommand: string
  status: RunStatus
  exitCode?: number
  errorKind?: RunErrorKind
  errorMessage?: string
  startedAt: string
  endedAt?: string
  durationMs?: number
  logBytes?: number
  remotePid?: number
  uploadStats?: UploadStats
}

export interface Settings {
  theme: 'system' | 'light' | 'dark'
  defaultTimeoutSec: number
  validatePathsBeforeRun: boolean
  defaultConflict: 'backup' | 'overwrite'
  uploadIdleTimeoutSec: number
  logRetentionCount: number
  logRetentionDays: number
  outputEncoding: 'utf-8' | 'gbk'
  legacySshAlgorithms: boolean
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  defaultTimeoutSec: 300,
  validatePathsBeforeRun: true,
  defaultConflict: 'backup',
  uploadIdleTimeoutSec: 60,
  logRetentionCount: 200,
  logRetentionDays: 30,
  outputEncoding: 'utf-8',
  legacySshAlgorithms: false
}

export interface PathCheck {
  key: string
  label: string
  path: string
  status: 'unknown' | 'ok' | 'readonly' | 'missing'
  checkedAt?: string
  error?: string
}

export interface TestResult {
  ok: boolean
  durationMs: number
  os?: string
  osId?: string
  osVersion?: string
  kernel?: string
  uptime?: string
  username?: string
  errorKind?: RunErrorKind
  errorMessage?: string
}

export interface HostKeyRecord {
  host: string
  port: number
  keyType: string
  fingerprint: string
  firstSeenAt: string
  lastSeenAt: string
}

export interface HostKeyChallenge {
  challengeId: string
  host: string
  port: number
  keyType: string
  fingerprint: string
  isMismatch: boolean
  oldFingerprint?: string
}

export interface RunProgress {
  runId: string
  phase: 'upload'
  fileIndex: number
  fileCount: number
  fileName: string
  transferredBytes: number
  totalBytes: number
}

export interface RunStatusEvent {
  runId: string
  status: RunStatus
  errorKind?: RunErrorKind
  errorMessage?: string
  exitCode?: number
  durationMs?: number
}

export interface RunOutputEvent {
  runId: string
  stream: 'stdout' | 'stderr' | 'system'
  data: string
}

export interface LogEntry {
  t: number
  s: 'out' | 'err' | 'sys'
  d: string
}

export interface LogChunk {
  content: string
  offset: number
  nextOffset: number
  totalBytes: number
  eof: boolean
}

export interface RunFilter {
  envId?: string
  serverId?: string
  status?: RunStatus
  from?: string
  to?: string
  keyword?: string
  offset?: number
  limit?: number
}

export interface BootState {
  dataDir: string
  servers: ServerSummary[]
  envs: DevEnv[]
  settings: Settings
  activeRunIds: string[]
}

export type IpcResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } }

export interface ServerInput {
  name: string
  host: string
  port: number
  username: string
  password?: string
  description?: string
  tags: string[]
}

export interface ServerUpdateInput extends ServerInput {
  clearPassword?: boolean
}

export interface DevEnvInput {
  serverId: string
  name: string
  description?: string
  paths: PathEntry[]
  actions: EnvAction[]
}

export interface AppNotice {
  level: 'info' | 'warning' | 'error'
  message: string
}

export interface ExportedConfig {
  exportedAt: string
  appVersion: string
  servers: Omit<Server, 'id'>[] & { id: string }[]
  envs: DevEnv[]
  settings: Settings
}
