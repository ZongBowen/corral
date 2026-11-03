import { promises as fs } from 'node:fs'
import { basename, join } from 'node:path'
import type { UploadItem } from '@shared/types'
import { AppError } from '@shared/errors'
import { assertTargetDir, joinRemote, resolveVariables } from '@shared/command'

export interface PlannedFile {
  localPath: string
  rel: string
  targetPath: string
  size: number
}

export interface PlannedItem {
  item: UploadItem
  targetDir: string
  files: PlannedFile[]
  dirs: string[]
  totalBytes: number
}

export interface UploadPlan {
  items: PlannedItem[]
  totalBytes: number
  fileCount: number
  missing: string[]
  warnings: string[]
}

export interface PlanOptions {
  maxFiles?: number
}

export async function buildUploadPlan(
  items: UploadItem[],
  vars: Record<string, string>,
  options: PlanOptions = {}
): Promise<UploadPlan> {
  const maxFiles = options.maxFiles ?? 20000
  const plan: UploadPlan = { items: [], totalBytes: 0, fileCount: 0, missing: [], warnings: [] }
  const targets = new Set<string>()

  for (const item of items) {
    const resolved = resolveVariables(item.targetDir, vars)
    if (resolved.missing.length > 0) {
      throw new AppError('config', '上传目标目录引用了未定义的变量：' + resolved.missing.join(', '))
    }
    const targetDir = resolved.text
    assertTargetDir(targetDir)

    let stat
    try {
      stat = await fs.lstat(item.localPath)
    } catch {
      plan.missing.push(item.localPath)
      plan.items.push({
        item,
        targetDir,
        files: [],
        dirs: [],
        totalBytes: 0
      })
      continue
    }

    if (stat.isSymbolicLink()) {
      plan.warnings.push('跳过符号链接：' + item.localPath)
      continue
    }

    const planned: PlannedItem = { item, targetDir, files: [], dirs: [], totalBytes: 0 }

    if (item.kind === 'file') {
      if (!stat.isFile()) {
        throw new AppError('config', '本地路径不是文件：' + item.localPath)
      }
      const name = basename(item.localPath)
      const targetPath = joinRemote(targetDir, name)
      if (targets.has(targetPath)) {
        throw new AppError('config', '上传目标路径重复：' + targetPath)
      }
      targets.add(targetPath)
      planned.files.push({ localPath: item.localPath, rel: name, targetPath, size: stat.size })
      planned.totalBytes += stat.size
    } else {
      if (!stat.isDirectory()) {
        throw new AppError('config', '本地路径不是目录：' + item.localPath)
      }
      await walkDirectory(item.localPath, '', planned, plan.warnings, targets, targetDir, maxFiles)
    }

    plan.fileCount += planned.files.length
    if (plan.fileCount > maxFiles) {
      throw new AppError('config', '上传文件数超过 ' + String(maxFiles) + ' 个，请分批上传')
    }
    plan.totalBytes += planned.totalBytes
    plan.items.push(planned)
  }

  return plan
}

async function walkDirectory(
  root: string,
  relBase: string,
  planned: PlannedItem,
  warnings: string[],
  targets: Set<string>,
  targetDir: string,
  maxFiles: number
): Promise<void> {
  let entries
  try {
    entries = await fs.readdir(root, { withFileTypes: true })
  } catch (error) {
    throw new AppError('upload', '无法读取本地目录：' + root)
  }
  for (const entry of entries) {
    const absolute = join(root, entry.name)
    const rel = relBase ? relBase + '/' + entry.name : entry.name
    let stat
    try {
      stat = await fs.lstat(absolute)
    } catch {
      warnings.push('跳过无法读取的路径：' + absolute)
      continue
    }
    if (stat.isSymbolicLink()) {
      warnings.push('跳过符号链接：' + absolute)
      continue
    }
    if (stat.isDirectory()) {
      planned.dirs.push(rel)
      await walkDirectory(absolute, rel, planned, warnings, targets, targetDir, maxFiles)
      continue
    }
    if (!stat.isFile()) continue
    if (planned.files.length >= maxFiles) {
      throw new AppError('config', '上传文件数超过 ' + String(maxFiles) + ' 个，请分批上传')
    }
    const targetPath = joinRemote(targetDir, rel)
    if (targets.has(targetPath)) {
      throw new AppError('config', '上传目标路径重复：' + targetPath)
    }
    targets.add(targetPath)
    planned.files.push({ localPath: absolute, rel, targetPath, size: stat.size })
    planned.totalBytes += stat.size
  }
}
