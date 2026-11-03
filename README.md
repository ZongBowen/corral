# Corral

研发服务器管理工具：在 Windows 桌面端集中管理 Linux 虚拟机与开发环境，支持 SSH 命令执行、SFTP 预上传、流式日志与执行历史。

技术栈：Electron + React 19 + TypeScript + Ant Design 6 + ssh2。

## 开发

    pnpm install
    pnpm dev

## 校验

    pnpm typecheck
    pnpm test

## 构建

    pnpm build
    pnpm exec electron-builder --win --x64 --dir

数据目录：%APPDATA%/Corral（服务器、环境、执行历史、加密凭据、日志）。
