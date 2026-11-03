import { useCallback, useEffect, useState } from 'react'
import { App as AntdApp, ConfigProvider, Spin, theme } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import type { AppNotice } from '@shared/types'
import { AppLayout } from './layouts/AppLayout'
import { HostKeyModal } from './components/HostKeyModal'
import { useSettingsStore } from './stores/settingsStore'
import { useServersStore } from './stores/serversStore'
import { useEnvsStore } from './stores/envsStore'
import { useRunStreamStore } from './stores/runStreamStore'
import { useAppEvents } from './hooks/useAppEvents'

function useSystemDark(): boolean {
  const [dark, setDark] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)').matches : false
  )
  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (event: MediaQueryListEvent): void => setDark(event.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])
  return dark
}

function AppInner(): React.ReactElement {
  const { notification } = AntdApp.useApp()
  const settings = useSettingsStore((state) => state.settings)
  const [booted, setBooted] = useState(false)
  const [bootError, setBootError] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      try {
        const result = await window.api.app.getBootState()
        if (!result.ok) {
          setBootError(result.error.message)
          return
        }
        const boot = result.data
        useSettingsStore.setState({ settings: boot.settings, loaded: true })
        useServersStore.setState({ servers: boot.servers, loaded: true })
        useEnvsStore.setState({ envs: boot.envs, loaded: true })
        for (const runId of boot.activeRunIds) {
          useRunStreamStore.getState().setStatus(runId, 'running')
        }
        setBooted(true)
      } catch (error) {
        setBootError(error instanceof Error ? error.message : String(error))
      }
    })()
  }, [])

  const notify = useCallback(
    (notice: AppNotice) => {
      const key = notice.message
      if (notice.level === 'error') notification.error({ message: notice.message, key })
      else if (notice.level === 'warning') notification.warning({ message: notice.message, key })
      else notification.info({ message: notice.message, key })
    },
    [notification]
  )

  useAppEvents(notify)

  if (bootError) {
    return (
      <div style={{ padding: 48 }}>
        <Spin />
        <div style={{ marginTop: 16 }}>初始化失败：{bootError}</div>
      </div>
    )
  }
  if (!booted) {
    return (
      <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Spin size="large" description="正在加载…" />
      </div>
    )
  }

  return (
    <>
      <AppLayout />
      <HostKeyModal />
    </>
  )
}

export default function App(): React.ReactElement {
  const settings = useSettingsStore((state) => state.settings)
  const systemDark = useSystemDark()
  const dark = settings.theme === 'dark' || (settings.theme === 'system' && systemDark)

  return (
    <ConfigProvider
      locale={zhCN}
      button={{ autoInsertSpace: false }}
      theme={{
        algorithm: dark ? theme.darkAlgorithm : theme.defaultAlgorithm,
        token: { borderRadius: 6, borderRadiusLG: 8, borderRadiusSM: 4, controlHeight: 32 }
      }}
    >
      <AntdApp>
        <AppInner />
      </AntdApp>
    </ConfigProvider>
  )
}
