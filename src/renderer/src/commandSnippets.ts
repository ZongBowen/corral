export interface SnippetSuggestion {
  /** 仅新建操作且名称仍为空时写入 */
  name?: string
  /** 仅在为 true 时写入，绝不主动置 false */
  danger?: boolean
  /** 新建操作时可覆盖默认超时，单位秒 */
  timeoutSec?: number
}

export const SNIPPET_GROUPS = [
  { key: 'script', label: '脚本' },
  { key: 'daemon', label: '后台常驻' },
  { key: 'stop', label: '停止' },
  { key: 'docker', label: 'Docker' },
  { key: 'systemd', label: 'systemd' },
  { key: 'diagnose', label: '排查' }
] as const

export type SnippetGroupKey = (typeof SNIPPET_GROUPS)[number]['key']

export interface CommandSnippet {
  key: string
  group: SnippetGroupKey
  label: string
  description: string
  /** 含 workDir / logDir 等变量占位符，插入时原样写入 */
  command: string
  /** 依赖的变量 key（不含花括号），空数组表示与环境目录无关 */
  requires: string[]
  suggest?: SnippetSuggestion
}

export const COMMAND_SNIPPETS: CommandSnippet[] = [
  {
    key: 'run-foreground',
    group: 'script',
    label: '前台运行脚本',
    description: '直接执行启动脚本，输出会实时回传到执行日志',
    command: 'cd "\${workDir}" && ./start.sh',
    requires: ['workDir'],
    suggest: { name: '启动' }
  },
  {
    key: 'daemon-nohup',
    group: 'daemon',
    label: 'nohup 后台常驻',
    description: '无终端环境下的正确后台写法：日志写文件并断开标准输入',
    command:
      'cd "\${workDir}" || exit 1; nohup ./start.sh > "\${logDir}/app.log" 2>&1 < /dev/null & echo $!',
    requires: ['workDir', 'logDir'],
    suggest: { name: '启动（后台）' }
  },
  {
    key: 'daemon-nohup-pid',
    group: 'daemon',
    label: 'nohup + PID 文件',
    description: '在 nohup 基础上把 PID 写入 app.pid，便于按 PID 停止',
    command:
      'cd "\${workDir}" || exit 1; nohup ./start.sh > "\${logDir}/app.log" 2>&1 < /dev/null & pid=$!; printf "%s\\n" "$pid" > "\${workDir}/app.pid"; cat "\${workDir}/app.pid"',
    requires: ['workDir', 'logDir'],
    suggest: { name: '启动（后台 + PID）' }
  },
  {
    key: 'daemon-setsid',
    group: 'daemon',
    label: 'setsid 后台常驻',
    description: '用 setsid 脱离当前会话，比 nohup 更彻底',
    command:
      'cd "\${workDir}" || exit 1; setsid ./start.sh > "\${logDir}/app.log" 2>&1 < /dev/null & echo $!',
    requires: ['workDir', 'logDir'],
    suggest: { name: '启动（setsid）' }
  },
  {
    key: 'stop-pidfile',
    group: 'stop',
    label: '按 PID 文件停止',
    description: '读取 app.pid 并发送 TERM，配合「启动（后台 + PID）」使用',
    command:
      'cd "\${workDir}" && if [ -f app.pid ]; then pid=$(cat app.pid); kill "$pid" && rm -f app.pid && echo "已向 $pid 发送 TERM"; else echo "未找到 app.pid"; exit 1; fi',
    requires: ['workDir'],
    suggest: { name: '停止', danger: true }
  },
  {
    key: 'stop-pkill',
    group: 'stop',
    label: '按关键字停止',
    description: '按关键字结束进程，请把 startup-dev.sh 换成实际脚本名',
    command: 'pkill -f "startup-dev.sh" && echo "已发送 TERM"',
    requires: [],
    suggest: { name: '停止', danger: true }
  },
  {
    key: 'compose-up',
    group: 'docker',
    label: 'Compose 启动',
    description: '后台启动 Compose 服务',
    command: 'cd "\${workDir}" && docker compose up -d',
    requires: ['workDir'],
    suggest: { name: '启动' }
  },
  {
    key: 'compose-ps',
    group: 'docker',
    label: 'Compose 状态',
    description: '查看 Compose 容器状态',
    command: 'cd "\${workDir}" && docker compose ps',
    requires: ['workDir'],
    suggest: { name: '状态' }
  },
  {
    key: 'compose-down',
    group: 'docker',
    label: 'Compose 停止',
    description: '停止并移除 Compose 容器',
    command: 'cd "\${workDir}" && docker compose down',
    requires: ['workDir'],
    suggest: { name: '停止', danger: true }
  },
  {
    key: 'systemd-restart',
    group: 'systemd',
    label: 'systemd 重启并校验',
    description: '重启服务并用 is-active 校验，请把 my-service 换成实际服务名',
    command: 'sudo systemctl restart my-service && systemctl is-active my-service',
    requires: [],
    suggest: { name: '重启' }
  },
  {
    key: 'tail-log',
    group: 'diagnose',
    label: '跟踪日志',
    description: '持续跟踪日志尾部，到超时后自动结束',
    command: 'tail -n 200 -F "\${logDir}/app.log"',
    requires: ['logDir'],
    suggest: { name: '查看日志', timeoutSec: 120 }
  },
  {
    key: 'ps-grep',
    group: 'diagnose',
    label: '查看进程',
    description: '查看脚本进程，请把 start.sh 换成实际脚本名',
    command: 'cd "\${workDir}" && ps -ef | grep -F -- "[s]tart.sh" || echo "未找到匹配进程"',
    requires: ['workDir'],
    suggest: { name: '进程状态' }
  }
]

function isVariableReady(vars: Readonly<Record<string, string>>, key: string): boolean {
  if (!Object.prototype.hasOwnProperty.call(vars, key)) return false
  const value = vars[key]
  return typeof value === 'string' && value.trim() !== ''
}

export function snippetDisabledReason(missing: readonly string[]): string {
  if (missing.length === 0) return ''
  return '缺少变量：' + missing.join('、') + '（请先在环境目录配置中补齐）'
}

export interface SnippetAvailability {
  available: boolean
  missing: string[]
  reason: string
}

export function snippetAvailability(
  snippet: Pick<CommandSnippet, 'requires'>,
  vars: Readonly<Record<string, string>>
): SnippetAvailability {
  const missing: string[] = []
  for (const key of snippet.requires) {
    if (missing.includes(key)) continue
    if (!isVariableReady(vars, key)) missing.push(key)
  }
  return {
    available: missing.length === 0,
    missing,
    reason: snippetDisabledReason(missing)
  }
}

export interface SnippetOptionItem {
  value: string
  label: string
  description: string
  hint: string
  disabled: boolean
}

export interface SnippetOptionGroup {
  label: string
  options: SnippetOptionItem[]
}

export function buildSnippetOptions(
  vars: Readonly<Record<string, string>>,
  snippets: readonly CommandSnippet[] = COMMAND_SNIPPETS
): SnippetOptionGroup[] {
  const groups: SnippetOptionGroup[] = []
  for (const group of SNIPPET_GROUPS) {
    const options = snippets
      .filter((snippet) => snippet.group === group.key)
      .map((snippet) => {
        const availability = snippetAvailability(snippet, vars)
        return {
          value: snippet.key,
          label: snippet.label,
          description: snippet.description,
          hint: availability.available ? snippet.description : availability.reason,
          disabled: !availability.available
        }
      })
    if (options.length > 0) groups.push({ label: group.label, options })
  }
  return groups
}

export type SnippetApplyMode = 'create' | 'edit'

export interface SnippetPatch {
  command: string
  name?: string
  danger?: boolean
  timeoutSec?: number
}

export function buildSnippetPatch(input: {
  snippet: CommandSnippet
  mode: SnippetApplyMode
  currentName: string
}): SnippetPatch {
  const patch: SnippetPatch = { command: input.snippet.command }
  if (input.mode !== 'create') return patch
  const suggestion = input.snippet.suggest
  if (!suggestion) return patch
  if (suggestion.name && input.currentName.trim() === '') patch.name = suggestion.name
  if (suggestion.danger === true) patch.danger = true
  if (typeof suggestion.timeoutSec === 'number') patch.timeoutSec = suggestion.timeoutSec
  return patch
}
