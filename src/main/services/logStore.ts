import { createReadStream, createWriteStream } from 'node:fs'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { finished } from 'node:stream/promises'
import type { LogChunk, LogEntry } from '@shared/types'
import { AppError } from '@shared/errors'

const MAX_LOG_BYTES = 50 * 1024 * 1024

export class LogWriter {
  private written = 0
  private overflow = false
  private closed = false
  private readonly stream: ReturnType<typeof createWriteStream>

  constructor(
    readonly filePath: string,
    readonly limitBytes = MAX_LOG_BYTES
  ) {
    this.stream = createWriteStream(filePath, { flags: 'a' })
  }

  append(entry: LogEntry): void {
    if (this.closed || this.overflow) return
    const line = JSON.stringify(entry) + '\n'
    this.written += Buffer.byteLength(line)
    if (this.written > this.limitBytes) {
      this.overflow = true
      this.stream.write(
        JSON.stringify({ t: entry.t, s: 'sys', d: '\n[corral] 日志超过 50MB，已停止写入\n' }) + '\n'
      )
      return
    }
    this.stream.write(line)
  }

  bytes(): number {
    return this.written
  }

  isOverflow(): boolean {
    return this.overflow
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    this.stream.end()
    try {
      await finished(this.stream)
    } catch {
      // ignore stream errors on close
    }
  }
}

export class LogStore {
  constructor(private readonly dir: string) {}

  async init(): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true })
  }

  logPath(runId: string): string {
    return join(this.dir, runId + '.jsonl')
  }

  open(runId: string): LogWriter {
    return new LogWriter(this.logPath(runId))
  }

  async readChunk(runId: string, offset = 0, limit = 262_144): Promise<LogChunk> {
    const path = this.logPath(runId)
    let size = 0
    try {
      const stat = await fs.stat(path)
      size = stat.size
    } catch {
      return { content: '', offset, nextOffset: offset, totalBytes: 0, eof: true }
    }
    if (offset >= size) {
      return { content: '', offset, nextOffset: size, totalBytes: size, eof: true }
    }

    const start = Math.max(0, offset - 4096)
    const readLength = Math.min(limit + (offset - start), size - start)
    const buffer = Buffer.alloc(readLength)
    const handle = await fs.open(path, 'r')
    try {
      await handle.read(buffer, 0, readLength, start)
    } finally {
      await handle.close()
    }

    let begin = 0
    if (offset > 0) {
      const at = offset - start
      if (at > 0 && buffer[at - 1] === 0x0a) {
        begin = at
      } else {
        const newline = buffer.indexOf(0x0a, at)
        begin = newline >= 0 ? newline + 1 : buffer.length
      }
    }

    let end = buffer.length
    if (start + buffer.length < size) {
      const lastNewline = buffer.lastIndexOf(0x0a)
      if (lastNewline >= begin) end = lastNewline + 1
    }

    const slice = buffer.subarray(begin, end)
    const content = slice
      .toString('utf8')
      .split(/\r?\n/)
      .filter((line) => line.length > 0)
      .map((line) => {
        try {
          const entry = JSON.parse(line) as LogEntry
          return entry.d
        } catch {
          return ''
        }
      })
      .join('')

    const nextOffset = start + end
    return {
      content,
      offset,
      nextOffset: nextOffset <= offset ? Math.min(offset + readLength, size) : nextOffset,
      totalBytes: size,
      eof: nextOffset >= size
    }
  }

  async exportTo(runId: string, targetPath: string): Promise<void> {
    const source = this.logPath(runId)
    try {
      await fs.access(source)
    } catch {
      throw new AppError('config', '该执行没有日志文件')
    }
    const input = createReadStream(source, { encoding: 'utf8' })
    const output = createWriteStream(targetPath, { encoding: 'utf8' })
    const reader = createInterface({ input, crlfDelay: Infinity })
    for await (const line of reader) {
      if (!line) continue
      try {
        const entry = JSON.parse(line) as LogEntry
        output.write(entry.d)
      } catch {
        // skip malformed line
      }
    }
    output.end()
    await finished(output)
  }

  async remove(runId: string): Promise<void> {
    try {
      await fs.unlink(this.logPath(runId))
    } catch {
      // ignore missing file
    }
  }

  async clear(): Promise<void> {
    let entries: string[] = []
    try {
      entries = await fs.readdir(this.dir)
    } catch {
      return
    }
    await Promise.all(
      entries
        .filter((name) => name.endsWith('.jsonl'))
        .map((name) => fs.unlink(join(this.dir, name)).catch(() => undefined))
    )
  }
}
