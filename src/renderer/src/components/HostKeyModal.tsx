import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { Alert, App, Button, Modal, Space, Typography } from 'antd'
import { useHostKeyStore } from '../stores/hostKeyStore'
import type { HostKeyChallenge } from '@shared/types'
import { unwrap } from '../api'

export function HostKeyModal(): React.ReactElement | null {
  const challenge = useHostKeyStore((state) => state.challenge)
  return challenge ? <HostKeyPrompt key={challenge.challengeId} challenge={challenge} /> : null
}

function HostKeyPrompt({ challenge }: { challenge: HostKeyChallenge }): React.ReactElement {
  const { message } = App.useApp()
  const [remaining, setRemaining] = useState(30)
  const [loading, setLoading] = useState(false)

  const decidingRef = useRef(false)

  const decide = async (accept: boolean): Promise<void> => {
    if (decidingRef.current) return
    decidingRef.current = true
    setLoading(true)
    try {
      await unwrap(window.api.hostkey.decide({ challengeId: challenge.challengeId, accept }))
      if (!accept) void message.warning('已拒绝该主机密钥')
    } catch (error) {
      void message.error(error instanceof Error ? error.message : String(error))
    } finally {
      const state = useHostKeyStore.getState()
      if (state.challenge?.challengeId === challenge.challengeId) state.setChallenge(null)
    }
  }

  const expire = useEffectEvent(() => {
    void decide(false)
  })

  useEffect(() => {
    const deadline = Date.now() + 30_000
    const interval = setInterval(() => {
      setRemaining(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)))
    }, 1000)
    const timeout = setTimeout(() => {
      clearInterval(interval)
      setRemaining(0)
      expire()
    }, 30_000)
    return () => {
      clearInterval(interval)
      clearTimeout(timeout)
    }
  }, [])

  return (
    <Modal
      open
      title={challenge.isMismatch ? '主机密钥发生变化' : '首次连接，确认主机密钥'}
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
    </Modal>
  )
}
