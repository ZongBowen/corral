import { App, Button, Space, Tag, Typography, theme } from 'antd'
import { DeleteOutlined, FileAddOutlined, FolderAddOutlined } from '@ant-design/icons'
import type { UploadItem, UploadRule } from '@shared/types'
import { newId } from '@shared/id'
import { unwrap } from '../api'

interface UploadEditorProps {
  rules: UploadRule[]
  value: UploadItem[]
  onChange: (value: UploadItem[]) => void
  disabled?: boolean
}

export function UploadEditor({
  rules,
  value,
  onChange,
  disabled = false
}: UploadEditorProps): React.ReactElement {
  const { message } = App.useApp()
  const { token } = theme.useToken()

  const addFiles = async (rule: UploadRule): Promise<void> => {
    try {
      const paths = await unwrap(window.api.dialog.pickFiles({ multiple: !rule.variableKey }))
      if (paths.length === 0) return
      const selectedPaths = rule.variableKey
        ? paths.slice(0, 1)
        : paths.filter(
            (path) =>
              !value.some(
                (item) => item.ruleId === rule.id && item.kind === 'file' && item.localPath === path
              )
          )
      const items = selectedPaths.map((path) => ({
        id: newId(),
        ruleId: rule.id,
        kind: 'file' as const,
        localPath: path,
        targetDir: rule.targetDir,
        conflict: rule.conflict
      }))
      const retained = rule.variableKey ? value.filter((item) => item.ruleId !== rule.id) : value
      onChange([...retained, ...items])
    } catch (error) {
      void message.error(error instanceof Error ? error.message : String(error))
    }
  }

  const addDirectory = async (rule: UploadRule): Promise<void> => {
    try {
      const path = await unwrap(window.api.dialog.pickDirectory())
      if (
        !path ||
        value.some(
          (item) => item.ruleId === rule.id && item.kind === 'dir' && item.localPath === path
        )
      )
        return
      onChange([
        ...value,
        {
          id: newId(),
          ruleId: rule.id,
          kind: 'dir',
          localPath: path,
          targetDir: rule.targetDir,
          conflict: rule.conflict
        }
      ])
    } catch (error) {
      void message.error(error instanceof Error ? error.message : String(error))
    }
  }

  return (
    <Space orientation="vertical" size={12} style={{ width: '100%' }}>
      {rules.map((rule) => {
        const items = value.filter((item) => item.ruleId === rule.id)
        return (
          <div
            key={rule.id}
            style={{
              border: '1px solid ' + token.colorBorderSecondary,
              borderRadius: 8,
              padding: 12
            }}
          >
            <Space size={8} wrap>
              <Typography.Text strong>上传至</Typography.Text>
              <Typography.Text className="corral-code">{rule.targetDir}</Typography.Text>
              <Tag color={rule.conflict === 'backup' ? 'blue' : 'orange'}>
                {rule.conflict === 'backup' ? '覆盖前备份' : '直接覆盖'}
              </Tag>
              {rule.variableKey ? <Tag color="purple">命令变量：{rule.variableKey}</Tag> : null}
            </Space>

            <Space orientation="vertical" size={6} style={{ width: '100%', margin: '10px 0' }}>
              {items.length === 0 ? (
                <Typography.Text type="secondary">
                  {rule.variableKey ? '尚未选择单个本地文件' : '尚未选择本地文件或目录'}
                </Typography.Text>
              ) : (
                items.map((item) => (
                  <Space key={item.id} size={8} wrap>
                    <Tag color={item.kind === 'file' ? 'blue' : 'gold'}>
                      {item.kind === 'file' ? '文件' : '目录'}
                    </Tag>
                    <Typography.Text
                      className="corral-code"
                      style={{ fontSize: 12, wordBreak: 'break-all' }}
                    >
                      {item.localPath}
                    </Typography.Text>
                    <Button
                      danger
                      type="text"
                      size="small"
                      disabled={disabled}
                      aria-label="删除上传项"
                      icon={<DeleteOutlined />}
                      onClick={() => onChange(value.filter((current) => current.id !== item.id))}
                    />
                  </Space>
                ))
              )}
            </Space>

            <Space wrap>
              <Button
                type="dashed"
                disabled={disabled}
                icon={<FileAddOutlined />}
                onClick={() => void addFiles(rule)}
              >
                {rule.variableKey && items.length > 0 ? '重新选择文件' : '添加文件'}
              </Button>
              {!rule.variableKey ? (
                <Button
                  type="dashed"
                  disabled={disabled}
                  icon={<FolderAddOutlined />}
                  onClick={() => void addDirectory(rule)}
                >
                  添加目录
                </Button>
              ) : null}
            </Space>
          </div>
        )
      })}
    </Space>
  )
}
