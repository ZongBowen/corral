import { Alert, Button, Input, Modal, Segmented, Space, Tag, Typography, theme } from 'antd'
import type {
  EnvAction,
  ManualUploadFile,
  RunPrecheck,
  RunUploadMode,
  UploadItem
} from '@shared/types'
import { extractVariables } from '@shared/command'
import { formatBytes } from '../utils/format'
import { UploadEditor } from './UploadEditor'

function isValidManualFileName(value: string): boolean {
  const fileName = value.trim()
  return (
    fileName.length > 0 &&
    fileName.length <= 255 &&
    fileName !== '.' &&
    fileName !== '..' &&
    !/[/\\\0\n\r]/.test(fileName)
  )
}

interface ConfirmRunModalProps {
  open: boolean
  action: EnvAction | null
  precheck: RunPrecheck | null
  uploads: UploadItem[]
  uploadMode: RunUploadMode
  manualUploadFiles: ManualUploadFile[]
  loading: boolean
  prechecking: boolean
  onUploadsChange: (uploads: UploadItem[]) => void
  onUploadModeChange: (mode: RunUploadMode) => void
  onManualUploadFilesChange: (files: ManualUploadFile[]) => void
  onPrecheck: () => void
  onBack: () => void
  onCancel: () => void
  onConfirm: () => void
}

export function ConfirmRunModal({
  open,
  action,
  precheck,
  uploads,
  uploadMode,
  manualUploadFiles,
  loading,
  prechecking,
  onUploadsChange,
  onUploadModeChange,
  onManualUploadFilesChange,
  onPrecheck,
  onBack,
  onCancel,
  onConfirm
}: ConfirmRunModalProps): React.ReactElement {
  const { token } = theme.useToken()
  const hasUploadRules = Boolean(action && action.uploadRules.length > 0)
  const commandVariables = action ? extractVariables(action.command) : []
  const referencedVariableRules = action
    ? action.uploadRules.filter(
        (rule) =>
          rule.variableKey &&
          (commandVariables.includes(rule.variableKey + 'Name') ||
            commandVariables.includes(rule.variableKey + 'Path'))
      )
    : []
  const missingManualRules =
    uploadMode === 'skip'
      ? referencedVariableRules.filter((rule) => {
          const fileName = manualUploadFiles.find((item) => item.ruleId === rule.id)?.fileName ?? ''
          return !isValidManualFileName(fileName)
        })
      : []
  const selecting = hasUploadRules && !precheck
  const busy = loading || prechecking
  const missing = precheck?.missing ?? []
  const uploadVariableEntries = Object.entries(precheck?.uploadVariables ?? {})
  const ready =
    uploadMode === 'skip'
      ? missingManualRules.length === 0
      : Boolean(
          action?.uploadRules.every((rule) => uploads.some((item) => item.ruleId === rule.id))
        )
  const confirmText = action?.danger ? '确认' + action.name : '确认执行'

  const updateManualFile = (ruleId: string, fileName: string): void => {
    const exists = manualUploadFiles.some((item) => item.ruleId === ruleId)
    onManualUploadFilesChange(
      exists
        ? manualUploadFiles.map((item) => (item.ruleId === ruleId ? { ...item, fileName } : item))
        : [...manualUploadFiles, { ruleId, fileName }]
    )
  }

  return (
    <Modal
      open={open}
      width={720}
      title={
        selecting ? '准备' + (action?.name ?? '执行') : '确认' + (action?.name ?? '执行') + '？'
      }
      okText={selecting ? '预检并继续' : confirmText}
      cancelText="取消"
      okButtonProps={{
        danger: selecting ? false : action?.danger,
        loading: selecting ? prechecking : loading,
        disabled: selecting ? !ready : missing.length > 0
      }}
      cancelButtonProps={{ disabled: busy }}
      closable={!busy}
      keyboard={!busy}
      onOk={selecting ? onPrecheck : onConfirm}
      onCancel={() => {
        if (!busy) onCancel()
      }}
      mask={{ closable: !busy }}
      footer={
        hasUploadRules && precheck ? (
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <Button disabled={loading} onClick={onBack}>
              返回修改
            </Button>
            <div style={{ flex: 1 }} />
            <Space>
              <Button disabled={loading} onClick={onCancel}>
                取消
              </Button>
              <Button
                type="primary"
                danger={action?.danger}
                loading={loading}
                disabled={missing.length > 0}
                onClick={onConfirm}
              >
                {confirmText}
              </Button>
            </Space>
          </div>
        ) : undefined
      }
    >
      {selecting && action ? (
        <Space orientation="vertical" size={12} style={{ width: '100%' }}>
          <Segmented
            block
            disabled={prechecking}
            value={uploadMode}
            options={[
              { value: 'upload', label: '上传文件后执行' },
              { value: 'skip', label: '文件已就绪，跳过上传' }
            ]}
            onChange={(value) => onUploadModeChange(value as RunUploadMode)}
          />
          {uploadMode === 'skip' ? (
            <>
              <Alert
                type={referencedVariableRules.length > 0 ? 'info' : 'warning'}
                showIcon
                title={
                  referencedVariableRules.length > 0 ? '录入已上传的远程文件名' : '本次将跳过上传'
                }
                description={
                  referencedVariableRules.length > 0
                    ? '文件名仅用于生成命令变量，不执行上传，也不会校验远程文件是否存在。'
                    : '请确认命令所需文件已上传到下列目标目录。跳过上传不会校验远程文件是否存在。'
                }
              />
              <div>
                <Typography.Text strong>目标目录：</Typography.Text>
                <Space orientation="vertical" size={4} style={{ width: '100%', marginTop: 8 }}>
                  {action.uploadRules.map((rule) => (
                    <Typography.Text key={rule.id} className="corral-code" style={{ fontSize: 12 }}>
                      {rule.targetDir}
                    </Typography.Text>
                  ))}
                </Space>
              </div>
              {referencedVariableRules.map((rule) => {
                const fileName =
                  manualUploadFiles.find((item) => item.ruleId === rule.id)?.fileName ?? ''
                const valid = isValidManualFileName(fileName)
                return (
                  <div key={rule.id}>
                    <Typography.Text strong>{rule.targetDir} 中的已上传文件名：</Typography.Text>
                    <Input
                      value={fileName}
                      disabled={prechecking}
                      allowClear
                      maxLength={255}
                      placeholder="例如 app-20261117.zip"
                      aria-label={'已上传文件名：' + rule.targetDir}
                      status={fileName.trim() && !valid ? 'error' : undefined}
                      style={{ marginTop: 8 }}
                      onChange={(event) => updateManualFile(rule.id, event.target.value)}
                    />
                    <div style={{ marginTop: 4 }}>
                      <Typography.Text
                        type="secondary"
                        className="corral-code"
                        style={{ fontSize: 12 }}
                      >
                        {'生成 ${' + rule.variableKey + 'Name}、${' + rule.variableKey + 'Path}'}
                      </Typography.Text>
                    </div>
                    {fileName.trim() && !valid ? (
                      <Typography.Text type="danger" style={{ fontSize: 12 }}>
                        请输入单个文件名，不能包含路径或路径穿越。
                      </Typography.Text>
                    ) : null}
                  </div>
                )
              })}
            </>
          ) : (
            <>
              <Alert
                type="info"
                showIcon
                title="选择本次要上传的本地文件或目录"
                description="每个目标目录至少选择一项，所选内容仅用于本次执行。"
              />
              <UploadEditor
                rules={action.uploadRules}
                value={uploads}
                onChange={onUploadsChange}
                disabled={prechecking}
              />
            </>
          )}
        </Space>
      ) : (
        <Space orientation="vertical" size={12} style={{ width: '100%' }}>
          {hasUploadRules && uploadMode === 'skip' ? (
            <Alert
              type="warning"
              showIcon
              title={
                manualUploadFiles.length > 0
                  ? '本次跳过上传，使用手工录入的文件名'
                  : '本次跳过上传（文件已手工准备）'
              }
            />
          ) : null}
          {missing.length > 0 ? (
            <Alert
              type="error"
              showIcon
              title="本地文件不存在，无法执行"
              description={missing.join('、')}
            />
          ) : null}
          {precheck?.warnings.length ? (
            <Alert type="warning" showIcon title={precheck.warnings.join('；')} />
          ) : null}

          {precheck && precheck.items.length > 0 ? (
            <div>
              <Typography.Text strong>
                将上传 {precheck.items.length} 项（{precheck.fileCount} 个文件，共{' '}
                {formatBytes(precheck.totalBytes)}）
              </Typography.Text>
              <div style={{ marginTop: 8 }}>
                {precheck.items.map((item) => (
                  <div
                    key={item.targetPath}
                    style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}
                  >
                    <Tag color={item.kind === 'file' ? 'blue' : 'gold'}>
                      {item.kind === 'file' ? '文件' : '目录'}
                    </Tag>
                    <Typography.Text
                      className="corral-code"
                      style={{ fontSize: 12, wordBreak: 'break-all' }}
                    >
                      {item.localPath} → {item.targetPath}
                    </Typography.Text>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {formatBytes(item.bytes)}
                    </Typography.Text>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {uploadVariableEntries.length > 0 ? (
            <div>
              <Typography.Text strong>本次上传变量：</Typography.Text>
              <Space orientation="vertical" size={4} style={{ width: '100%', marginTop: 8 }}>
                {uploadVariableEntries.map(([key, value]) => (
                  <Typography.Text key={key} style={{ fontSize: 12 }}>
                    <span className="corral-code">{'${' + key + '}'}</span> = {value}
                  </Typography.Text>
                ))}
              </Space>
            </div>
          ) : null}

          <div>
            <Typography.Text strong>将执行：</Typography.Text>
            <pre
              className="corral-code"
              style={{
                marginTop: 6,
                padding: 12,
                borderRadius: 8,
                background: token.colorFillQuaternary,
                whiteSpace: 'pre-wrap'
              }}
            >
              {precheck?.resolvedCommand ?? ''}
            </pre>
          </div>
        </Space>
      )}
    </Modal>
  )
}
