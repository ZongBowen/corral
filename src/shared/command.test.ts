import { describe, expect, it } from 'vitest'
import {
  assertSafeRemotePath,
  buildExecScript,
  buildPathCheckScript,
  findUnquotedVars,
  joinRemote,
  parsePathCheckOutput,
  resolveVariables,
  shellQuote
} from './command'

describe('shellQuote', () => {
  it('wraps plain values', () => {
    expect(shellQuote('/opt/app')).toBe("'/opt/app'")
  })

  it('escapes single quotes', () => {
    expect(shellQuote("a'b")).toBe("'a'\\''b'")
  })

  it('allows spaces and chinese', () => {
    expect(shellQuote('/opt/我的 应用')).toBe("'/opt/我的 应用'")
  })

  it('rejects null bytes', () => {
    expect(() => shellQuote('a\0b')).toThrow()
  })
})

describe('resolveVariables', () => {
  it('replaces known variables', () => {
    expect(resolveVariables('cd \${workDir} && ls', { workDir: '/opt/app' })).toEqual({
      text: 'cd /opt/app && ls',
      missing: []
    })
  })

  it('reports missing variables and keeps placeholder', () => {
    expect(resolveVariables('cd \${logDir}', {})).toEqual({
      text: 'cd \${logDir}',
      missing: ['logDir']
    })
  })
})

describe('findUnquotedVars', () => {
  it('detects unquoted variables only', () => {
    expect(findUnquotedVars('cd "\${workDir}" && cat \${configDir}/a')).toEqual(['configDir'])
  })
})

describe('buildExecScript', () => {
  it('includes pid marker and quoted payload', () => {
    const script = buildExecScript('echo hi')
    expect(script.startsWith('bash -lc ')).toBe(true)
    expect(script).toContain('CORRAL_PID')
    expect(script).toContain("echo hi")
    expect(script).toContain("'")
  })
})

describe('path check', () => {
  it('builds and parses output', () => {
    const script = buildPathCheckScript([{ key: 'workDir', path: '/opt/app' }])
    expect(script).toContain("'workDir'")
    expect(script).toContain("'/opt/app'")

    const parsed = parsePathCheckOutput('CORRAL_PATH:workDir:/opt/app:DIR_OK:WRITE_OK\n')
    expect(parsed).toEqual([{ key: 'workDir', path: '/opt/app', status: 'ok' }])
  })

  it('parses readonly and missing', () => {
    expect(parsePathCheckOutput('CORRAL_PATH:a:/a:DIR_OK:READONLY')).toEqual([
      { key: 'a', path: '/a', status: 'readonly' }
    ])
    expect(parsePathCheckOutput('CORRAL_PATH:a:/a:DIR_MISSING:READONLY')).toEqual([
      { key: 'a', path: '/a', status: 'missing' }
    ])
  })
})

describe('remote paths', () => {
  it('joins safely', () => {
    expect(joinRemote('/opt/app', 'lib', 'a.jar')).toBe('/opt/app/lib/a.jar')
    expect(joinRemote('/opt/app/', '/lib/')).toBe('/opt/app/lib')
  })

  it('rejects traversal and backslash', () => {
    expect(() => joinRemote('/opt/app', '../etc')).toThrow()
    expect(() => joinRemote('/opt/app', 'a\\b')).toThrow()
    expect(() => assertSafeRemotePath('relative')).toThrow()
  })
})
