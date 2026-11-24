import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  App,
  Button,
  DatePicker,
  Descriptions,
  Drawer,
  Empty,
  Input,
  Select,
  Space,
  Table,
  Typography,
  theme
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { DeleteOutlined, ExportOutlined, ReloadOutlined } from '@ant-design/icons'
import type { Dayjs } from 'dayjs'
import type { Run, RunFilter, RunStatus } from '@shared/types'
import { StatusBadge } from '../../components/StatusBadge'
import { AnsiText } from '../../components/AnsiText'
import { useRunsStore } from '../../stores/runsStore'
import { useEnvsStore } from '../../stores/envsStore'
import { useServersStore } from '../../stores/serversStore'
import { unwrap } from '../../api'
import { formatBytes, formatDateTime, formatDuration } from '../../utils/format'

const { RangePicker } = DatePicker

const STATUS_OPTIONS: { value: RunStatus; label: string }[] = [
  { value: 'success', label: '成功' },
  { value: 'failed', label: '失败' },
  { value: 'timeout', label: '超时' },
  { value: 'canceled', label: '已取消' },
  { value: 'disconnected', label: '连接中断' }
]

export function RunsPage(): React.ReactElement {
  const { message, modal } = App.useApp()
  const { token } = theme.useToken()
  const runs = useRunsStore((state) => state.runs)
  const loading = useRunsStore((state) => state.loading)
  const load = useRunsStore((state) => state.load)
  const removeRun = useRunsStore((state) => state.remove)
  const clearRuns = useRunsStore((state) => state.clear)
  const envs = useEnvsStore((state) => state.envs)
  const servers = useServersStore((state) => state.servers)

  const [serverId, setServerId] = useState<string | undefined>(undefined)
  const [envId, setEnvId] = useState<string | undefined>(undefined)
  const [status, setStatus] = useState<RunStatus | undefined>(undefined)
  const [keyword, setKeyword] = useState('')
  const [range, setRange] = useState<[Dayjs, Dayjs] | null>(null)
  const [detail, setDetail] = useState<Run | null>(null)
  const [logText, setLogText] = useState('')
  const [logOffset, setLogOffset] = useState(0)
  const [logEof, setLogEof] = useState(true)
  const [logLoading, setLogLoading] = useState(false)
  const tableContainerRef = useRef<HTMLDivElement>(null)
  const [tableBodyHeight, setTableBodyHeight] = useState<number | undefined>(undefined)

  useEffect(() => {
    void load()
    void useEnvsStore.getState().load()
    void useServersStore.getState().load()
  }, [load])

  useLayoutEffect(() => {
    const container = tableContainerRef.current
    if (!container) return

    const updateTableBodyHeight = (): void => {
      const header = container.querySelector<HTMLElement>('.ant-table-thead')
      const pagination = container.querySelector<HTMLElement>('.ant-pagination')
      let paginationHeight = 0
      if (pagination && pagination.getClientRects().length > 0) {
        const { marginTop, marginBottom } = window.getComputedStyle(pagination)
        paginationHeight =
          pagination.offsetHeight + parseFloat(marginTop) + parseFloat(marginBottom)
      }
      const nextHeight = Math.max(
        0,
        Math.floor(container.clientHeight - (header?.offsetHeight ?? 0) - paginationHeight)
      )
      setTableBodyHeight((current) => (current === nextHeight ? current : nextHeight))
    }

    updateTableBodyHeight()
    const observer = new ResizeObserver(updateTableBodyHeight)
    observer.observe(container)
    const header = container.querySelector<HTMLElement>('.ant-table-thead')
    const pagination = container.querySelector<HTMLElement>('.ant-pagination')
    if (header) observer.observe(header)
    if (pagination) observer.observe(pagination)
    return () => observer.disconnect()
  }, [runs.length])

  const query = (): void => {
    const filter: RunFilter = {
      serverId,
      envId,
      status,
      keyword: keyword.trim() || undefined,
      from: range?.[0]?.startOf('day').toISOString(),
      to: range?.[1]?.endOf('day').toISOString()
    }
    void load(filter)
  }

  const openDetail = async (run: Run): Promise<void> => {
    setDetail(run)
    setLogText('')
    setLogOffset(0)
    setLogEof(false)
    setLogLoading(true)
    try {
      const chunk = await unwrap(
        window.api.run.readLog({ runId: run.id, offset: 0, limit: 262144 })
      )
      setLogText(chunk.content)
      setLogOffset(chunk.nextOffset)
      setLogEof(chunk.eof)
    } catch (error) {
      void message.error(error instanceof Error ? error.message : String(error))
    } finally {
      setLogLoading(false)
    }
  }

  const loadMore = async (): Promise<void> => {
    if (!detail) return
    setLogLoading(true)
    try {
      const chunk = await unwrap(
        window.api.run.readLog({ runId: detail.id, offset: logOffset, limit: 262144 })
      )
      setLogText((current) => current + chunk.content)
      setLogOffset(chunk.nextOffset)
      setLogEof(chunk.eof)
    } finally {
      setLogLoading(false)
    }
  }

  const exportLog = async (run: Run): Promise<void> => {
    try {
      const result = await unwrap(window.api.run.exportLog(run.id))
      if (result) void message.success('已导出到 ' + result.filePath)
    } catch (error) {
      void message.error(error instanceof Error ? error.message : String(error))
    }
  }

  const remove = (run: Run): void => {
    modal.confirm({
      title: '删除这条执行记录？',
      content: '日志文件将一并删除。',
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        await removeRun(run.id)
        if (detail?.id === run.id) setDetail(null)
        void message.success('已删除')
      }
    })
  }

  const clearAll = (): void => {
    modal.confirm({
      title: '清空执行历史？',
      content: '将删除全部执行记录与日志文件，此操作不可撤销。',
      okText: '清空',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        await clearRuns()
        setDetail(null)
        void message.success('已清空')
      }
    })
  }

  const columns: ColumnsType<Run> = [
    {
      title: '开始时间',
      dataIndex: 'startedAt',
      width: 175,
      render: (value: string) => formatDateTime(value)
    },
    {
      title: '服务器 / 环境',
      width: 220,
      ellipsis: true,
      render: (_, run) => run.serverName + ' / ' + run.envName
    },
    { title: '操作', dataIndex: 'actionName', width: 120 },
    {
      title: '状态',
      width: 130,
      render: (_, run) => <StatusBadge status={run.status} />
    },
    {
      title: '耗时',
      width: 100,
      render: (_, run) => formatDuration(run.durationMs)
    },
    {
      title: '退出码',
      dataIndex: 'exitCode',
      width: 90,
      render: (value?: number) => (value === undefined ? '—' : String(value))
    },
    {
      title: '上传',
      width: 170,
      render: (_, run) =>
        run.uploadMode === 'skip'
          ? '已跳过'
          : run.uploadStats
            ? String(run.uploadStats.fileCount) +
              ' 个文件 · ' +
              formatBytes(run.uploadStats.totalBytes)
            : '—'
    },
    {
      title: '操作',
      width: 100,
      render: (_, run) => (
        <Space size={0}>
          <Button size="small" type="link" onClick={() => void openDetail(run)}>
            详情
          </Button>
          <Button
            size="small"
            type="link"
            danger
            icon={<DeleteOutlined />}
            onClick={() => remove(run)}
          />
        </Space>
      )
    }
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0, marginBottom: 12 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          执行历史
        </Typography.Title>
        <div style={{ flex: 1 }} />
        <Space>
          <Button icon={<ReloadOutlined />} onClick={() => void load()} loading={loading}>
            刷新
          </Button>
          <Button danger onClick={clearAll}>
            清空
          </Button>
        </Space>
      </div>

      <Space style={{ flexShrink: 0, marginBottom: 8 }} wrap>
        <Select
          allowClear
          placeholder="服务器"
          style={{ width: 180 }}
          value={serverId}
          options={servers.map((server) => ({ value: server.id, label: server.name }))}
          onChange={setServerId}
        />
        <Select
          allowClear
          placeholder="环境"
          style={{ width: 180 }}
          value={envId}
          options={envs.map((env) => ({ value: env.id, label: env.name }))}
          onChange={setEnvId}
        />
        <Select
          allowClear
          placeholder="状态"
          style={{ width: 130 }}
          value={status}
          options={STATUS_OPTIONS}
          onChange={setStatus}
        />
        <Input
          allowClear
          placeholder="搜索操作或环境"
          style={{ width: 220 }}
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
          onPressEnter={query}
        />
        <RangePicker value={range} onChange={(value) => setRange(value as [Dayjs, Dayjs] | null)} />
        <Button type="primary" onClick={query}>
          查询
        </Button>
      </Space>

      <div ref={tableContainerRef} style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
        <Table
          rowKey="id"
          size="small"
          columns={columns}
          dataSource={runs}
          loading={loading}
          scroll={{ y: tableBodyHeight }}
          pagination={{ pageSize: 15, showSizeChanger: false }}
          locale={{ emptyText: <Empty description="暂无执行记录" /> }}
          onRow={(run) => ({ onDoubleClick: () => void openDetail(run) })}
        />
      </div>

      <Drawer
        open={Boolean(detail)}
        size={760}
        title={detail ? detail.envName + ' · ' + detail.actionName : '执行详情'}
        onClose={() => setDetail(null)}
        extra={
          detail ? (
            <Space>
              <Button icon={<ExportOutlined />} onClick={() => void exportLog(detail)}>
                导出
              </Button>
              <Button danger icon={<DeleteOutlined />} onClick={() => remove(detail)}>
                删除
              </Button>
            </Space>
          ) : null
        }
      >
        {detail ? (
          <Space orientation="vertical" size={12} style={{ width: '100%' }}>
            <Descriptions size="small" column={2} bordered>
              <Descriptions.Item label="状态">
                <StatusBadge status={detail.status} />
              </Descriptions.Item>
              <Descriptions.Item label="退出码">{detail.exitCode ?? '—'}</Descriptions.Item>
              <Descriptions.Item label="开始时间">
                {formatDateTime(detail.startedAt)}
              </Descriptions.Item>
              <Descriptions.Item label="耗时">
                {formatDuration(detail.durationMs)}
              </Descriptions.Item>
              <Descriptions.Item label="服务器">{detail.serverName}</Descriptions.Item>
              <Descriptions.Item label="环境">{detail.envName}</Descriptions.Item>
              {detail.uploadMode === 'skip' ? (
                <Descriptions.Item label="上传" span={2}>
                  {detail.manualUploadFiles?.length
                    ? '本次跳过上传，文件名手工录入（未执行 SFTP）'
                    : '本次跳过上传（文件已手工准备）'}
                </Descriptions.Item>
              ) : null}
              {detail.uploads?.length ? (
                <Descriptions.Item label="上传清单" span={2}>
                  <Space orientation="vertical" size={4}>
                    {detail.uploads.map((item) => (
                      <Typography.Text key={item.id} style={{ fontSize: 12 }}>
                        {item.kind === 'file' ? '文件' : '目录'}{' '}
                        <span className="corral-code">
                          {item.localPath} → {item.targetDir}
                        </span>
                        {' · '}
                        {item.conflict === 'backup' ? '覆盖前备份' : '直接覆盖'}
                      </Typography.Text>
                    ))}
                  </Space>
                </Descriptions.Item>
              ) : null}
              {detail.uploadVariables && Object.keys(detail.uploadVariables).length > 0 ? (
                <Descriptions.Item label="上传变量" span={2}>
                  <Space orientation="vertical" size={4}>
                    {Object.entries(detail.uploadVariables).map(([key, value]) => (
                      <Typography.Text key={key} style={{ fontSize: 12 }}>
                        <span className="corral-code">{'${' + key + '}'}</span> = {value}
                      </Typography.Text>
                    ))}
                  </Space>
                </Descriptions.Item>
              ) : null}
              {detail.uploadStats ? (
                <Descriptions.Item label="上传统计" span={2}>
                  {String(detail.uploadStats.fileCount) +
                    ' 个文件 · 共 ' +
                    formatBytes(detail.uploadStats.totalBytes) +
                    (detail.uploadStats.backups.length > 0
                      ? ' · 备份 ' + String(detail.uploadStats.backups.length) + ' 项'
                      : '')}
                </Descriptions.Item>
              ) : null}
              {detail.errorMessage ? (
                <Descriptions.Item label="错误" span={2}>
                  <Typography.Text type="danger">{detail.errorMessage}</Typography.Text>
                </Descriptions.Item>
              ) : null}
            </Descriptions>

            <Typography.Text strong>命令</Typography.Text>
            <pre
              className="corral-code"
              style={{
                margin: 0,
                padding: 12,
                background: token.colorFillQuaternary,
                borderRadius: 8
              }}
            >
              {detail.resolvedCommand}
            </pre>

            <Typography.Text strong>日志</Typography.Text>
            <pre
              className="corral-log"
              style={{
                margin: 0,
                padding: 12,
                minHeight: 240,
                maxHeight: 480,
                overflow: 'auto',
                background: token.colorFillQuaternary,
                borderRadius: 8
              }}
            >
              {logText ? <AnsiText text={logText} /> : '（无日志）'}
            </pre>
            {!logEof ? (
              <Button loading={logLoading} onClick={() => void loadMore()}>
                加载更多
              </Button>
            ) : null}
          </Space>
        ) : null}
      </Drawer>
    </div>
  )
}
