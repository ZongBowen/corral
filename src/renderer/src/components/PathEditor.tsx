import { Button, Input, Space, Switch, Tooltip, Typography } from 'antd'
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons'
import type { PathEntry } from '@shared/types'

interface PathEditorProps {
  value: PathEntry[]
  onChange: (value: PathEntry[]) => void
}

export function PathEditor({ value, onChange }: PathEditorProps): React.ReactElement {
  const update = (index: number, patch: Partial<PathEntry>): void => {
    onChange(value.map((entry, current) => (current === index ? { ...entry, ...patch } : entry)))
  }

  return (
    <Space orientation="vertical" size={8} style={{ width: '100%' }}>
      {value.map((entry, index) => {
        const isWorkDir = entry.key === 'workDir'
        return (
          <Space key={index} align="start" style={{ width: '100%' }} wrap>
            <Input
              value={entry.key}
              placeholder="key，如 workDir"
              style={{ width: 140 }}
              onChange={(event) => update(index, { key: event.target.value.trim() })}
            />
            <Input
              value={entry.label}
              placeholder="展示名"
              style={{ width: 120 }}
              onChange={(event) => update(index, { label: event.target.value })}
            />
            <Input
              value={entry.path}
              placeholder="/opt/app"
              style={{ width: 260 }}
              onChange={(event) => update(index, { path: event.target.value })}
            />
            <Tooltip title="必填目录不可删除">
              <Switch
                checked={Boolean(entry.required)}
                checkedChildren="必填"
                unCheckedChildren="可选"
                disabled={isWorkDir}
                onChange={(checked) => update(index, { required: checked })}
              />
            </Tooltip>
            <Button
              danger
              type="text"
              icon={<DeleteOutlined />}
              disabled={isWorkDir}
              onClick={() => onChange(value.filter((_, current) => current !== index))}
            />
          </Space>
        )
      })}
      <Space>
        <Button
          type="dashed"
          icon={<PlusOutlined />}
          onClick={() => onChange([...value, { key: '', label: '', path: '', required: false }])}
        >
          添加目录
        </Button>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          命令中可用 $&#123;key&#125; 引用路径
        </Typography.Text>
      </Space>
    </Space>
  )
}
