import { App, Button, Input, Select, Space, Tag, Typography } from 'antd'
import { DeleteOutlined, FileAddOutlined, FolderAddOutlined } from '@ant-design/icons'
import type { UploadItem } from '@shared/types'
import { newId } from '@shared/id'
import { unwrap } from '../api'

interface UploadEditorProps {
  value: UploadItem[]
  onChange: (value: UploadItem[]) => void
  defaultConflict: 'backup' | 'overwrite'
  defaultTarget?: string
}

export function UploadEditor({
  value,
  onChange,
  defaultConflict,
  defaultTarget = '${workDir}'
}: UploadEditorProps): React.ReactElement {
  const { message } = App.useApp()

  const addFiles = async (): Promise<void> => {
    try {
      const paths = await unwrap(window.api.dialog.pickFiles({ multiple: true }))
      if (paths.length === 0) return
      onChange([
        ...value,
        ...paths.map((path) => ({
          id: newId(),
          kind: 'file' as const,
          localPath: path,
          targetDir: defaultTarget,
          conflict: defaultConflict
        }))
      ])
    } catch (error) {
      void message.error(error instanceof Error ? error.message : String(error))
    }
  }

  const addDirectory = async (): Promise<void> => {
    try {
      const path = await unwrap(window.api.dialog.pickDirectory())
      if (!path) return
      onChange([
        ...value,
        {
          id: newId(),
          kind: 'dir' as const,
          localPath: path,
          targetDir: defaultTarget,
          conflict: defaultConflict
        }
      ])
    } catch (error) {
      void message.error(error instanceof Error ? error.message : String(error))
    }
  }

  const update = (index: number, patch: Partial<UploadItem>): void => {
    onChange(value.map((item, current) => (current === index ? { ...item, ...patch } : item)))
  }

  return (
    <Space orientation="vertical" size={8} style={{ width: '100%' }}>
      {value.map((item, index) => (
        <Space key={item.id} align="start" style={{ width: '100%' }} wrap>
          <Tag color={item.kind === 'file' ? 'blue' : 'gold'}>
            {item.kind === 'file' ? '文件' : '目录'}
          </Tag>
          <Input
            value={item.localPath}
            style={{ width: 300 }}
            onChange={(event) => update(index, { localPath: event.target.value })}
          />
          <Typography.Text type="secondary">→</Typography.Text>
          <Input
            value={item.targetDir}
            style={{ width: 220 }}
            placeholder="${workDir}/lib"
            onChange={(event) => update(index, { targetDir: event.target.value })}
          />
          <Select
            value={item.conflict}
            style={{ width: 110 }}
            options={[
              { value: 'backup', label: '覆盖前备份' },
              { value: 'overwrite', label: '直接覆盖' }
            ]}
            onChange={(conflict) => update(index, { conflict })}
          />
          <Button
            danger
            type="text"
            icon={<DeleteOutlined />}
            onClick={() => onChange(value.filter((_, current) => current !== index))}
          />
        </Space>
      ))}
      <Space wrap>
        <Button type="dashed" icon={<FileAddOutlined />} onClick={() => void addFiles()}>
          添加文件
        </Button>
        <Button type="dashed" icon={<FolderAddOutlined />} onClick={() => void addDirectory()}>
          添加目录
        </Button>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          目录上传会合并内容到目标目录；覆盖前默认备份为 .bak-时间戳
        </Typography.Text>
      </Space>
    </Space>
  )
}
