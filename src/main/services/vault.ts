import { join } from 'node:path'
import { safeStorage } from 'electron'
import { AppError } from '@shared/errors'
import { readJsonFile, writeFileAtomic } from '../utils/atomicFile'

type SecretsFile = Record<string, string>

export class VaultService {
  readonly filePath: string
  private secrets: SecretsFile = {}
  private available = false

  constructor(readonly dataDir: string) {
    this.filePath = join(dataDir, 'secrets.json')
  }

  async init(): Promise<void> {
    this.available = await safeStorage.isAsyncEncryptionAvailable()
    const result = await readJsonFile<SecretsFile>(this.filePath, () => ({}))
    this.secrets = result.data && typeof result.data === 'object' ? result.data : {}
  }

  isAvailable(): boolean {
    return this.available
  }

  has(serverId: string): boolean {
    return Boolean(this.secrets[serverId])
  }

  async isBroken(serverId: string): Promise<boolean> {
    if (!this.has(serverId)) return false
    return (await this.decrypt(serverId)) === null
  }

  async getPassword(serverId: string): Promise<string | null> {
    return await this.decrypt(serverId)
  }

  async setPassword(serverId: string, password: string): Promise<void> {
    if (!this.available) {
      throw new AppError('config', '当前系统不支持安全存储，无法保存密码')
    }
    const encrypted = await safeStorage.encryptStringAsync(JSON.stringify({ password }))
    this.secrets[serverId] = encrypted.toString('base64')
    await this.flush()
  }

  async remove(serverId: string): Promise<void> {
    if (!this.secrets[serverId]) return
    delete this.secrets[serverId]
    await this.flush()
  }

  async flush(): Promise<void> {
    await writeFileAtomic(this.filePath, JSON.stringify(this.secrets, null, 2))
  }

  private async decrypt(serverId: string): Promise<string | null> {
    const encoded = this.secrets[serverId]
    if (!encoded) return null
    try {
      const decrypted = await safeStorage.decryptStringAsync(Buffer.from(encoded, 'base64'))
      if (decrypted.shouldReEncrypt) {
        const encrypted = await safeStorage.encryptStringAsync(decrypted.result)
        this.secrets[serverId] = encrypted.toString('base64')
        void this.flush()
      }
      const parsed = JSON.parse(decrypted.result) as { password?: unknown }
      return typeof parsed.password === 'string' ? parsed.password : null
    } catch {
      return null
    }
  }
}
