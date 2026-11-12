import { describe, expect, it } from 'vitest'
import { envPathCheckTargetChanged, serverPathCheckTargetChanged } from './pathCheck'

const envTarget = {
  serverId: 's1',
  paths: [
    { key: 'workDir', path: '/opt/app' },
    { key: 'logDir', path: '/var/log/app' }
  ]
}

describe('path check targets', () => {
  it('keeps snapshots when path order changes but targets stay the same', () => {
    expect(
      envPathCheckTargetChanged(envTarget, {
        serverId: 's1',
        paths: [envTarget.paths[1], envTarget.paths[0]]
      })
    ).toBe(false)
  })

  it('invalidates snapshots when the environment server or a path changes', () => {
    expect(envPathCheckTargetChanged(envTarget, { ...envTarget, serverId: 's2' })).toBe(true)
    expect(
      envPathCheckTargetChanged(envTarget, {
        ...envTarget,
        paths: [envTarget.paths[0], { key: 'logDir', path: '/srv/logs' }]
      })
    ).toBe(true)
  })

  it('invalidates snapshots when the SSH target or login user changes', () => {
    const server = { host: '10.0.0.1', port: 22, username: 'root' }
    expect(serverPathCheckTargetChanged(server, { ...server })).toBe(false)
    expect(serverPathCheckTargetChanged(server, { ...server, host: '10.0.0.2' })).toBe(true)
    expect(serverPathCheckTargetChanged(server, { ...server, port: 2222 })).toBe(true)
    expect(serverPathCheckTargetChanged(server, { ...server, username: 'deploy' })).toBe(true)
  })
})
