import type { RunErrorKind } from './types'

export type AppErrorCode = RunErrorKind | 'internal' | 'canceled' | 'timeout'

export class AppError extends Error {
  readonly code: AppErrorCode
  readonly detail?: string

  constructor(code: AppErrorCode, message: string, detail?: string) {
    super(message)
    this.name = 'AppError'
    this.code = code
    this.detail = detail
  }
}

interface ErrorLike {
  code?: string
  level?: string
  message?: string
}

export function classifySshError(error: unknown): { kind: RunErrorKind; message: string } {
  const err = (error ?? {}) as ErrorLike
  const raw = typeof err.message === 'string' ? err.message : String(error)
  const code = err.code ?? ''
  const lower = raw.toLowerCase()

  if (code === 'ENOTFOUND' || lower.includes('getaddrinfo') || lower.includes('not found')) {
    return { kind: 'dns', message: '无法解析主机名，请检查拼写或改用 IP' }
  }
  if (code === 'ETIMEDOUT' || lower.includes('timed out') || lower.includes('timeout')) {
    return { kind: 'connect-timeout', message: '连接超时，请检查 IP、端口、防火墙或 VPN' }
  }
  if (code === 'ECONNREFUSED' || lower.includes('econnrefused')) {
    return { kind: 'refused', message: '端口拒绝连接，请确认 sshd 已启动且端口正确' }
  }
  if (
    err.level === 'client-authentication' ||
    lower.includes('all configured authentication methods failed') ||
    lower.includes('authentication failed')
  ) {
    return { kind: 'auth', message: '账号或密码错误，请重新输入密码并确认账号未被锁定' }
  }
  if (lower.includes('host key') || lower.includes('hostkey') || lower.includes('verification failed')) {
    return { kind: 'hostkey', message: '主机密钥与记录不一致，存在中间人风险，请谨慎处理' }
  }
  if (
    code === 'ECONNRESET' ||
    lower.includes('econnreset') ||
    lower.includes('channel closed') ||
    lower.includes('connection lost')
  ) {
    return { kind: 'network', message: '连接中断，命令可能仍在远端运行' }
  }
  return { kind: 'unknown', message: raw || '未知错误' }
}

export function describeExitCode(code: number): string {
  if (code === 130) return '命令被 SIGINT 中断（退出码 130）'
  if (code === 137) return '命令被 SIGKILL 终止（退出码 137）'
  return '命令退出码 ' + String(code)
}

export function toAppError(error: unknown, fallback: AppErrorCode = 'unknown'): AppError {
  if (error instanceof AppError) return error
  const classified = classifySshError(error)
  return new AppError(classified.kind ?? fallback, classified.message)
}

export function trimError(error: unknown): { code: string; message: string } {
  const appError = toAppError(error)
  return { code: appError.code, message: appError.message }
}
