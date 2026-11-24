import type { PathEntry, Server } from './types'

export interface EnvPathCheckTarget {
  serverId: string
  paths: Array<Pick<PathEntry, 'key' | 'path'>>
}

export type ServerPathCheckTarget = Pick<Server, 'host' | 'port' | 'username'>

export function envPathCheckTargetChanged(
  previous: EnvPathCheckTarget,
  next: EnvPathCheckTarget
): boolean {
  if (previous.serverId !== next.serverId || previous.paths.length !== next.paths.length)
    return true
  const nextPaths = new Map(next.paths.map((entry) => [entry.key, entry.path]))
  return previous.paths.some((entry) => nextPaths.get(entry.key) !== entry.path)
}

export function serverPathCheckTargetChanged(
  previous: ServerPathCheckTarget,
  next: ServerPathCheckTarget
): boolean {
  return (
    previous.host !== next.host ||
    previous.port !== next.port ||
    previous.username !== next.username
  )
}
