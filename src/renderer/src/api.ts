import type { IpcResult } from '@shared/types'

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export async function unwrap<T>(input: Promise<IpcResult<T>>): Promise<T> {
  const result = await input
  if (!result.ok) throw new ApiError(result.error.code, result.error.message)
  return result.data
}

export function errorText(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}
