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
  Typography
} from 'antd'
import type { SelectProps } from 'antd'
import type { DevEnv, EnvAction, UploadRule } from '@shared/types'
import { newId } from '@shared/id'
import {
  extractVariables,
  findSingleQuotedVars,
  findUnquotedVars,
  resolveVariables
} from '@shared/command'
import {
  COMMAND_SNIPPETS,
  buildSnippetOptions,
  buildSnippetPatch,
  snippetAvailability,
  type CommandSnippet
} from '../commandSnippets'
import { useSettingsStore } from '../stores/settingsStore'
import { UploadRuleEditor } from './UploadRuleEditor'

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

export function ActionEditor({
  open,
  env,
  action,
  onClose,
  onSave
}: ActionEditorProps): React.ReactElement {
  const { message, modal } = App.useApp()
  const [form] = Form.useForm<ActionForm>()
  const [uploadRules, setUploadRules] = useState<UploadRule[]>(() => action?.uploadRules ?? [])
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

  const uploadVariableNames = useMemo(
    () =>
      uploadRules.flatMap((rule) => {
        const key = rule.variableKey?.trim()
        return key ? [key + 'Name', key + 'Path'] : []
      }),
    [uploadRules]
  )
  const variableOptionGroups = useMemo<SelectProps['options']>(
    () => [
      { label: '环境变量', options: Object.keys(vars).map((key) => ({ value: key, label: key })) },
      ...(uploadVariableNames.length > 0
        ? [
            {
              label: '上传变量（执行时生成）',
              options: uploadVariableNames.map((key) => ({ value: key, label: key }))
            }
          ]
        : [])
    ],
    [vars, uploadVariableNames]
  )
  const snippetOptionGroups = useMemo<SelectProps['options']>(
    () => buildSnippetOptions(vars),
    [vars]
  )

  useEffect(() => {
    openRef.current = open
    return () => {
      openRef.current = false
    }
  }, [open])

  const initialValues: ActionForm = {
    name: action?.name ?? '',
    command: action?.command ?? '',
    timeoutSec: action?.timeoutSec ?? settings.defaultTimeoutSec,
    confirm: action?.confirm ?? true,
    danger: action?.danger ?? false
  }

  const missingVars = extractVariables(command).filter(
    (key) => !Object.prototype.hasOwnProperty.call(vars, key) && !uploadVariableNames.includes(key)
  )
  const unquoted = findUnquotedVars(command)
  const singleQuotedUploadVars = findSingleQuotedVars(command).filter((key) =>
    uploadVariableNames.includes(key)
  )

  const insertVariable = (key: string): void => {
    const current = form.getFieldValue('command') ?? ''
    form.setFieldValue('command', current + ' ${' + key + '}')
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
      if (singleQuotedUploadVars.length > 0) {
        void message.error(
          '上传变量不能使用单引号，请改用双引号：' + singleQuotedUploadVars.join('、')
        )
        return
      }
      const normalizedUploadRules = uploadRules.map((rule) => ({
        ...rule,
        variableKey: rule.variableKey?.trim() || undefined
      }))
      const seen = new Set<string>()
      const variableNames = new Set(Object.keys(vars))
      for (const rule of normalizedUploadRules) {
        const target = resolveVariables(rule.targetDir, vars)
        if (target.missing.length > 0) {
          void message.error('上传目标引用了未定义的变量：' + target.missing.join('、'))
          return
        }
        if (!target.text.startsWith('/') || target.text === '/') {
          void message.error('上传目标必须是远程绝对路径且不能是根目录')
          return
        }
        const key = target.text + '|' + rule.conflict
        if (seen.has(key)) {
          void message.error('上传目标重复：' + target.text)
          return
        }
        seen.add(key)
        if (rule.variableKey) {
          if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(rule.variableKey)) {
            void message.error('命令变量名必须以字母或下划线开头，仅含字母、数字、下划线')
            return
          }
          for (const suffix of ['Name', 'Path']) {
            const name = rule.variableKey + suffix
            if (variableNames.has(name)) {
              void message.error('上传变量与环境变量或其他上传变量重复：' + name)
              return
            }
            variableNames.add(name)
          }
        }
      }
      setSaving(true)
      await onSave({
        id: action?.id ?? newId(),
        name: values.name.trim(),
        command: values.command,
        timeoutSec: values.timeoutSec ?? 0,
        confirm: values.confirm,
        danger: values.danger,
        uploadRules: normalizedUploadRules
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
        initialValues={initialValues}
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
            options={variableOptionGroups}
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
            placeholder={'cd "${workDir}" && ./restart.sh'}
          />
        </Form.Item>

        {missingVars.length > 0 ? (
          <Alert
            type="error"
            showIcon
            style={{ marginBottom: 12 }}
            title={'引用了未定义的变量：' + missingVars.join('、')}
          />
        ) : null}
        {singleQuotedUploadVars.length > 0 ? (
          <Alert
            type="error"
            showIcon
            style={{ marginBottom: 12 }}
            title={
              '上传变量在 shell 中需使用双引号，单引号不会展开：' +
              singleQuotedUploadVars.join('、')
            }
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

        <Typography.Title level={5} style={{ marginTop: 0 }}>
          执行前上传（可选）
        </Typography.Title>
        <UploadRuleEditor
          value={uploadRules}
          onChange={setUploadRules}
          defaultConflict={settings.defaultConflict}
          defaultTarget={'${workDir}'}
        />
      </Form>
    </Drawer>
  )
}
