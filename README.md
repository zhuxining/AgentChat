# AgentChat

AgentChat 是本机 Agent 工作台。本仓库当前实现桌面本地切片：由 Tauri 管理 Node Runner，Runner 使用 pi-durable 和 SQLite 承载多个 Bot Conversation。

## 桌面开发与打包

需要 Bun 1.4.2、Rust 工具链，以及当前平台的 Tauri 桌面构建依赖。首次安装会按当前平台下载锁定在 `bun.lock` 中的 Node 22.19.0 runtime。

```bash
bun install
vpr tauri dev
bun run tauri build --bundles app
```

最后一条在 macOS 生成 `.app`。请在目标操作系统和 CPU 架构上构建安装包；当前 Runner runtime 按 macOS arm64/x64、Windows x64、Linux arm64/x64 分发。桌面开发和发布包都使用随项目安装或打包的 Node runtime，不依赖开发机 PATH 中的 Node。

## 当前桌面功能

- 创建、编辑和归档 Bot，选择模型、Thinking Level、instructions、Extension、Tool 和默认工作目录。
- 从 Bot 创建 Conversation；Bot 配置作为快照保存，空闲时可显式应用后续更改。
- 提交输入、查看已接纳状态和存活 Task Graph、撤回排队输入或停止 Conversation。
- 保存 Conversation 工作目标，由用户明确标记完成。
- 将 OpenAI API Key 保存到系统凭据库，由 Runner 使用。
- 关闭时关闭 Harness，重新启动时打开 SQLite 并恢复未完成工作。

`cwd` 只是工具默认工作目录，不构成文件访问隔离。当前内置 Extension 提供 `read`、`write`、`edit` 和 `bash` 工具。

## 本机数据与凭据

pi-durable SQLite 数据保存在 Tauri 应用数据目录下的 `runner/agentchat.sqlite`。Provider 密钥存储在操作系统凭据库中；Linux 桌面需要可用的 Secret Service。`OPENAI_API_KEY` 进程环境变量仍可作为本机开发配置来源。

本机已验证 macOS `.app` 包含 Runner 资源，并能启动 Runner、打开 SQLite 和正常退出；Harness 在 Runner 进程关闭/重开时的未完成工作恢复已有确定性测试，但尚未验证 Tauri 应用实际重启场景或真实 Provider。当前环境的默认 DMG 打包步骤未通过，Windows/Linux 目标也尚未验证。
