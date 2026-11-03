# Corral 研发服务器管理工具 · 设计文档

| 项目 | 内容 |
| --- | --- |
| 文档版本 | v0.2（草案） |
| 更新日期 | 2026-10-29 |
| 应用代号 | Corral |
| 版本变更 | v0.2：新增操作级预上传；Ant Design 升级为 6.6.8+ |
| 技术栈 | Electron + React 19 + TypeScript + Ant Design 6.6.8+ |
| 目标平台 | Windows 10/11 x64 |
| 状态 | 待评审 |

---

## 1. 背景与目标

研发与测试过程中，团队需要维护多台 Linux 虚拟机（Ubuntu、银河麒麟），每台机器上又运行着若干「开发环境」（一类需要长期运行、可更新可启停的软件，如 Docker Compose 服务、Java 进程、Node 服务等）。当前这些信息分散在文档、聊天记录和个人笔记中，存在以下问题：

- 服务器地址、账号、密码分散，交接成本高；
- 每台机器上的部署目录不统一，靠记忆；
- 更新/启动/关闭需要手动 SSH 登录并输入多条命令，易出错；
- 更新包需要手动通过 scp 等方式上传，容易传错目录；
- 操作过程没有留存，出了问题难以回溯。

**Corral 的目标**：把「服务器信息」「环境目录」「环境操作」收敛到一个单机、单人使用的本地桌面应用中，一键完成连接、校验、上传、执行，并保留完整的执行记录与日志。

### 1.1 已确认的产品决策

| 议题 | 结论 |
| --- | --- |
| 凭据存储 | 使用 Electron `safeStorage` 加密后存入本地文件 |
| 操作配置 | 每个环境维护**自定义操作列表**，内置更新/启动/关闭模板 |
| 执行呈现 | 应用内**流式日志面板**，仅展示执行输出与上传进度 |
| 认证方式 | 一期仅支持**密码认证** |
| 目标平台 | 一期仅 Windows |
| 批量执行 | 一期仅单环境执行，架构预留并发能力 |
| 目录配置 | **多目录（具名）字段 + 路径存在性/可写性校验** |
| 在线状态 | **手动/懒检测**，不做后台轮询 |
| 文件上传 | **操作级预上传**：执行操作时先上传本地文件/目录，成功后再执行命令 |
| 上传对象 | **文件 + 目录（递归）**，目标为远程绝对目录（通常引用环境具名目录） |
| 冲突处理 | 覆盖前自动备份为 `.bak-<时间戳>`，上传失败立即中止本次执行 |

---

## 2. 范围

### 2.1 一期范围（In Scope）

1. 服务器（虚拟机）的新增、编辑、删除、搜索、分组/标签、连接测试；
2. 服务器 IP/域名、SSH 端口、账号、密码、描述的记录，密码加密落盘；
3. 开发环境的新增、编辑、删除，绑定到某台服务器；
4. 每个环境配置多个具名目录（工作目录必填，日志目录/配置目录可选，支持自定义），并支持远程校验；
5. 每个环境配置任意条操作（名称、命令、超时、二次确认、危险标记），支持内置模板快速生成；
6. 操作级预上传：为操作配置本地文件/目录，执行时自动上传到目标目录，支持进度、取消与覆盖前备份；
7. 单环境执行操作，实时展示上传进度、stdout/stderr、退出码、耗时，支持取消与超时终止；
8. 执行历史列表与日志回看、导出；
9. 服务器连通性与基础信息检测（发行版、内核、运行时长）；
10. 全局设置（日志保留、默认超时、编码、主题等）。

### 2.2 一期不做（Out of Scope）

- 私钥 / ssh-agent / 跳板机认证；
- sudo 密码交互（见 §6.3.2 说明）；
- 独立的 SFTP 文件管理与远程目录浏览选择器（上传仅作为操作执行的前置步骤）；
- 多环境批量执行、定时任务；
- 多平台打包（macOS/Linux）、自动更新、代码签名；
- 服务器监控（CPU/内存曲线）、告警。

以上能力均在一期架构中预留扩展点。

---

## 3. 术语

| 术语 | 含义 | 代码中的实体 |
| --- | --- | --- |
| 服务器 | 一台可通过 SSH 访问的 Linux 虚拟机，包含地址与账号信息 | `Server` |
| 开发环境 | 部署在某台服务器上的软件运行实例，包含目录配置与操作集合 | `DevEnv` |
| 操作 | 一段可在环境上执行的 shell 命令，如「更新」「启动」「关闭」 | `EnvAction` |
| 执行 | 一次操作的具体运行实例，含日志、退出码、耗时 | `Run` |
| 目录项 | 环境中配置的具名远程路径，如 `workDir` | `PathEntry` |
| 上传项 | 操作执行前需要从本地上传到远程目录的文件或目录 | `UploadItem` |

---

## 4. 用户与核心场景

**目标用户**：研发、测试、实施人员，本机为 Windows，具备基础 Linux 命令能力。

### 场景 A：新环境接入

1. 拿到虚拟机 IP、账号、密码，在「服务器」页新增记录；
2. 点击「测试连接」，确认网络与账号可用；
3. 在「开发环境」页新增环境，选择服务器，填写工作目录；
4. 点击「校验目录」，确认路径存在且可写；
5. 保存。

### 场景 B：日常更新与启停

1. 进入环境详情，看到目录状态与操作按钮；
2. 点击「更新」→ 二次确认（弹窗列出待上传文件及目标路径）→ 查看上传进度；
3. 上传完成后自动执行更新命令，实时查看拉取/构建日志；
4. 失败时根据退出码与 stderr 定位；成功后状态标记为成功；
5. 需要停止时点击「关闭」，同样有确认与日志。

### 场景 C：问题回溯

1. 在「执行历史」中按环境/时间筛选；
2. 打开某次失败记录，查看完整日志（含 stderr 着色）；
3. 导出日志发给同事。

---

## 5. 总体方案

### 5.1 技术选型

| 层 | 选型 | 说明 |
| --- | --- | --- |
| 桌面框架 | Electron（最新稳定版） | 主进程持有 Node 能力，渲染进程纯 Web |
| 构建 | electron-vite + Vite | 主/预加载/渲染三端统一构建，HMR 体验好 |
| UI | React 19 + TypeScript + Ant Design 6.6.8+ | 需求指定；`ConfigProvider` 支持明暗主题与中文 locale，`App` 提供 message/notification 上下文 |
| 状态 | Zustand | 轻量，按领域拆 store，避免 Redux 样板 |
| 校验 | Zod | 与 TS 类型同源，用于持久化数据与 IPC 入参校验 |
| SSH / SFTP | ssh2 | 纯 JS，无需编译原生模块；支持密码认证、exec 流、SFTP 传输、host key 校验 |
| 日志渲染 | 无（`<pre>` + ANSI 解析） | 不引入 PTY；用 `anser` 将 ANSI 转为带颜色的安全 HTML |
| 时间 | dayjs | antd 已依赖 |
| 日志文件 | 自研 JSONL 追加写 | 保留 stdout/stderr/系统事件区分，支持历史回放 |
| 打包 | electron-builder（NSIS） | 生成单文件安装包，按用户安装 |

**为什么不用 `node-pty` / `xterm.js`**：本工具只做「发起预设命令 + 看输出」，定位上不提供交互式终端，同时避免原生模块编译与打包复杂度。

**为什么不用 `child_process.spawn('ssh')`**：Windows 自带 OpenSSH 客户端不保证存在，密码输入需要交互，且无法精细控制 host key 校验与流式事件。`ssh2` 可完全程序化控制。

**为什么不用 `keytar`**：需要原生模块并按 Electron ABI 重建；`safeStorage` 在 Windows 上底层即 DPAPI，满足一期安全要求。

**Ant Design 6 版本要点**：要求 React ≥ 18（本项目使用 React 19），`@ant-design/icons` 需同步使用 v6；CSS Variables 默认开启，仅支持现代浏览器（Electron 内置 Chromium 满足）；`Button` 的样式由 `color` + `variant` 表达（`type="primary"` 仍作为别名保留）；`Form.List` 的 `onFinish` 只包含已注册字段；消息提示统一通过 `App.useApp()` 获取实例，避免静态方法脱离主题上下文。

### 5.2 进程架构

```
┌────────────────────────── Renderer（Chromium）──────────────────────────┐
│  React 19 + Ant Design 6 + Zustand                                       │
│  Pages: 服务器 / 开发环境 / 执行历史 / 设置                               │
│  仅通过 window.api 访问能力，无 Node、无文件系统、无凭据                  │
└───────────────────────────────▲──────────────────────────────────────────┘
                                │ contextBridge 暴露的强类型 IPC
┌───────────────────────────────┴──────────────────────────────────────────┐
│ Preload（隔离上下文）                                                     │
│  白名单式 API：server.* / env.* / run.* / dialog.* / settings.* / events.*│
└───────────────────────────────▲──────────────────────────────────────────┘
                                │ ipcMain.handle / webContents.send
┌───────────────────────────────┴──────────────────────────────────────────┐
│ Main（Node.js）                                                           │
│  Store（JSON）  Vault（safeStorage）  SshService（ssh2 exec）             │
│  UploadService（SFTP）  RunManager（队列/超时/取消）  LogStore（JSONL）    │
│  KnownHosts（指纹）  FileDialog（系统文件选择）                            │
└───────────────────────────────▲──────────────────────────────────────────┘
                                │ SSH over TCP :22
                        ┌───────┴────────┐
                        │ Ubuntu / 麒麟   │
                        └────────────────┘
```

**关键原则**：凭据只存在于主进程内存与加密文件中，**任何情况下不通过 IPC 传给渲染进程**。渲染进程只持有 `serverId`，由主进程在建立连接时解析密码。

### 5.3 数据流（一次操作执行）

```
Renderer                Main                        远端服务器
   │ run:start(envId, actionId) │
   ├───────────────────────────►│
   │                            │ 1. 校验参数、取凭据、解析变量
   │                            │ 2. 建立 SSH（host key 校验，必要时弹窗）
   │                            ├──────────────────────────►│
   │                            │ 3. 目录校验 test -d/-w
   │                            ├──────────────────────────►│
   │                            │ 4. 预上传（SFTP：临时文件→备份→替换）
   │                            ├──────────────────────────►│
   │  event: run:progress        │
   │◄───────────────────────────┤
   │                            │ 5. exec bash -lc '<script>'
   │                            ├──────────────────────────►│
   │  event: run:status          │◄──────────── stdout/stderr ─┤
   │◄───────────────────────────┤   6. 节流聚合后推送 + 落盘
   │  event: run:output          │
   │◄───────────────────────────┤
   │                            │ 7. 退出码/超时/取消 → 终态
   │  event: run:done            │
   │◄───────────────────────────┤
```

---

## 6. 功能设计

### 6.1 服务器管理

#### 6.1.1 字段

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| 名称 | 是 | 展示名，如「订单测试机-01」，全局唯一性仅做软提示 |
| 主机 | 是 | IPv4 / 域名；保存时做格式校验，不强制可解析 |
| 端口 | 是 | 默认 22 |
| 用户名 | 是 | SSH 账号 |
| 密码 | 是 | 加密存储；编辑时留空表示不修改 |
| 描述 | 否 | 多行文本，记录用途、负责人、到期时间等 |
| 标签 | 否 | 字符串数组，用于筛选，如 `ubuntu`、`kylin`、`test` |

> 一期不做「分组树」，用标签 + 搜索满足分类需求，避免过早引入层级模型。

#### 6.1.2 列表

列：名称、地址（`host:port`）、账号、标签、描述、状态、最近连接时间、操作。

- 状态枚举：`未检测` / `检测中` / `在线` / `离线`，仅表示「最近一次检测结果」，不轮询；
- 搜索：名称、主机、描述、标签模糊匹配；
- 排序：名称、最近连接时间；
- 行操作：查看详情、测试连接、编辑、复制、删除；
- 空状态：引导「新增服务器」。

#### 6.1.3 新增/编辑

- 使用 `Drawer`（宽 520）承载表单，避免打断列表上下文；
- 新增时可点「测试连接」：使用当前表单中的 host/port/username/password 临时连接，**不落盘**；
- 编辑时密码框显示占位「已保存，留空则不修改」，提供「清除密码」开关；
- 端口非法、名称为空时即时校验。

#### 6.1.4 删除

- 若服务器下存在开发环境，弹窗明确提示「将同时删除 N 个环境，历史执行记录会保留」；
- 确认按钮使用 `color="danger"`，需二次确认；删除服务器时同步删除其凭据与 known-host 记录；
- 执行历史中保留服务器/环境的**名称快照**，不因删除而丢失可读性。

### 6.2 开发环境与目录

#### 6.2.1 字段

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| 名称 | 是 | 如「订单服务-dev」 |
| 所属服务器 | 是 | 从服务器列表选择 |
| 描述 | 否 | 版本、端口、负责人等 |
| 目录项 | 至少 1 项 | 具名路径列表，`workDir` 必填 |
| 操作列表 | 否 | 可先建环境后补操作 |

#### 6.2.2 目录模型

目录项为 `{ key, label, path }`：

- `key`：命令模板中的变量名，必须匹配 `^[A-Za-z_][A-Za-z0-9_]*$` 且唯一；
- `label`：界面展示名，如「工作目录」；
- `path`：远程绝对路径，必须以 `/` 开头；允许空格与中文（命令中需加引号）。

内置三项（可删除非必填项）：

| key | 默认 label | 必填 |
| --- | --- | --- |
| `workDir` | 工作目录 | 是 |
| `logDir` | 日志目录 | 否 |
| `configDir` | 配置文件目录 | 否 |

**变量**：命令中通过 `${workDir}`、`${logDir}`、`${configDir}`、`${自定义key}` 引用；另提供 `${envName}`。执行前替换为路径原文，未定义的变量视为错误并阻止执行。

**校验**：

- 保存时不强制联网，允许离线配置；
- 「校验」按钮或执行前自动校验（设置可关）执行：
  ```bash
  test -d '<path>' && echo "DIR_OK" || echo "DIR_MISSING"
  test -w '<path>' && echo "WRITE_OK" || echo "READONLY"
  ```
- 详情页展示每个目录的状态徽标：`未校验` / `存在且可写` / `只读` / `不存在`；
- 执行前校验失败时弹窗提示，并提供「仍要执行」与「取消」。

#### 6.2.3 环境列表与详情

- 左侧面板：按服务器分组的树（服务器 → 环境），支持搜索；
- 右侧：环境详情工作台（见 §7.2 线框图）；
- 删除环境：二次确认，历史记录保留。

### 6.3 操作配置

#### 6.3.1 操作字段

| 字段 | 说明 |
| --- | --- |
| 名称 | 「更新」「启动」「关闭」或自定义 |
| 命令 | 多行 shell 脚本，支持变量 |
| 超时 | 秒，默认继承全局 300s，可单独设置（0 表示不限，需谨慎） |
| 二次确认 | 默认开启；关闭后点击即执行 |
| 危险操作 | 标记为危险语义，按钮使用 `color="danger"`，确认文案更醒目（如「关闭」） |
| 预上传 | 执行前需上传的本地文件/目录列表，可为空；每项含本地路径、目标目录、冲突策略 |

- 操作列表支持上移/下移排序，顺序即详情页按钮顺序；
- 新建环境时可从模板一键生成三条操作；
- 命令编辑区为等宽字体多行输入，带「插入变量」「插入模板」两个下拉和实时预览（显示替换后的命令）；模板内置前台运行、后台常驻、停止、Docker Compose、systemd、排查片段，依赖目录变量时会按环境配置置灰；
- 预上传配置位于操作编辑器的独立分区，仅对配置了上传项的操作生效，未配置时执行流程与普通操作一致。

#### 6.3.2 内置模板

新建环境时可选模板，仅作预填，不锁定：

**Docker Compose**

| 操作 | 命令 |
| --- | --- |
| 更新 | `cd "${workDir}" && docker compose pull && docker compose up -d --remove-orphans` |
| 启动 | `cd "${workDir}" && docker compose up -d` |
| 关闭 | `cd "${workDir}" && docker compose down` |
| 状态 | `cd "${workDir}" && docker compose ps` |

**systemd 服务**

| 操作 | 命令 |
| --- | --- |
| 更新 | `cd "${workDir}" && ./deploy.sh` |
| 启动 | `systemctl restart my-service` |
| 关闭 | `systemctl stop my-service` |

> `systemctl` 通常需要 root 权限。一期不处理 sudo 密码交互，推荐目标机为运维账号配置 `NOPASSWD`，或直接使用具备权限的账号（不推荐 root）。详见 §6.3.2。

**脚本/二进制**

| 操作 | 命令 |
| --- | --- |
| 启动 | `cd "${workDir}" || exit 1; nohup ./start.sh > "${logDir}/app.log" 2>&1 < /dev/null & echo $!` |
| 关闭 | `cd "${workDir}" && ./stop.sh` |

**本地构建产物 + 预上传**

| 操作 | 命令 | 预上传 |
| --- | --- | --- |
| 更新 | `cd "${workDir}" && ./restart.sh` | `dist/app.jar` → `${workDir}/lib`（覆盖前备份） |
| 更新（前端） | `cd "${workDir}" && ./reload.sh` | `dist` → `${workDir}/static`（内容合并，覆盖前备份） |

> 上传项的目标目录支持与环境相同的 `${key}` 变量；目录上传将内容合并到目标目录，例如 `dist` 上传到 `${workDir}/static` 后，文件位于 `${workDir}/static/` 下。

#### 6.3.3 命令执行约定

- 统一以 `bash -lc <script>` 执行：加载登录 shell 环境，保证 `docker`、`node`、`java` 等 PATH 与人工登录一致（Ubuntu 与麒麟均适用）；
- 工作目录不自动切换，由命令模板中的 `cd "${workDir}"` 显式处理，避免隐式行为；
- 支持多行脚本；脚本整体做 POSIX 单引号转义后作为参数传递，不经过本地 shell；
- 不注入 `set -e`：由用户命令自行决定容错；退出码以远端 shell 的退出码为准；
- 前端在保存时对「变量未加引号」给出警告（路径含空格时会失败），不做强制。

### 6.4 执行引擎

#### 6.4.1 状态机

```
queued → connecting → validating → uploading → running → success
   │          │            │            │          ├──→ failed（退出码 ≠ 0）
   │          │            │            │          ├──→ timeout（命令超时）
   │          │            │            │          ├──→ canceled（用户取消）
   │          │            │            │          └──→ disconnected（连接中断）
   │          │            │            ├──→ failed（上传失败）
   │          │            │            ├──→ timeout（上传空闲超时）
   │          │            │            ├──→ canceled（上传中取消）
   │          │            │            └──→ disconnected（上传中断网）
   │          │            └──→ failed（目录校验失败）
   │          └──→ failed（DNS/拒绝/超时/认证/主机密钥）
   └──→ canceled（排队中被取消）
```

> 未配置预上传项时，`uploading` 状态自动跳过，不产生额外耗时。

- 终态：`success / failed / timeout / canceled / disconnected`；
- 每次状态变更都会产生一条 IPC 事件并更新 Run 记录。

#### 6.4.2 执行流程

1. **前置校验**：环境存在、操作存在、无同环境正在执行的任务、凭据可解密；校验预上传项的本地路径存在且可读；
2. **变量解析**：替换 `${key}`（命令与上传目标目录），任一未定义 → 失败并提示；
3. **建立连接**：`ssh2.Client`，密码认证；若 host key 未记录或变化，走确认流程（§9.2）；
4. **目录校验**（可配置）：对必填与非空目录执行 `test -d` / `test -w`；
5. **预上传**（如有）：按配置顺序上传文件/目录，实时推送进度，全部成功后继续；任一失败则中止（§6.4.6）；
6. **执行命令**：
   ```bash
   bash -lc '<script>'
   ```
   实际脚本前置一行 PID 标记（用于取消）：
   ```bash
   printf '\036CORRAL_PID:%s\036\n' "$$" >&2; <用户脚本>
   ```
   主进程解析并剥离该标记，记录远端 shell PID；
7. **流式回传**：stdout/stderr 分别接收，按 50–100ms 或 64KB 聚合后推送给渲染进程，同时以 JSONL 追加写入日志文件；
8. **收尾**：记录退出码、耗时、日志大小、上传统计；关闭连接；更新环境「最近执行」摘要。

#### 6.4.3 取消与超时

- 取消：通过**独立 SSH 连接**执行 `pkill -TERM -P <pid>; kill -TERM <pid>`，随后关闭原 channel；若处于上传阶段，则中止 SFTP 传输并清理远端临时文件；
- 超时：命令阶段的计时到达后执行同样的终止逻辑，状态记为 `timeout`；上传阶段使用独立的**空闲超时**（60s 无进度），避免大文件上传被命令超时误杀；
- 语义说明：这是**尽力而为**的终止，用户脚本若自行 `nohup`/`setsid`/`docker` 启动的后台进程不会被连带杀死（符合预期，服务本就应常驻）；
- UI 在取消后提示「已发送终止信号，若命令仍在运行可在服务器上手动检查」；
- 退出码约定：130 表示被 SIGINT 中断，137 表示 SIGKILL，界面在日志末尾给出解释。

#### 6.4.4 并发约束

- 同一环境同一时刻只允许一个执行（含上传阶段），重复点击直接置灰；
- 不同环境可并行，一期界面只支持单环境操作，主进程并发上限设为 4，为后续批量预留；
- 同一服务器的多个环境各自建连，不共享连接，避免长连接状态污染。

#### 6.4.5 连接策略

- 每次执行新建 SSH 连接，结束后关闭；
- 状态检测使用短连接（超时 8s）；
- `keepaliveInterval = 15s`，`keepaliveCountMax = 3`，用于探测断网；
- 一期不做连接池；如后续批量执行有性能诉求，再按 `serverId + 凭据版本` 引入空闲 60s 的连接复用。

#### 6.4.6 预上传阶段

只有配置了上传项的操作才进入该阶段，用于「本地构建产物 → 服务器目录 → 执行更新脚本」的流程。

**数据结构**

```ts
interface UploadItem {
  id: string;
  kind: 'file' | 'dir';
  localPath: string;      // 本地绝对路径，来自系统文件对话框
  targetDir: string;      // 远程绝对路径，支持 ${key} 变量
  conflict: 'backup' | 'overwrite';
}
```

- `kind` 在添加时由对话框类型决定，并用 `fs.stat` 校验；保存时允许文件暂不存在（可能稍后构建产出，仅提示），执行前必须存在；
- `targetDir` 必须解析为绝对路径；禁止 `/`；变量未定义或解析后非绝对路径 → 阻止执行；新增上传项时默认预填 `${workDir}`；
- 文件目标路径 = `targetDir/basename(localPath)`；目录上传将**目录内容**递归合并到 `targetDir`，不创建同名子目录；
- 同一操作内解析后的目标路径不得重复，保存与执行前均校验。

**上传流程**

1. 本地预检：逐个 `stat`，统计文件数/总字节；符号链接跳过并记录警告；空目录也计入；
2. 远程准备：SFTP 递归创建 `targetDir`，校验可写；
3. 逐项串行上传：
   - 文件：先写入 `targetDir/.corral-tmp-<runId>-<name>`；
   - 目录：先建立目录结构，再逐文件写入临时名；
4. 替换：临时文件完整写入并关闭后，`stat` 校验远端字节数与本地一致，再按冲突策略替换目标（见下）；
5. 失败：立即中止，清理本项临时文件，标记 `failed`，不执行命令；已完成的项不回滚（日志中列出）。

**覆盖与备份**

| 策略 | 行为 |
| --- | --- |
| `backup`（默认） | 目标存在时 `mv <target> <target>.bak-<yyyyMMdd-HHmmss>`，再 `mv <tmp> <target>`；同一秒重名追加 `-1`、`-2` |
| `overwrite` | 直接 `mv -f <tmp> <target>`，不保留旧文件 |

- 目录上传按**文件级合并**：只覆盖同名文件，目标目录中多余的文件保留；
- 备份路径写入系统日志，便于人工回滚；应用不自动清理备份；
- 备份与替换通过远端 `bash` 执行 `mv`，路径逐项单引号转义；SFTP 只负责传输。

**进度、取消与超时**

- 进度按字节聚合：`transferredBytes / totalBytes`，同时展示当前文件与序号；
- 100ms 节流推送 `run:progress`，每完成一项写一行 `[corral]` 系统日志；
- 上传串行，避免多文件争抢带宽；
- 60s 无字节进度视为空闲超时，终止上传并标记 `timeout`；
- 用户取消：关闭 SFTP 会话并尽力删除临时文件；已替换的文件保持现状，日志中说明；
- 不支持断点续传；失败后重新执行会整文件重传。

**安全与约束**

- 本地路径由系统文件对话框选择（也可手填），主进程 `fs.stat` 校验，渲染进程不直接读文件；
- 本地路径保留 Windows 格式（如 `D:/build/dist`），仅传给 SFTP，不拼入远端脚本；远端路径统一使用 `/`；
- 远端相对路径逐级拼接时过滤 `..`，禁止逃逸 `targetDir`；不跟随符号链接，避免循环；
- 文件以 `0644`、目录以 `0755` 写入；需要执行权限时在命令中 `chmod +x`；
- 不做校验和比对（SSH 传输本身提供完整性校验）；
- 不把本地文件复制进应用数据目录，配置中只保存本地路径。

### 6.5 实时日志面板

- 使用 `<pre>` 渲染，等宽字体（13px）；背景与文字颜色通过 `LogPanel` 组件级 token 定义，亮/暗主题分别取值，不硬编码黑底白字；
- ANSI 转义序列通过 `anser` 解析为颜色 span；所有文本先转义，避免 XSS；
- stdout 使用 `colorText`，stderr 使用 `colorError`，应用产生的系统日志（`[corral]`，如上传/备份说明）使用 `colorTextSecondary` 并加前缀；
- 自动滚动到底部；用户向上滚动时暂停自动滚动，右下角出现「回到底部」按钮与「N 条新输出」提示；
- 顶部工具条：状态 Badge、操作名、耗时、退出码、「停止」、「清屏」、「复制全部」、「导出」；
- 上传阶段在日志区上方展示 `Progress`（总字节进度 + 当前文件名 + 序号），上传完成后收起为一行摘要；
- 渲染端保留最近 2MB 文本（环形裁剪），完整日志以文件为准；
- 大日志场景：超过 2MB 后只渲染尾部，历史查看时按偏移分页读取文件。

### 6.6 连通性与信息检测

- 触发：服务器行「测试连接」、详情页「检测」、进入环境详情时的懒检测（缓存 60s）；
- 检测脚本（一次 exec）：
  ```bash
  . /etc/os-release 2>/dev/null
  echo "OS=$PRETTY_NAME"
  echo "ID=$ID"
  echo "VER=$VERSION_ID"
  echo "KERNEL=$(uname -r)"
  echo "UPTIME=$(uptime -p 2>/dev/null || uptime)"
  echo "USER=$(whoami)"
  ```
- 展示：发行版名称与版本（Ubuntu / 银河麒麟识别自 `ID`、`/etc/kylin-release`）、内核、运行时长、登录用户、连接耗时；
- 检测失败按错误类型给出可操作提示（见 §11.1）；
- 检测结果不持久化为「在线」，仅在本次会话内缓存，避免误导。

### 6.7 执行历史

- 列表列：开始时间、服务器、环境、操作、状态、耗时、退出码；配置了预上传的记录额外展示上传摘要（文件数/大小）；
- 筛选：环境、服务器、状态、时间范围；搜索操作名；
- 详情抽屉：元信息（含上传文件数、总大小、耗时与备份记录）+ 日志（从 JSONL 文件读取，按 256KB 分页）；
- 操作：查看、导出（`.log` 纯文本）、删除、清空（二次确认）；
- 保留策略：默认保留最近 200 条且不超过 30 天，取交集；可在设置中调整；启动时清理；
- 历史记录保存名称快照，环境/服务器删除后仍可查看。

### 6.8 设置

| 设置项 | 默认值 | 说明 |
| --- | --- | --- |
| 主题 | 跟随系统 | 亮色 / 暗色 / 跟随系统 |
| 默认命令超时 | 300s | 新操作的默认值 |
| 执行前校验目录 | 开启 | 关闭后直接执行 |
| 上传冲突默认策略 | 备份 | 新增上传项时的默认值：备份 / 直接覆盖 |
| 上传空闲超时 | 60s | 超过该时间无字节进度则终止上传 |
| 日志保留条数 | 200 | |
| 日志保留天数 | 30 | |
| 输出编码 | UTF-8 | 可选 GBK（麒麟/老系统兼容） |
| 兼容旧 SSH 算法 | 关闭 | 开启后放宽 KEX/主机密钥算法（仅在连接失败且确认服务端过旧时使用） |
| 数据目录 | 只读展示 | 提供「打开目录」按钮 |
| 导出配置 | — | 导出 JSON（**不含密码**），用于备份/迁移 |

“导出配置”属于低成本高价值能力，一期提供；导入放到二期。

---

## 7. 界面设计

### 7.1 信息架构

```
Corral
├── 服务器          # 列表 + 新增/编辑抽屉 + 检测
├── 开发环境        # 左树右详情，执行工作台
├── 执行历史        # 列表 + 日志抽屉
└── 设置
```

- 单窗口，左侧导航 200px（4px 网格），右侧内容区自适应；导航使用 `Layout.Sider` + `Menu`，选中项采用 antd 默认的 `colorPrimaryBg` 背景与 `colorPrimary` 文本，不自定义导航配色；
- 页面内使用「标题 + 主操作」的页头行，不引入自定义全局工具栏；内容区背景使用 `colorBgLayout`，内容承载使用 `Card` / `Table` 的 `colorBgContainer`；
- 中文界面；`ConfigProvider` 设置 `zh_CN`、`theme.algorithm`（亮/暗）、默认圆角（控件 6px / 容器 8px / 标签 4px）与默认控件尺寸（32px），不启用全局 `compactAlgorithm`；`App` 组件包裹全局内容以提供 message/notification/modal 上下文；
- 主色使用默认 `colorPrimary`（#1677FF），不另设品牌色；危险操作用 `colorError`；每个页面/卡片只保留一个 primary 按钮，其余为 default；
- 语义色只用于状态（success / warning / error / info），预设色板只用于标签与分类，不用于主操作。

### 7.2 线框图

**服务器列表**

```
┌────────────┬──────────────────────────────────────────────────────────────┐
│ Corral     │ 服务器                                    [ + 新增服务器 ]     │
│            │ ┌──────────────────────────┐  [标签▾] [状态▾]                │
│ ▸ 服务器    │ │ 🔍 搜索名称/IP/描述        │                              │
│   开发环境  │ └──────────────────────────┘                              │
│   执行历史  │ ┌──────────────────────────────────────────────────────────┐ │
│   设置      │ │ 名称        地址           账号   状态    最近连接   操作 │ │
│            │ │ 订单测试机  10.0.0.12:22   root   ● 在线  10-29 14:2  ⋯  │ │
│            │ │ 麒麟验证机  10.0.0.31:22   dev    ○ 未检测    —      ⋯  │ │
│            │ └──────────────────────────────────────────────────────────┘ │
└────────────┴──────────────────────────────────────────────────────────────┘
```

> 「新增服务器」为该页唯一 primary 按钮；行内操作使用 default 按钮或 Dropdown，不与主操作争夺视觉权重。线框中的 ● / ○ 表示 `Badge status` 状态点；✓ / ⚠ 表示目录校验结果的语义图标（success / warning），均配合文本说明。

**环境工作台**

```
┌────────────┬──────────────┬───────────────────────────────────────────────┐
│ Corral     │ 环境          │ 订单服务-dev        ● 在线  [检测] [编辑]      │
│            │ 🔍 搜索       │ 服务器：订单测试机 10.0.0.12 · Ubuntu 22.04    │
│ ▸ 服务器    │              ├───────────────────────────────────────────────┤
│   开发环境  │ ▾ 订单测试机  │ 目录配置                          [校验]      │
│   执行历史  │   • 订单服务  │  工作目录  /opt/app/order   ✓ 存在且可写      │
│   设置      │   • 网关服务  │  日志目录  /var/log/order   ⚠ 只读           │
│            │ ▸ 麒麟验证机  ├───────────────────────────────────────────────┤
│            │              │ [更新] [启动] [关闭] [状态] [自定义 ▾]         │
│            │              ├───────────────────────────────────────────────┤
│            │              │ ● 上传中 · 更新 · 32%        [停止] [复制] [导出]│
│            │              │ dist/app.jar  24.6 / 48.2 MB   [====------]  │
│            │              │ ┌───────────────────────────────────────────┐ │
│            │              │ │ [corral] 上传 dist/app.jar → /opt/app/lib  │ │
│            │              │ │ [corral] 备份 app.jar → app.jar.bak-...    │ │
│            │              │ │ [INFO] Pulling order-service ...          │ │
│            │              │ └───────────────────────────────────────────┘ │
└────────────┴──────────────┴───────────────────────────────────────────────┘
```

**执行确认弹窗（含预上传）**

```
┌────────────────────────────────────────────────────┐
│ ⚠ 确认更新「订单服务-dev」？                        │
│                                                    │
│ 将上传 2 项（共 48.2 MB）：                         │
│   dist/app.jar → /opt/app/order/lib                │
│   dist/conf    → /opt/app/order/conf               │
│ 覆盖前自动备份同名文件。                             │
│                                                    │
│ 然后执行：                                          │
│   cd "/opt/app/order" && ./restart.sh               │
│                                                    │
│                             [取消]  [确认更新]      │
└────────────────────────────────────────────────────┘
```

**操作编辑（预上传配置）**

```
┌ 编辑操作：更新 ───────────────────────────────────┐
│ 名称 [更新          ]  超时 [300] 秒  [✓] 二次确认  │
│ 命令                                              │
│ ┌───────────────────────────────────────────────┐ │
│ │ cd "${workDir}" && ./restart.sh               │ │
│ └───────────────────────────────────────────────┘ │
│ 预上传（可选）                   [+ 添加文件] [+ 添加目录]
│ ┌───────────────────────────────────────────────┐ │
│ │ 📄 D:/build/dist/app.jar → ${workDir}/lib      │ │
│ │    冲突 [备份 ▾]                        [删除] │ │
│ │ 📁 D:/build/dist/conf    → ${workDir}/conf     │ │
│ │    冲突 [备份 ▾]                        [删除] │ │
│ └───────────────────────────────────────────────┘ │
│                                [取消]  [保存]      │
└────────────────────────────────────────────────────┘
```

### 7.3 交互细节

- **危险操作**：`确认` 按钮使用 `color="danger"`（或 `danger` 别名）；连续点击「关闭」不排队，按钮在执行中禁用；同一屏只保留一个 primary 操作（环境详情默认「更新」为 primary，「关闭」为 danger，其余 default）；
- **状态展示**：连接/运行状态一律使用 `Badge status`（success / processing / default / error）+ 文本，不用 `Tag` 表达关键状态；映射：queued/canceled → default，connecting/validating/uploading/running → processing，success → success，failed/timeout/disconnected → error；服务器在线 → success、检测中 → processing、未检测 → default、离线 → error；`Tag` 仅用于服务器标签、操作类型等分类信息，颜色取预设色板；
- **表格**：使用默认 `Table` 样式（表头 `surface-container` + 14/600），行 hover 高亮，不加斑马纹；操作列用 `Dropdown` + `MoreOutlined`，不用密集文字按钮；
- **表单与间距**：抽屉内表单单列；控件高度 32px，label 与控件间距 8px，分组间距 24px；所有 margin/padding/gap 取 4px 网格（4/8/16/24/32）；字号使用 14px 基准，页面标题 16/600，区块标题 14/600，辅助文字 12/400；
- **颜色与 token**：禁止硬编码颜色、圆角、字号；统一使用 antd token 或组件级 token，自定义组件通过 `theme.useToken()` 读取；暗色主题通过 `darkAlgorithm` 生成，不手工反色；
- **动效**：沿用 antd motion token（0.1s 状态变化 / 0.2s 组件过渡 / 0.3s Drawer、Modal），不自定义 cubic-bezier；
- **图标**：统一使用 `@ant-design/icons` v6，默认 16px，图标按钮配 `Tooltip`；
- **密码框**：`Input.Password`，默认不可见，支持显隐；编辑时留空不覆盖；
- **文件选择**：通过主进程 `dialog.showOpenDialog` 打开系统对话框，文件与目录分别入口；选择后仅保存绝对路径，不上传文件内容到渲染进程；
- **上传项校验**：本地路径不存在时以表单 `error` 状态提示并在执行前阻止；目标目录变量未定义或非绝对路径时同样阻止；同一操作内目标路径重复时提示；
- **上传进度**：日志区上方展示总进度、当前文件与序号；上传阶段可取消，取消后保留已完成的文件并清理临时文件；
- **保存反馈**：通过 `App.useApp()` 获取 `message` / `notification`；长任务与错误使用 `notification`；
- **加载态**：表格 `loading`、按钮 `loading`，避免重复提交；
- **空状态**：`Empty` + 主行动按钮，文案说明下一步；
- **删除**：使用 `App.useApp().modal.confirm`，不可用 `Popconfirm` 承载级联删除说明；
- **错误展示**：表单内联错误 + 顶部 `Alert`（网络类错误附「排查建议」折叠区）；
- **键盘**：`Ctrl/Cmd + K` 聚焦左侧搜索（一期可选）。

### 7.4 设计语言核对（Ant Design v6）

核对依据：通过 `antd design.md` 获取的 Ant Design v6 设计语言（CLI 6.6.8，默认亮色主题 `defaultAlgorithm`）。逐项核对结论如下：

| 检查项 | Ant Design 规范 | 本项目落实 | 结论 |
| --- | --- | --- | --- |
| 色彩 | 主色 `#1677FF`；success / warning / error / info 表达状态；预设色板仅用于标签与分类 | 使用默认 `colorPrimary`；危险操作 `colorError`；标签使用预设色；不新增品牌色 | 符合 |
| 字体 | 基准 14px，仅使用 400 / 600 字重；表格头 14/600；代码 13px | 沿用 antd 字体与字重；日志面板使用 13px 等宽字体；标题使用 600，不出现 700+ 或斜体 | 符合 |
| 间距 | 4px 网格（4/8/16/24/32）；控件高度 32px；卡片内边距 24px | 导航 200px、抽屉 520px、表单单列间距 8/24px 均落在网格上 | 符合 |
| 圆角 | 控件 6px、容器 8px、标签与浮层 4px；胶囊形仅用于头像/徽标 | 使用默认圆角，不做全局覆盖；不使用胶囊按钮 | 符合 |
| 层级 | 三层表面：layout / container / elevated；扁平优先，阴影仅用于浮层 | 页面使用 `colorBgLayout`，内容使用 Card；仅 Drawer / Modal / Dropdown 使用阴影 | 符合 |
| 按钮 | 同一表面只保留一个 primary；危险操作使用 error 语义 | 环境详情以「更新」为 primary，「关闭」为 danger，其余 default；列表页「新增」为唯一 primary | 已落实 |
| 导航 | Menu 选中项使用 `colorPrimaryBg` + `colorPrimary` 文本 | 直接使用 Menu 默认选中态，不自定义导航配色 | 符合 |
| 表格 | 表头使用 `surface-container` + title-md；行 hover 高亮，不使用斑马纹 | 使用默认 Table，不开启 striped；操作列用 Dropdown | 符合 |
| 状态 | 使用 Badge 状态点 + 文本；Tag 不承担关键状态 | 服务器状态、运行状态均使用 Badge + 文本；Tag 仅用于分类 | 符合 |
| 反馈 | message 用于轻提示，notification 用于长任务/错误，Alert 用于内联说明，Empty 用于空态 | 通过 `App.useApp()` 获取实例；错误使用 Alert；列表空态使用 Empty | 符合 |
| 动效 | 使用 motion token：0.1s / 0.2s / 0.3s，不自定义曲线 | 组件过渡使用 antd 默认动效，不覆盖 easing | 符合 |
| 暗色 | 使用 `darkAlgorithm` 派生，不手工反色 | 跟随系统切换 `theme.algorithm` | 符合 |

**核对后的修正**：

- 原「圆角与紧凑度」表述改为**默认圆角 + 默认控件尺寸**，不启用全局 `compactAlgorithm`，避免偏离设计语言；
- 明确「同一页面/卡片只保留一个 primary 按钮」，环境详情的「更新」为 primary、「关闭」为 danger；
- 补充 4px 网格、字体层级、Badge 状态、表格无斑马纹、动效 token 等实现约束；
- 日志面板由「深色底」改为**组件级 token** 定义，亮/暗主题分别取值，不硬编码颜色。

---

## 8. 数据模型

### 8.1 TypeScript 定义（`src/shared/types.ts`）

```ts
export interface Server {
  id: string;              // nanoid
  name: string;
  host: string;
  port: number;
  username: string;
  description?: string;
  tags: string[];
  createdAt: string;       // ISO 8601
  updatedAt: string;
  lastConnectedAt?: string;
}

export interface PathEntry {
  key: string;             // 变量名
  label: string;           // 展示名
  path: string;            // 远程绝对路径
  required?: boolean;      // 目前仅 workDir 为 true
}

export interface UploadItem {
  id: string;
  kind: 'file' | 'dir';
  localPath: string;       // 本地绝对路径
  targetDir: string;       // 远程绝对路径，支持 ${key}；目录上传时合并内容到此
  conflict: 'backup' | 'overwrite';
}

export interface EnvAction {
  id: string;
  name: string;
  command: string;
  timeoutSec: number;      // 0 = 不限
  confirm: boolean;
  danger?: boolean;
  uploads: UploadItem[];   // 执行前预上传，可为空
}

export interface DevEnv {
  id: string;
  serverId: string;
  name: string;
  description?: string;
  paths: PathEntry[];
  actions: EnvAction[];
  createdAt: string;
  updatedAt: string;
}

export type RunStatus =
  | 'queued' | 'connecting' | 'validating' | 'uploading' | 'running'
  | 'success' | 'failed' | 'timeout' | 'canceled' | 'disconnected';

export type RunErrorKind =
  | 'dns' | 'connect-timeout' | 'refused' | 'auth'
  | 'hostkey' | 'network' | 'remote' | 'config' | 'upload' | 'unknown';

export interface UploadStats {
  itemCount: number;
  fileCount: number;
  totalBytes: number;
  transferredBytes: number;
  durationMs?: number;
  backups: string[];       // 备份后的远端路径，最多保留 200 条用于展示
}

export interface RunPrecheck {
  resolvedCommand: string;
  items: {
    localPath: string;
    kind: 'file' | 'dir';
    targetPath: string;
    exists: boolean;
    bytes: number;
  }[];
  totalBytes: number;
  missing: string[];       // 本地不存在的路径
}

export interface Run {
  id: string;
  envId: string;
  envName: string;         // 快照
  serverId: string;
  serverName: string;      // 快照
  actionId: string;
  actionName: string;      // 快照
  command: string;         // 原始命令
  resolvedCommand: string; // 变量替换后
  status: RunStatus;
  exitCode?: number;
  errorKind?: RunErrorKind;
  errorMessage?: string;
  startedAt: string;
  endedAt?: string;
  durationMs?: number;
  logBytes?: number;
  remotePid?: number;
  uploadStats?: UploadStats;
}
```

### 8.2 持久化结构（`app.getPath('userData')`）

```
%APPDATA%/Corral/
├── store.json          # servers / envs / runs 元数据 / settings / schemaVersion
├── secrets.json        # { [serverId]: base64(safeStorage 加密后的 payload) }
├── known-hosts.json    # host key 指纹
├── settings.json       # 可选，与 store 合并亦可（见下）
└── logs/
    ├── <runId>.jsonl
    └── ...
```

**取舍**：将 `settings` 放进 `store.json` 可减少文件数量与一致性问题；`secrets` 与 `known-hosts` 独立，便于单独备份/清除。

```ts
interface StoreFile {
  schemaVersion: 1;
  servers: Server[];
  envs: DevEnv[];
  runs: Run[];              // 仅元数据，最多保留条数由设置控制
  settings: Settings;
}
```

**写入策略**：

- 预上传配置仅保存本地绝对路径，**不复制本地文件到数据目录**；本地文件更新后下次执行重新上传；
- 主进程统一写，渲染进程不直接操作文件；
- 原子写：写 `*.tmp` → `fs.rename` 覆盖；
- 连续写入做 300ms 防抖合并；
- 读取失败（JSON 损坏）时重命名为 `store.corrupt-<timestamp>.json`，以空数据启动并通过 `notification` 告知，避免静默丢数据；
- 迁移：`schemaVersion` 逐级迁移，迁移前自动备份；为旧环境数据补 `uploads: []`，旧操作数据补 `timeoutSec: 300`、`confirm: true`。

---

## 9. 安全设计

### 9.1 凭据存储

- 使用 `safeStorage.isEncryptionAvailable()` 检测；Windows 下底层为 DPAPI，绑定当前 Windows 用户；
- 加密内容为 `JSON.stringify({ password })`，以 Base64 存入 `secrets.json`；
- **解密失败**（换机、重装、用户变化）时：把该服务器标记为「凭据不可用」，执行时提示重新输入密码，不自动清空其他数据；
- 渲染进程永远拿不到密码：
  - 列表/详情接口返回 `hasPassword: boolean`；
  - 只有「测试连接」允许在主进程内使用表单临时密码；
- 日志与 IPC 不打印凭据；错误对象在上抛前做字段裁剪；
- `devtools` 仅在开发构建启用；生产禁用右键菜单与 `Ctrl+Shift+I`。

### 9.2 主机密钥校验（TOFU）

- 首次连接：读取服务器公钥，计算 `SHA256` 指纹，通过 IPC 让渲染进程弹窗展示「主机 / 端口 / 算法 / 指纹」，用户确认后写入 `known-hosts.json`；
- 后续连接：指纹不一致时**阻止连接**，展示 `type="error"` 的 Alert 与旧/新指纹对比，要求用户到「服务器详情」手动「信任新指纹」（需二次确认）；
- `known-hosts.json` 记录：`{ host, port, keyType, fingerprint, firstSeenAt, lastSeenAt }`；
- 删除服务器时同步删除对应记录；
- 实现注意：`ssh2` 的 `hostVerifier` 需使用异步回调形式，握手期间挂起等待用户决策，超时 30s 视为拒绝。

### 9.3 应用加固

- `BrowserWindow`：`contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`；
- 预加载脚本只暴露白名单方法，所有入参在主进程用 Zod 校验；
- 禁止 `webSecurity: false`、禁止加载远程 URL；`index.html` 设置 CSP：
  `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:;`
- 外部链接一律 `shell.openExternal`，并做协议白名单（`https/http`）；
- 渲染进程不渲染任何远端 HTML，日志通过 `anser` 转义后输出。

### 9.4 命令注入的边界

本工具的命令由**本机使用者**编写，属于受信输入，不构成传统意义上的注入面。但仍采取以下措施：

- 路径变量替换后，命令整体作为单个参数传给远端 `bash -lc`，本地不经过 shell 解析；
- 远端命令统一用 POSIX 单引号转义：`'\''`；
- 目录校验脚本中的路径逐项单引号包裹；
- 保存时对未加引号的路径变量给出警告，避免空格路径执行失败。

---

### 9.5 上传路径与本地文件

- 渲染进程不具备文件系统访问能力：文件/目录选择统一由主进程 `dialog.showOpenDialog` 完成，渲染进程只拿到绝对路径字符串；
- 本地路径校验：必须是绝对路径、存在、可读；目录递归时**不跟随符号链接**（跳过并记录警告），单次上传对象上限 20000 个文件，超出提示分批；
- 远端目标：`targetDir` 解析后必须是绝对路径且不为 `/`；拼接相对路径时逐段过滤 `.`、`..`，确保不逃逸目标目录；远端目标或其子目录为符号链接时中止上传，避免写入意外位置；
- SFTP 操作使用路径参数，不经过 shell；备份/替换的 `mv` 命令由主进程生成，路径逐项单引号转义；
- 临时文件名包含 `runId`，上传失败或取消时尽力删除；替换成功后才清理临时文件；
- 上传日志只记录路径、大小、耗时与备份路径，不记录文件内容；应用不缓存、不复制本地文件。

## 10. IPC 契约

所有通道在主进程用 Zod 校验入参，返回 `{ ok: true, data }` 或 `{ ok: false, error: { code, message } }`。

| 通道 | 入参 | 返回 | 说明 |
| --- | --- | --- | --- |
| `server:list` | — | `Server[]` | 不含密码 |
| `server:create` | `ServerInput` | `Server` | 密码单独加密存储 |
| `server:update` | `id, ServerInput` | `Server` | 密码为空则保留 |
| `server:remove` | `id` | `void` | 级联删除环境与凭据 |
| `server:test` | `id` 或临时 `ServerInput` | `TestResult` | 含耗时、发行版信息 |
| `env:list` | `{ serverId? }` | `DevEnv[]` | |
| `env:create` / `env:update` / `env:remove` | — | `DevEnv` / `void` | |
| `env:validatePaths` | `envId` | `PathCheck[]` | 需要连接 |
| `run:precheck` | `{ envId, actionId }` | `RunPrecheck` | 展开上传目标、统计大小、检查本地文件、返回预览命令 |
| `run:start` | `{ envId, actionId }` | `{ runId }` | 立即返回，后续走事件 |
| `run:cancel` | `runId` | `void` | 尽力终止（含上传阶段） |
| `run:list` | `RunFilter` | `Run[]` | 分页 |
| `run:readLog` | `{ runId, offset, limit }` | `LogChunk` | 历史回看 |
| `run:exportLog` | `runId` | `{ filePath }` | 弹出保存对话框 |
| `run:remove` / `run:clear` | `id` / `filter?` | `void` | 同时删除日志文件 |
| `settings:get` / `settings:update` | — | `Settings` | |
| `hostkey:decision` | `{ challengeId, accept }` | `void` | 渲染进程回应指纹确认 |
| `dialog:pickFiles` | `{ multiple?: boolean }` | `string[]` | 系统文件选择，返回绝对路径 |
| `dialog:pickDirectory` | — | `string \| null` | 系统目录选择 |
| `app:openDataDir` | — | `void` | |

**事件（主 → 渲染）**

| 事件 | 载荷 |
| --- | --- |
| `run:status` | `{ runId, status, errorKind?, errorMessage?, exitCode?, durationMs? }` |
| `run:output` | `{ runId, stream: 'stdout' \| 'stderr' \| 'system', data: string }` |
| `run:progress` | `{ runId, phase: 'upload', fileIndex, fileCount, fileName, transferredBytes, totalBytes }` |
| `hostkey:challenge` | `{ challengeId, host, port, keyType, fingerprint, isMismatch, oldFingerprint? }` |
| `run:done` | `Run` |
| `app:notice` | `{ level, message }` |

**事件订阅**：preload 暴露 `onRunStatus`、`onRunOutput`、`onRunProgress`、`onHostKeyChallenge` 等订阅方法，均返回取消订阅函数，组件卸载时调用，防止监听泄漏。

---

## 11. SSH 实现细节

### 11.1 错误分类与文案

| 底层错误 | 分类 | 用户文案 | 建议 |
| --- | --- | --- | --- |
| `ENOTFOUND` | `dns` | 无法解析主机名 | 检查拼写或改用 IP |
| `ETIMEDOUT` | `connect-timeout` | 连接超时 | 检查 IP、端口、防火墙、VPN |
| `ECONNREFUSED` | `refused` | 端口拒绝连接 | 确认 sshd 已启动、端口正确 |
| 认证失败（`All configured authentication methods failed`） | `auth` | 账号或密码错误 | 重新输入密码；确认账号未被锁定 |
| host key 不匹配 | `hostkey` | 主机密钥与记录不一致 | 可能重装或存在中间人风险，谨慎信任 |
| `ECONNRESET` / 通道关闭 | `network` | 连接中断 | 检查网络；命令可能仍在远端运行 |
| 退出码 ≠ 0 | `remote` | 命令执行失败（退出码 N） | 查看 stderr |
| 本地文件不存在 / 不可读 | `upload` | 本地文件不可用：`<path>` | 重新构建或重新选择文件 |
| 远端权限不足 / 磁盘已满 | `upload` | 上传失败：`<remote path>` 写入失败 | 检查目录权限与 `df -h` |
| SFTP 子系统不可用 | `upload` | 服务器未启用 SFTP | 检查 sshd 的 `Subsystem sftp` 配置 |
| 目标已存在且类型冲突（文件/目录） | `upload` | 目标类型冲突：`<path>` | 调整目标目录或手动处理后重试 |

> 认证失败**不自动重试**，避免触发服务器账号锁定策略。

### 11.2 兼容性

- 银河麒麟 V10 通常自带 OpenSSH 8.x，默认算法可用；
- 若目标机仅支持旧算法（如 `ssh-rsa` + SHA-1），连接会失败；在设置中开启「兼容旧 SSH 算法」后放宽 `algorithms` 配置，并在连接时给出提示；
- 国密算法（SM2/SM3/SM4）SSH 不在支持范围，需在服务端同时开启标准算法；
- 输出编码默认 UTF-8；如遇乱码可在设置切换 GBK（使用 `iconv-lite` 在主进程解码，流式时用 `StringDecoder` 处理跨块多字节字符）；
- `bash -lc` 会加载 `/etc/profile`，个别机器上 profile 有交互输出，首次执行时属正常现象。

### 11.3 命令执行与取消实现要点

```ts
// 伪代码
const script = buildScript(action.command, vars) // 变量替换
const payload = `printf '\\036CORRAL_PID:%s\\036\\n' "$$" >&2; ${script}`
const quoted = shellQuote(payload)
const stream = await client.exec(`bash -lc ${quoted}`, { pty: false })
```

- `shellQuote`：`"'" + s.replace(/'/g, "'\\''") + "'"`；
- PID 标记从首个 stderr 块中解析并剥离，不展示给用户；
- 取消：新建连接执行终止命令，最多等待 5s，然后 `stream.close()`；
- 连接对象在 RunManager 中以 `runId` 索引，应用退出时统一 `client.end()`。

### 11.4 SFTP 上传实现要点

```ts
// 伪代码
const sftp = await client.sftp();
await mkdirp(sftp, targetDir);            // 逐级 mkdir，权限 0755
const total = await statLocalTree(item);  // 汇总文件数与字节数
await sftp.fastPut(localFile, tempPath, {
  mode: 0o644,
  concurrency: 8,                         // 单文件内部流水线
  step: (transferred, _chunk, size) => onProgress(transferred, size),
});
await exec(`mv ${q(target)} ${q(backup)} && mv ${q(temp)} ${q(target)}`);
```

- 目录递归使用 `fs.promises.opendir`，将目录内容逐文件 `fastPut` 到 `targetDir`（不创建同名子目录）；多文件**串行**，避免带宽争抢；
- 上传前用 `lstat` 判断类型，符号链接跳过并写入系统日志；
- 单文件内部使用 `fastPut` 的并发流水线，提升大文件吞吐；`step` 回调按字节上报，主进程节流后推送；
- 远端目录创建失败（权限/只读）直接终止，不继续尝试后续文件；
- 上传完成关闭 `sftp`，但复用同一个 SSH 连接执行后续命令（避免二次握手）；
- 取消时 `sftp.end()` 并关闭 channel；随后新建连接删除临时文件（尽力）。

---

## 12. 异常与边界

| 场景 | 处理 |
| --- | --- |
| 应用退出时仍有执行中任务 | 弹窗提示「N 个任务将中断（远端进程可能继续）」，确认后关闭连接并退出 |
| 连续快速点击同一操作 | 按钮 loading + 主进程幂等校验，第二次直接拒绝 |
| 命令超长（> 64KB） | 保存时限制 64KB，超出提示拆分脚本 |
| 日志暴涨（如 `docker compose pull`） | 服务端节流 + 渲染端环形缓冲；日志文件上限 50MB/次，超出后停止写入并提示 |
| 目录含空格/中文 | 模板与插入变量自动加引号；保存时警告未加引号的变量 |
| 本地文件在配置后被删除/移动 | 执行前预检失败，提示缺失路径，不建立连接 |
| 上传过程中本地文件被修改 | 读取长度与预统计不一致时终止该项，清理临时文件并标记失败 |
| 上传中途断网 | 标记 `disconnected`，清理临时文件；已替换的文件不回滚，日志中列出 |
| 上传大文件/大量文件 | 流式读取，不占同等内存；多文件串行、单文件流水线；进度可取消；空闲 60s 终止 |
| 备份文件持续累积 | 不自动删除；系统日志给出备份路径，设置页说明可手动清理 |
| 目标目录不存在 | 自动 `mkdir -p` 并记录日志；若权限不足则失败并提示 |
| 服务器重装导致 host key 变化 | 阻止连接，引导手动信任新指纹 |
| 密码在外部被修改 | 认证失败提示重新输入，可只更新密码 |
| 系统时间不正确 | 仅影响日志排序展示，不影响功能 |
| 数据文件损坏 | 备份为 `.corrupt` 文件后以空库启动并提示 |
| 多显示器/缩放 | 窗口尺寸与位置持久化，最小尺寸 1100×720 |

---

## 13. 非功能需求

| 维度 | 目标 |
| --- | --- |
| 启动时间 | 冷启动 < 2s（不含首次安装） |
| 数据规模 | 200 台服务器、500 个环境、200 条历史记录下操作流畅 |
| 日志延迟 | 远端输出到界面呈现 < 200ms；上传进度刷新 < 300ms |
| 上传能力 | 百 MB 级文件/目录上传不阻塞界面，进度可见、可取消；单文件流式读写 |
| 安装包 | NSIS 安装包 < 120MB |
| 稳定性 | 单次执行异常不影响应用主流程；SSH 错误均有可读文案 |
| 资源占用 | 空闲时内存 < 250MB；不后台轮询、不常驻连接 |
| 可维护性 | 主进程服务按职责拆分，IPC 契约与 Zod Schema 单一来源 |

---

## 14. 工程结构

```
corral/
├── electron.vite.config.ts
├── electron-builder.yml
├── package.json
├── tsconfig.json
├── src/
│   ├── main/
│   │   ├── index.ts              # 窗口、单实例、生命周期
│   │   ├── ipc/
│   │   │   ├── index.ts          # 注册所有 handler
│   │   │   ├── server.ts
│   │   │   ├── env.ts
│   │   │   ├── run.ts
│   │   │   ├── dialog.ts         # 文件/目录选择
│   │   │   └── settings.ts
│   │   ├── services/
│   │   │   ├── store.ts          # JSON 原子读写、迁移
│   │   │   ├── vault.ts          # safeStorage 加解密
│   │   │   ├── knownHosts.ts
│   │   │   ├── ssh.ts            # 连接、exec、hostVerifier
│   │   │   ├── upload.ts         # SFTP 上传、目录递归、备份替换、进度
│   │   │   ├── runner.ts         # 状态机、超时、取消、并发
│   │   │   ├── logStore.ts       # JSONL 写入/读取/清理
│   │   │   └── template.ts       # 变量解析、shell 转义
│   │   └── utils/
│   ├── preload/
│   │   └── index.ts              # contextBridge API + 事件订阅
│   ├── shared/
│   │   ├── types.ts
│   │   ├── schema.ts             # Zod
│   │   └── ipc.ts                # 通道常量与载荷类型
│   └── renderer/
│       ├── index.html
│       └── src/
│           ├── main.tsx
│           ├── App.tsx           # 路由 + ConfigProvider
│           ├── layouts/AppLayout.tsx
│           ├── pages/
│           │   ├── servers/
│           │   ├── envs/
│           │   ├── runs/
│           │   └── settings/
│           ├── components/
│           │   ├── LogPanel.tsx
│           │   ├── StatusBadge.tsx
│           │   ├── PathEditor.tsx
│           │   ├── ActionEditor.tsx
│           │   └── HostKeyModal.tsx
│           ├── stores/
│           └── styles/
└── docs/
    └── design.md
```

**依赖清单（一期）**

- 运行时：`electron`、`react@19`、`react-dom@19`、`antd@^6.6.8`、`@ant-design/icons@^6`、`zustand`、`zod`、`ssh2`、`anser`、`dayjs`、`nanoid`、`iconv-lite`
- 开发：`electron-vite`、`vite`、`typescript`、`@types/*`、`electron-builder`、`vitest`

> `ssh2` 的可选原生依赖 `cpu-features` 可不安装，不影响密码认证、exec 与 SFTP 功能。

---

## 15. 测试策略

| 层级 | 内容 |
| --- | --- |
| 单元测试（Vitest） | `shellQuote`、变量解析、路径校验脚本生成、Run 状态机、日志保留清理、Zod Schema |
| 集成测试 | 使用本地 Docker 启动带密码认证的 sshd，覆盖：连接、host key 首次信任/变更、exec 流、非零退出码、超时与取消；SFTP 文件/目录上传、覆盖备份、临时文件清理、权限不足与空间不足 |
| UI 测试 | Playwright Electron 冒烟：启动 → 新增服务器 → 新增环境 → 配置预上传 → 执行 `echo` → 查看上传进度与历史 |
| 手工验证 | 真实 Ubuntu 22.04 / 银河麒麟 V10 各一台，验证编码、PATH、目录校验、中文字符路径、大文件上传与备份替换 |

---

## 16. 里程碑

| 阶段 | 交付内容 | 验收标准 |
| --- | --- | --- |
| M1 骨架 | 工程初始化、主/预加载/渲染打通、布局与路由、设置持久化 | 应用可启动，导航可用 |
| M2 服务器 | 服务器 CRUD、safeStorage 凭据、连接测试、host key 确认 | 可新增并成功连接真实机器 |
| M3 环境 | 环境 CRUD、目录配置与校验、操作编辑与模板、预上传配置 | 目录状态展示正确，命令与上传目标预览正确 |
| M4 执行 | RunManager、流式日志、取消/超时、错误分类、SFTP 预上传与进度 | 更新/启动/关闭及上传全流程可用 |
| M5 历史与打包 | 历史列表/日志回看/导出、日志清理、NSIS 打包 | 安装包在纯净 Win10/11 可运行 |
| M6 打磨 | 空状态、文案、暗色主题、异常兜底、真实环境回归 | 通过 §15 手工验证清单 |

---

## 17. 风险与待确认事项

| # | 事项 | 影响 | 应对 |
| --- | --- | --- | --- |
| 1 | 银河麒麟的国产化 OpenSSH 配置差异（算法、编码） | 连接失败或乱码 | 提供「兼容旧算法」与输出编码设置；真实机器验证 |
| 2 | `safeStorage` 绑定 Windows 用户，换机后无法解密 | 用户需重新输入密码 | 明确提示；不阻塞其他数据 |
| 3 | 取消操作无法保证杀掉所有子进程 | 残留进程 | UI 明示「尽力终止」；文档建议脚本自身做好进程管理 |
| 4 | 用户命令需要 sudo 密码 | 无法非交互执行 | 一期文档说明：配置 NOPASSWD 或使用有权限账号；二期评估 sudo 密码托管 |
| 5 | 长任务日志量过大 | 内存/磁盘压力 | 节流 + 环形缓冲 + 单次日志上限 |
| 6 | 密码可能被写进命令本身 | 泄露到历史记录 | 文档提示；执行记录导出前提示检查；二期可做敏感词脱敏 |
| 7 | 上传大文件/目录耗时长、占用带宽 | 执行等待时间长 | 进度可见、可取消、串行上传；命令超时不计入上传阶段；文档建议大产物走内网 |
| 8 | 自动备份在目标目录累积 | 磁盘占用增长 | 日志给出备份路径；不自动删除；文档提示定期清理 |
| 9 | 目标目录拼写错误导致自动创建 | 产生垃圾目录 | 目标必须是绝对路径并经过变量解析；日志明确输出创建路径；目录校验可提前发现 |

### 待确认（不阻塞一期开工）

1. 是否需要「开发环境」级别的备注截图/附件？一期仅文本描述。
2. 执行历史是否需要按服务器维度汇总统计（成功率、平均耗时）？一期不做。
3. 是否需要「导入配置」用于本机备份恢复（不含密码）？一期仅导出，导入可放二期。
4. 服务器标签是否需要预置（如 ubuntu / kylin / prod / test）？一期自由输入。

---

## 18. 后续演进方向

- 私钥 / ssh-agent / 跳板机认证；
- SFTP 目录浏览、远端日志/文件下载；
- 多环境批量执行与执行计划（定时更新）；
- 环境健康检查（端口探活、HTTP 探针）与告警；
- 操作编排（更新 → 健康检查 → 失败回滚）；
- 配置导入（本机备份恢复，不含密码）；
- macOS / Linux 打包。

---

## 附录 A：关键实现约定速查

| 项 | 约定 |
| --- | --- |
| 执行 shell | `bash -lc` |
| 命令转义 | POSIX 单引号，`'` → `'\''` |
| 上传临时文件 | `targetDir/.corral-tmp-<runId>-<name>` |
| 上传备份 | `<target>.bak-<yyyyMMdd-HHmmss>`，重名追加序号 |
| 上传权限 | 文件 `0644`，目录 `0755` |
| 上传并发 | 多文件串行；单文件 `fastPut` 流水线 8 |
| 上传空闲超时 | 60s 无字节进度 |
| 变量语法 | `${key}`，替换为路径原文 |
| 日志格式 | JSONL，`{ "t": 毫秒偏移, "s": "out"\|"err"\|"sys", "d": "文本" }` |
| 日志节流 | 50–100ms 或 64KB 聚合 |
| 连接超时 | 15s；检测超时 8s |
| 保活 | `keepaliveInterval=15s`，`keepaliveCountMax=3` |
| 凭证加密 | `safeStorage.encryptString` + Base64 |
| 主机指纹 | SHA256，首次信任（TOFU） |
| 数据目录 | `%APPDATA%/Corral` |
| 单环境并发 | 1 |
| 全局并发 | 4 |
