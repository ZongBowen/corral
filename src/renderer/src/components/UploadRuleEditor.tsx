import { Button, Input, Select, Space, Typography } from 'antd'
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons'
import type { UploadRule } from '@shared/types'
import { newId } from '@shared/id'

interface UploadRuleEditorProps {
  value: UploadRule[]
  onChange: (value: UploadRule[]) => void
  defaultConflict: UploadRule['conflict']
  defaultTarget?: string
}

export function UploadRuleEditor({
  value,
  onChange,
  defaultConflict,
  defaultTarget = '${workDir}'
}: UploadRuleEditorProps): React.ReactElement {
  const update = (id: string, patch: Partial<UploadRule>): void => {
    onChange(value.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule)))
  }

  return (
    <Space orientation="vertical" size={8} style={{ width: '100%' }}>
      {value.map((rule) => (
        <Space key={rule.id} align="start" style={{ width: '100%' }} wrap>
          <Input
            value={rule.targetDir}
            style={{ width: 330 }}
            placeholder="${workDir}/lib"
            onChange={(event) => update(rule.id, { targetDir: event.target.value })}
          />
          <Select
            value={rule.conflict}
            style={{ width: 130 }}
            options={[
              { value: 'backup', label: '覆盖前备份' },
              { value: 'overwrite', label: '直接覆盖' }
            ]}
            onChange={(conflict) => update(rule.id, { conflict })}
          />
          <Input
            value={rule.variableKey ?? ''}
            style={{ width: 170 }}
            placeholder="命令变量名（可选）"
            onChange={(event) => update(rule.id, { variableKey: event.target.value })}
          />
          {rule.variableKey ? (
            <Typography.Text type="secondary" className="corral-code" style={{ fontSize: 12 }}>
              {'${' + rule.variableKey + 'Name}、${' + rule.variableKey + 'Path}'}
            </Typography.Text>
          ) : null}
          <Button
            danger
            type="text"
            icon={<DeleteOutlined />}
            onClick={() => onChange(value.filter((item) => item.id !== rule.id))}
          />
        </Space>
      ))}
      <Button
        type="dashed"
        icon={<PlusOutlined />}
        onClick={() =>
          onChange([...value, { id: newId(), targetDir: defaultTarget, conflict: defaultConflict }])
        }
      >
        添加目标目录
      </Button>
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        本地文件或目录将在每次执行时选择；设置命令变量名后，该目标只能选择单个文件，并生成对应的
        Name 和 Path 变量。
      </Typography.Text>
    </Space>
  )
}
