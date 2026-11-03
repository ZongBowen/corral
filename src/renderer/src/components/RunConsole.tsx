import { App, Empty } from 'antd'
import type { DevEnv } from '@shared/types'
import { useRunStreamStore } from '../stores/runStreamStore'
import { unwrap } from '../api'
import { LogPanel } from './LogPanel'

export function RunConsole({ env }: { env: DevEnv }): React.ReactElement {
  const stream = useRunStreamStore((state) => {
    const runId = state.activeByEnv[env.id]
    return runId ? state.streams[runId] ?? null : null
  })
  const { modal, message } = App.useApp()

  if (!stream) {
    return (
      <div style={{ padding: '40px 0' }}>
        <Empty description="尚无执行记录，点击上方操作开始" />
      </div>
    )
  }

  const stop = (): void => {
    modal.confirm({
      title: '停止当前执行？',
      content: '将尽力终止远端进程；由脚本自行启动的后台服务不会被连带停止。',
      okText: '停止',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        await unwrap(window.api.run.cancel(stream.runId))
        void message.info('已发送终止信号')
      }
    })
  }

  const exportLog = async (): Promise<void> => {
    try {
      const result = await unwrap(window.api.run.exportLog(stream.runId))
      if (result) void message.success('日志已导出到 ' + result.filePath)
    } catch (error) {
      void message.error(error instanceof Error ? error.message : String(error))
    }
  }

  return <LogPanel stream={stream} onStop={stop} onExport={() => void exportLog()} />
}
