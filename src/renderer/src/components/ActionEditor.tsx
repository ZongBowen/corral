import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert,
  App,
  Button,
  Drawer,
  Form,
  Input,
  InputNumber,
  Select,
  Space,
  Switch,
  Typography,
  theme
} from 'antd'
import type { SelectProps } from 'antd'
import type { DevEnv, EnvAction, UploadItem } from '@shared/types'
import { newId } from '@shared/id'
import { findUnquotedVars, resolveVariables } from '@shared/command'
import {
  COMMAND_SNIPPETS,
  buildSnippetOptions,
  buildSnippetPatch,
  snippetAvailability,
  type CommandSnippet
} from '../commandSnippets'
import { useSettingsStore } from '../stores/settingsStore'
import { UploadEditor } from './UploadEditor'

interface ActionEditorProps {
  open: boolean
  env: DevEnv
  action: EnvAction | null
  onClose: () => void
  onSave: (action: EnvAction) => Promise<void> | void
}

interface ActionForm {
  name: string
  command: string
  timeoutSec: number
  confirm: boolean
  danger: boolean
}

export function ActionEditor({ open, env, action, onClose, onSave }: ActionEditorProps): React.ReactElement {
  const { message, modal } = App.useApp()
  const { token } = theme.useToken()
  const [form] = Form.useForm<ActionForm>()
  const [uploads, setUploads] = useState<UploadItem[]>([])
  const [saving, setSaving] = useState(false)
  const [variableKey, setVariableKey] = useState<string | undefined>(undefined)
  const [snippetKey, setSnippetKey] = useState<string | undefined>(undefined)
  const openRef = useRef(open)
  const settings = useSettingsStore((state) => state.settings)
  const command = Form.useWatch('command', form) ?? ''

  const vars = useMemo(() => {
    const result: Record<string, string> = { envName: env.name }
    for (const entry of env.paths) result[entry.key] = entry.path
    return result
  }, [env])

  const snippetOptionGroups = useMemo<SelectProps['options']>(() => buildSnippetOptions(vars), [vars])

  useEffect(() => {
    openRef.current = open
  }, [open])

  useEffect(() => {
    if (!open) return
    form.setFieldsValue({
      name: action?.name ?? '',
      command: action?.command ?? '',
      timeoutSec: action?.timeoutSec ?? settings.defaultTimeoutSec,
      confirm: action?.confirm ?? true,
      danger: action?.danger ?? false
    })
    setUploads(action?.uploads ?? [])
    setSnippetKey(undefined)
  }, [open, action, form, settings.defaultTimeoutSec])

  const resolved = resolveVariables(command, vars)
  const unquoted = findUnquotedVars(command)

  const insertVariable = (key: string): void => {
    const current = form.getFieldValue('command') ?? ''
    form.setFieldValue('command', current + ' \${' + key + '}')
  }

  const applySnippet = (snippet: CommandSnippet): void => {
    form.setFieldsValue(
      buildSnippetPatch({
        snippet,
        mode: action ? 'edit' : 'create',
        currentName: String(form.getFieldValue('name') ?? '')
      })
    )
    void form.validateFields(['command']).catch(() => undefined)
  }

  const insertSnippet = (key: string | undefined): void => {
    setSnippetKey(undefined)
    if (!key) return
    const snippet = COMMAND_SNIPPETS.find((item) => item.key === key)
    if (!snippet) return
    const availability = snippetAvailability(snippet, vars)
    if (!availability.available) {
      void message.warning(availability.reason)
      return
    }
    const current = String(form.getFieldValue('command') ?? '')
    if (current.trim() === '') {
      applySnippet(snippet)
      return
    }
    modal.confirm({
      title: '覆盖当前命令？',
      content: '将用「' + snippet.label + '」整体替换命令框中的现有内容，原命令不会保留。',
      okText: '覆盖插入',
      cancelText: '取消',
      onOk: () => {
        if (!openRef.current) return
        applySnippet(snippet)
      }
    })
  }

  const submit = async (): Promise<void> => {
    try {
      const values = await form.validateFields()
      const seen = new Set<string>()
      for (const upload of uploads) {
        if (!upload.localPath.trim()) {
          void message.error('请选择上传文件或目录')
          return
        }
        const target = resolveVariables(upload.targetDir, vars)
        if (target.missing.length > 0) {
          void message.error('上传目标引用了未定义的变量：' + target.missing.join('、'))
          return
        }
        if (!target.text.startsWith('/') || target.text === '/') {
          void message.error('上传目标必须是远程绝对路径且不能是根目录')
          return
        }
        const base = upload.kind === 'file' ? upload.localPath.split(/[\\/]/).filter(Boolean).pop() ?? '' : ''
        const key = target.text + '|' + base
        if (seen.has(key)) {
          void message.error('上传目标重复：' + target.text)
          return
        }
        seen.add(key)
      }
      setSaving(true)
      await onSave({
        id: action?.id ?? newId(),
        name: values.name.trim(),
        command: values.command,
        timeoutSec: values.timeoutSec ?? 0,
        confirm: values.confirm,
        danger: values.danger,
        uploads
      })
      void message.success('操作已保存')
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
      size={680}
      title={action ? '编辑操作：' + action.name : '新增操作'}
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
      <Form
        form={form}
        layout="horizontal"
        labelCol={{ span: 6 }}
        wrapperCol={{ span: 16 }}
        labelAlign="left"
        colon={false}
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
            gap: 16,
            marginBottom: 16
          }}
        >
          <Form.Item
            name="name"
            label="操作名称："
            rules={[{ required: true, message: '请输入操作名称' }]}
            style={{ marginBottom: 0 }}
          >
            <Input placeholder="更新 / 启动 / 关闭" maxLength={64} />
          </Form.Item>
          <Form.Item name="timeoutSec" label="超时：" style={{ marginBottom: 0 }}>
            <InputNumber min={0} max={86400} suffix="秒" style={{ width: '100%' }} />
          </Form.Item>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
            gap: 16,
            marginBottom: 16
          }}
        >
          <Form.Item
            name="confirm"
            label="二次确认"
            valuePropName="checked"
            style={{ marginBottom: 0 }}
          >
            <Switch />
          </Form.Item>
          <Form.Item
            name="danger"
            label="危险操作"
            valuePropName="checked"
            style={{ marginBottom: 0 }}
          >
            <Switch />
          </Form.Item>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
            gap: 16,
            marginBottom: 20
          }}
        >
          <Select
            placeholder="插入变量"
            style={{ width: '100%' }}
            value={variableKey}
            options={Object.keys(vars).map((key) => ({ value: key, label: key }))}
            onChange={(key) => {
              insertVariable(key)
              setVariableKey(undefined)
            }}
          />
          <Select
            placeholder="插入模板"
            style={{ width: '100%' }}
            popupMatchSelectWidth={380}
            value={snippetKey}
            showSearch={{ optionFilterProp: 'label' }}
            options={snippetOptionGroups}
            optionRender={(option) => (
              <div>
                <div>{option.data.label}</div>
                <Typography.Text
                  type={option.data.disabled ? 'danger' : 'secondary'}
                  style={{ fontSize: 12 }}
                >
                  {option.data.hint}
                </Typography.Text>
              </div>
            )}
            onChange={insertSnippet}
          />
        </div>

        <Form.Item
          name="command"
          label="命令（bash）"
          layout="vertical"
          labelCol={{ span: 24 }}
          wrapperCol={{ span: 24 }}
          rules={[{ required: true, message: '请输入命令' }]}
        >
          <Input.TextArea
            className="corral-code"
            rows={9}
            placeholder={'cd "\${workDir}" && ./restart.sh'}
          />
        </Form.Item>

        {resolved.missing.length > 0 ? (
          <Alert
            type="error"
            showIcon
            style={{ marginBottom: 12 }}
            title={'引用了未定义的变量：' + resolved.missing.join('、')}
          />
        ) : null}
        {unquoted.length > 0 ? (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 12 }}
            title={'变量建议加双引号，否则路径含空格时会失败：' + unquoted.join('、')}
          />
        ) : null}

        <Typography.Text type="secondary">执行预览</Typography.Text>
        <pre
          className="corral-code"
          style={{
            margin: '6px 0 20px',
            padding: 12,
            borderRadius: 8,
            background: token.colorFillQuaternary,
            whiteSpace: 'pre-wrap'
          }}
        >
          {resolved.text || '（暂无命令）'}
        </pre>

        <Typography.Title level={5} style={{ marginTop: 0 }}>
          预上传（可选）
        </Typography.Title>
        <UploadEditor
          value={uploads}
          onChange={setUploads}
          defaultConflict={settings.defaultConflict}
          defaultTarget={'\${workDir}'}
        />
      </Form>
    </Drawer>
  )
}
