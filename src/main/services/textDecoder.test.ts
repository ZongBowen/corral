import { encode } from 'iconv-lite'
import { describe, expect, it } from 'vitest'
import { createTextDecoder } from './textDecoder'
import { OutputBatcher } from './batcher'

describe('createTextDecoder', () => {
  it('handles split utf8 characters', () => {
    const decoder = createTextDecoder('utf-8')
    const buffer = Buffer.from('中文', 'utf8')
    let text = decoder.write(buffer.subarray(0, 2))
    text += decoder.write(buffer.subarray(2))
    text += decoder.end()
    expect(text).toBe('中文')
  })

  it('decodes gbk', () => {
    const decoder = createTextDecoder('gbk')
    const buffer = encode('中文测试', 'gbk')
    let text = decoder.write(buffer.subarray(0, 3))
    text += decoder.write(buffer.subarray(3))
    text += decoder.end()
    expect(text).toBe('中文测试')
  })
})

describe('OutputBatcher', () => {
  it('flushes by size', () => {
    const chunks: string[] = []
    const batcher = new OutputBatcher((_stream, data) => chunks.push(data), 4, 1000)
    batcher.push('stdout', 'hello')
    expect(chunks).toEqual(['hello'])
  })
})
