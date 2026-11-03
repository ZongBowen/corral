# Corral 项目架构

> 本文基于当前仓库实际代码整理，描述目录结构、进程边界、核心模块、数据流与构建方式。
> 产品需求与交互细节见 design.md。

## 1. 项目概览

Corral 是一个 Windows 桌面端研发服务器管理工具，使用 Electron 构建。它把服务器信息、开发环境、目录配置、操作命令、SFTP 预上传和执行历史收敛到一个本地应用中。

核心能力：

- 服务器 CRUD、密码加密存储、SSH 连接测试、主机指纹 TOFU 校验
- 开发环境与具名远程目录配置、目录存在性/可写性校验
- 每个环境维护多条操作（命令、超时、二次确认、危险标记、预上传）
- 单环境执行：SSH exec、stdout/stderr 流式日志、超时与取消
- 操作级 SFTP 预上传：文件/目录、进度、覆盖前备份、失败清理
- 执行历史、日志分页回看、导出、保留策略
- 全局设置、明暗主题、数据目录与配置导出

### 技术栈

| 层 | 选型 | 当前版本 |
| --- | --- | --- |
| 桌面运行时 | Electron | 45.1.0 |
| 构建 | electron-vite + Vite | 6.0.0 / 8.3.5 |
| UI | React + Ant Design | 19.3.1 / 6.6.8 |
| 状态 | Zustand | 5.0.16 |
| 校验 | Zod | 4.6.7 |
| SSH/SFTP | ssh2 | 1.17.0 |
| 日志渲染 | anser | 2.3.5 |
| 编码 | iconv-lite | 0.7.3 |
| 语言/类型 | TypeScript | 7.0.2 |
| 测试 | Vitest | 5.0.5 |
| 打包 | electron-builder（NSIS x64） | 26.18.0 |

主进程和预加载脚本输出 CommonJS（package.json 未设置 type: module），因此 sandbox: true 的预加载脚本可以正常 require('electron')。ssh2 与 iconv-lite 放在 dependencies 中并由 electron-builder 打入 asar；React、antd、zustand、zod、nanoid、anser 等由 Vite 打进各自 bundle。

## 2. 目录结构

    corral/
    ├─ docs/
    │  ├─ design.md                 # 产品设计文档
    │  └─ architecture.md           # 本文
    ├─ electron.vite.config.ts      # 三端构建、别名、CSP 注入
    ├─ electron-builder.yml         # NSIS x64 打包配置
    ├─ package.json
    ├─ pnpm-workspace.yaml          # hoisted linker、允许执行的构建脚本
    ├─ tsconfig.json                # IDE/通用配置
    ├─ tsconfig.node.json           # main/preload/shared 类型检查
    ├─ tsconfig.web.json            # renderer/shared 类型检查
    ├─ vitest.config.mts            # 单测配置与 electron mock 别名
    ├─ src/
    │  ├─ main/
    │  │  ├─ index.ts               # 单实例、窗口、启动装配、退出保护
    │  │  ├─ context.ts             # AppContext 依赖容器
    │  │  ├─ ipc/
    │  │  │  ├─ index.ts            # registerIpc + 统一 handle 包装
    │  │  │  ├─ server.ts
    │  │  │  ├─ env.ts
    │  │  │  ├─ run.ts
    │  │  │  ├─ settings.ts
    │  │  │  ├─ app.ts
    │  │  │  ├─ hostkey.ts
    │  │  │  └─ dialog.ts
    │  │  ├─ services/
    │  │  │  ├─ store.ts            # store.json 原子读写/迁移
    │  │  │  ├─ vault.ts            # safeStorage 密码加密
    │  │  │  ├─ knownHosts.ts       # 主机指纹记录
    │  │  │  ├─ ssh.ts              # SSH 连接、exec、检测、终止进程
    │  │  │  ├─ hostKeyBroker.ts    # 指纹确认挑战
    │  │  │  ├─ uploadPlan.ts       # 本地文件树预检
    │  │  │  ├─ upload.ts           # SFTP 上传/备份/替换
    │  │  │  ├─ runner.ts           # 执行状态机、队列、取消、超时
    │  │  │  ├─ logStore.ts         # JSONL 日志读写
    │  │  │  ├─ textDecoder.ts      # UTF-8/GBK 流式解码
    │  │  │  ├─ batcher.ts          # 输出节流聚合
    │  │  │  └─ retention.ts        # 执行历史保留策略
    │  │  └─ utils/
    │  │     └─ atomicFile.ts       # 原子写与损坏 JSON 备份
    │  ├─ preload/
    │  │  └─ index.ts               # contextBridge 白名单 API
    │  ├─ shared/
    │  │  ├─ types.ts               # 领域类型与默认设置
    │  │  ├─ schema.ts              # Zod 输入校验
    │  │  ├─ ipc.ts                 # 通道常量、CorralApi、事件类型
    │  │  ├─ command.ts             # shell 转义、变量解析、路径校验
    │  │  ├─ errors.ts              # AppError、SSH 错误分类
    │  │  └─ id.ts                  # nanoid 封装
    │  └─ renderer/
    │     ├─ index.html             # CSP 占位符
    │     └─ src/
    │        ├─ main.tsx            # React 入口，引入全局样式
    │        ├─ App.tsx             # ConfigProvider、启动态、事件桥
    │        ├─ api.ts              # IPC 结果拆包与 ApiError
    │        ├─ layouts/AppLayout.tsx
    │        ├─ pages/servers/
    │        ├─ pages/envs/
    │        ├─ pages/runs/
    │        ├─ pages/settings/
    │        ├─ components/         # 日志、路径、操作、上传、指纹、状态
    │        ├─ stores/             # Zustand 领域 store
    │        ├─ hooks/useAppEvents.ts
    │        ├─ templates.ts        # 操作模板
    │        ├─ utils/format.ts
    │        └─ styles/global.css   # reset 与日志/代码字体
    ├─ tests/
    │  └─ mocks/electron.ts         # 单测用 electron 模块 mock
    └─ release/                     # electron-builder 输出（忽略提交）

## 3. 进程架构

    ┌──────────────────────────── Renderer（Chromium）───────────────────────────┐
    │ React 19 + Ant Design 6 + Zustand                                         │
    │ App.tsx 启动后通过 window.api 获取 bootState、订阅运行事件                │
    │ 仅访问 window.api，无 Node、无文件系统、无凭据                             │
    └───────────────────────────────▲────────────────────────────────────────────┘
                                    │ contextBridge 白名单 API
    ┌───────────────────────────────┴────────────────────────────────────────────┐
    │ Preload（sandbox、contextIsolation）                                       │
    │ 暴露 server/env/run/settings/app/hostkey/dialog + events                   │
    │ invoke 统一返回 { ok, data } / { ok, error }                               │
    └───────────────────────────────▲────────────────────────────────────────────┘
                                    │ ipcRenderer.invoke / webContents.send
    ┌───────────────────────────────┴────────────────────────────────────────────┐
    │ Main（Node.js）                                                           │
    │ StoreService  VaultService  KnownHostsService  SshService                  │
    │ HostKeyBroker  LogStore  Uploader  RunManager  IPC handlers                │
    └───────────────────────────────▲────────────────────────────────────────────┘
                                    │ SSH over TCP（密码认证 + SFTP 子系统）
                            ┌───────┴────────┐
                            │ Ubuntu / 麒麟   │
                            └────────────────┘

### 安全边界

- BrowserWindow：sandbox: true、contextIsolation: true、nodeIntegration: false、webSecurity: true。
- 预加载只暴露 CorralApi 白名单，不暴露 ipcRenderer 本身。
- 每个 IPC handler 校验调用来源是否为主窗口，入参用 Zod 校验，异常统一转换为 { ok: false, error }。
- 密码只在主进程内存和 safeStorage 加密文件中存在，渲染层只收到 hasPassword / credentialBroken 标记。
- 生产环境 CSP 由构建插件注入：script-src 'self'、style-src 'self' 'unsafe-inline'、object-src 'none' 等；开发环境额外放行 Vite HMR 所需的内联脚本和 localhost WebSocket。
- 禁止新窗口与页面导航，外链只允许 http/https 经 shell.openExternal 打开；生产禁用菜单、F12 和 Ctrl+Shift+I。

## 4. 启动流程

1. app.setName('Corral')，开发环境可通过 CORRAL_USER_DATA_DIR 指定独立数据目录，通过 CORRAL_DEBUG_PORT 开启远程调试。
2. app.requestSingleInstanceLock() 保证单实例；第二次启动只聚焦已有窗口。
3. app.whenReady() 后拒绝所有权限请求，进入 bootstrap()。
4. bootstrap() 依次初始化：
   - StoreService：加载 store.json，迁移旧数据；把上次未完成的运行标记为 disconnected。
   - VaultService：初始化异步 safeStorage 与 secrets.json。
   - KnownHostsService：加载 known-hosts.json。
   - LogStore：创建 logs/。
   - HostKeyBroker、SshService、RunManager：装配执行链路。
   - AppContext：作为依赖容器传给所有 IPC handler。
   - registerIpc()：注册全部 invoke handler。
   - applyRetention()：按保留条数/天数清理历史。
   - 读取 window-state.json，创建主窗口。
5. 渲染层启动：App.tsx 调用 app:getBootState，一次性拿到 servers/envs/settings/activeRunIds，写入 Zustand；随后渲染 AppLayout 与全局 HostKeyModal。
6. 退出：窗口关闭或 before-quit 时若有活动任务，弹出确认；确认后 cancelAll()、刷新 store、退出。

默认数据目录：%APPDATA%/Corral。

## 5. 主进程核心模块

### 5.1 StoreService（services/store.ts）

- 维护完整 StoreState：servers、envs、runs、settings、schemaVersion。
- 写策略：writeFileAtomic 先写临时文件、fsync，再 rename 覆盖。
- 写节流：mutate() 后 300ms 防抖；flush() 立即落盘，退出前调用。
- 损坏恢复：JSON 读取失败时重命名为 store.corrupt-<timestamp>.json，以空库启动并通知渲染层。
- 迁移：补齐旧执行缺少的 uploads、timeoutSec、confirm 等字段。
- exportConfig() 导出不含密码的配置快照。

### 5.2 VaultService（services/vault.ts）

- 使用 Electron safeStorage.isAsyncEncryptionAvailable / encryptStringAsync / decryptStringAsync。
- secrets.json 中以 serverId -> base64(密文) 保存密码。
- 解密失败返回 null，列表展示 credentialBroken，不删除其他数据。
- 提供 has/getPassword/setPassword/remove/isBroken，不向渲染层返回明文。

### 5.3 KnownHostsService（services/knownHosts.ts）

- 计算 SHA256:<base64> 主机指纹，与 ssh-keygen -lf 格式一致。
- known-hosts.json 保存 host、port、keyType、fingerprint、firstSeenAt、lastSeenAt。
- trust/touch/remove/list；服务器删除或地址变更时清理旧记录。

### 5.4 SshService（services/ssh.ts）

- connect()：密码认证、keepaliveInterval=15s、keepaliveCountMax=3；已知主机 readyTimeout=20s，首次连接 45s。
- hostVerifier 使用回调形式挂起握手：首次连接向 HostKeyBroker 发起 30 秒确认；指纹变化立即拒绝并记录新指纹。
- execStream() / execCapture()：执行远端命令并收集输出；execCapture 支持超时与 UTF-8/GBK 解码。
- testConnection()：执行 /etc/os-release、uname、uptime、whoami，返回发行版、内核、运行时长、账号。
- killRemoteProcess()：新建连接执行 pkill -TERM -P <pid>、kill -TERM、kill -KILL，尽力终止。
- openSftp()：打开 SFTP 会话，供上传使用。
- 兼容旧算法时通过 algorithms.append 追加 SHA-1/CBC 等旧算法。

### 5.5 HostKeyBroker（services/hostKeyBroker.ts）

- 保存 challengeId -> resolve/timer 的挂起请求。
- 通过 hostkey:challenge 事件发往渲染层；渲染层 hostkey:decision 或 30 秒超时结束。
- 主窗口不存在或已销毁时直接拒绝，避免 SSH 握手悬挂。

### 5.6 UploadPlan / Uploader（services/uploadPlan.ts、upload.ts）

uploadPlan.ts 只做本地预检，不建立 SSH：

- 解析上传项 localPath、targetDir 变量；
- lstat/readdir 递归统计文件数、目录数、总字节；
- 跳过符号链接，记录 warning；
- 文件数上限 20000；
- 校验目标路径为绝对路径、非根目录、同一操作内不重复。

upload.ts 负责实际传输：

- mkdirp 逐级创建远端目录（0755），并检查路径组件是否为符号链接；
- 文件先写入 targetDir/.corral-tmp-<runId8>-<seq>-<name>；
- fastPut 使用 mode 0644、concurrency 8、step 回调上报字节进度；
- 写完用远端 stat 校验临时文件大小；
- backup：mv target target.bak-yyyyMMdd-HHmmss，重名追加 -1、-2；
- overwrite：mv -f temp target；
- 目录上传按文件级合并，保留目标目录中多余文件；
- 失败或取消时尽力删除本次临时文件，已完成替换不回滚；
- 上传空闲超过设置值（默认 60s）终止。

### 5.7 RunManager（services/runner.ts）

- 全局并发上限 4；同一环境同时只允许一个执行（envLocks）。
- precheck()：解析命令变量、展开上传目标、统计本地文件；不建立 SSH。
- start()：创建 Run 记录、入队、立即返回 runId。
- 状态机只允许预定义迁移；终态后忽略迟到事件。
- 执行过程：连接 → 目录校验（可跳过）→ 预上传 → bash -lc 执行。
- 命令前置 PID 标记：printf '\036CORRAL_PID:%s\036\n' "$$" >&2，主进程解析并剥离。
- 输出经 StringDecoder/iconv 解码，OutputBatcher 按 64KB 或 60ms 聚合后推给渲染层并写 JSONL。
- 取消：排队中直接取消；运行中通过独立 SSH 连接终止远端 PID，再关闭 channel；上传中通过 AbortController 和 sftp.end() 中止。
- 命令超时与上传空闲超时相互独立；退出码 130/137 在日志中给出解释。
- 结束后写 logBytes、uploadStats、durationMs，更新 store，发出 run:done。

### 5.8 LogStore（services/logStore.ts）

- 每个 Run 一个 logs/<runId>.jsonl，写入 t、s、d：
  - t：相对开始的毫秒偏移
  - s：out / err / sys
  - d：文本
- 单次日志上限 50MB，超出后写一条系统提示并停止写入。
- readChunk() 按字节偏移读取，自动对齐行边界，默认每页 256KB。
- exportTo() 将 JSONL 导出为纯文本；remove/clear 同步删除日志文件。

### 5.9 其他

- batcher.ts：输出节流聚合，避免高频 IPC。
- textDecoder.ts：UTF-8 使用 StringDecoder，GBK 使用 iconv-lite。
- retention.ts：同时满足「最近 N 条」和「最近 M 天」的交集，删除 Run 与日志文件。
- atomicFile.ts：writeFileAtomic、readJsonFile、损坏文件备份与时间戳。

## 6. 共享层

| 文件 | 职责 |
| --- | --- |
| shared/types.ts | Server、DevEnv、EnvAction、UploadItem、Run、Settings、事件载荷、默认设置 |
| shared/schema.ts | 服务器、环境、目录、操作、上传、设置、run 过滤等 Zod Schema |
| shared/ipc.ts | CH 通道常量、EV 事件常量、CorralApi 类型 |
| shared/command.ts | shellQuote、resolveVariables、buildExecScript、buildPathCheckScript、joinRemote、assertSafeRemotePath、findUnquotedVars |
| shared/errors.ts | AppError、classifySshError、describeExitCode、错误裁剪 |
| shared/id.ts | nanoid 封装 |

共享层不依赖 Node/Electron，主进程与渲染进程都可使用。

## 7. IPC 契约

### 7.1 统一返回

所有 invoke 通道返回：

    { ok: true, data: T }
    { ok: false, error: { code: string, message: string } }

src/main/ipc/index.ts 的 handle() 负责：

- 校验调用来源为主窗口 webContents；
- 可选的 Zod 入参解析；
- 捕获 AppError/未知异常并裁剪为统一错误；
- 返回统一信封。

### 7.2 通道分组

| 分组 | 通道 | 说明 |
| --- | --- | --- |
| 服务器 | server:list/create/update/remove/test/trustHostKey | 列表返回 ServerSummary；测试支持临时凭据 |
| 环境 | env:list/create/update/remove/validatePaths | validatePaths 需要真实 SSH |
| 执行 | run:precheck/start/cancel/list/readLog/exportLog/remove/clear | start 返回 runId，结果走事件 |
| 设置 | settings:get/update | 合并更新 Settings |
| 应用 | app:getBootState/openDataDir/exportConfig/copyText | 启动态、数据目录、配置导出、复制日志 |
| 指纹 | hostkey:decision | 回应 hostkey:challenge |
| 文件对话框 | dialog:pickFiles/pickDirectory | 返回本地绝对路径，不传文件内容 |

### 7.3 主进程到渲染层事件

| 事件 | 载荷 |
| --- | --- |
| run:status | runId, status, errorKind?, errorMessage?, exitCode?, durationMs? |
| run:output | runId, stream: stdout/stderr/system, data |
| run:progress | runId, phase: upload, fileIndex, fileCount, fileName, transferredBytes, totalBytes |
| run:done | 完整 Run |
| hostkey:challenge | 主机、端口、算法、指纹、是否不匹配 |
| app:notice | 启动损坏、凭据不可用等系统提示 |

Preload 的订阅方法都返回取消订阅函数，渲染层在 useAppEvents 的 effect 清理阶段统一调用。

## 8. 执行状态机与数据流

    queued
      │
      ▼
    connecting ──失败──► failed / canceled / disconnected
      │
      ▼
    validating（设置关闭或 force 时可跳过）──失败──► failed / canceled / disconnected
      │
      ▼
    uploading（无上传项时跳过）──失败──► failed / timeout / canceled / disconnected
      │
      ▼
    running ──► success
            ├──► failed（退出码非 0）
            ├──► timeout（命令超时）
            ├──► canceled（用户取消）
            └──► disconnected（连接中断）

一次执行的完整链路：

1. 渲染层点击操作，先调用 run:precheck 获取展开后的命令、上传清单、缺失文件和警告。
2. 需要确认时展示 ConfirmRunModal，调用 run:start。
3. RunManager 创建 Run、加环境锁、入队并立即返回 runId。
4. 主进程取凭据、建立 SSH、处理主机指纹。
5. 如开启目录校验，执行 test -d/-w 脚本，解析 DIR_OK/DIR_MISSING/WRITE_OK/READONLY。
6. 如有预上传，先完成全部 SFTP 上传与替换，再进入命令执行。
7. 通过 bash -lc 执行命令，按 60ms/64KB 聚合输出，分别写入日志文件并推送事件。
8. 命令结束、超时、取消或断连后进入终态，写回 Run 并发出 run:done。
9. 渲染层更新日志面板、按钮状态、历史和环境的最近执行信息。

## 9. 数据与持久化

    %APPDATA%/Corral/
    ├─ store.json          # servers / envs / runs / settings / schemaVersion
    ├─ secrets.json        # { [serverId]: base64(safeStorage 密文) }
    ├─ known-hosts.json    # 主机指纹记录
    ├─ window-state.json   # 窗口尺寸、位置、最大化状态
    └─ logs/
       └─ <runId>.jsonl    # 每次执行的日志

### 关键数据模型

- Server：id、name、host、port、username、description、tags、时间戳、lastConnectedAt。
- ServerSummary：Server + hasPassword + credentialBroken，仅用于渲染层。
- DevEnv：serverId、name、paths、actions、description、时间戳。
- PathEntry：key、label、path、required；workDir 必填。
- EnvAction：name、command、timeoutSec、confirm、danger、uploads。
- UploadItem：kind（file/dir）、localPath、targetDir、conflict（backup/overwrite）。
- Run：环境/服务器/操作名称快照、原始命令、解析后命令、状态、退出码、错误分类、耗时、日志大小、上传统计、远端 PID。

设置默认值：默认超时 300s、执行前校验目录开启、上传冲突默认备份、上传空闲超时 60s、日志保留 200 条 / 30 天、输出 UTF-8、旧 SSH 算法关闭。

## 10. 渲染层架构

### 10.1 入口与主题

- main.tsx：引入 styles/global.css，挂载 React。
- App.tsx：
  - ConfigProvider 设置 zh_CN、亮/暗算法、圆角 6/8/4、控件高度 32、按钮不自动插入空格；
  - AntdApp 提供 message/notification/modal 上下文；
  - 启动时调用 app:getBootState 一次性填充 stores；
  - 全局订阅运行事件、指纹挑战、系统通知；
  - 加载完成后渲染 AppLayout 与 HostKeyModal。
- 主题：settings.theme 为 system/light/dark，system 通过 matchMedia('(prefers-color-scheme: dark)') 跟随系统。

### 10.2 导航与页面

不使用 react-router；uiStore 维护当前页面与选中环境，AppLayout 用 Layout.Sider + Menu 切换四个页面。内容区 padding 为 16px。

| 页面 | 文件 | 主要内容 |
| --- | --- | --- |
| 服务器 | pages/servers/ServersPage.tsx、ServerDrawer.tsx | 表格、搜索/筛选、连接测试、新增/编辑/复制/删除、指纹信任 |
| 开发环境 | pages/envs/EnvsPage.tsx、EnvDrawer.tsx、EnvDetail.tsx、EnvActionsDrawer.tsx | 左树右详情、目录徽标与校验、操作按钮、执行面板、操作配置 |
| 执行历史 | pages/runs/RunsPage.tsx | 筛选、表格、日志详情抽屉、导出/删除/清空 |
| 设置 | pages/settings/SettingsPage.tsx | 主题、超时、上传、日志保留、编码、旧算法、数据目录、配置导出 |

配置操作：EnvActionsDrawer 的编辑、新增、删除、上移/下移都会立即调用 env:update 落盘，抽屉不再需要二次保存；保存失败时保留原列表并提示错误。

### 10.3 组件

| 组件 | 职责 |
| --- | --- |
| LogPanel | 实时日志、ANSI 着色、自动滚动暂停、停止/清屏/复制/导出、上传进度 |
| AnsiText | 历史日志的 ANSI token 渲染（无 HTML 注入） |
| RunConsole | 环境详情中的执行面板与停止确认 |
| StatusBadge | RunStatus 与服务器在线状态统一 Badge |
| PathEditor | 具名目录增删、key/label/path、必填开关 |
| ActionEditor | 操作名称、命令、超时、确认、危险标记、变量插入、预览、上传项 |
| UploadEditor | 文件/目录选择、目标变量、冲突策略 |
| ConfirmRunModal | 上传清单、总大小、解析后命令、缺失文件警告 |
| HostKeyModal | 首次信任/指纹变化、30 秒倒计时 |

### 10.4 Zustand stores

| Store | 职责 |
| --- | --- |
| uiStore | 当前页面、选中环境、简单历史 |
| settingsStore | Settings 加载与更新 |
| serversStore | 服务器列表、连接状态缓存、测试连接 |
| envsStore | 环境列表、目录校验结果缓存 |
| runsStore | 历史列表、筛选、删除/清空 |
| runStreamStore | 每个 run 的状态、输出行、进度；2MB/2000 行环形裁剪 |
| hostKeyStore | 当前指纹挑战 |

### 10.5 事件桥

hooks/useAppEvents.ts 在 App 挂载时一次性订阅：

- run:output → runStreamStore.append
- run:status → 更新状态/退出码/错误
- run:progress → 更新上传进度
- run:done → 写入完整 Run，并刷新历史与环境
- hostkey:challenge → hostKeyStore
- app:notice → antd notification

## 11. 构建与运行

### 11.1 electron-vite

- 三个 target：main、preload、renderer。
- 别名：@shared、@main、@renderer。
- externalizeDepsPlugin() 外部化 dependencies（ssh2、iconv-lite）；其余依赖由 Vite 打包。
- CSP 插件在 renderer 构建时替换 index.html 的 CSP 占位符：
  - 开发：允许 unsafe-inline 与 localhost WebSocket，兼容 HMR；
  - 生产：收紧为 script-src 'self'。
- main/preload 输出 CJS，满足 sandbox preload 限制。

### 11.2 pnpm

- pnpm-workspace.yaml 设置 nodeLinker: hoisted，便于 electron-builder 收集依赖。
- onlyBuiltDependencies 允许 electron、electron-builder、esbuild 执行安装脚本；cpu-features、electron-winstaller、ssh2 的构建脚本被忽略（ssh2 可选原生依赖不影响密码认证/exec/SFTP）。

### 11.3 打包

electron-builder.yml：

- Windows NSIS x64，oneClick: false，允许修改安装目录；
- files 只包含 out/**/*、!out/**/*.map、package.json；
- asar: true、npmRebuild: false；
- electronDownload.mirror 指向 npmmirror；
- 目前未配置自定义图标与代码签名，使用 Electron 默认图标。

### 11.4 常用命令

    pnpm dev                 # electron-vite 开发模式
    pnpm typecheck           # node + web 两套 TS 类型检查
    pnpm test                # Vitest
    pnpm build               # typecheck + electron-vite build
    pnpm dist:dir            # 构建并生成 release/win-unpacked
    pnpm dist                # 构建 NSIS 安装包

## 12. 测试架构

- vitest.config.mts：Node 环境，electron 别名到 tests/mocks/electron.ts，只收集 src/**/*.test.ts。
- 当前覆盖 10 个测试文件、44 个用例：
  - shared/command：shell 转义、变量解析、路径拼接、校验脚本解析；
  - store：默认值、原子写、损坏备份、旧数据迁移；
  - vault：异步 safeStorage、损坏凭据；
  - knownHosts：SHA256 指纹、信任/删除；
  - logStore：JSONL 写入、偏移分页、导出、删除；
  - retention：条数 ∩ 天数；
  - uploadPlan：文件/目录递归、缺失、重复目标；
  - upload：FakeSftp 上传、备份、取消；
  - runner：FakeSsh 成功/失败/拒绝连接、环境互斥、PID 标记；
  - textDecoder：UTF-8 跨块、GBK、批处理。
- 真实 SSH/SFTP、主机指纹首次确认、大文件上传仍需在 Ubuntu/麒麟测试机上手工验证。

## 13. 扩展约定

新增一个业务能力时，通常按以下顺序改动：

1. shared/types.ts 增加领域类型；
2. shared/schema.ts 增加 Zod 入参校验；
3. shared/ipc.ts 增加 CH 通道和 CorralApi 方法；
4. main/services/ 实现业务逻辑，并通过 AppContext 注入；
5. main/ipc/ 注册 handler，统一走 handle()；
6. preload/index.ts 映射通道；
7. renderer/src/stores 增加状态，页面/组件消费；
8. 为纯逻辑补 *.test.ts，避免把 Electron 依赖带入单测。

## 14. 当前约束

- 一期仅 Windows，仅密码认证，不支持私钥/ssh-agent/跳板机。
- 同一环境同一时刻只允许一个执行；全局并发 4；不做批量执行。
- 不使用 PTY/xterm，只做预设命令执行与日志查看。
- 取消是尽力而为，脚本自行 nohup/setsid 启动的后台进程不会被连带终止。
- 密码不可导出；safeStorage 绑定 Windows 用户，换机/换用户后需要重新录入。
- 预上传配置只保存本地路径，不复制文件到应用数据目录。
- 打包未配置应用图标和代码签名，安装包为默认 Electron 图标。
