import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LogStore } from './logStore'

let dir = ''
let store: LogStore

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'corral-log-'))
  store = new LogStore(dir)
  await store.init()
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('LogStore', () => {
  it('writes jsonl and reads it back', async () => {
    const writer = store.open('run1')
    writer.append({ t: 0, s: 'out', d: 'hello\n' })
    writer.append({ t: 10, s: 'err', d: 'bad\n' })
    writer.append({ t: 20, s: 'sys', d: '[corral] note\n' })
    await writer.close()

    const chunk = await store.readChunk('run1', 0, 1024)
    expect(chunk.content).toBe('hello\nbad\n[corral] note\n')
    expect(chunk.eof).toBe(true)
    expect(chunk.totalBytes).toBeGreaterThan(0)
  })

  it('pages by byte offset without splitting lines', async () => {
    const writer = store.open('run2')
    for (let i = 0; i < 20; i += 1) {
      writer.append({ t: i, s: 'out', d: 'line-' + String(i) + '\n' })
    }
    await writer.close()

    const first = await store.readChunk('run2', 0, 60)
    expect(first.eof).toBe(false)
    expect(first.content.startsWith('line-0\n')).toBe(true)

    const second = await store.readChunk('run2', first.nextOffset, 60)
    expect(second.content.length).toBeGreaterThan(0)
    expect(second.content.startsWith('line-')).toBe(true)
  })

  it('exports plain text', async () => {
    const writer = store.open('run3')
    writer.append({ t: 0, s: 'out', d: 'a\n' })
    writer.append({ t: 1, s: 'err', d: 'b\n' })
    await writer.close()

    const target = join(dir, 'export.log')
    await store.exportTo('run3', target)
    expect(await readFile(target, 'utf8')).toBe('a\nb\n')
  })

  it('removes and clears logs', async () => {
    const writer = store.open('run4')
    writer.append({ t: 0, s: 'out', d: 'x\n' })
    await writer.close()
    await store.remove('run4')
    expect((await store.readChunk('run4', 0, 10)).content).toBe('')
  })
})
