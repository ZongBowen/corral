import { useEffect, useState } from 'react'
import { App, Badge, Button, Card, Empty, Space, Tag, Typography, theme } from 'antd'
import { DeleteOutlined, EditOutlined, SafetyCertificateOutlined, SettingOutlined, SyncOutlined } from '@ant-design/icons'
import type { DevEnv, EnvAction, PathCheck, RunPrecheck } from '@shared/types'
import { StatusBadge } from '../../components/StatusBadge'
import { RunConsole } from '../../components/RunConsole'
import { ConfirmRunModal } from '../../components/ConfirmRunModal'
import { EnvActionsDrawer } from './EnvActionsDrawer'
import { useEnvsStore } from '../../stores/envsStore'
import { useServersStore } from '../../stores/serversStore'
import { useRunStreamStore } from '../../stores/runStreamStore'
import { unwrap } from '../../api'

const PATH_STATUS: Record<PathCheck['status'], { badge: 'success' | 'warning' | 'error' | 'default'; text: string }> = {
  ok: { badge: 'success', text: '存在且可写' },
  readonly: { badge: 'warning', text: '只读' },
  missing: { badge: 'error', text: '不存在' },
  unknown: { badge: 'default', text: '未校验' }
}

export function EnvDetail({ env, onEdit }: { env: DevEnv; onEdit: () => void }): React.ReactElement {
  const { token } = theme.useToken()
  const { message, modal, notification } = App.useApp()
  const servers = useServersStore((state) => state.servers)
  const checks = useEnvsStore((state) => state.pathChecks[env.id])
  const setChecks = useEnvsStore((state) => state.setChecks)
  const upsert = useEnvsStore((state) => state.upsert)
  const removeEnv = useEnvsStore((state) => state.remove)
  const server = servers.find((item) => item.id === env.serverId)
  const testConnection = useServersStore((state) => state.test)

  const [validating, setValidating] = useState(false)
  const [detecting, setDetecting] = useState(false)
  const [serverInfo, setServerInfo] = useState<string | null>(null)
  const [pending, setPending] = useState<{ action: EnvAction; precheck: RunPrecheck } | null>(null)
  const [starting, setStarting] = useState(false)
  const [actionsOpen, setActionsOpen] = useState(false)

  const stream = useRunStreamStore((state) => {
    const runId = state.activeByEnv[env.id]
    return runId ? state.streams[runId] ?? null : null
  })
  const isRunning = useRunStreamStore((state) => {
    const runId = state.activeByEnv[env.id]
    if (!runId) return false
    const item = state.streams[runId]
    return Boolean(item && ['queued', 'connecting', 'validating', 'uploading', 'running'].includes(item.status))
  })

  useEffect(() => {
    if (!stream || stream.status !== 'failed') return
    if (!stream.errorMessage?.startsWith('目录校验失败')) return
    const actionId = stream.actionId
    notification.warning({
      key: 'path-check-' + stream.runId,
      message: '目录校验失败',
      description: stream.errorMessage,
      duration: 0,
      btn: actionId ? (
        <Button
          size="small"
          onClick={() => {
            notification.destroy('path-check-' + stream.runId)
            void startActionById(actionId, true)
          }}
        >
          仍要执行
        </Button>
      ) : undefined
    })
  }, [stream?.status, stream?.runId])

  const detect = async (): Promise<void> => {
    setDetecting(true)
    try {
      const result = await testConnection(env.serverId)
      if (result.ok) {
        setServerInfo(
          (result.os ?? 'Linux') +
            ' · 内核 ' +
            (result.kernel ?? '—') +
            (result.username ? ' · ' + result.username : '')
        )
        void message.success('服务器在线')
      } else {
        void message.error(result.errorMessage ?? '连接失败')
      }
    } catch (error) {
      void message.error(error instanceof Error ? error.message : String(error))
    } finally {
      setDetecting(false)
    }
  }

  const validate = async (): Promise<void> => {
    setValidating(true)
    try {
      const result = await unwrap(window.api.env.validatePaths({ envId: env.id }))
      setChecks(env.id, result)
      const bad = result.filter((item) => item.status !== 'ok')
      if (bad.length === 0) void message.success('目录校验通过')
      else void message.warning('有 ' + String(bad.length) + ' 个目录不可用')
    } catch (error) {
      void message.error(error instanceof Error ? error.message : String(error))
    } finally {
      setValidating(false)
    }
  }

  const startActionById = async (actionId: string, force = false): Promise<void> => {
    const action = env.actions.find((item) => item.id === actionId)
    if (!action) return
    await beginRun(action, null, force)
  }

  const beginRun = async (
    action: EnvAction,
    precheck: RunPrecheck | null,
    force = false
  ): Promise<void> => {
    try {
      setStarting(true)
      const result = await unwrap(
        window.api.run.start({ envId: env.id, actionId: action.id, force })
      )
      useRunStreamStore.getState().begin(result.runId, env.id, action.id)
      setPending(null)
      void message.success('已开始执行「' + action.name + '」')
    } catch (error) {
      void message.error(error instanceof Error ? error.message : String(error))
    } finally {
      setStarting(false)
    }
  }

  const requestRun = async (action: EnvAction): Promise<void> => {
    try {
      const precheck = await unwrap(
        window.api.run.precheck({ envId: env.id, actionId: action.id })
      )
      if (action.confirm || precheck.missing.length > 0 || precheck.warnings.length > 0) {
        setPending({ action, precheck })
        return
      }
      await beginRun(action, precheck)
    } catch (error) {
      void message.error(error instanceof Error ? error.message : String(error))
    }
  }

  const remove = (): void => {
    modal.confirm({
      title: '删除环境「' + env.name + '」？',
      content: '历史执行记录会保留。',
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        await unwrap(window.api.env.remove(env.id))
        removeEnv(env.id)
        void message.success('环境已删除')
      }
    })
  }

  const saveActions = async (actions: EnvAction[]): Promise<void> => {
    const updated = await unwrap(
      window.api.env.update({
        id: env.id,
        input: {
          serverId: env.serverId,
          name: env.name,
          description: env.description,
          paths: env.paths,
          actions
        }
      })
    )
    upsert(updated)
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-start', marginBottom: 16 }}>
        <div>
          <Space align="center">
            <Typography.Title level={4} style={{ margin: 0 }}>
              {env.name}
            </Typography.Title>
            {isRunning ? <Tag color="processing">执行中</Tag> : null}
          </Space>
          <div style={{ marginTop: 4 }}>
            <Typography.Text type="secondary">
              {server ? server.name + ' · ' + server.host + ':' + String(server.port) : '服务器已删除'}
              {serverInfo ? ' · ' + serverInfo : ''}
            </Typography.Text>
          </div>
          {env.description ? (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {env.description}
            </Typography.Text>
          ) : null}
        </div>
        <div style={{ flex: 1 }} />
        <Space>
          <Button icon={<SyncOutlined />} loading={detecting} onClick={() => void detect()}>
            检测
          </Button>
          <Button icon={<SettingOutlined />} onClick={() => setActionsOpen(true)}>
            配置操作
          </Button>
          <Button icon={<EditOutlined />} onClick={onEdit}>
            编辑
          </Button>
          <Button danger icon={<DeleteOutlined />} onClick={remove}>
            删除
          </Button>
        </Space>
      </div>

      <Card
        size="small"
        title="目录配置"
        extra={
          <Button
            size="small"
            icon={<SafetyCertificateOutlined />}
            loading={validating}
            onClick={() => void validate()}
          >
            校验
          </Button>
        }
        style={{ marginBottom: 16 }}
      >
        <Space orientation="vertical" size={6} style={{ width: '100%' }}>
          {env.paths.map((entry) => {
            const check = checks?.find((item) => item.key === entry.key && item.path === entry.path)
            const status = PATH_STATUS[check?.status ?? 'unknown']
            return (
              <div key={entry.key} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <Typography.Text style={{ width: 120 }}>{entry.label}</Typography.Text>
                <Typography.Text className="corral-code" style={{ fontSize: 12, opacity: 0.85 }}>
                  {entry.path}
                </Typography.Text>
                <div style={{ flex: 1 }} />
                <Badge status={status.badge} text={status.text} />
              </div>
            )
          })}
        </Space>
      </Card>

      <Card size="small" title="操作" style={{ marginBottom: 16 }}>
        {env.actions.length === 0 ? (
          <Empty description="还没有配置操作">
            <Button type="primary" onClick={() => setActionsOpen(true)}>
              配置操作
            </Button>
          </Empty>
        ) : (
          <Space wrap>
            {env.actions.map((action, index) => {
              const primary = index === 0 && !action.danger
              return (
                <Button
                  key={action.id}
                  type={primary ? 'primary' : 'default'}
                  color={action.danger ? 'danger' : undefined}
                  variant={action.danger ? 'solid' : undefined}
                  disabled={isRunning}
                  onClick={() => void requestRun(action)}
                >
                  {action.name}
                </Button>
              )
            })}
          </Space>
        )}
        {isRunning ? (
          <div style={{ marginTop: 8 }}>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              当前环境有执行中的任务，操作按钮已禁用。
            </Typography.Text>
          </div>
        ) : null}
      </Card>

      <Card size="small" title="执行输出" styles={{ body: { padding: 0 } }}>
        <RunConsole env={env} />
      </Card>

      <ConfirmRunModal
        open={Boolean(pending)}
        action={pending?.action ?? null}
        precheck={pending?.precheck ?? null}
        loading={starting}
        onCancel={() => setPending(null)}
        onConfirm={() => {
          if (pending) void beginRun(pending.action, pending.precheck)
        }}
      />

      <EnvActionsDrawer
        open={actionsOpen}
        env={env}
        onClose={() => setActionsOpen(false)}
        onSave={saveActions}
      />
    </div>
  )
}
