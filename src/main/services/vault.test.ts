import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { VaultService } from './vault'

let dir = ''

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'corral-vault-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('VaultService', () => {
  it('stores and reads passwords through safeStorage', async () => {
    const vault = new VaultService(dir)
    await vault.init()
    await vault.setPassword('s1', 'p@ss')
    expect(vault.has('s1')).toBe(true)
    await expect(vault.getPassword('s1')).resolves.toBe('p@ss')
    await expect(vault.isBroken('s1')).resolves.toBe(false)

    const reloaded = new VaultService(dir)
    await reloaded.init()
    await expect(reloaded.getPassword('s1')).resolves.toBe('p@ss')
  })

  it('marks broken credentials without throwing', async () => {
    await writeFile(join(dir, 'secrets.json'), JSON.stringify({ s1: 'not-base64' }), 'utf8')
    const vault = new VaultService(dir)
    await vault.init()
    expect(vault.has('s1')).toBe(true)
    await expect(vault.getPassword('s1')).resolves.toBeNull()
    await expect(vault.isBroken('s1')).resolves.toBe(true)
  })

  it('removes secrets', async () => {
    const vault = new VaultService(dir)
    await vault.init()
    await vault.setPassword('s1', 'x')
    await vault.remove('s1')
    expect(vault.has('s1')).toBe(false)
  })
})
