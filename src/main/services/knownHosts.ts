import { createHash } from 'node:crypto'
import { join } from 'node:path'
import type { HostKeyRecord } from '@shared/types'
import { readJsonFile, writeFileAtomic } from '../utils/atomicFile'

interface KnownHostsFile {
  version: 1
  entries: HostKeyRecord[]
}

export function fingerprint(key: Buffer | string): string {
  const hash = createHash('sha256').update(key).digest('base64').replace(/=+$/, '')
  return 'SHA256:' + hash
}

export class KnownHostsService {
  readonly filePath: string
  private entries: HostKeyRecord[] = []

  constructor(readonly dataDir: string) {
    this.filePath = join(dataDir, 'known-hosts.json')
  }

  async init(): Promise<void> {
    const result = await readJsonFile<KnownHostsFile>(this.filePath, () => ({ version: 1, entries: [] }))
    this.entries = Array.isArray(result.data.entries) ? result.data.entries : []
  }

  get(host: string, port: number): HostKeyRecord | undefined {
    return this.entries.find((entry) => entry.host === host && entry.port === port)
  }

  list(): HostKeyRecord[] {
    return [...this.entries]
  }

  async trust(record: HostKeyRecord): Promise<void> {
    const now = new Date().toISOString()
    const index = this.entries.findIndex((entry) => entry.host === record.host && entry.port === record.port)
    if (index >= 0) {
      this.entries[index] = {
        ...record,
        firstSeenAt: this.entries[index].firstSeenAt,
        lastSeenAt: now
      }
    } else {
      this.entries.push({ ...record, firstSeenAt: now, lastSeenAt: now })
    }
    await this.flush()
  }

  async touch(host: string, port: number): Promise<void> {
    const record = this.get(host, port)
    if (!record) return
    record.lastSeenAt = new Date().toISOString()
    await this.flush()
  }

  async remove(host: string, port: number): Promise<void> {
    const next = this.entries.filter((entry) => !(entry.host === host && entry.port === port))
    if (next.length === this.entries.length) return
    this.entries = next
    await this.flush()
  }

  async flush(): Promise<void> {
    const payload: KnownHostsFile = { version: 1, entries: this.entries }
    await writeFileAtomic(this.filePath, JSON.stringify(payload, null, 2))
  }
}
