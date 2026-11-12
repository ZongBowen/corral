import { beforeEach, describe, expect, it } from 'vitest'
import type { DevEnv, PathCheck } from '@shared/types'
import { useEnvsStore } from './envsStore'

const env: DevEnv = {
  id: 'e1',
  serverId: 's1',
  name: '测试环境',
  paths: [{ key: 'workDir', label: '工作目录', path: '/opt/app', required: true }],
  actions: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
}

const check: PathCheck = {
  key: 'workDir',
  label: '工作目录',
  path: '/opt/app',
  status: 'ok',
  checkedAt: '2026-01-01T00:00:00.000Z'
}

beforeEach(() => {
  useEnvsStore.setState({
    envs: [env],
    loading: false,
    loaded: true,
    pathChecks: { e1: [check] }
  })
})

describe('envsStore path checks', () => {
  it('preserves snapshots for changes unrelated to validation targets', () => {
    useEnvsStore.getState().upsert({ ...env, name: '新名称' })
    expect(useEnvsStore.getState().pathChecks.e1).toEqual([check])
  })

  it('clears snapshots when an environment path changes', () => {
    useEnvsStore.getState().upsert({
      ...env,
      paths: [{ ...env.paths[0], path: '/srv/app' }]
    })
    expect(useEnvsStore.getState().pathChecks.e1).toBeUndefined()
  })

  it('clears only snapshots belonging to a changed server', () => {
    const other = { ...env, id: 'e2', serverId: 's2' }
    useEnvsStore.setState({ envs: [env, other], pathChecks: { e1: [check], e2: [check] } })
    useEnvsStore.getState().clearServerChecks('s1')
    expect(useEnvsStore.getState().pathChecks).toEqual({ e2: [check] })
  })

  it('clears snapshots when removing an environment', () => {
    useEnvsStore.getState().remove(env.id)
    expect(useEnvsStore.getState().pathChecks).toEqual({})
  })
})
