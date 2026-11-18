import { Alert, Button, Modal, Segmented, Space, Tag, Typography, theme } from 'antd'
import type { EnvAction, RunPrecheck, RunUploadMode, UploadItem } from '@shared/types'
import { extractVariables } from '@shared/command'
import { formatBytes } from '../utils/format'
import { UploadEditor } from './UploadEditor'

interface ConfirmRunModalProps {
  open: boolean
  action: EnvAction | null
  precheck: RunPrecheck | null
  uploads: UploadItem[]
  uploadMode: RunUploadMode
  loading: boolean
  prechecking: boolean
  onUploadsChange: (uploads: UploadItem[]) => void
  onUploadModeChange: (mode: RunUploadMode) => void
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
  loading,
  prechecking,
  onUploadsChange,
  onUploadModeChange,
  onPrecheck,
  onBack,
  onCancel,
  onConfirm
}: ConfirmRunModalProps): React.ReactElement {
  const { token } = theme.useToken()
  const hasUploadRules = Boolean(action && action.uploadRules.length > 0)
  const uploadVariableNames = action
    ? action.uploadRules.flatMap((rule) => rule.variableKey ? [rule.variableKey + 'Name', rule.variableKey + 'Path'] : [])
    : []
  const commandVariables = action ? extractVariables(action.command) : []
  const unavailableSkipVariables = uploadVariableNames.filter((key) => commandVariables.includes(key))
  const skipBlocked = uploadMode === 'skip' && unavailableSkipVariables.length > 0
  const selecting = hasUploadRules && !precheck
  const busy = loading || prechecking
  const missing = precheck?.missing ?? []
  const uploadVariableEntries = Object.entries(precheck?.uploadVariables ?? {})
  const ready = !skipBlocked && (uploadMode === 'skip' || Boolean(
    action?.uploadRules.every((rule) => uploads.some((item) => item.ruleId === rule.id))
  ))
  const confirmText = action?.danger ? '确认' + action.name : '确认执行'

  return (
    <Modal
      open={open}
      width={720}
      title={selecting ? '准备' + (action?.name ?? '执行') : '确认' + (action?.name ?? '执行') + '？'}
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
        hasUploadRules && precheck
          ? (
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <Button disabled={loading} onClick={onBack}>返回修改</Button>
              <div style={{ flex: 1 }} />
              <Space>
                <Button disabled={loading} onClick={onCancel}>取消</Button>
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
          )
          : undefined
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
                type={skipBlocked ? 'error' : 'warning'}
                showIcon
                title={skipBlocked ? '当前命令需要上传变量，不能跳过上传' : '本次将跳过上传'}
                description={skipBlocked
                  ? '命令引用了 ' + unavailableSkipVariables.map((key) => '${' + key + '}').join('、') + '，请使用上传模式或移除变量。'
                  : '请确认命令所需文件已上传到下列目标目录。跳过上传不会校验远程文件是否存在。'}
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
            <Alert type="warning" showIcon title="本次跳过上传（文件已手工准备）" />
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
                将上传 {precheck.items.length} 项（{precheck.fileCount} 个文件，共 {formatBytes(precheck.totalBytes)}）
              </Typography.Text>
              <div style={{ marginTop: 8 }}>
                {precheck.items.map((item, index) => (
                  <div key={index} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
                    <Tag color={item.kind === 'file' ? 'blue' : 'gold'}>
                      {item.kind === 'file' ? '文件' : '目录'}
                    </Tag>
                    <Typography.Text className="corral-code" style={{ fontSize: 12, wordBreak: 'break-all' }}>
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
