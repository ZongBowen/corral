import { describe, expect, it } from 'vitest'
import { extractVariables, findUnquotedVars } from '@shared/command'
import {
  COMMAND_SNIPPETS,
  SNIPPET_GROUPS,
  buildSnippetOptions,
  buildSnippetPatch,
  snippetAvailability,
  type CommandSnippet
} from './commandSnippets'

const FULL_VARS: Record<string, string> = {
  workDir: '/opt/app',
  logDir: '/var/log/app',
  envName: 'demo'
}

const VARIABLE_WHITELIST = ['workDir', 'logDir', 'envName']

function makeSnippet(overrides: Partial<CommandSnippet> = {}): CommandSnippet {
  return {
    key: 'test-snippet',
    group: 'script',
    label: '测试片段',
    description: '测试用',
    command: 'cd "\${workDir}" && ./start.sh',
    requires: ['workDir'],
    ...overrides
  }
}

describe('COMMAND_SNIPPETS', () => {
  it('uses unique keys', () => {
    const keys = COMMAND_SNIPPETS.map((snippet) => snippet.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('belongs to declared groups and leaves no group empty', () => {
    for (const snippet of COMMAND_SNIPPETS) {
      expect(SNIPPET_GROUPS.some((group) => group.key === snippet.group)).toBe(true)
    }
    for (const group of SNIPPET_GROUPS) {
      expect(COMMAND_SNIPPETS.some((snippet) => snippet.group === group.key)).toBe(true)
    }
  })

  it('declares exactly the variables used by the command', () => {
    for (const snippet of COMMAND_SNIPPETS) {
      expect(new Set(extractVariables(snippet.command))).toEqual(new Set(snippet.requires))
    }
  })

  it('quotes every variable', () => {
    for (const snippet of COMMAND_SNIPPETS) {
      expect(findUnquotedVars(snippet.command)).toEqual([])
    }
  })

  it('keeps no stray escape characters before variables', () => {
    for (const snippet of COMMAND_SNIPPETS) {
      expect(snippet.command).not.toContain('\\$')
    }
  })

  it('only references known variables', () => {
    for (const snippet of COMMAND_SNIPPETS) {
      for (const key of extractVariables(snippet.command)) {
        expect(VARIABLE_WHITELIST).toContain(key)
      }
    }
  })

  it('starts background snippets detached with log redirection', () => {
    const daemonSnippets = COMMAND_SNIPPETS.filter((snippet) => snippet.group === 'daemon')
    expect(daemonSnippets.length).toBeGreaterThan(0)
    for (const snippet of daemonSnippets) {
      expect(snippet.command).toContain('2>&1')
      expect(snippet.command).toContain('< /dev/null')
      expect(snippet.requires).toContain('logDir')
      expect(snippet.command).toContain('|| exit 1;')
      expect(snippet.command).not.toContain('&& nohup')
      expect(snippet.command).not.toContain('&& setsid')
    }
  })

  it('marks destructive snippets as dangerous', () => {
    const destructive = COMMAND_SNIPPETS.filter(
      (snippet) => snippet.group === 'stop' || snippet.key === 'compose-down'
    )
    expect(destructive.length).toBeGreaterThan(0)
    for (const snippet of destructive) {
      expect(snippet.suggest?.danger).toBe(true)
    }
  })
})

describe('snippetAvailability', () => {
  it('is available when every variable is configured', () => {
    expect(snippetAvailability({ requires: ['workDir', 'logDir'] }, FULL_VARS)).toEqual({
      available: true,
      missing: [],
      reason: ''
    })
  })

  it('reports the missing variable and a readable reason', () => {
    const result = snippetAvailability({ requires: ['workDir', 'logDir'] }, { workDir: '/opt/app' })
    expect(result.available).toBe(false)
    expect(result.missing).toEqual(['logDir'])
    expect(result.reason).toContain('logDir')
  })

  it('treats empty and blank values as missing', () => {
    expect(snippetAvailability({ requires: ['logDir'] }, { logDir: '' }).available).toBe(false)
    expect(snippetAvailability({ requires: ['logDir'] }, { logDir: '   ' }).available).toBe(false)
  })

  it('is available without any variable when nothing is required', () => {
    expect(snippetAvailability({ requires: [] }, {}).available).toBe(true)
  })

  it('keeps declaration order and removes duplicates', () => {
    const result = snippetAvailability({ requires: ['logDir', 'workDir', 'logDir'] }, {})
    expect(result.missing).toEqual(['logDir', 'workDir'])
  })

  it('does not mutate the variables object', () => {
    const vars = { workDir: '/opt/app' }
    snippetAvailability({ requires: ['workDir', 'logDir'] }, vars)
    expect(vars).toEqual({ workDir: '/opt/app' })
  })
})

describe('buildSnippetOptions', () => {
  it('keeps the declared group order', () => {
    expect(buildSnippetOptions(FULL_VARS).map((group) => group.label)).toEqual(
      SNIPPET_GROUPS.map((group) => group.label)
    )
  })

  it('disables snippets with missing variables but keeps them visible', () => {
    const options = buildSnippetOptions({ workDir: '/opt/app' }).flatMap((group) => group.options)
    const daemon = options.find((item) => item.value === 'daemon-nohup')
    const foreground = options.find((item) => item.value === 'run-foreground')
    expect(daemon?.disabled).toBe(true)
    expect(daemon?.hint).toContain('logDir')
    expect(foreground?.disabled).toBe(false)
    expect(foreground?.hint).toBe(foreground?.description)
  })

  it('includes every snippet exactly once', () => {
    const values = buildSnippetOptions(FULL_VARS).flatMap((group) =>
      group.options.map((option) => option.value)
    )
    expect(values).toHaveLength(COMMAND_SNIPPETS.length)
    expect(new Set(values).size).toBe(COMMAND_SNIPPETS.length)
  })
})

describe('buildSnippetPatch', () => {
  const snippet = makeSnippet({
    suggest: { name: '启动（后台）', danger: true, timeoutSec: 120 }
  })

  it('only replaces the command in edit mode', () => {
    expect(buildSnippetPatch({ snippet, mode: 'edit', currentName: '' })).toEqual({
      command: snippet.command
    })
  })

  it('fills name, danger and timeout when creating with an empty name', () => {
    expect(buildSnippetPatch({ snippet, mode: 'create', currentName: '  ' })).toEqual({
      command: snippet.command,
      name: '启动（后台）',
      danger: true,
      timeoutSec: 120
    })
  })

  it('keeps the name typed by the user', () => {
    const patch = buildSnippetPatch({ snippet, mode: 'create', currentName: '我的启动' })
    expect(patch.name).toBeUndefined()
  })

  it('never writes danger=false', () => {
    const plain = makeSnippet({ suggest: { name: '启动' } })
    const patch = buildSnippetPatch({ snippet: plain, mode: 'create', currentName: '' })
    expect('danger' in patch).toBe(false)
  })

  it('returns only the command when the snippet has no suggestions', () => {
    const plain = makeSnippet()
    expect(buildSnippetPatch({ snippet: plain, mode: 'create', currentName: '' })).toEqual({
      command: plain.command
    })
  })
})
