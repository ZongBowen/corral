import { useEffect, useMemo, useState } from 'react'
import { App, Button, Empty, Input, Space, Tree, Typography, theme } from 'antd'
import { PlusOutlined } from '@ant-design/icons'
import type { DataNode } from 'antd/es/tree'
import { useEnvsStore } from '../../stores/envsStore'
import { useServersStore } from '../../stores/serversStore'
import { useUiStore } from '../../stores/uiStore'
import { EnvDrawer } from './EnvDrawer'
import { EnvDetail } from './EnvDetail'

export function EnvsPage(): React.ReactElement {
  const { token } = theme.useToken()
  const { message } = App.useApp()
  const envs = useEnvsStore((state) => state.envs)
  const loadEnvs = useEnvsStore((state) => state.load)
  const servers = useServersStore((state) => state.servers)
  const loadServers = useServersStore((state) => state.load)
  const selectedEnvId = useUiStore((state) => state.selectedEnvId)
  const selectEnv = useUiStore((state) => state.selectEnv)

  const [keyword, setKeyword] = useState('')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editing, setEditing] = useState<import('@shared/types').DevEnv | null>(null)
  const [expandedKeys, setExpandedKeys] = useState<string[]>([])

  useEffect(() => {
    void loadEnvs()
    void loadServers()
  }, [loadEnvs, loadServers])

  useEffect(() => {
    if (envs.length > 0 && (!selectedEnvId || !envs.some((env) => env.id === selectedEnvId))) {
      selectEnv(envs[0].id)
    }
  }, [envs, selectedEnvId, selectEnv])

  const filteredEnvs = useMemo(() => {
    const text = keyword.trim().toLowerCase()
    if (!text) return envs
    return envs.filter(
      (env) =>
        env.name.toLowerCase().includes(text) ||
        (servers.find((server) => server.id === env.serverId)?.name ?? '').toLowerCase().includes(text)
    )
  }, [envs, keyword, servers])

  const treeData: DataNode[] = useMemo(() => {
    const map = new Map<string, DataNode>()
    for (const server of servers) {
      map.set(server.id, {
        key: 'server:' + server.id,
        title: server.name,
        selectable: false,
        children: []
      })
    }
    for (const env of filteredEnvs) {
      const node = map.get(env.serverId)
      if (!node) continue
      node.children = node.children ?? []
      node.children.push({ key: 'env:' + env.id, title: env.name, isLeaf: true })
    }
    return Array.from(map.values()).filter((node) => (node.children?.length ?? 0) > 0)
  }, [servers, filteredEnvs])

  useEffect(() => {
    setExpandedKeys(treeData.map((node) => String(node.key)))
  }, [treeData])

  const selectedEnv = envs.find((env) => env.id === selectedEnvId) ?? null

  return (
    <div style={{ display: 'flex', gap: 16, height: '100%' }}>
      <div
        style={{
          width: 280,
          flexShrink: 0,
          border: '1px solid ' + token.colorBorderSecondary,
          borderRadius: token.borderRadiusLG,
          padding: 12,
          background: token.colorBgContainer,
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
          <Typography.Text strong>开发环境</Typography.Text>
          <div style={{ flex: 1 }} />
          <Button
            size="small"
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => {
              setEditing(null)
              setDrawerOpen(true)
            }}
          >
            新增
          </Button>
        </div>
        <Input.Search
          allowClear
          placeholder="搜索环境或服务器"
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
          style={{ marginBottom: 8 }}
        />
        <div style={{ flex: 1, overflow: 'auto' }}>
          {treeData.length === 0 ? (
            <Empty description="还没有环境" image={Empty.PRESENTED_IMAGE_SIMPLE} />
          ) : (
            <Tree
              blockNode
              treeData={treeData}
              expandedKeys={expandedKeys}
              selectedKeys={selectedEnvId ? ['env:' + selectedEnvId] : []}
              onExpand={(keys) => setExpandedKeys(keys.map(String))}
              onSelect={(keys) => {
                const key = String(keys[0] ?? '')
                if (key.startsWith('env:')) selectEnv(key.slice(4))
              }}
            />
          )}
        </div>
        {selectedEnv ? (
          <Button
            style={{ marginTop: 8 }}
            onClick={() => {
              setEditing(selectedEnv)
              setDrawerOpen(true)
            }}
          >
            编辑当前环境
          </Button>
        ) : null}
      </div>

      <div style={{ flex: 1, minWidth: 0, overflow: 'auto' }}>
        {selectedEnv ? (
          <EnvDetail
            env={selectedEnv}
            onEdit={() => {
              setEditing(selectedEnv)
              setDrawerOpen(true)
            }}
          />
        ) : (
          <CardishEmpty onCreate={() => {
            setEditing(null)
            setDrawerOpen(true)
          }} />
        )}
      </div>

      <EnvDrawer
        open={drawerOpen}
        env={editing}
        onClose={() => setDrawerOpen(false)}
      />
    </div>
  )
}

function CardishEmpty({ onCreate }: { onCreate: () => void }): React.ReactElement {
  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 400
      }}
    >
      <Empty description="选择左侧环境，或创建一个新的开发环境">
        <Space>
          <Button type="primary" onClick={onCreate}>
            新增环境
          </Button>
        </Space>
      </Empty>
    </div>
  )
}
