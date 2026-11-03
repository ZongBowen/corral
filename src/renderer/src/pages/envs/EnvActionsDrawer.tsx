import { useRef, useState } from 'react'
import { App, Button, Drawer, Empty, Space, Tag, Typography, theme } from 'antd'
import { ArrowDownOutlined, ArrowUpOutlined, DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons'
import type { DevEnv, EnvAction } from '@shared/types'
import { ActionEditor } from '../../components/ActionEditor'

interface EnvActionsDrawerProps {
  open: boolean
  env: DevEnv
  onClose: () => void
  onSave: (actions: EnvAction[]) => Promise<void>
}

export function EnvActionsDrawer({ open, env, onClose, onSave }: EnvActionsDrawerProps): React.ReactElement {
  const { modal, message } = App.useApp()
  const { token } = theme.useToken()
  const [editing, setEditing] = useState<EnvAction | null>(null)
  const [editorOpen, setEditorOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)

  const actions = env.actions

  const apply = async (next: EnvAction[]): Promise<void> => {
    if (savingRef.current) {
      throw new Error('正在保存，请稍候')
    }
    savingRef.current = true
    setSaving(true)
    try {
      await onSave(next)
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  const move = (index: number, direction: -1 | 1): void => {
    const target = index + direction
    if (target < 0 || target >= actions.length) return
    const next = [...actions]
    const temp = next[index]
    next[index] = next[target]
    next[target] = temp
    void apply(next)
      .then(() => {
        void message.success('操作顺序已保存')
      })
      .catch((error: unknown) => {
        void message.error(error instanceof Error ? error.message : String(error))
      })
  }

  const remove = (action: EnvAction): void => {
    modal.confirm({
      title: '删除操作「' + action.name + '」？',
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        const next = actions.filter((item) => item.id !== action.id)
        try {
          await apply(next)
          void message.success('操作已删除')
        } catch (error) {
          void message.error(error instanceof Error ? error.message : String(error))
        }
      }
    })
  }

  const saveAction = async (action: EnvAction): Promise<void> => {
    const exists = actions.some((item) => item.id === action.id)
    const next = exists
      ? actions.map((item) => (item.id === action.id ? action : item))
      : [...actions, action]
    await apply(next)
  }

  return (
    <Drawer
      open={open}
      size={620}
      title="配置操作"
      onClose={onClose}
      extra={<Button onClick={onClose}>关闭</Button>}
    >
      <div style={{ marginBottom: 12 }}>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          修改会自动保存，无需再次提交。
        </Typography.Text>
      </div>

      <Space orientation="vertical" size={10} style={{ width: '100%' }}>
        {actions.length === 0 ? <Empty description="还没有操作" /> : null}
        {actions.map((action, index) => (
          <div
            key={action.id}
            style={{
              border: '1px solid ' + token.colorBorderSecondary,
              borderRadius: 8,
              padding: 12
            }}
          >
            <Space style={{ width: '100%' }}>
              <Typography.Text strong>{action.name}</Typography.Text>
              {action.danger ? <Tag color="red">危险</Tag> : null}
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                超时 {action.timeoutSec === 0 ? '不限' : String(action.timeoutSec) + 's'}
              </Typography.Text>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                上传 {action.uploads.length} 项
              </Typography.Text>
              <div style={{ flex: 1 }} />
              <Button
                size="small"
                type="text"
                icon={<ArrowUpOutlined />}
                disabled={saving || index === 0}
                onClick={() => move(index, -1)}
              />
              <Button
                size="small"
                type="text"
                icon={<ArrowDownOutlined />}
                disabled={saving || index === actions.length - 1}
                onClick={() => move(index, 1)}
              />
              <Button
                size="small"
                type="text"
                icon={<EditOutlined />}
                disabled={saving}
                onClick={() => {
                  setEditing(action)
                  setEditorOpen(true)
                }}
              />
              <Button
                size="small"
                type="text"
                danger
                icon={<DeleteOutlined />}
                disabled={saving}
                onClick={() => remove(action)}
              />
            </Space>
            <pre className="corral-code" style={{ margin: '8px 0 0', whiteSpace: 'pre-wrap', opacity: 0.8 }}>
              {action.command}
            </pre>
          </div>
        ))}
        <Button
          type="dashed"
          icon={<PlusOutlined />}
          disabled={saving}
          onClick={() => {
            setEditing(null)
            setEditorOpen(true)
          }}
        >
          新增操作
        </Button>
      </Space>

      <ActionEditor
        open={editorOpen}
        env={env}
        action={editing}
        onClose={() => setEditorOpen(false)}
        onSave={saveAction}
      />
    </Drawer>
  )
}
