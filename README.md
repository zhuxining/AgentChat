# AgentChat

AgentChat 是本机 Agent 工作台。桌面 UI 连接独立后台 Runner；原生宿主管理本机连接、进程和系统凭据，Node Runner 使用 pi-durable Harness 与 SQLite 执行工作。关闭窗口或退出 UI 后，Runner 继续运行。

## 开发与构建

需要 Bun 1.4.2、Rust 工具链和当前平台的 Tauri 构建依赖。项目使用最小 Bun Workspaces，根目录为前端，`runner/` 为独立 Node package，共用 `bun.lock`。

```bash
bun install
bun run tauri dev
bun run build
bun run test
bun run check
```

`bun run build` 检查并构建前端与 Runner、暂存锁定的 Node 22.19.0 runtime。`bun run test` 聚合 UI 与 Runner 测试。macOS 可用以下命令构建 `.app`：

```bash
bun run tauri build --bundles app
```

开发和分发均使用项目暂存或打包的 Node，不依赖 PATH 中的 Node。runtime 依赖包含多个平台的二进制，不代表所有平台已可运行：**当前本机 IPC 实现为 Unix socket；Windows 本机 IPC 尚未实现**。macOS arm64 的 release `.app` 已完成构建与打包产物冒烟；Linux、Windows 和其他架构仍需在目标平台验证。

Tauri 的版本检查要求 Rust crate 与对应的 `@tauri-apps/*` 包处于同一 major.minor，因此 `src-tauri/Cargo.toml` 用 `~` 固定到 `package.json` 声明的 minor。升级任一侧时必须同步另一侧，并保留 `Cargo.lock`：`tauri-plugin-updater` 的可选 Windows 依赖 `zip ^4` 目前所有已发布版本都被 yank，全量 `cargo update` 无法重新解析，只能依赖锁文件中已固定的 `zip 4.6.1`。

## 使用与生命周期

桌面启动先连接同一数据目录的已有后台实例，未运行时再启动；UI 断开不会关闭 Harness。同一数据目录只允许一个后台实例持有执行 Storage。

- 在设置中保存 DeepSeek API Key；密钥进入系统凭据库，不写入 JSON 或聊天数据。Linux 需要可用的 Secret Service。
- 创建 Bot 时，将 Runner 默认模型、指令与能力选择写入该 Bot 的配置，并分配稳定工作区。当前模型入口为 DeepSeek Chat / Reasoner，默认编码工具为 `bash`、`edit`、`read`、`write`。
- 从 Bot 开始新对话；既有执行保存配置快照，空闲时通过“应用最新 Bot 设置”显式更新。
- 设置中的“停止后台 Runner”调用 Harness close 并收尾，保留未完成工作的恢复状态。取消工作或撤回输入是独立操作。
- 使用“重新启动并连接”停止并重新打开后台；停止后该按钮显示“启动并连接”。退出 UI 后如需停止后台，可重新打开 UI 进入设置操作。

产品聊天窗口是持续对话入口，可以容纳多个库 Conversation：界面把它们按时间拼接为一条消息流，边界以轻量分隔标注，选中 Bot 停留在最新的一个。界面结构、自适应规则与状态归属见 [UI 结构](docs/architecture/03-ui-structure.md)。

## 配置与本机数据

默认数据目录为 `~/.agentchat`。可在启动 UI 前设置绝对路径覆盖：

```bash
AGENTCHAT_DATA_DIR=/absolute/path/agentchat-dev bun run tauri dev
```

切换目录不会迁移旧数据，也不会停止另一个目录的后台实例。这是新项目，不提供旧配置或旧数据库迁移。

```text
~/.agentchat/
├─ runner.json                 # Runner 默认值、Provider 声明、Harness settings
├─ bots/
│  └─ <bot-id>/
│     ├─ bot.json              # Bot 档案与默认 Agent 配置
│     └─ instructions.md       # 可选独立指令文件
├─ workspaces/<bot-id>/         # 自动分配的稳定工作区
├─ state/runner.sqlite         # 执行事实与已确定的配置
├─ logs/host.log               # 后台诊断
└─ run/                        # 本机 socket 与实例锁
```

JSON 是期望配置的权威来源，既支持独立编辑，也支持 UI 经 Runner 保存同一份文件。操作步骤：

1. 启动一次应用生成 `runner.json`；创建 Bot 后生成 `bots/<id>/bot.json`。
2. 编辑文件。Bot 指令使用 `instructions` 或 `instructionsFile`，两者必须且只能选择一个；独立指令路径相对 Bot 目录解析。
3. 在设置点击“重载配置”，检查路径和字段诊断。第一阶段不监听文件变化。
4. Harness settings 在下次读取时生效；已有执行需显式应用 Bot 配置；Provider 声明变化需重启后台。

UI 保存携带内容版本，文件被外部编辑后拒绝过期覆盖；Runner 采用原子替换写入。无效修改不覆盖已加载的有效配置；冷启动无效 Bot 可诊断并修复，必要 Runner 配置无效时不启动执行。删除 Bot 文件不删除历史或自动取消工作。具体字段、示例与异常规则见[配置与 Harness 集成](docs/architecture/01-pi-durable.md)。

同一 Bot 的多个执行默认共享工作区；`cwd` 是执行位置，不提供文件访问或并发隔离。外部项目可以直接作为工作区使用。

`DEEPSEEK_API_KEY` 可作为本机开发凭据来源，由后台宿主启动时继承；修改环境变量后需重启后台。密钥经私有进程通信进入 Provider 认证闭包，工具环境不继承该密钥。

## 源码与验证边界

- `src/app/`：路由、应用装配与 `runner-client.ts` 集中适配 Tauri IPC；`src/features/bots/`、`src/features/chat/`、`src/features/settings/` 分别承载 Bot、连续对话与应用设置。
- `src-tauri/src/host.rs`：独立原生后台宿主、本机 IPC 与凭据入口；`runner.rs` 管理其 Node 子进程和私有 JSONL 通信。
- `runner/src/config/`：配置文件、校验、版本冲突、有效值与重载。
- `runner/src/harness/`：models、Registry、settings、ExecutionEnv、Storage 装配，类型化操作和状态视图。
- `runner/src/communication/`：外部请求校验、分发与私有 stdio 传输。

UI 测试位于 `tests/ui/`，Runner 测试位于 `runner/tests/`，Rust 模块内有协议和宿主测试。macOS 已使用临时数据目录验证独立后台、多客户端关联、配置读写与重载、停止、UI 进程退出后后台存活和重新连接；Harness 单元集成测试验证了已接纳工作的关闭/重开恢复。本轮未调用真实模型，工具中断的跨进程恢复仍待验证。

前端/Node 与 Rust 构建通过；Tauri 打包的 JS/Rust 版本不匹配已修复（两侧统一在同一 major.minor），release `.app`（115.8 MiB）已在 macOS arm64 构建，并在临时目录完成打包产物冒烟：随包 Node 与 Runner 入口启动后台、创建 Bot 与会话、通过宿主读取配置、退出 UI 后后台存活、重连与显式停止。本轮未调用真实模型；手机、Device Core 与 Relay 尚未实现。

设计入口：[产品蓝图](docs/PRODUCT_BLUEPRINT.md)、[架构总览](docs/architecture/00-overview.md)、[UI 结构](docs/architecture/03-ui-structure.md)、[多端规划](docs/architecture/02-multi-device.md)、[术语表](GLOSSARY.md)。
