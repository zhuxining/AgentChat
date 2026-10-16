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
- 三栏聊天界面：左侧搜索和切换会话、中间消息与输入框、右侧可折叠的智能体资料和运行配置，使用现有 shadcn 组件默认样式。
- 提交输入、查看接纳及执行状态、撤回排队输入或停止 Conversation。
- 保存 Conversation 工作目标，由用户明确标记完成。
- 使用 DeepSeek Chat / Reasoner，将 API Key 保存到系统凭据库或从宿主环境变量读取，由 Runner 使用。
- 关闭时关闭 Harness，重新启动时打开 SQLite 并恢复未完成工作。

`cwd` 只是工具默认工作目录，不构成文件访问隔离。当前内置 Extension 提供 `read`、`write`、`edit` 和 `bash` 工具。

## 源码职责

- `src/App.tsx`：装配桌面聊天入口和 Runner Adapter。
- `src/features/chat/chat-workspace.tsx`：组合三栏和弹窗，管理面板开关与编辑对象。
- `src/features/chat/use-workspace.ts`：统一管理 Runner 同步、会话选择、消息重试和跨视图操作；通过传入的 Runner Adapter 访问宿主。
- `src/features/chat/` 中其余视图：会话列表、聊天、资料栏及智能体、新聊天、设置弹窗；表单自行管理草稿。
- `src/app/runner-client.ts`：集中定义前端请求类型与 Tauri IPC 适配。
- `runner/src/application.ts`：组合 Harness 并处理应用请求；Provider 凭据、Agent 配置、Document 定义、Bot 校验及消息投影分别放在对应文件中。

界面行为通过 `tests/ui/submission.test.ts` 验证，Runner 行为通过 `createApplicationRunner` 的请求入口验证。内部拆分不改变 IPC 或 SQLite Document 格式。

## 本机数据与凭据

pi-durable SQLite 数据保存在 Tauri 应用数据目录下的 `runner/agentchat.sqlite`。Provider 密钥存储在操作系统凭据库中；Linux 桌面需要可用的 Secret Service。`DEEPSEEK_API_KEY` 进程环境变量可作为本机开发配置来源；启动 Tauri 的进程必须实际继承该变量，Shell 配置中的注释行不会生效。密钥通过私有 IPC 传给 Runner，工具进程不会继承该密钥。

旧 OpenAI Bot 与 Conversation 保留原配置。继续使用前，编辑智能体选择 DeepSeek 模型，并在会话空闲时点击“应用最新智能体设置”；也可用新智能体创建聊天。

本机已验证 macOS `.app` 包含 Runner 资源，并能启动 Runner、打开 SQLite 和正常退出；Harness 在 Runner 进程关闭/重开时的未完成工作恢复已有确定性测试，但尚未验证 Tauri 应用实际重启场景。已通过真实 DeepSeek Chat / Reasoner 的 Runner 发消息验证，以及 macOS 桌面输入框到 DeepSeek 回复的完整链路验证。当前环境的默认 DMG 打包步骤未通过，Windows/Linux 目标也尚未验证。
