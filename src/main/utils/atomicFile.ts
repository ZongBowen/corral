import { promises as fs } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { dirname } from 'node:path'

export function timestampForFile(date = new Date()): string {
  return date.toISOString().replace(/[:.]/g, '-')
}

export async function writeFileAtomic(filePath: string, content: string): Promise<void> {
  await fs.mkdir(dirname(filePath), { recursive: true })
  const tmp = filePath + '.tmp-' + randomUUID()
  const handle = await fs.open(tmp, 'wx')
  try {
    try {
      await handle.writeFile(content, 'utf8')
      await handle.sync()
    } catch (error) {
      await handle.close().catch(() => undefined)
      throw error
    }
    await handle.close()
    await fs.rename(tmp, filePath)
  } catch (error) {
    await fs.unlink(tmp).catch(() => undefined)
    throw error
  }
}

export interface ReadJsonResult<T> {
  data: T
  corrupt: boolean
  backupPath?: string
}

export async function readJsonFile<T>(
  filePath: string,
  fallback: () => T
): Promise<ReadJsonResult<T>> {
  try {
    const raw = await fs.readFile(filePath, 'utf8')
    return { data: JSON.parse(raw) as T, corrupt: false }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') {
      return { data: fallback(), corrupt: false }
    }
    const backupPath = filePath.replace(/\.json$/i, '') + '.corrupt-' + timestampForFile() + '.json'
    try {
      await fs.rename(filePath, backupPath)
    } catch {
      // ignore: the corrupt file may be locked or already moved
    }
    return { data: fallback(), corrupt: true, backupPath }
  }
}
