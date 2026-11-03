import type { EnvAction } from '@shared/types'
import { newId } from '@shared/id'

export interface EnvTemplate {
  key: string
  label: string
  description: string
  build: () => EnvAction[]
}

function action(
  name: string,
  command: string,
  options: { danger?: boolean; uploads?: EnvAction['uploads'] } = {}
): EnvAction {
  return {
    id: newId(),
    name,
    command,
    timeoutSec: 300,
    confirm: true,
    danger: options.danger,
    uploads: options.uploads ?? []
  }
}

export const ENV_TEMPLATES: EnvTemplate[] = [
  {
    key: 'docker',
    label: 'Docker Compose',
    description: '更新 / 启动 / 关闭 / 状态',
    build: () => [
      action('更新', 'cd "\${workDir}" && docker compose pull && docker compose up -d --remove-orphans'),
      action('启动', 'cd "\${workDir}" && docker compose up -d'),
      action('关闭', 'cd "\${workDir}" && docker compose down', { danger: true }),
      action('状态', 'cd "\${workDir}" && docker compose ps')
    ]
  },
  {
    key: 'systemd',
    label: 'systemd 服务',
    description: '需要目标账号具备 systemctl 权限',
    build: () => [
      action('更新', 'cd "\${workDir}" && ./deploy.sh'),
      action('启动', 'systemctl restart my-service'),
      action('关闭', 'systemctl stop my-service', { danger: true })
    ]
  },
  {
    key: 'script',
    label: '脚本 / 二进制',
    description: 'nohup 启动与停止脚本',
    build: () => [
      action('启动', 'cd "\${workDir}" || exit 1; nohup ./start.sh > "\${logDir}/app.log" 2>&1 < /dev/null & echo $!'),
      action('关闭', 'cd "\${workDir}" && ./stop.sh', { danger: true })
    ]
  },
  {
    key: 'upload',
    label: '本地构建产物 + 预上传',
    description: '上传 jar 后执行重启脚本',
    build: () => [
      action('更新', 'cd "\${workDir}" && ./restart.sh', {
        uploads: [
          {
            id: newId(),
            kind: 'file',
            localPath: 'D:/build/dist/app.jar',
            targetDir: '\${workDir}/lib',
            conflict: 'backup'
          }
        ]
      })
    ]
  }
]

export function templateActions(key: string): EnvAction[] {
  const template = ENV_TEMPLATES.find((item) => item.key === key)
  return template ? template.build() : []
}
