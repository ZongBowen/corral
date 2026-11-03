import { useEffect, useState } from 'react'
import { App, Alert, Button, Drawer, Form, Input, InputNumber, Select, Space, Switch, Typography } from 'antd'
import type { ServerInput, ServerSummary, TestResult } from '@shared/types'
import { unwrap } from '../../api'
import { useServersStore } from '../../stores/serversStore'

interface ServerDrawerProps {
  open: boolean
  editing: ServerSummary | null
  seed?: Partial<ServerInput> | null
  onClose: () => void
}

interface FormValues extends ServerInput {
  clearPassword?: boolean
}

export function ServerDrawer({ open, editing, seed, onClose }: ServerDrawerProps): React.ReactElement {
  const { message, modal, notification } = App.useApp()
  const [form] = Form.useForm<FormValues>()
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [hostKeyFailure, setHostKeyFailure] = useState<TestResult | null>(null)
  const upsert = useServersStore((state) => state.upsert)
  const setStatus = useServersStore((state) => state.setStatus)

  useEffect(() => {
    if (!open) return
    setHostKeyFailure(null)
    form.setFieldsValue({
      name: editing?.name ?? seed?.name ?? '',
      host: editing?.host ?? seed?.host ?? '',
      port: editing?.port ?? seed?.port ?? 22,
      username: editing?.username ?? seed?.username ?? '',
      password: '',
      description: editing?.description ?? seed?.description ?? '',
      tags: editing?.tags ?? seed?.tags ?? [],
      clearPassword: false
    })
  }, [open, editing, seed, form])

  const test = async (): Promise<void> => {
    try {
      const values = await form.validateFields(['host', 'port', 'username', 'password'])
      setTesting(true)
      setStatus(editing?.id ?? 'temp', 'checking')
      let result
      if (!values.password && editing && (values.host !== editing.host || values.port !== editing.port)) {
        void notification.warning({ message: '地址或端口已修改，请重新输入密码后再测试' })
        return
      }
      if (values.password) {
        result = await unwrap(
          window.api.server.test({
            input: { ...values, tags: values.tags ?? [] }
          })
        )
      } else if (editing) {
        result = await unwrap(window.api.server.test({ id: editing.id }))
      } else {
        void notification.warning({ message: '请先输入密码再测试连接' })
        return
      }
      if (editing) setStatus(editing.id, result.ok ? 'online' : 'offline')
      setHostKeyFailure(!result.ok && result.errorKind === 'hostkey' ? result : null)
      if (result.ok) {
        void useServersStore.getState().load(true)
        notification.success({
          message: '连接成功',
          description:
            (result.os ?? 'Linux') +
            ' · 内核 ' +
            (result.kernel ?? '—') +
            ' · ' +
            String(result.durationMs) +
            'ms'
        })
      } else {
        notification.error({ message: '连接失败', description: result.errorMessage ?? '未知错误' })
      }
    } catch (error) {
      if (error instanceof Error && 'errorFields' in error) return
      void message.error(error instanceof Error ? error.message : String(error))
    } finally {
      setTesting(false)
    }
  }

  const submit = async (): Promise<void> => {
    try {
      const values = await form.validateFields()
      setSaving(true)
      if (editing) {
        const updated = await unwrap(
          window.api.server.update({ id: editing.id, input: { ...values, tags: values.tags ?? [] } })
        )
        upsert(updated)
        void message.success('服务器已更新')
      } else {
        if (!values.password) {
          void message.error('新增服务器必须填写密码')
          return
        }
        const created = await unwrap(
          window.api.server.create({ ...values, tags: values.tags ?? [] })
        )
        upsert(created)
        void message.success('服务器已创建')
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
      size={520}
      title={editing ? '编辑服务器' : '新增服务器'}
      onClose={onClose}
      extra={
        <Space>
          <Button loading={testing} onClick={() => void test()}>
            测试连接
          </Button>
          <Button type="primary" loading={saving} onClick={() => void submit()}>
            保存
          </Button>
        </Space>
      }
    >
      <Form form={form} layout="vertical">
        <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入名称' }]}>
          <Input placeholder="订单测试机-01" maxLength={64} />
        </Form.Item>
        <Form.Item name="host" label="主机" rules={[{ required: true, message: '请输入 IP 或域名' }]}>
          <Input placeholder="10.0.0.12" />
        </Form.Item>
        <Form.Item name="port" label="端口" rules={[{ required: true, message: '请输入端口' }]}>
          <InputNumber min={1} max={65535} style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item name="username" label="账号" rules={[{ required: true, message: '请输入账号' }]}>
          <Input placeholder="root" autoComplete="off" />
        </Form.Item>
        <Form.Item
          name="password"
          label="密码"
          rules={editing ? [] : [{ required: true, message: '请输入密码' }]}
          extra={editing ? '已保存，留空则不修改' : undefined}
        >
          <Input.Password placeholder={editing ? '留空则不修改' : 'SSH 密码'} autoComplete="new-password" />
        </Form.Item>
        {editing ? (
          <Form.Item name="clearPassword" label="清除已保存密码" valuePropName="checked">
            <Switch />
          </Form.Item>
        ) : null}
        <Form.Item name="tags" label="标签">
          <Select mode="tags" placeholder="如 ubuntu / kylin / test" tokenSeparators={[',', ' ']} />
        </Form.Item>
        <Form.Item name="description" label="描述">
          <Input.TextArea rows={4} placeholder="用途、负责人、到期时间等" maxLength={2000} />
        </Form.Item>
        {hostKeyFailure ? (
          <Alert
            type="error"
            showIcon
            style={{ marginBottom: 12 }}
            title="主机密钥与记录不一致"
            description={hostKeyFailure.errorMessage}
            action={
              <Button
                size="small"
                danger
                onClick={() => {
                  modal.confirm({
                    title: '信任新的主机指纹？',
                    content: '仅在确认服务器被重装或指纹变更可信时继续；否则可能存在中间人风险。',
                    okText: '信任',
                    okButtonProps: { danger: true },
                    cancelText: '取消',
                    onOk: async () => {
                      const values = form.getFieldsValue()
                      await unwrap(
                        window.api.server.trustHostKey({
                          host: values.host,
                          port: Number(values.port)
                        })
                      )
                      setHostKeyFailure(null)
                      void message.success('已信任新指纹，可重新测试连接')
                    }
                  })
                }}
              >
                信任新指纹
              </Button>
            }
          />
        ) : null}
        {editing?.credentialBroken ? (
          <Alert type="error" showIcon title="已保存的密码无法解密，请重新输入密码" />
        ) : null}
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          密码使用系统安全存储加密，仅在主进程中使用，不会传给渲染进程。
        </Typography.Text>
      </Form>
    </Drawer>
  )
}
