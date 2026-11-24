import { mkdtemp, rm } from 'node:fs/promises'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { KnownHostsService, fingerprint } from './knownHosts'

let dir = ''

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'corral-known-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('KnownHostsService', () => {
  it('computes stable sha256 fingerprints', () => {
    expect(fingerprint(Buffer.from('abc'))).toBe(
      'SHA256:ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0'
    )
  })

  it('trusts, reads and removes records', async () => {
    const service = new KnownHostsService(dir)
    await service.init()
    await service.trust({
      host: '10.0.0.1',
      port: 22,
      keyType: 'ssh-ed25519',
      fingerprint: 'SHA256:abc',
      firstSeenAt: '',
      lastSeenAt: ''
    })
    expect(service.get('10.0.0.1', 22)?.fingerprint).toBe('SHA256:abc')

    const reloaded = new KnownHostsService(dir)
    await reloaded.init()
    expect(reloaded.get('10.0.0.1', 22)?.keyType).toBe('ssh-ed25519')

    await reloaded.remove('10.0.0.1', 22)
    expect(reloaded.get('10.0.0.1', 22)).toBeUndefined()
  })

  it('persists concurrent snapshots in order after a failed write', async () => {
    const service = new KnownHostsService(dir)
    await service.init()
    const record = {
      host: 'server.example',
      port: 22,
      keyType: 'ssh-ed25519',
      fingerprint: 'SHA256:abc',
      firstSeenAt: '',
      lastSeenAt: ''
    }
    await service.trust(record)
    const rename = vi.spyOn(fs, 'rename').mockRejectedValueOnce(new Error('disk write failed'))
    const touching = service.touch(record.host, record.port)
    const removing = service.remove(record.host, record.port)
    const trusting = service.trust({ ...record, port: 2222 })
    await expect(touching).rejects.toThrow('disk write failed')
    await Promise.all([removing, trusting])
    expect(rename).toHaveBeenCalledTimes(3)
    const reloaded = new KnownHostsService(dir)
    await reloaded.init()
    expect(reloaded.list()).toEqual([expect.objectContaining({ host: record.host, port: 2222 })])
  })
})
