import { useEffect, useMemo, useState } from 'react'
import {
  App,
  Button,
  Dropdown,
  Empty,
  Input,
  Select,
  Space,
  Table,
  Tag,
  Typography
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { EllipsisOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons'
import type { ServerInput, ServerSummary, TestResult } from '@shared/types'
import { StatusBadge } from '../../components/StatusBadge'
import { ServerDrawer } from './ServerDrawer'
import { useServersStore } from '../../stores/serversStore'
import { useEnvsStore } from '../../stores/envsStore'
import { unwrap } from '../../api'
import { formatDateTime } from '../../utils/format'

export function ServersPage(): React.ReactElement {
  const { message, modal, notification } = App.useApp()
  const servers = useServersStore((state) => state.servers)
  const loading = useServersStore((state) => state.loading)
  const statuses = useServersStore((state) => state.statuses)
  const load = useServersStore((state) => state.load)
  const removeServer = useServersStore((state) => state.remove)
  const testConnection = useServersStore((state) => state.test)
  const reloadServers = useServersStore((state) => state.load)
  const envs = useEnvsStore((state) => state.envs)
  const loadEnvs = useEnvsStore((state) => state.load)

  const [keyword, setKeyword] = useState('')
  const [tagFilter, setTagFilter] = useState<string | undefined>(undefined)
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editing, setEditing] = useState<ServerSummary | null>(null)
  const [seed, setSeed] = useState<Partial<ServerInput> | null>(null)

  useEffect(() => {
    void load()
    void loadEnvs()
  }, [load, loadEnvs])

  const tags = useMemo(() => {
    const set = new Set<string>()
    servers.forEach((server) => server.tags.forEach((tag) => set.add(tag)))
    return Array.from(set)
  }, [servers])

  const filtered = useMemo(() => {
    const text = keyword.trim().toLowerCase()
    return servers.filter((server) => {
      if (tagFilter && !server.tags.includes(tagFilter)) return false
      if (statusFilter) {
        const state = statuses[server.id] ?? 'unknown'
        if (state !== statusFilter) return false
      }
      if (!text) return true
      return (
        server.name.toLowerCase().includes(text) ||
        server.host.toLowerCase().includes(text) ||
        (server.description ?? '').toLowerCase().includes(text) ||
        server.tags.some((tag) => tag.toLowerCase().includes(text))
      )
    })
  }, [servers, keyword, tagFilter, statusFilter, statuses])

  const openCreate = (): void => {
    setEditing(null)
    setSeed(null)
    setDrawerOpen(true)
  }

  const openEdit = (server: ServerSummary): void => {
    setEditing(server)
    setSeed(null)
    setDrawerOpen(true)
  }

  const openCopy = (server: ServerSummary): void => {
    setEditing(null)
    setSeed({
      name: server.name + ' 副本',
      host: server.host,
      port: server.port,
      username: server.username,
      description: server.description,
      tags: server.tags
    })
    setDrawerOpen(true)
  }

  const runTest = async (server: ServerSummary): Promise<void> => {
    try {
      const result: TestResult = await testConnection(server.id)
      if (result.ok) {
        void reloadServers(true)
        notification.success({
          message: server.name + ' 连接成功',
          description:
            (result.os ?? 'Linux') +
            ' · 内核 ' + (result.kernel ?? '—') +
            ' · ' + String(result.durationMs) + 'ms'
        })
      } else {
        notification.error({
          message: server.name + ' 连接失败',
          description: result.errorMessage ?? '未知错误'
        })
      }
    } catch (error) {
      notification.error({
        message: '连接失败',
        description: error instanceof Error ? error.message : String(error)
      })
    }
  }

  const confirmDelete = (server: ServerSummary): void => {
    const count = envs.filter((env) => env.serverId === server.id).length
    modal.confirm({
      title: '删除服务器「' + server.name + '」？',
      content:
        count > 0
          ? '将同时删除 ' + String(count) + ' 个开发环境，历史执行记录会保留。'
          : '删除后凭据与主机指纹记录将一并清除。',
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        await unwrap(window.api.server.remove(server.id))
        removeServer(server.id)
        await loadEnvs(true)
        void message.success('服务器已删除')
      }
    })
  }

  const columns: ColumnsType<ServerSummary> = [
    {
      title: '名称',
      dataIndex: 'name',
      render: (_, server) => (
        <Space orientation="vertical" size={0}>
          <Typography.Text strong>{server.name}</Typography.Text>
          {server.description ? (
            <Typography.Text type="secondary" style={{ fontSize: 12 }} ellipsis>
              {server.description}
            </Typography.Text>
          ) : null}
        </Space>
      )
    },
    {
      title: '地址',
      dataIndex: 'host',
      width: 190,
      render: (_, server) => server.host + ':' + String(server.port)
    },
    { title: '账号', dataIndex: 'username', width: 120 },
    {
      title: '标签',
      dataIndex: 'tags',
      width: 180,
      render: (tags: string[]) => (
        <Space size={4} wrap>
          {tags.map((tag) => (
            <Tag key={tag}>{tag}</Tag>
          ))}
        </Space>
      )
    },
    {
      title: '状态',
      width: 110,
      render: (_, server) => <StatusBadge status={statuses[server.id] ?? 'unknown'} />
    },
    {
      title: '最近连接',
      dataIndex: 'lastConnectedAt',
      width: 170,
      render: (value?: string) => formatDateTime(value)
    },
    {
      title: '操作',
      width: 70,
      render: (_, server) => (
        <Dropdown
          menu={{
            items: [
              { key: 'edit', label: '编辑' },
              { key: 'test', label: '测试连接' },
              { key: 'copy', label: '复制' },
              { type: 'divider' },
              { key: 'delete', label: '删除', danger: true }
            ],
            onClick: ({ key }) => {
              if (key === 'edit') openEdit(server)
              if (key === 'test') void runTest(server)
              if (key === 'copy') openCopy(server)
              if (key === 'delete') confirmDelete(server)
            }
          }}
        >
          <Button type="text" icon={<EllipsisOutlined />} />
        </Dropdown>
      )
    }
  ]

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          服务器
        </Typography.Title>
        <div style={{ flex: 1 }} />
        <Space>
          <Button icon={<ReloadOutlined />} onClick={() => void load(true)} loading={loading}>
            刷新
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            新增服务器
          </Button>
        </Space>
      </div>

      <Space style={{ marginBottom: 12 }} wrap>
        <Input.Search
          allowClear
          placeholder="搜索名称 / IP / 描述 / 标签"
          style={{ width: 280 }}
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
        />
        <Select
          allowClear
          placeholder="标签"
          style={{ width: 140 }}
          value={tagFilter}
          options={tags.map((tag) => ({ value: tag, label: tag }))}
          onChange={setTagFilter}
        />
        <Select
          allowClear
          placeholder="状态"
          style={{ width: 140 }}
          value={statusFilter}
          options={[
            { value: 'online', label: '在线' },
            { value: 'offline', label: '离线' },
            { value: 'unknown', label: '未检测' }
          ]}
          onChange={setStatusFilter}
        />
      </Space>

      <Table
        rowKey="id"
        columns={columns}
        dataSource={filtered}
        loading={loading}
        pagination={{ pageSize: 20, showSizeChanger: false }}
        locale={{
          emptyText: (
            <Empty description="还没有服务器">
              <Button type="primary" onClick={openCreate}>
                新增服务器
              </Button>
            </Empty>
          )
        }}
      />

      <ServerDrawer
        open={drawerOpen}
        editing={editing}
        seed={seed}
        onClose={() => setDrawerOpen(false)}
      />
    </div>
  )
}
