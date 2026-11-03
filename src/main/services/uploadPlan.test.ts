import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildUploadPlan } from './uploadPlan'

let dir = ''

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'corral-plan-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('buildUploadPlan', () => {
  it('plans a single file', async () => {
    const file = join(dir, 'app.jar')
    await writeFile(file, '12345')
    const plan = await buildUploadPlan(
      [{ id: 'u1', kind: 'file', localPath: file, targetDir: '\${workDir}/lib', conflict: 'backup' }],
      { workDir: '/opt/app' }
    )
    expect(plan.fileCount).toBe(1)
    expect(plan.totalBytes).toBe(5)
    expect(plan.items[0].files[0].targetPath).toBe('/opt/app/lib/app.jar')
  })

  it('recurses directories and keeps relative layout', async () => {
    const root = join(dir, 'dist')
    await mkdir(join(root, 'assets'), { recursive: true })
    await writeFile(join(root, 'index.html'), 'html')
    await writeFile(join(root, 'assets', 'app.js'), 'js')
    const plan = await buildUploadPlan(
      [{ id: 'u1', kind: 'dir', localPath: root, targetDir: '/opt/app/static', conflict: 'backup' }],
      {}
    )
    expect(plan.fileCount).toBe(2)
    expect(plan.items[0].dirs).toContain('assets')
    expect(plan.items[0].files.map((file) => file.rel).sort()).toEqual(['assets/app.js', 'index.html'])
    expect(plan.items[0].files.map((file) => file.targetPath).sort()).toEqual([
      '/opt/app/static/assets/app.js',
      '/opt/app/static/index.html'
    ])
  })

  it('reports missing local paths', async () => {
    const plan = await buildUploadPlan(
      [{ id: 'u1', kind: 'file', localPath: join(dir, 'missing.jar'), targetDir: '/opt/app', conflict: 'backup' }],
      {}
    )
    expect(plan.missing).toHaveLength(1)
    expect(plan.fileCount).toBe(0)
  })

  it('rejects unresolved variables and duplicate targets', async () => {
    const file = join(dir, 'a.jar')
    await writeFile(file, 'a')
    await expect(
      buildUploadPlan([{ id: 'u1', kind: 'file', localPath: file, targetDir: '\${unknown}', conflict: 'backup' }], {})
    ).rejects.toThrow()

    await expect(
      buildUploadPlan(
        [
          { id: 'u1', kind: 'file', localPath: file, targetDir: '/opt/app/lib', conflict: 'backup' },
          { id: 'u2', kind: 'file', localPath: file, targetDir: '/opt/app/lib', conflict: 'backup' }
        ],
        {}
      )
    ).rejects.toThrow()
  })
})
