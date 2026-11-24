# Corral

研发服务器管理工具：在 Windows 桌面端集中管理 Linux 虚拟机与开发环境，支持 SSH 命令执行、SFTP 预上传、流式日志与执行历史。

技术栈：Electron + React 19 + TypeScript + Ant Design 6 + ssh2。

## 开发

项目使用 npm 管理依赖。`.npmrc` 将 npm 源设为 `https://registry.npmmirror.com/`，与锁文件一致。

    npm ci
    npm run dev

## 校验

    npm run typecheck
    npm run lint
    npm run format:check
    npm test

## 构建

    npm run build

以下命令会先构建应用，再生成 Windows x64 免安装应用目录。

    npm run build:unpack -- --win --x64

数据目录：%APPDATA%/Corral（服务器、环境、执行历史、加密凭据、日志）。
