import { AppError } from './errors'

const VARIABLE_RE = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g
const VARIABLE_SINGLE_RE = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/

export const PID_MARKER = '\x1eCORRAL_PID:'

export function shellQuote(value: string): string {
  if (value.includes('\0')) {
    throw new AppError('config', '参数包含非法字符（空字节）')
  }
  return "'" + value.replace(/'/g, "'\\''") + "'"
}

export interface ResolveResult {
  text: string
  missing: string[]
}

export function resolveVariables(template: string, vars: Record<string, string>): ResolveResult {
  const missing: string[] = []
  const text = template.replace(VARIABLE_RE, (match, key: string) => {
    if (Object.prototype.hasOwnProperty.call(vars, key)) return vars[key]
    if (!missing.includes(key)) missing.push(key)
    return match
  })
  return { text, missing }
}

export function extractVariables(template: string): string[] {
  const result: string[] = []
  const re = new RegExp(VARIABLE_SINGLE_RE.source, 'g')
  let match: RegExpExecArray | null
  while ((match = re.exec(template)) !== null) {
    if (!result.includes(match[1])) result.push(match[1])
  }
  return result
}

export function findUnquotedVars(template: string): string[] {
  const result: string[] = []
  const re = new RegExp(VARIABLE_SINGLE_RE.source, 'g')
  let match: RegExpExecArray | null
  while ((match = re.exec(template)) !== null) {
    const previous = match.index > 0 ? template[match.index - 1] : ''
    if (previous !== '"' && previous !== "'") {
      if (!result.includes(match[1])) result.push(match[1])
    }
  }
  return result
}

export function buildExecScript(command: string): string {
  const payload =
    "printf '\\036CORRAL_PID:%s\\036\\n' \"$$\" >&2; " + command
  return 'bash -lc ' + shellQuote(payload)
}

export interface PathCheckInput {
  key: string
  path: string
}

export function buildPathCheckScript(entries: PathCheckInput[]): string {
  const lines: string[] = ['set +e']
  for (const entry of entries) {
    const path = shellQuote(entry.path)
    lines.push(
      "printf 'CORRAL_PATH:%s:%s:' " + shellQuote(entry.key) + ' ' + path
    )
    lines.push('if [ -d ' + path + " ]; then printf 'DIR_OK:'; else printf 'DIR_MISSING:'; fi")
    lines.push('if [ -w ' + path + " ]; then echo 'WRITE_OK'; else echo 'READONLY'; fi")
  }
  return lines.join('\n')
}

export interface ParsedPathCheck {
  key: string
  path: string
  status: 'ok' | 'readonly' | 'missing'
}

export function parsePathCheckOutput(stdout: string): ParsedPathCheck[] {
  const results: ParsedPathCheck[] = []
  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trim()
    const match = /^CORRAL_PATH:([^:]+):(.*):(DIR_OK|DIR_MISSING):(WRITE_OK|READONLY)$/.exec(line)
    if (!match) continue
    const status: ParsedPathCheck['status'] =
      match[3] === 'DIR_MISSING' ? 'missing' : match[4] === 'READONLY' ? 'readonly' : 'ok'
    results.push({ key: match[1], path: match[2], status })
  }
  return results
}

export function assertSafeRemotePath(path: string): void {
  if (!path.startsWith('/')) {
    throw new AppError('config', '远端路径必须是绝对路径：' + path)
  }
  if (path.includes('\0') || path.includes('\n') || path.includes('\r')) {
    throw new AppError('config', '远端路径包含非法字符')
  }
  if (path.includes('\\')) {
    throw new AppError('config', '远端路径不能包含反斜杠')
  }
  const parts = path.split('/')
  if (parts.includes('..')) {
    throw new AppError('config', '远端路径不能包含 ..')
  }
}

export function joinRemote(base: string, ...segments: string[]): string {
  assertSafeRemotePath(base)
  if (base === '/') {
    throw new AppError('config', '目标目录不能是根目录 /')
  }
  const parts = base.split('/').filter(Boolean)
  for (const segment of segments) {
    if (segment.includes('\\')) {
      throw new AppError('config', '远端路径不能包含反斜杠')
    }
    for (const part of segment.split('/')) {
      if (!part || part === '.') continue
      if (part === '..') {
        throw new AppError('config', '远端路径不能包含 ..')
      }
      parts.push(part)
    }
  }
  const result = '/' + parts.join('/')
  assertSafeRemotePath(result)
  return result
}

export function assertTargetDir(path: string): void {
  assertSafeRemotePath(path)
  if (path === '/' || path.replace(/\/+$/, '') === '') {
    throw new AppError('config', '上传目标目录不能是根目录 /')
  }
}

export function unionVars(...lists: string[][]): string[] {
  const result: string[] = []
  for (const list of lists) {
    for (const item of list) {
      if (!result.includes(item)) result.push(item)
    }
  }
  return result
}
