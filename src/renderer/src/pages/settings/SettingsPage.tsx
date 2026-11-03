import { useEffect, useState } from 'react'
import {
  App,
  Button,
  Card,
  Descriptions,
  Form,
  InputNumber,
  Select,
  Space,
  Switch,
  Typography
} from 'antd'
import type { Settings } from '@shared/types'
import { useSettingsStore } from '../../stores/settingsStore'
import { unwrap } from '../../api'

export function SettingsPage(): React.ReactElement {
  const { message } = App.useApp()
  const settings = useSettingsStore((state) => state.settings)
  const update = useSettingsStore((state) => state.update)
  const [form] = Form.useForm<Settings>()
  const [saving, setSaving] = useState(false)
  const [dataDir, setDataDir] = useState('')

  useEffect(() => {
    form.setFieldsValue(settings)
  }, [settings, form])

  useEffect(() => {
    void (async () => {
      try {
        const boot = await unwrap(window.api.app.getBootState())
        setDataDir(boot.dataDir)
      } catch {
        // ignore
      }
    })()
  }, [])

  const save = async (): Promise<void> => {
    try {
      const values = await form.validateFields()
      setSaving(true)
      await update(values)
      void message.success('设置已保存')
    } catch (error) {
      if (error instanceof Error && 'errorFields' in error) return
      void message.error(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  const exportConfig = async (): Promise<void> => {
    try {
      const result = await unwrap(window.api.app.exportConfig())
      if (result) void message.success('配置已导出到 ' + result.filePath)
    } catch (error) {
      void message.error(error instanceof Error ? error.message : String(error))
    }
  }

  return (
    <div style={{ maxWidth: 880 }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          设置
        </Typography.Title>
        <div style={{ flex: 1 }} />
        <Button type="primary" loading={saving} onClick={() => void save()}>
          保存
        </Button>
      </div>

      <Form form={form} layout="vertical">
        <Card size="small" title="外观与执行" style={{ marginBottom: 16 }}>
          <Space size={24} wrap align="start">
            <Form.Item name="theme" label="主题" style={{ width: 180 }}>
              <Select
                options={[
                  { value: 'system', label: '跟随系统' },
                  { value: 'light', label: '亮色' },
                  { value: 'dark', label: '暗色' }
                ]}
              />
            </Form.Item>
            <Form.Item name="defaultTimeoutSec" label="默认命令超时（秒）" style={{ width: 180 }}>
              <InputNumber min={0} max={86400} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item
              name="validatePathsBeforeRun"
              label="执行前校验目录"
              valuePropName="checked"
              style={{ width: 180 }}
            >
              <Switch />
            </Form.Item>
          </Space>
        </Card>

        <Card size="small" title="上传" style={{ marginBottom: 16 }}>
          <Space size={24} wrap align="start">
            <Form.Item name="defaultConflict" label="默认冲突策略" style={{ width: 180 }}>
              <Select
                options={[
                  { value: 'backup', label: '覆盖前备份' },
                  { value: 'overwrite', label: '直接覆盖' }
                ]}
              />
            </Form.Item>
            <Form.Item name="uploadIdleTimeoutSec" label="上传空闲超时（秒）" style={{ width: 180 }}>
              <InputNumber min={10} max={3600} style={{ width: '100%' }} />
            </Form.Item>
          </Space>
        </Card>

        <Card size="small" title="日志与兼容性" style={{ marginBottom: 16 }}>
          <Space size={24} wrap align="start">
            <Form.Item name="logRetentionCount" label="保留条数" style={{ width: 160 }}>
              <InputNumber min={1} max={10000} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="logRetentionDays" label="保留天数" style={{ width: 160 }}>
              <InputNumber min={1} max={3650} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="outputEncoding" label="输出编码" style={{ width: 160 }}>
              <Select
                options={[
                  { value: 'utf-8', label: 'UTF-8' },
                  { value: 'gbk', label: 'GBK' }
                ]}
              />
            </Form.Item>
            <Form.Item
              name="legacySshAlgorithms"
              label="兼容旧 SSH 算法"
              valuePropName="checked"
              style={{ width: 180 }}
            >
              <Switch />
            </Form.Item>
          </Space>
        </Card>
      </Form>

      <Card size="small" title="数据">
        <Descriptions size="small" column={1} bordered>
          <Descriptions.Item label="数据目录">{dataDir || '—'}</Descriptions.Item>
        </Descriptions>
        <Space style={{ marginTop: 12 }}>
          <Button onClick={() => void window.api.app.openDataDir()}>打开数据目录</Button>
          <Button onClick={() => void exportConfig()}>导出配置（不含密码）</Button>
        </Space>
        <div style={{ marginTop: 8 }}>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            密码使用 Windows 安全存储加密，导出配置不会包含密码。
          </Typography.Text>
        </div>
      </Card>
    </div>
  )
}
