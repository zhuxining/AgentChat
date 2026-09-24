# Tauri Rust Pi RPC Adapter 设计

状态：设计已获逐段口头确认，等待书面规格审阅

## 1. 目标与范围

设计 Tauri Rust Host 如何启动、管理并调用 Pi CLI RPC，以及如何把 Pi 的进程、协议和事件纳入 AgentChat 的 Host 边界。

本设计聚焦 Rust Pi RPC Adapter。桌面 Host 与移动端 API、SQLite、设备配对等更大架构仅作为 Adapter 的调用上下文，不在此重新决策。设计以当前项目和已有架构决策为准：Tauri 2 + Rust Host、Pi CLI RPC、每个 AgentChat Conversation 对应一个 Pi Session、Pi 保存执行历史，Host 保存产品消息与最终结果。

目标不是重写整个项目为 Rust，也不是引入 Node/Bun；TypeScript UI 通过类型化 Tauri IPC 调用 Host。Shell 插件可继续为 UI 提供普通原生能力，但不用于让 WebView 持有 Pi RPC 子进程。

## 2. 项目与产品约束

- 桌面 Host 使用 Tauri 2，在 macOS 桌面应用进程内运行；隐藏窗口后继续驻留，显式退出时关闭受管 Pi 子进程。
- 移动端是局域网 Host 客户端，通过 HTTPS 请求与 SSE 接收消息；不运行 Pi。
- 用户预装 Pi CLI，AgentChat 复用 Pi 当前用户的模型与认证配置。
- 一个 AgentChat Conversation 关联一个 Pi Session；Pi 拥有并持久化 Pi Session 文件。
- Host 在 SQLite 持久化用户消息、Conversation 到 Pi Session 的引用、最终响应/结果；不持久化 Run 状态、逐 token delta 或工具调用历史。
- 同一 Conversation 的请求串行；不同 Conversation 最多两个 Run 并发，超额排队。完成后的少量近期 RPC 进程可保留，空闲进程由 Host 回收策略管理。
- Agent 工作目录是 Pi 默认上下文，不是 OS 沙箱；Pi 工具继承当前 macOS 用户权限。
- Host 崩溃后不恢复或自动重放 Run。没有最终响应的消息提示“可能未完成”，由用户决定是否重新发送。

## 3. 决策摘要

**Pi 子进程与 Pi RPC 协议由 Rust Host 的 Pi RPC Adapter 统一管理。** Host Runtime 只调用 Adapter 的产品级操作；Tauri Command、HTTP/SSE 和 TypeScript UI 都不能直接拼接 Pi RPC JSON 或持有 Pi 子进程句柄。

Adapter 当前是 Pi 专用的具体实现，不预先建立多 Provider 通用 trait/框架。它把 Pi 的 JSONL 命令和原生事件转换为稳定的 AgentChat Host 事件。Host Runtime 负责并发调度、SQLite 写入和向桌面/移动端转发结果。

## 4. Waku 源码参考与适用边界

参考 `egoist/waku` 固定提交 [`5454cd4`](https://github.com/egoist/waku/tree/5454cd4c47aba67e1082dd658ecf09afb23e4c45)：

- [`crates/waku-core/src/driver/pi.rs`](https://github.com/egoist/waku/blob/5454cd4c47aba67e1082dd658ecf09afb23e4c45/crates/waku-core/src/driver/pi.rs) 的 `PiDriver` 启动 `pi --mode rpc`，分别接管 stdin/stdout/stderr，读取 stdout JSONL、写入 RPC 命令，并将 Pi 消息转换成驱动事件。
- [`crates/waku-core/src/driver/mod.rs`](https://github.com/egoist/waku/blob/5454cd4c47aba67e1082dd658ecf09afb23e4c45/crates/waku-core/src/driver/mod.rs) 定义 Waku 多 Provider 共用的 Driver 控制与事件边界；[`src/app/runtime.rs`](https://github.com/egoist/waku/blob/5454cd4c47aba67e1082dd658ecf09afb23e4c45/src/app/runtime.rs) 负责协调 Driver 和事件泵。
- [`crates/waku-core/src/pi_session.rs`](https://github.com/egoist/waku/blob/5454cd4c47aba67e1082dd658ecf09afb23e4c45/crates/waku-core/src/pi_session.rs) 的 Session 文件发现/读取与在线 Pi RPC Driver 分离；模型目录查询也由独立流程处理。
- Waku 的内部 client/daemon 协议不同于 Pi 子进程的 stdio JSONL。AgentChat 不复制 Waku 的 daemon/WebSocket/protocol 结构，也不需要把 Pi wire protocol 生成成 TypeScript API。
- Waku 有面向 Oh My Pi 的 `negotiate_protocol` / `rpc_chunk` 兼容处理；这不是标准 Pi RPC 的通用要求。AgentChat 不向标准 Pi CLI 发送该扩展命令，除非未来明确支持并识别对应 fork。

**借鉴：** Pi 专用 Driver 边界、进程 I/O 与产品事件解耦、Session 恢复和模型目录发现分开。

**不照搬：** 当前没有第二个 Provider，因此不预建 Waku 式通用 Provider Driver 抽象；Waku 自身 daemon RPC 也不替代 Pi RPC。

## 5. Rust 模块与 Adapter 接口

建议将 Pi 实现聚合在 `src-tauri/src/pi_runtime/`，Tauri Command 留在现有 `commands/` 边界：

```text
src-tauri/src/
  commands/                 桌面 UI 的薄 IPC 边界
  pi_runtime/
    mod.rs                  PiRuntimeManager 与 Host 可调用操作
    process.rs              Pi 子进程、标准流、退出监控与清理
    protocol.rs             Pi RPC JSONL 命令、响应、事件与解码
```

初期由具体的 `PiRuntimeManager` 管理 Conversation 到 `PiSessionRuntime` 的映射。除非出现第二个 Provider 或真实重复边界，不抽象通用 `ProviderDriver` trait。

Host 只依赖窄的产品级操作：

- 打开新 Pi Session 或恢复已有 Pi Session；
- 对已打开的 Conversation 提交一个 prompt 并接收流式 Host 事件与最终消息；
- 取消该 Conversation 当前执行；
- 应用关闭时关闭所有受管进程。

`get_state`、`prompt`、`abort` 等 Pi RPC 命令只存在于 Adapter 内部；不提供任意原始 RPC 转发，也不在首发实现模型目录发现 API。

## 6. 进程与 Session 生命周期

### 6.1 进程所有权

每个 Pi Session 运行时由一个 `PiSessionRuntime` 独占管理：

```text
PiSessionRuntime
├── Child supervisor       启动、退出监控、停止与回收
├── stdin writer           串行发送 JSONL 命令
├── stdout reader/parser   读取 Pi 响应和异步事件
└── stderr drain           持续排空诊断输出
```

- 通过 Rust 子进程 API 启动 Pi，不经 Shell 拼接命令；工作目录设为 Agent 工作上下文，CLI 参数单独传递。
- 先解析 Pi 可执行文件的绝对路径，不只依赖 macOS GUI 进程继承的 `PATH`；缺少 CLI 时返回可操作的 `PiNotFound` 错误。
- stdin 写入集中到单一有序 writer；每个 JSON 命令编码为一条以 LF 结尾的记录并完整写入。
- stdout 只承载 Pi 协议记录，按 LF 切分 JSONL；stderr 独立持续读取，不能并入 stdout 或因未读取导致子进程阻塞。
- 进程 I/O、等待和解析均在后台任务执行，不阻塞 Tauri/UI 线程。子进程、工作任务、通道和退出通知归同一个 Session Runtime 所有。
- Host 有界并发、限制近期空闲进程保留数量；慢客户端不得反压 stdout reader。每个客户端使用有界发送队列，落后连接可断开并在之后读取已持久化最终结果；delta 不补放。

### 6.2 Pi Session 新建与恢复

- 新 Conversation：启动 `pi --mode rpc`，在 RPC 初始化后读取 `get_state`，取得 Pi 返回的 `sessionFile` / `sessionId`，由 Host 保存 Conversation 到 Pi Session 的引用后再提交 prompt。
- 已有 Conversation：使用保存的 Session 文件引用启动 `pi --mode rpc --session <sessionFile>`，随后调用 `get_state` 校验实际绑定的 Session。
- Host 只保存 Pi Session 引用，不复制或自行编辑 Pi Session 文件。Session 文件不存在或恢复失败时返回明确错误，不静默创建新 Session，以免丢失上下文。
- 进程崩溃后，下次用户操作可用已保存引用重新启动并附着持久化 Session；不尝试接管已脱离 Host 的活动进程，也不自动重放中断 prompt。
- Waku 使用 `get_state`/`switch_session` 管理其 Driver 的 Session；AgentChat 选用 Pi 官方 `--session <path>` 启动参数恢复，以避免先创建错误默认 Session 再切换。

## 7. JSONL 请求、响应与事件转换

Pi RPC 官方接口是长驻子进程的 stdin/stdout JSONL：stdout 中的命令 `response` 与异步 Agent `event` 混合出现。参考 [Pi RPC](https://pi.dev/docs/latest/rpc)、[RPC Commands](https://pi.dev/docs/latest/rpc-commands) 和 [CLI `--session`](https://pi.dev/docs/latest/cli)。

### 7.1 请求与响应

- Adapter 为每个需要应答的命令分配唯一 request ID，维护待处理请求表；收到匹配的 `response` 后完成相应请求。
- 命令拒绝、启动握手失败或等待超时映射为内部 Pi RPC 错误；未知/未来事件类型不应使进程解析器 panic。
- Host 已保证 Conversation 串行；Adapter 每个 Session 同时只接受一个活动 prompt，避免在运行中隐式排队、steer 或 follow-up。
- `prompt` 的成功应答只表示 Pi 接受了请求，不表示生成完成。Adapter 必须继续消费异步事件。

### 7.2 事件语义

- `message_update` 中的 `text_delta` 转成 Host 流式 delta；stdout 消费不能等待任一客户端网络发送完成。
- `message_end` 中的最终 assistant message 是内容结果来源；Host 负责保存最终产品响应。
- `agent_settled` 是 Run 完成边界；不单凭 `agent_end` 结束，因为后面可能仍有恢复或排队工作。
- `abort` 的 RPC 应答及运行停止信号转换为取消结果；Pi 的原始 JSON、工具轨迹与诊断文本不暴露为 Host/客户端契约。
- 已知事件转换为稳定 Host 事件，如运行开始、文本 delta、完成、取消、失败；无法识别但格式有效的事件可忽略或作限速诊断，不影响已知事件读取。

## 8. 错误、取消与关闭

Adapter 至少区分：`PiNotFound`、`SpawnFailed`、`StdioUnavailable`、`RpcRejected`、`RpcTimeout`、`InvalidJsonl`、`SessionUnavailable` 与 `ProcessExited`。错误契约不包含密钥、环境变量、完整 prompt 或原始 stderr。

- Pi 进程退出时，立即结束所有待处理请求，并向 Host 发一次退出/运行失败事件。
- prompt 已被接受但还未到 `agent_settled` 时进程退出，结果标记为执行中断/未知；不自动重试，不把模型错误伪装成成功结果。
- 用户取消先发送 Pi `abort` 并等待有限时长；超时后终止该子进程，清理待处理请求并标记执行中断。
- 应用显式退出时停止接收新执行，尝试有界等待子进程退出，超时后终止所有受管进程；所有读写任务必须有确定的关闭与等待路径。
- 日志仅保留受限的进程/错误诊断元数据；不记录用户 prompt、认证配置或整条协议消息。

## 9. 验证策略

### 自动化测试

- JSONL 编解码：LF/CRLF、UTF-8、JSON 字符串内换行、连续记录、命令应答与事件交错、request ID 关联、未知事件。
- Run 状态：prompt accepted 不代表完成；只有 `agent_settled` 结束；`message_end` 为最终消息来源；同一 Session 不并发接受两个 prompt。
- Fake Pi 子进程：正常流式回复、延迟/拒绝响应、取消、启动失败、无效 JSON、stderr 大量输出、等待中异常退出和 Session 恢复失败。
- Host 集成：Conversation 串行、最多两个 Run 并发、超限排队、最终结果写库、delta 不写库且慢客户端不会卡住进程输出。
- Session 数据：新 Session 引用先持久化后执行；恢复引用失效时显式报错，不静默新建。

### 桌面与真 Pi 验证

- macOS 桌面冒烟：GUI 环境能解析预装 Pi 可执行文件；隐藏窗口后 Pi 仍可响应；显式退出终止进程。
- 使用真实 Pi CLI 验证 `--mode rpc`、`get_state`、`--session` 恢复、prompt 流式输出、`agent_settled` 与 abort。
- 单独验证安装 Pi 的模型/认证配置被复用；测试不依赖模型供应商网络或用户密钥。
- Waku 的 Oh My Pi `rpc_chunk` 扩展不属于标准 Pi 测试路径；只有将来明确支持该 fork 时才增加相应兼容测试。

## 10. 备选方案与取舍

### A. Rust Host Pi 专用 Adapter（选定）

Host Runtime 调用 Rust Pi Adapter；Adapter 直接管理 Pi CLI RPC 子进程并转成 Host 事件。职责与 Pi RPC 的实际 stdio 边界一致，不新增前端到子进程的桥接。

### B. TypeScript 通过 Shell 插件管理 Pi

WebView 启动 Pi 并解析 RPC，Rust 仍拥有移动端 API/SQLite。手机请求需要从 Rust 跨回 WebView 执行，且后台生命周期依赖 Renderer；不采用。

### C. 独立 TypeScript Host Sidecar

增加 Node/Bun 运行时，把 Host 与 Pi RPC 放入 TS 服务；部署和生命周期成本超出当前范围，不采用。

## 11. 明确不在本设计范围

- 独立 daemon、Waku 内部 client/daemon WebSocket 协议、生成式跨端 RPC 协议层。
- 多 Provider 通用框架、Pi 模型目录发现、Pi 工具权限沙箱、文件附件、多 Agent 会话。
- Run/Task 状态持久化、delta 回放、崩溃自动恢复/重试、应用层静态加密、备份或导出。
- 引入 Node/Bun 或在 TypeScript WebView 中管理 Pi 进程。
