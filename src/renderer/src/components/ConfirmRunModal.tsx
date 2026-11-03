import { Alert, Modal, Space, Tag, Typography, theme } from 'antd'
import type { EnvAction, RunPrecheck } from '@shared/types'
import { formatBytes } from '../utils/format'

interface ConfirmRunModalProps {
  open: boolean
  action: EnvAction | null
  precheck: RunPrecheck | null
  loading: boolean
  onCancel: () => void
  onConfirm: () => void
}

export function ConfirmRunModal({
  open,
  action,
  precheck,
  loading,
  onCancel,
  onConfirm
}: ConfirmRunModalProps): React.ReactElement {
  const { token } = theme.useToken()
  const missing = precheck?.missing ?? []
  return (
    <Modal
      open={open}
      width={640}
      title={'确认' + (action?.name ?? '执行') + '？'}
      okText={action?.danger ? '确认' + action.name : '确认执行'}
      cancelText="取消"
      okButtonProps={{ danger: action?.danger, loading, disabled: missing.length > 0 }}
      onOk={onConfirm}
      onCancel={onCancel}
      mask={{ closable: !loading }}
    >
      <Space orientation="vertical" size={12} style={{ width: '100%' }}>
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
                  <Typography.Text className="corral-code" style={{ fontSize: 12 }}>
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
    </Modal>
  )
}
