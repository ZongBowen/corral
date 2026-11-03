import { Badge } from 'antd'
import type { RunStatus } from '@shared/types'
import type { ConnState } from '../stores/serversStore'

type Status = RunStatus | ConnState

const RUN_TEXT: Record<RunStatus, string> = {
  queued: '排队中',
  connecting: '连接中',
  validating: '校验目录',
  uploading: '上传中',
  running: '执行中',
  success: '成功',
  failed: '失败',
  timeout: '超时',
  canceled: '已取消',
  disconnected: '连接中断'
}

const RUN_BADGE: Record<RunStatus, 'default' | 'processing' | 'success' | 'error'> = {
  queued: 'default',
  connecting: 'processing',
  validating: 'processing',
  uploading: 'processing',
  running: 'processing',
  success: 'success',
  failed: 'error',
  timeout: 'error',
  canceled: 'default',
  disconnected: 'error'
}

const CONN_TEXT: Record<ConnState, string> = {
  unknown: '未检测',
  checking: '检测中',
  online: '在线',
  offline: '离线'
}

const CONN_BADGE: Record<ConnState, 'default' | 'processing' | 'success' | 'error'> = {
  unknown: 'default',
  checking: 'processing',
  online: 'success',
  offline: 'error'
}

export function isRunStatus(status: Status): status is RunStatus {
  return status in RUN_TEXT
}

export function StatusBadge({ status }: { status: Status }): React.ReactElement {
  const run = isRunStatus(status)
  return (
    <Badge
      status={run ? RUN_BADGE[status] : CONN_BADGE[status]}
      text={run ? RUN_TEXT[status] : CONN_TEXT[status]}
    />
  )
}
