export type OutputStream = 'stdout' | 'stderr' | 'system'

export class OutputBatcher {
  private buffers: Record<OutputStream, string> = { stdout: '', stderr: '', system: '' }
  private bytes = 0
  private timer: NodeJS.Timeout | null = null

  constructor(
    private readonly onFlush: (stream: OutputStream, data: string) => void,
    private readonly maxBytes = 64 * 1024,
    private readonly delayMs = 60
  ) {}

  push(stream: OutputStream, data: string): void {
    if (!data) return
    this.buffers[stream] += data
    this.bytes += Buffer.byteLength(data)
    if (this.bytes >= this.maxBytes) {
      this.flush()
      return
    }
    if (!this.timer) {
      this.timer = setTimeout(() => {
        this.timer = null
        this.flush()
      }, this.delayMs)
    }
  }

  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    const pending = this.buffers
    this.buffers = { stdout: '', stderr: '', system: '' }
    this.bytes = 0
    for (const stream of ['stdout', 'stderr', 'system'] as OutputStream[]) {
      if (pending[stream]) this.onFlush(stream, pending[stream])
    }
  }

  dispose(): void {
    this.flush()
  }
}
