import { Layout, Menu, theme, Typography } from 'antd'
import { AppstoreOutlined, CloudServerOutlined, HistoryOutlined, SettingOutlined } from '@ant-design/icons'
import { useUiStore, type Page } from '../stores/uiStore'
import { ServersPage } from '../pages/servers/ServersPage'
import { EnvsPage } from '../pages/envs/EnvsPage'
import { RunsPage } from '../pages/runs/RunsPage'
import { SettingsPage } from '../pages/settings/SettingsPage'

const ITEMS = [
  { key: 'servers', icon: <CloudServerOutlined />, label: '服务器' },
  { key: 'envs', icon: <AppstoreOutlined />, label: '开发环境' },
  { key: 'runs', icon: <HistoryOutlined />, label: '执行历史' },
  { key: 'settings', icon: <SettingOutlined />, label: '设置' }
]

export function AppLayout(): React.ReactElement {
  const page = useUiStore((state) => state.page)
  const navigate = useUiStore((state) => state.navigate)
  const { token } = theme.useToken()

  return (
    <Layout style={{ height: '100vh' }}>
      <Layout.Sider width={200} theme="light" style={{ borderRight: '1px solid ' + token.colorBorderSecondary }}>
        <div style={{ padding: '20px 16px 12px' }}>
          <Typography.Text strong style={{ fontSize: 18 }}>
            Corral
          </Typography.Text>
          <div>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              研发服务器管理
            </Typography.Text>
          </div>
        </div>
        <Menu
          mode="inline"
          selectedKeys={[page]}
          items={ITEMS}
          onClick={({ key }) => navigate(key as Page)}
          style={{ borderInlineEnd: 'none' }}
        />
      </Layout.Sider>
      <Layout>
        <Layout.Content
          style={{
            padding: 16,
            overflow: page === 'envs' ? 'hidden' : 'auto',
            background: token.colorBgLayout
          }}
        >
          {page === 'servers' ? <ServersPage /> : null}
          {page === 'envs' ? <EnvsPage /> : null}
          {page === 'runs' ? <RunsPage /> : null}
          {page === 'settings' ? <SettingsPage /> : null}
        </Layout.Content>
      </Layout>
    </Layout>
  )
}
