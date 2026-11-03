import { useEffect, useState } from 'react'
import { Alert, App, Button, Modal, Space, Typography } from 'antd'
import { useHostKeyStore } from '../stores/hostKeyStore'
import { unwrap } from '../api'

export function HostKeyModal(): React.ReactElement {
  const challenge = useHostKeyStore((state) => state.challenge)
  const setChallenge = useHostKeyStore((state) => state.setChallenge)
  const { message } = App.useApp()
  const [remaining, setRemaining] = useState(30)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!challenge) return
    setRemaining(30)
    const timer = setInterval(() => {
      setRemaining((value) => {
        if (value <= 1) {
          clearInterval(timer)
          void decide(false)
          return 0
        }
        return value - 1
      })
    }, 1000)
    return () => clearInterval(timer)
  }, [challenge])

  const decide = async (accept: boolean): Promise<void> => {
    if (!challenge) return
    setLoading(true)
    try {
      await unwrap(window.api.hostkey.decide({ challengeId: challenge.challengeId, accept }))
      if (!accept) void message.warning('已拒绝该主机密钥')
    } catch (error) {
      void message.error(error instanceof Error ? error.message : String(error))
    } finally {
      setLoading(false)
      setChallenge(null)
    }
  }

  return (
    <Modal
      open={Boolean(challenge)}
      title={challenge?.isMismatch ? '主机密钥发生变化' : '首次连接，确认主机密钥'}
      mask={{ closable: false }}
      closable={false}
      footer={
        <Space>
          <Button danger loading={loading} onClick={() => void decide(false)}>
            拒绝
          </Button>
          <Button type="primary" loading={loading} onClick={() => void decide(true)}>
            信任并继续（{remaining}s）
          </Button>
        </Space>
      }
    >
      {challenge ? (
        <Space orientation="vertical" size={10} style={{ width: '100%' }}>
          {challenge.isMismatch ? (
            <Alert
              type="error"
              showIcon
              title="指纹与记录不一致"
              description="可能服务器被重装，也可能存在中间人风险。请核对指纹后再决定。"
            />
          ) : (
            <Alert type="info" showIcon title="这是第一次连接该主机，请确认指纹与服务器一致。" />
          )}
          <Typography.Text>
            主机：{challenge.host}:{challenge.port}
          </Typography.Text>
          <Typography.Text>算法：{challenge.keyType}</Typography.Text>
          <Typography.Text className="corral-code" style={{ fontSize: 12 }}>
            新指纹：{challenge.fingerprint}
          </Typography.Text>
          {challenge.oldFingerprint ? (
            <Typography.Text className="corral-code" type="danger" style={{ fontSize: 12 }}>
              旧指纹：{challenge.oldFingerprint}
            </Typography.Text>
          ) : null}
        </Space>
      ) : null}
    </Modal>
  )
}
