import { useEffect, useMemo, useRef, useState } from 'react'
import { Alert, App, Button, Progress, Space, Tooltip, Typography, theme } from 'antd'
import { CopyOutlined, ExportOutlined, DeleteOutlined, StopOutlined } from '@ant-design/icons'
import Anser from 'anser'
import type { RunStream } from '../stores/runStreamStore'
import { StatusBadge } from './StatusBadge'
import { useRunStreamStore } from '../stores/runStreamStore'
import { formatBytes, formatDuration } from '../utils/format'
import { unwrap } from '../api'

interface LogPanelProps {
  stream: RunStream
  height?: number
  onStop?: () => void
  onExport?: () => void
}

export function LogPanel({ stream, height = 360, onStop, onExport }: LogPanelProps): React.ReactElement {
  const { token } = theme.useToken()
  const { message } = App.useApp()
  const scrollRef = useRef<HTMLDivElement>(null)
  const [stick, setStick] = useState(true)
  const [newLines, setNewLines] = useState(0)

  const entries = useMemo(() => {
    const result: { key: string; content: string; color: string; bold: boolean }[] = []
    stream.lines.forEach((line, lineIndex) => {
      const baseColor =
        line.stream === 'stderr'
          ? token.colorError
          : line.stream === 'system'
            ? token.colorTextSecondary
            : token.colorText
      const tokens = Anser.ansiToJson(line.text, { use_classes: false })
      tokens.forEach((item, index) => {
        if (!item.content) return
        const color = item.fg ? 'rgb(' + item.fg + ')' : item.fg_truecolor ?? baseColor
        result.push({
          key: String(lineIndex) + '-' + String(index),
          content: item.content,
          color,
          bold: item.decoration === 'bold' || item.decorations?.includes('bold') === true
        })
      })
    })
    return result
  }, [stream.lines, token])

  useEffect(() => {
    const element = scrollRef.current
    if (!element) return
    if (stick) {
      element.scrollTop = element.scrollHeight
      setNewLines(0)
    } else {
      setNewLines((count) => count + 1)
    }
  }, [stream.lines, stick])

  const running = ['queued', 'connecting', 'validating', 'uploading', 'running'].includes(stream.status)

  const copyAll = async (): Promise<void> => {
    const text = stream.lines.map((line) => line.text).join('')
    try {
      await unwrap(window.api.app.copyText(text))
      void message.success('已复制全部日志')
    } catch {
      void message.error('复制失败')
    }
  }

  return (
    <div
      style={{
        border: '1px solid ' + token.colorBorderSecondary,
        borderRadius: token.borderRadiusLG,
        background: token.colorBgContainer,
        overflow: 'hidden'
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '8px 12px',
          borderBottom: '1px solid ' + token.colorBorderSecondary,
          flexWrap: 'wrap'
        }}
      >
        <StatusBadge status={stream.status} />
        <Typography.Text type="secondary">
          耗时 {formatDuration(stream.durationMs)}
        </Typography.Text>
        {stream.exitCode !== undefined ? (
          <Typography.Text type="secondary">退出码 {stream.exitCode}</Typography.Text>
        ) : null}
        <div style={{ flex: 1 }} />
        {running && onStop ? (
          <Tooltip title="尽力终止远端命令">
            <Button size="small" color="danger" variant="solid" icon={<StopOutlined />} onClick={onStop}>
              停止
            </Button>
          </Tooltip>
        ) : null}
        <Tooltip title="清屏">
          <Button size="small" icon={<DeleteOutlined />} onClick={() => {
            useRunStreamStore.getState().clear(stream.runId)
            void message.success('已清屏（完整日志仍保留在文件中）')
          }}>
            清屏
          </Button>
        </Tooltip>
        <Tooltip title="复制全部">
          <Button size="small" icon={<CopyOutlined />} onClick={() => void copyAll()}>
            复制
          </Button>
        </Tooltip>
        {onExport ? (
          <Tooltip title="导出日志">
            <Button size="small" icon={<ExportOutlined />} onClick={onExport}>
              导出
            </Button>
          </Tooltip>
        ) : null}
      </div>

      {stream.errorMessage ? (
        <Alert type="error" showIcon title={stream.errorMessage} style={{ margin: '8px 12px 0' }} />
      ) : null}

      {stream.progress && stream.status === 'uploading' ? (
        <div style={{ padding: '8px 12px', borderBottom: '1px solid ' + token.colorBorderSecondary }}>
          <Space orientation="vertical" size={2} style={{ width: '100%' }}>
            <Typography.Text style={{ fontSize: 12 }}>
              上传 {stream.progress.fileIndex}/{stream.progress.fileCount} · {stream.progress.fileName}
            </Typography.Text>
            <Progress
              percent={
                stream.progress.totalBytes > 0
                  ? Math.min(100, (stream.progress.transferredBytes / stream.progress.totalBytes) * 100)
                  : 0
              }
              size="small"
              status={running ? 'active' : 'normal'}
              format={() =>
                formatBytes(stream.progress!.transferredBytes) + ' / ' + formatBytes(stream.progress!.totalBytes)
              }
            />
          </Space>
        </div>
      ) : null}

      <div className="corral-log-wrap">
        <div
          ref={scrollRef}
          onScroll={(event) => {
            const element = event.currentTarget
            const distance = element.scrollHeight - element.scrollTop - element.clientHeight
            setStick(distance < 24)
          }}
          style={{
            height,
            overflow: 'auto',
            padding: '10px 12px',
            background: token.colorFillQuaternary
          }}
        >
          {entries.length === 0 ? (
            <Typography.Text type="secondary">等待输出…</Typography.Text>
          ) : (
            <pre className="corral-log" style={{ color: token.colorText }}>
              {entries.map((entry) => (
                <span
                  key={entry.key}
                  style={{ color: entry.color, fontWeight: entry.bold ? 600 : 400 }}
                >
                  {entry.content}
                </span>
              ))}
            </pre>
          )}
        </div>
        {!stick ? (
          <div className="corral-back-bottom">
            <Button
              size="small"
              onClick={() => {
                const element = scrollRef.current
                if (element) element.scrollTop = element.scrollHeight
                setStick(true)
                setNewLines(0)
              }}
            >
              回到底部{newLines > 0 ? ' · ' + String(newLines) + ' 条新输出' : ''}
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  )
}
