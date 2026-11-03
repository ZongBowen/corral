import { StringDecoder } from 'node:string_decoder'
import { getDecoder } from 'iconv-lite'

export interface TextDecoderLike {
  write: (buffer: Buffer) => string
  end: () => string
}

export function createTextDecoder(encoding: 'utf-8' | 'gbk'): TextDecoderLike {
  if (encoding === 'gbk') {
    const decoder = getDecoder('gbk')
    return {
      write: (buffer) => decoder.write(buffer),
      end: () => decoder.end() ?? ''
    }
  }
  const decoder = new StringDecoder('utf8')
  return {
    write: (buffer) => decoder.write(buffer),
    end: () => decoder.end()
  }
}
