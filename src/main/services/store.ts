import { join } from 'node:path'
import {
  DEFAULT_SETTINGS,
  type DevEnv,
  type PathCheck,
  type Run,
  type Server,
  type Settings,
  type UploadRule
} from '@shared/types'
import { devEnvSchema, pathCheckMapSchema, serverSchema } from '@shared/schema'
import { newId } from '@shared/id'
import { readJsonFile, writeFileAtomic } from '../utils/atomicFile'

export const SCHEMA_VERSION = 3

export interface StoreState {
  schemaVersion: number
  servers: Server[]
  envs: DevEnv[]
  pathChecks: Record<string, PathCheck[]>
  runs: Run[]
  settings: Settings
}

export function emptyState(): StoreState {
  return {
    schemaVersion: SCHEMA_VERSION,
    servers: [],
    envs: [],
    pathChecks: {},
    runs: [],
    settings: { ...DEFAULT_SETTINGS }
  }
}

type LooseRecord = Record<string, unknown>

export class StoreService {
  readonly filePath: string
  private state: StoreState = emptyState()
  private timer: NodeJS.Timeout | null = null
  private writing: Promise<void> = Promise.resolve()
  private corruptOnLoad = false

  constructor(readonly dataDir: string) {
    this.filePath = join(dataDir, 'store.json')
  }

  async init(): Promise<void> {
    const result = await readJsonFile<LooseRecord>(this.filePath, () => emptyState() as unknown as LooseRecord)
    this.corruptOnLoad = result.corrupt
    this.state = this.migrate(result.data)
    if (result.corrupt) {
      await this.flush()
    }
  }

  wasCorruptOnLoad(): boolean {
    return this.corruptOnLoad
  }

  getState(): StoreState {
    return this.state
  }

  getSettings(): Settings {
    return { ...this.state.settings }
  }

  async updateSettings(patch: Partial<Settings>): Promise<Settings> {
    this.state.settings = { ...this.state.settings, ...patch }
    this.scheduleSave()
    return this.getSettings()
  }

  async mutate(mutator: (state: StoreState) => void): Promise<void> {
    mutator(this.state)
    this.scheduleSave()
  }

  private scheduleSave(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = null
      void this.flush()
    }, 300)
  }

  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    const payload = JSON.stringify(this.state, null, 2)
    this.writing = this.writing.then(() => writeFileAtomic(this.filePath, payload))
    return this.writing
  }

  async close(): Promise<void> {
    await this.flush()
  }

  exportConfig(appVersion: string): {
    exportedAt: string
    appVersion: string
    servers: Server[]
    envs: DevEnv[]
    settings: Settings
  } {
    return {
      exportedAt: new Date().toISOString(),
      appVersion,
      servers: this.state.servers,
      envs: this.state.envs,
      settings: this.state.settings
    }
  }

  private migrate(input: unknown): StoreState {
    const state = emptyState()
    if (!input || typeof input !== 'object') return state
    const raw = input as LooseRecord

    if (Array.isArray(raw.servers)) {
      state.servers = raw.servers
        .map((item) => serverSchema.safeParse(item))
        .filter((parsed) => parsed.success)
        .map((parsed) => parsed.data as Server)
    }

    if (Array.isArray(raw.envs)) {
      state.envs = raw.envs
        .map((item) => migrateEnv(item))
        .filter((item): item is DevEnv => item !== null)
    }

    const pathChecks = pathCheckMapSchema.safeParse(raw.pathChecks)
    if (pathChecks.success) {
      const envIds = new Set(state.envs.map((env) => env.id))
      state.pathChecks = Object.fromEntries(
        Object.entries(pathChecks.data).filter(([envId]) => envIds.has(envId))
      )
    }

    if (Array.isArray(raw.runs)) {
      state.runs = raw.runs as Run[]
    }

    if (raw.settings && typeof raw.settings === 'object') {
      state.settings = { ...DEFAULT_SETTINGS, ...(raw.settings as Partial<Settings>) }
    }

    state.schemaVersion = SCHEMA_VERSION
    return state
  }
}

function migrateUploadRules(action: LooseRecord): UploadRule[] {
  if (Array.isArray(action.uploadRules)) return action.uploadRules as UploadRule[]
  if (!Array.isArray(action.uploads)) return []

  const rules: UploadRule[] = []
  const seen = new Set<string>()
  for (const value of action.uploads) {
    if (!value || typeof value !== 'object') continue
    const upload = value as LooseRecord
    if (typeof upload.targetDir !== 'string') continue
    if (upload.conflict !== 'backup' && upload.conflict !== 'overwrite') continue
    const key = upload.targetDir + '|' + upload.conflict
    if (seen.has(key)) continue
    seen.add(key)
    rules.push({
      id: typeof upload.id === 'string' && upload.id ? upload.id : newId(),
      targetDir: upload.targetDir,
      conflict: upload.conflict
    })
  }
  return rules
}

function migrateEnv(input: unknown): DevEnv | null {
  if (!input || typeof input !== 'object') return null
  const raw = input as LooseRecord
  if (typeof raw.id !== 'string' || typeof raw.serverId !== 'string' || typeof raw.name !== 'string') {
    return null
  }
  const actions = Array.isArray(raw.actions)
    ? raw.actions.map((action) => {
        const item = (action ?? {}) as LooseRecord
        return {
          ...item,
          timeoutSec: typeof item.timeoutSec === 'number' ? item.timeoutSec : 300,
          confirm: typeof item.confirm === 'boolean' ? item.confirm : true,
          uploadRules: migrateUploadRules(item)
        }
      })
    : []
  const candidate = {
    id: raw.id,
    serverId: raw.serverId,
    name: raw.name,
    description: typeof raw.description === 'string' ? raw.description : undefined,
    paths: Array.isArray(raw.paths) ? raw.paths : [],
    actions,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : new Date().toISOString(),
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : new Date().toISOString()
  }
  const parsed = devEnvSchema.safeParse(candidate)
  return parsed.success ? (parsed.data as DevEnv) : null
}
