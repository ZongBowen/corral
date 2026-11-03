import { Client, utils } from 'ssh2'
import { decode as iconvDecode } from 'iconv-lite'
import type { ClientChannel, ConnectConfig, SFTPWrapper } from 'ssh2'
import { AppError, classifySshError } from '@shared/errors'
import { newId } from '@shared/id'
import type { HostKeyChallenge, Server, TestResult } from '@shared/types'
import { fingerprint, type KnownHostsService } from './knownHosts'
import type { HostKeyBroker } from './hostKeyBroker'

export interface SshConnectOptions {
  host: string
  port: number
  username: string
  password: string
  legacyAlgorithms?: boolean
  readyTimeoutMs?: number
}

export interface SshDeps {
  knownHosts: KnownHostsService
  hostKeys: HostKeyBroker
  getLegacyAlgorithms: () => boolean
}

const LEGACY_ALGORITHMS = {
  kex: { append: ['diffie-hellman-group14-sha1'] },
  cipher: { append: ['aes128-cbc', 'aes192-cbc', 'aes256-cbc', '3des-cbc'] },
  serverHostKey: { append: ['ssh-rsa'] },
  hmac: { append: ['hmac-sha1'] }
} as unknown as ConnectConfig['algorithms']

export interface ExecResult {
  stdout: string
  stderr: string
  code: number | null
}

export class SshService {
  private lastSeen = new Map<string, { keyType: string; fingerprint: string }>()

  constructor(private readonly deps: SshDeps) {}

  static keyFor(host: string, port: number): string {
    return host + ':' + String(port)
  }

  lastSeenKey(host: string, port: number): { keyType: string; fingerprint: string } | undefined {
    return this.lastSeen.get(SshService.keyFor(host, port))
  }

  async trustLastSeen(host: string, port: number): Promise<void> {
    const seen = this.lastSeen.get(SshService.keyFor(host, port))
    if (!seen) {
      throw new AppError('hostkey', '没有可信任的新指纹，请先对该服务器执行一次连接测试')
    }
    await this.deps.knownHosts.trust({
      host,
      port,
      keyType: seen.keyType,
      fingerprint: seen.fingerprint,
      firstSeenAt: '',
      lastSeenAt: ''
    })
  }

  async connect(options: SshConnectOptions): Promise<Client> {
    const known = this.deps.knownHosts.get(options.host, options.port)
    const legacy = options.legacyAlgorithms ?? this.deps.getLegacyAlgorithms()
    let captured: { key: Buffer; keyType: string; fingerprint: string } | null = null

    const client = new Client()

    return await new Promise<Client>((resolve, reject) => {
      let settled = false

      const rejectWith = (error: AppError): void => {
        if (settled) return
        settled = true
        try {
          client.end()
        } catch {
          // ignore close errors
        }
        reject(error)
      }

      client.on('ready', () => {
        if (settled) return
        settled = true
        void this.deps.knownHosts.touch(options.host, options.port)
        resolve(client)
      })

      client.on('error', (error: Error) => {
        if (settled) return
        if (captured && known && captured.fingerprint !== known.fingerprint) {
          this.lastSeen.set(SshService.keyFor(options.host, options.port), {
            keyType: captured.keyType,
            fingerprint: captured.fingerprint
          })
          rejectWith(
            new AppError(
              'hostkey',
              '主机密钥与记录不一致（旧 ' + known.fingerprint + '，新 ' + captured.fingerprint + '），已阻止连接'
            )
          )
          return
        }
        const classified = classifySshError(error)
        rejectWith(new AppError(classified.kind, classified.message))
      })

      client.on('close', () => {
        if (settled) return
        if (captured && known && captured.fingerprint !== known.fingerprint) {
          rejectWith(
            new AppError(
              'hostkey',
              '主机密钥与记录不一致（旧 ' + known.fingerprint + '，新 ' + captured.fingerprint + '），已阻止连接'
            )
          )
          return
        }
        rejectWith(new AppError('network', '连接已关闭'))
      })

      const config: ConnectConfig = {
        host: options.host,
        port: options.port,
        username: options.username,
        password: options.password,
        readyTimeout: options.readyTimeoutMs ?? (known ? 20_000 : 45_000),
        keepaliveInterval: 15_000,
        keepaliveCountMax: 3,
        hostVerifier: (key: Buffer, verify: (valid: boolean) => void): void => {
          captured = {
            key,
            keyType: keyTypeOf(key),
            fingerprint: fingerprint(key)
          }
          if (known) {
            verify(captured.fingerprint === known.fingerprint)
            return
          }
          const challenge: HostKeyChallenge = {
            challengeId: newId(),
            host: options.host,
            port: options.port,
            keyType: captured.keyType,
            fingerprint: captured.fingerprint,
            isMismatch: false
          }
          void this.deps.hostKeys.request(challenge).then((accepted) => {
            if (accepted && captured) {
              this.lastSeen.set(SshService.keyFor(options.host, options.port), {
                keyType: captured.keyType,
                fingerprint: captured.fingerprint
              })
              void this.deps.knownHosts.trust({
                host: options.host,
                port: options.port,
                keyType: captured.keyType,
                fingerprint: captured.fingerprint,
                firstSeenAt: '',
                lastSeenAt: ''
              })
            }
            verify(accepted)
          })
        }
      }
      if (legacy) config.algorithms = LEGACY_ALGORITHMS

      client.connect(config)
    })
  }

  execStream(client: Client, command: string): Promise<ClientChannel> {
    return new Promise<ClientChannel>((resolve, reject) => {
      client.exec(command, { pty: false }, (error, stream) => {
        if (error) {
          const classified = classifySshError(error)
          reject(new AppError(classified.kind, classified.message))
          return
        }
        resolve(stream)
      })
    })
  }

  async execCapture(
    client: Client,
    command: string,
    options: { timeoutMs?: number; encoding?: 'utf-8' | 'gbk' } = {}
  ): Promise<ExecResult> {
    const stream = await this.execStream(client, command)
    return await new Promise<ExecResult>((resolve, reject) => {
      const out: Buffer[] = []
      const err: Buffer[] = []
      let done = false
      const timer = options.timeoutMs
        ? setTimeout(() => {
            if (done) return
            done = true
            try {
              stream.close()
            } catch {
              // ignore
            }
            reject(new AppError('connect-timeout', '执行超时'))
          }, options.timeoutMs)
        : null

      const finish = (fn: () => void): void => {
        if (done) return
        done = true
        if (timer) clearTimeout(timer)
        fn()
      }

      stream.on('data', (data: Buffer) => out.push(data))
      stream.stderr.on('data', (data: Buffer) => err.push(data))
      stream.on('close', (code: number | null) => {
        finish(() =>
          resolve({
            stdout: decodeBuffer(Buffer.concat(out), options.encoding ?? 'utf-8'),
            stderr: decodeBuffer(Buffer.concat(err), options.encoding ?? 'utf-8'),
            code: typeof code === 'number' ? code : null
          })
        )
      })
      stream.on('error', (error: Error) => {
        const classified = classifySshError(error)
        finish(() => reject(new AppError(classified.kind, classified.message)))
      })
    })
  }

  async testConnection(server: Server, password: string): Promise<TestResult> {
    const started = Date.now()
    let client: Client | null = null
    try {
      const known = this.deps.knownHosts.get(server.host, server.port)
      client = await this.connect({
        host: server.host,
        port: server.port,
        username: server.username,
        password,
        readyTimeoutMs: known ? 8_000 : 45_000
      })
      const script = [
        '. /etc/os-release 2>/dev/null',
        'echo "OS=$PRETTY_NAME"',
        'echo "ID=$ID"',
        'echo "VER=$VERSION_ID"',
        'echo "KERNEL=$(uname -r)"',
        'echo "UPTIME=$(uptime -p 2>/dev/null || uptime)"',
        'echo "USER=$(whoami)"'
      ].join('\n')
      const result = await this.execCapture(client, 'bash -lc ' + quote(script), { timeoutMs: 8_000 })
      const fields = parseKeyValue(result.stdout)
      return {
        ok: true,
        durationMs: Date.now() - started,
        os: fields.OS,
        osId: fields.ID,
        osVersion: fields.VER,
        kernel: fields.KERNEL,
        uptime: fields.UPTIME,
        username: fields.USER
      }
    } catch (error) {
      const classified = error instanceof AppError ? { kind: error.code, message: error.message } : classifySshError(error)
      return {
        ok: false,
        durationMs: Date.now() - started,
        errorKind: classified.kind as TestResult['errorKind'],
        errorMessage: classified.message
      }
    } finally {
      if (client) {
        try {
          client.end()
        } catch {
          // ignore
        }
      }
    }
  }

  async killRemoteProcess(options: SshConnectOptions, pid: number): Promise<void> {
    if (!Number.isInteger(pid) || pid <= 0) return
    const client = await this.connect({ ...options, readyTimeoutMs: 10_000 })
    try {
      const command =
        'pkill -TERM -P ' +
        String(pid) +
        ' 2>/dev/null; kill -TERM ' +
        String(pid) +
        ' 2>/dev/null; sleep 0.5; kill -KILL ' +
        String(pid) +
        ' 2>/dev/null; true'
      await this.execCapture(client, 'bash -lc ' + quote(command), { timeoutMs: 5_000 })
    } finally {
      try {
        client.end()
      } catch {
        // ignore
      }
    }
  }

  async openSftp(client: Client): Promise<SFTPWrapper> {
    return await new Promise<SFTPWrapper>((resolve, reject) => {
      client.sftp((error, sftp) => {
        if (error) {
          reject(new AppError('upload', '服务器未启用 SFTP 子系统'))
          return
        }
        resolve(sftp)
      })
    })
  }
}

function quote(value: string): string {
  return "'" + value.replace(/'/g, "'\\''") + "'"
}

function parseKeyValue(text: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const line of text.split(/\r?\n/)) {
    const index = line.indexOf('=')
    if (index <= 0) continue
    result[line.slice(0, index)] = line.slice(index + 1)
  }
  return result
}

function keyTypeOf(key: Buffer): string {
  try {
    const parsed = utils.parseKey(key)
    if (Array.isArray(parsed)) return parsed[0]?.type ?? 'unknown'
    if (parsed instanceof Error) return 'unknown'
    return parsed.type ?? 'unknown'
  } catch {
    return 'unknown'
  }
}

function decodeBuffer(buffer: Buffer, encoding: 'utf-8' | 'gbk'): string {
  if (encoding === 'gbk') {
    try {
      return iconvDecode(buffer, 'gbk')
    } catch {
      return buffer.toString('utf8')
    }
  }
  return buffer.toString('utf8')
}
