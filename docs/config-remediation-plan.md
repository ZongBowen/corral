# Corral 项目配置修复方案

Windows x64 是 Corral 的主要发布目标。安装与测试从包含本次 npm 迁移内容的干净检出开始，实际打包结果用于确定发布工具链。macOS 和 Linux 的产物分别在对应平台验收。 [项目架构](architecture.md)

## 已有验证结果

- 2026-11-22 和 2026-11-24 均使用 Node 26.13.1、npm 12.2.3 和工作区已安装的依赖运行 Vitest，14 个文件中的 116 项测试通过。11 月 24 日单独运行 `src/shared/command.test.ts`，16 项测试通过。
- 修订记录中的另一次运行有 14 个文件在收集阶段失败、0 项测试执行，报错为 `TypeError: Cannot read properties of undefined (reading 'config')`。该记录用于对照干净安装后的结果。 修订记录保存在 `config-remediation` 分支。
- 11 月 22 日的类型检查和生产构建通过。Windows x64 免安装目录使用本地 Electron 和临时输出生成，验证时关闭了签名与可执行文件资源编辑。NSIS 安装包的验证进展见 Windows 打包步骤。

## 1. 验证干净安装和测试

1. 使用 Node 26.13.1 和 npm 12.2.3 作为候选版本。在包含当前清单、锁文件、源码和配置的临时检出中记录版本并安装依赖。

   ```powershell
   node --version
   npm --version
   npm ci
   ```

   若 Electron 下载失败，按第 3 节核对镜像后重试。

2. 安装成功后运行单文件测试和全量测试，记录实际执行的测试文件数与用例数。

   ```powershell
   npm exec --offline -- vitest run src/shared/command.test.ts --no-color
   npm test
   ```

3. 若复现测试收集错误，保存第一条完整堆栈并检查当前依赖树。

   ```powershell
   npm ls vitest vite @vitest/mocker @vitest/spy
   ```

   根据堆栈和锁文件排查版本、模块路径或环境差异。需要验证 Node 版本的影响时，用符合当前依赖要求的 Node 24 做同锁文件对照，并记录其 npm 版本。

现有清单与锁文件已通过 `npm ci --dry-run --offline --ignore-scripts` 校验。干净安装验收直接运行 `npm ci`，覆盖依赖下载、Electron 的 `postinstall` 和原生依赖的生命周期脚本。 [当前锁文件](../package-lock.json) · [npm ci 文档](https://docs.npmjs.com/cli/commands/npm-ci/)

## 2. 恢复 ESLint 和格式检查

当前 `eslint.config.mjs` 引用了未安装的 `eslint-plugin-react`，其 7.37.5 也未声明兼容 ESLint 10。审查时临时排除该插件后，其余规则报告了 52 个错误和 390 个警告。同期的 Prettier 检查有 48 个文件未通过。迁移后重新采集报告。 [当前 ESLint 配置](../eslint.config.mjs) · [旧插件的依赖声明](https://raw.githubusercontent.com/jsx-eslint/eslint-plugin-react/master/package.json)

1. 将支持 ESLint 10 的 `@eslint-react/eslint-plugin` 加入 `devDependencies`。移除旧插件的导入、两个 flat 预设和 `settings.react.version`。在 `src/renderer/src/**/*.{ts,tsx}` 应用 `eslintReact.configs['recommended-typescript']`，并将 React Hooks 和 React Refresh 的规则限定到同一范围。沿用现有工具包的 TypeScript 和 Prettier 预设。 [ESLint React 预设](https://eslint-react.xyz/docs/presets) · [规则迁移对照](https://eslint-react.xyz/docs/migrating-from-eslint-plugin-react)
2. 在 `package.json` 添加 `"format:check": "prettier --check ."`，在 `.prettierignore` 中加入工具安装的技能目录 `.agents/skills/` 和 `.codebuddy/skills/`。配置和依赖改动先提交，项目源码及文档的格式化单独提交。 [现有忽略规则](../.prettierignore)
3. 修复未使用的变量、常量声明和可确认等价的转义。涉及 React 状态同步、可变引用、正则或命令模板的修复单独提交，运行对应测试。渲染层改动还需检查表单打开、编辑和切换时的状态。

## 3. 完成 npm 迁移并统一下载镜像

### npm 源、依赖和锁文件

在项目 `.npmrc` 写入 `registry=https://registry.npmmirror.com/`，使 npm 安装使用与锁文件一致的镜像，并在 README 记录此设置和首次安装命令 `npm ci`。 [README](../README.md)

将 `antd` 从 `dependencies` 移到 `devDependencies`。Vite 已将 Ant Design 编入渲染产物，审查时的 `app.asar` 额外收录了约 48 MB 的独立 `antd` 文件。临时锁文件验证中有 71 个包转为仅开发依赖，已锁定的版本均未变化。 [当前依赖声明](../package.json)

依赖调整后运行 `npm install --package-lock-only --ignore-scripts` 更新锁文件，检查已锁定版本的差异。将新锁文件和检查配置随 pnpm 锁文件及工作区配置的删除一起提交。 [当前锁文件](../package-lock.json)

### Electron 下载镜像

将当前 `.env` 的两个公共镜像变量迁入项目根目录的 `electron-builder.env`，并提交该文件。

```dotenv
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/
```

在 `package.json` 更新 `postinstall`。

```json
{
  "postinstall": "node --env-file-if-exists=electron-builder.env ./node_modules/electron/install.js"
}
```

Node 和 electron-builder v26 已通过临时文件验证能读取这两个值。确认 CLI 加载共享文件后，移除 YAML 中重复的 `electronDownload.mirror`，并更新架构文档的安装说明。 [当前打包配置](../electron-builder.yml) · [架构文档的 npm 章节](architecture.md#112-npm) · [electron-builder 环境文件文档](https://www.electron.build/v26/docs/configuration/#environment-variables-from-file)

将根目录的 `.env`、`.env.local`、`.env.*.local` 和 `electron-builder.env.local` 加入 `.gitignore`。本地签名等构建变量通过 shell 或 CI 注入。若从本地文件获取变量，在启动 npm 或 electron-builder 前显式加载。

第 5 节的 Windows 验收使用空的 Electron 下载缓存和打包工具缓存。可在验证会话中将 `electron_config_cache` 与 `ELECTRON_BUILDER_CACHE` 指向新的临时目录，核对 `npm ci` 和 Windows 打包时的实际下载地址。

## 4. 补齐 macOS 和 Linux 打包配置

- 将两个平台的脚本接到统一的生产构建入口，使类型检查先于打包运行。 [构建脚本](../package.json)

  ```json
  {
    "build:mac": "npm run build && electron-builder --mac",
    "build:linux": "npm run build && electron-builder --linux"
  }
  ```

- 将 macOS 的 `extendInfo` 从数组改为键值映射，保留实际使用的权限描述。移除指向缺失文件的 `entitlementsInherit`。启用签名时配置实际使用的 entitlements 文件。验收时检查产物的 `Info.plist`。 [macOS 配置文档](https://www.electron.build/v26/docs/api/app-builder-lib.interface.macconfiguration/)
- 在 `package.json` 填写真实的 `homepage`，将 Linux 的 `maintainer: electronjs.org` 替换为真实维护者信息，并核对 `author` 和 `description`。验收时使用 `git archive` 从包含本次改动的提交导出源码，确认源码归档可以生成 `.deb`。 [electron-builder 元数据文档](https://www.electron.build/v26/docs/configuration/#metadata)

## 5. 从干净检出验收

在包含全部配置和依赖调整的干净检出中，使用候选 Node 与 npm 版本依次执行以下命令，记录测试报告中实际执行的用例数。通过后在对应平台验证发布产物。

```powershell
npm ci
npm run lint
npm run format:check
npm run typecheck
npm test
```

### Windows x64 免安装目录

```powershell
npm run build:unpack -- --win --x64
```

1. 检查 `release/win-unpacked/resources/app.asar`，确认独立的 `node_modules/antd` 已移除，记录归档体积变化。
2. 核对主进程、预加载和渲染入口，以及 `ssh2`、`iconv-lite` 等运行时依赖。
3. 启动免安装版，验证 Ant Design 页面、图标和样式，并连接测试服务器跑一次 SSH 功能冒烟测试。

### Windows NSIS 安装包

审查时，缓存中的旧版 `makensis.exe` 在启动阶段返回 Windows 错误 623。单独执行 `makensis.exe /VERSION` 也复现了 DLL 重定位错误。 [Windows 错误 623](https://learn.microsoft.com/en-us/windows/win32/debug/system-error-codes--500-999-)

1. 在干净的 Windows 发布环境运行 `npm run build:win`，检查 `release/Corral-<version>-setup.exe`。
2. 若仍出现 623，使用空缓存重新获取默认 NSIS 工具链，或在全新的 Windows 环境复测。用 `makensis.exe /VERSION` 确认编译器能否启动。
3. 若默认工具链在干净环境中仍失败，确认镜像可以下载 `nsis-bundle-3.12.tar.gz`，再试跑 electron-builder v26 的 NSIS 3.12 Beta 工具链。 [v26 工具链配置](https://www.electron.build/v26/docs/api/app-builder-lib.interface.toolsetconfig/#nsis) · [NSIS 工具包发布记录](https://github.com/electron-userland/electron-builder-binaries/releases/tag/nsis%401.2.1)

   ```powershell
   npm run build:win -- --config.toolsets.nsis=1.2.1
   ```

4. 在测试环境完成安装、启动、核心功能和卸载验证。若采用 Beta 且通过验收，将 `toolsets.nsis` 设为字符串 `'1.2.1'`，再用标准命令生成并验证安装包。

### macOS 和 Linux

在 macOS 运行 `npm run build:mac` 并检查 `Info.plist`。在 Linux 运行 `npm run build:linux`，再按第 4 节用源码归档验证 `.deb`。记录各平台的产物路径和验证结果。

## 6. 确定 Node 与 npm 基线

干净安装、测试和 Windows 发布验收通过后，正式确认 Node 与 npm 版本。在 `package.json` 的 `engines` 声明已验证的范围，并在 README 记录两者的版本要求。若候选组合通过，`packageManager` 使用 `npm@12.2.3`。同步锁文件，若正式选用的版本有调整，用最终组合复验。 [npm 的清单字段](https://docs.npmjs.com/files/package.json/)

## 实施验收（2026-11-24）

- 使用 Node 26.13.1 和 npm 12.2.3 在 Windows x64 从源码归档运行 `npm ci`、ESLint、Prettier、类型检查和 Vitest，均通过。单文件执行 16 项，全量执行 14 个文件中的 116 项。迁移后的首次 ESLint 扫描报告 52 个错误和 401 个警告，修复后均为 0。
- Ant Design 依赖归类的锁文件对照显示 71 个包转为仅开发依赖，锁定版本无变化。两次构建验证中的 `app.asar` 从 74,995,689 字节降至 4,266,654 字节。归档包含主进程、预加载和渲染入口、`ssh2` 与 `iconv-lite`，独立的 `node_modules/antd` 已移除。
- Windows x64 通过标准命令生成 `release/win-unpacked/Corral.exe` 和 `release/Corral-1.0.0-setup.exe`。Electron 和打包工具使用项目镜像，空打包缓存下载的默认 `makensis.exe /VERSION` 返回 `v3.04`。免安装版和 NSIS 安装后的应用通过 Ant Design 图标与样式、服务器和操作表单重开、编辑环境切换、主机指纹确认与本机回环 SSH 命令执行。NSIS 静默安装与卸载均通过。
- Ubuntu x64（WSL2）使用同一 Node 与 npm 组合，从 `git archive` 导出的源码运行 `npm ci` 和 `npm run build:linux`。生成 `release/corral-1.0.0.AppImage`、`release/corral_1.0.0_amd64.snap` 和 `release/corral_1.0.0_amd64.deb`。使用 `dpkg-deb --info` 核对了主页、维护者与描述。
- macOS 配置已更新。当前没有可用的 macOS 主机，原生打包与 `Info.plist` 验收仍待执行。

## 合入 main 时的复验

`main` 的独立检出使用 Node 26.13.1 与 npm 12.2.3，干净安装、ESLint、Prettier、生产构建和 Vitest 通过。该检出使用 `main` 现有的业务代码，共执行 13 个文件中的 89 项测试。上节的 Windows 和 Linux 发布验证使用包含 P1 业务改动的源码快照。
