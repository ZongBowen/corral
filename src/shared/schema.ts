import { z } from 'zod'

export const idSchema = z.string().min(1, 'ID 不能为空')

const hostSchema = z
  .string()
  .trim()
  .min(1, '主机不能为空')
  .max(255, '主机过长')
  .regex(/^[A-Za-z0-9._:-]+$/, '主机格式不正确')

export const serverInputSchema = z.object({
  name: z.string().trim().min(1, '名称不能为空').max(64, '名称最长 64 个字符'),
  host: hostSchema,
  port: z.number().int('端口必须是整数').min(1, '端口范围 1-65535').max(65535, '端口范围 1-65535'),
  username: z.string().trim().min(1, '账号不能为空').max(64, '账号过长'),
  password: z.string().max(512, '密码过长').optional(),
  description: z.string().max(2000, '描述最长 2000 个字符').optional(),
  tags: z.array(z.string().trim().min(1).max(32)).max(20, '标签最多 20 个').default([])
})

export const serverUpdateInputSchema = serverInputSchema.extend({
  clearPassword: z.boolean().optional()
})

export const pathEntrySchema = z.object({
  key: z
    .string()
    .trim()
    .regex(/^[A-Za-z_][A-Za-z0-9_]*$/, 'key 必须以字母或下划线开头，仅含字母、数字、下划线'),
  label: z.string().trim().min(1, '展示名不能为空').max(64),
  path: z
    .string()
    .trim()
    .min(1, '路径不能为空')
    .max(4096)
    .refine((value) => value.startsWith('/'), '路径必须是远程绝对路径（以 / 开头）')
    .refine((value) => !value.includes('\0') && !value.includes('\n') && !value.includes('\r'), '路径包含非法字符'),
  required: z.boolean().optional()
})

export const uploadItemSchema = z.object({
  id: idSchema,
  kind: z.enum(['file', 'dir']),
  localPath: z.string().trim().min(1, '本地路径不能为空').max(4096),
  targetDir: z
    .string()
    .trim()
    .min(1, '目标目录不能为空')
    .max(4096)
    .refine((value) => !value.includes('\0') && !value.includes('\n') && !value.includes('\r'), '目标目录包含非法字符'),
  conflict: z.enum(['backup', 'overwrite'])
})

export const envActionSchema = z.object({
  id: idSchema,
  name: z.string().trim().min(1, '操作名称不能为空').max(64),
  command: z.string().min(1, '命令不能为空').max(65536, '命令最长 64KB'),
  timeoutSec: z.number().int().min(0).max(86400),
  confirm: z.boolean(),
  danger: z.boolean().optional(),
  uploads: z.array(uploadItemSchema).max(50, '单个操作最多 50 个上传项')
})

export const devEnvInputSchema = z
  .object({
    serverId: idSchema,
    name: z.string().trim().min(1, '环境名称不能为空').max(64),
    description: z.string().max(2000).optional(),
    paths: z.array(pathEntrySchema).min(1, '至少配置一个目录').max(20, '目录最多 20 个'),
    actions: z.array(envActionSchema).max(30, '操作最多 30 个')
  })
  .superRefine((env, ctx) => {
    const keys = new Set<string>()
    env.paths.forEach((entry, index) => {
      if (keys.has(entry.key)) {
        ctx.addIssue({
          code: 'custom',
          message: '目录 key 不能重复',
          path: ['paths', index, 'key']
        })
      }
      keys.add(entry.key)
    })
    if (!env.paths.some((entry) => entry.key === 'workDir')) {
      ctx.addIssue({ code: 'custom', message: '必须包含 workDir 目录', path: ['paths'] })
    }
    const actionIds = new Set<string>()
    env.actions.forEach((action, index) => {
      if (actionIds.has(action.id)) {
        ctx.addIssue({ code: 'custom', message: '操作 ID 重复', path: ['actions', index, 'id'] })
      }
      actionIds.add(action.id)
    })
  })

export const settingsSchema = z.object({
  theme: z.enum(['system', 'light', 'dark']),
  defaultTimeoutSec: z.number().int().min(0).max(86400),
  validatePathsBeforeRun: z.boolean(),
  defaultConflict: z.enum(['backup', 'overwrite']),
  uploadIdleTimeoutSec: z.number().int().min(10).max(3600),
  logRetentionCount: z.number().int().min(1).max(10000),
  logRetentionDays: z.number().int().min(1).max(3650),
  outputEncoding: z.enum(['utf-8', 'gbk']),
  legacySshAlgorithms: z.boolean()
})

export const settingsUpdateSchema = settingsSchema.partial()

export const runStatusSchema = z.enum([
  'queued',
  'connecting',
  'validating',
  'uploading',
  'running',
  'success',
  'failed',
  'timeout',
  'canceled',
  'disconnected'
])

export const runErrorKindSchema = z.enum([
  'dns',
  'connect-timeout',
  'refused',
  'auth',
  'hostkey',
  'network',
  'remote',
  'config',
  'upload',
  'unknown'
])

export const serverSchema = z.object({
  id: idSchema,
  name: z.string(),
  host: z.string(),
  port: z.number(),
  username: z.string(),
  description: z.string().optional(),
  tags: z.array(z.string()).default([]),
  createdAt: z.string(),
  updatedAt: z.string(),
  lastConnectedAt: z.string().optional()
})

export const devEnvSchema = z.object({
  id: idSchema,
  serverId: idSchema,
  name: z.string(),
  description: z.string().optional(),
  paths: z.array(pathEntrySchema),
  actions: z.array(envActionSchema),
  createdAt: z.string(),
  updatedAt: z.string()
})

export const uploadStatsSchema = z.object({
  itemCount: z.number(),
  fileCount: z.number(),
  totalBytes: z.number(),
  transferredBytes: z.number(),
  durationMs: z.number().optional(),
  backups: z.array(z.string())
})

export const runSchema = z.object({
  id: idSchema,
  envId: idSchema,
  envName: z.string(),
  serverId: idSchema,
  serverName: z.string(),
  actionId: idSchema,
  actionName: z.string(),
  command: z.string(),
  resolvedCommand: z.string(),
  status: runStatusSchema,
  exitCode: z.number().optional(),
  errorKind: runErrorKindSchema.optional(),
  errorMessage: z.string().optional(),
  startedAt: z.string(),
  endedAt: z.string().optional(),
  durationMs: z.number().optional(),
  logBytes: z.number().optional(),
  remotePid: z.number().optional(),
  uploadStats: uploadStatsSchema.optional()
})

export const storeFileSchema = z.object({
  schemaVersion: z.number().int().min(1),
  servers: z.array(serverSchema),
  envs: z.array(devEnvSchema),
  runs: z.array(runSchema),
  settings: settingsSchema
})

export const logEntrySchema = z.object({
  t: z.number(),
  s: z.enum(['out', 'err', 'sys']),
  d: z.string()
})

export const serverTestPayloadSchema = z
  .object({
    id: idSchema.optional(),
    input: serverInputSchema.optional()
  })
  .refine((value) => Boolean(value.id) !== Boolean(value.input), {
    message: '必须提供 id 或临时服务器信息'
  })

export const serverUpdatePayloadSchema = z.object({
  id: idSchema,
  input: serverUpdateInputSchema
})

export const envUpdatePayloadSchema = z.object({
  id: idSchema,
  input: devEnvInputSchema
})

export const envValidatePayloadSchema = z.object({
  envId: idSchema
})

export const runStartSchema = z.object({
  envId: idSchema,
  actionId: idSchema,
  force: z.boolean().optional()
})

export const runCancelSchema = z.object({
  runId: idSchema
})

export const runPrecheckSchema = z.object({
  envId: idSchema,
  actionId: idSchema
})

export const runReadLogSchema = z.object({
  runId: idSchema,
  offset: z.number().int().min(0).default(0),
  limit: z.number().int().min(1).max(1048576).default(262144)
})

export const runFilterSchema = z.object({
  envId: idSchema.optional(),
  serverId: idSchema.optional(),
  status: runStatusSchema.optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  keyword: z.string().max(200).optional(),
  offset: z.number().int().min(0).optional(),
  limit: z.number().int().min(1).max(500).optional()
})

export const runIdSchema = z.object({
  runId: idSchema
})

export const hostKeyDecisionSchema = z.object({
  challengeId: idSchema,
  accept: z.boolean()
})

export const dialogPickFilesSchema = z.object({
  multiple: z.boolean().optional()
})

export const exportConfigSchema = z.object({
  filePath: z.string().min(1)
})

export type ServerInputSchema = z.infer<typeof serverInputSchema>
export type DevEnvInputSchema = z.infer<typeof devEnvInputSchema>
