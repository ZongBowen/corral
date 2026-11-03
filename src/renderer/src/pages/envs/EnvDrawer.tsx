import { useEffect, useMemo, useState } from 'react'
import { App, Button, Drawer, Form, Input, Select, Space, Tag, Typography } from 'antd'
import type { DevEnv, PathEntry } from '@shared/types'
import { ENV_TEMPLATES, templateActions } from '../../templates'
import { PathEditor } from '../../components/PathEditor'
import { useServersStore } from '../../stores/serversStore'
import { useEnvsStore } from '../../stores/envsStore'
import { useUiStore } from '../../stores/uiStore'
import { unwrap } from '../../api'

interface EnvDrawerProps {
  open: boolean
  env: DevEnv | null
  onClose: () => void
}

interface FormValues {
  name: string
  serverId: string
  description?: string
}

const DEFAULT_PATHS: PathEntry[] = [
  { key: 'workDir', label: '工作目录', path: '', required: true }
]

export function EnvDrawer({ open, env, onClose }: EnvDrawerProps): React.ReactElement {
  const { message } = App.useApp()
  const [form] = Form.useForm<FormValues>()
  const [paths, setPaths] = useState<PathEntry[]>(DEFAULT_PATHS)
  const [templateKey, setTemplateKey] = useState('docker')
  const [saving, setSaving] = useState(false)
  const servers = useServersStore((state) => state.servers)
  const upsert = useEnvsStore((state) => state.upsert)
  const selectEnv = useUiStore((state) => state.selectEnv)

  useEffect(() => {
    if (!open) return
    form.setFieldsValue({
      name: env?.name ?? '',
      serverId: env?.serverId ?? servers[0]?.id,
      description: env?.description ?? ''
    })
    setPaths(env?.paths?.length ? env.paths.map((entry) => ({ ...entry })) : DEFAULT_PATHS.map((entry) => ({ ...entry })))
    setTemplateKey('docker')
  }, [open, env, form, servers])

  const templateActionsPreview = useMemo(() => {
    if (env) return []
    return templateActions(templateKey)
  }, [env, templateKey])

  const submit = async (): Promise<void> => {
    try {
      const values = await form.validateFields()
      if (paths.length === 0) {
        void message.error('至少配置一个目录')
        return
      }
      for (const entry of paths) {
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(entry.key)) {
          void message.error('目录 key 格式不正确：' + entry.key)
          return
        }
        if (!entry.path.startsWith('/')) {
          void message.error('目录路径必须是远程绝对路径：' + entry.path)
          return
        }
      }
      if (!paths.some((entry) => entry.key === 'workDir')) {
        void message.error('必须包含 workDir 目录')
        return
      }

      setSaving(true)
      const input = {
        serverId: values.serverId,
        name: values.name.trim(),
        description: values.description,
        paths,
        actions: env ? env.actions : templateActionsPreview
      }
      if (env) {
        const updated = await unwrap(window.api.env.update({ id: env.id, input }))
        upsert(updated)
        void message.success('环境已更新')
      } else {
        const created = await unwrap(window.api.env.create(input))
        upsert(created)
        selectEnv(created.id)
        void message.success('环境已创建')
      }
      onClose()
    } catch (error) {
      if (error instanceof Error && 'errorFields' in error) return
      void message.error(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Drawer
      open={open}
      size={640}
      title={env ? '编辑环境' : '新增环境'}
      onClose={onClose}
      extra={
        <Space>
          <Button onClick={onClose}>取消</Button>
          <Button type="primary" loading={saving} onClick={() => void submit()}>
            保存
          </Button>
        </Space>
      }
    >
      <Form form={form} layout="vertical">
        <Form.Item name="name" label="环境名称" rules={[{ required: true, message: '请输入环境名称' }]}>
          <Input placeholder="订单服务-dev" maxLength={64} />
        </Form.Item>
        <Form.Item name="serverId" label="所属服务器" rules={[{ required: true, message: '请选择服务器' }]}>
          <Select
            placeholder="选择服务器"
            options={servers.map((server) => ({
              value: server.id,
              label: server.name + ' · ' + server.host
            }))}
          />
        </Form.Item>
        <Form.Item name="description" label="描述">
          <Input.TextArea rows={3} placeholder="版本、端口、负责人等" maxLength={2000} />
        </Form.Item>
      </Form>

      <Typography.Title level={5}>目录配置</Typography.Title>
      <PathEditor value={paths} onChange={setPaths} />

      {!env ? (
        <>
          <Typography.Title level={5} style={{ marginTop: 24 }}>
            操作模板
          </Typography.Title>
          <Space orientation="vertical" style={{ width: '100%' }} size={8}>
            <Select
              value={templateKey}
              style={{ width: 260 }}
              options={ENV_TEMPLATES.map((item) => ({ value: item.key, label: item.label }))}
              onChange={setTemplateKey}
            />
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {ENV_TEMPLATES.find((item) => item.key === templateKey)?.description}
            </Typography.Text>
            <Space wrap>
              {templateActionsPreview.map((action) => (
                <Tag key={action.id} color={action.danger ? 'red' : undefined}>
                  {action.name}
                </Tag>
              ))}
            </Space>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              模板仅作预填，保存后可在环境详情继续调整。
            </Typography.Text>
          </Space>
        </>
      ) : null}
    </Drawer>
  )
}
