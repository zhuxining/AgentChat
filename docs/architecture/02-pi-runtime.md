# Pi Runtime Adapter

> **Status**: `active`（架构决策；Pi Runtime Adapter 尚未落地）。

## 职责定位

Pi Runtime Adapter 负责启动和管理 Pi CLI RPC、关联 Conversation 当前上下文段与 Pi Session 并转换执行结果，不负责 AgentChat 消息存储、桌面 UI 或 OS 级沙箱。

## 核心原则

- **Pi 保有执行历史：** Pi Session 文件留在 Pi 默认会话目录，由 Pi 创建和恢复；Host 只保存对应 Session 引用，不复制工具调用明细。
- **当前上下文独立：** 一个 RPC 进程只承载一个当前 Pi Session；`clear` 后旧 Session 保留，新上下文使用新的 Session。不同 Session 并发时使用不同 RPC 进程。
- **失败不自动重放：** Host 进程重启后可重新打开已持久化 Pi Session，但不把尚未完成的执行当作可恢复任务自动续跑。
- **进程归 Rust Host：** Adapter 独占 Pi 子进程及 stdio；Tauri Command、Device Access 和 WebView 只调用 Host 的产品操作，不转发任意 Pi RPC JSON。当前只有 Pi 一个执行 Provider，不预建通用 Driver trait。

## 边界与实体

### 输入

- **Pi 执行请求：** Host Runtime 提供用户消息、Agent 工作上下文和当前 Context Segment 对应的 Pi Session 引用。
- **取消请求：** Host Runtime 请求终止当前 Pi 执行。
- **上下文清理：** Host Runtime 在 Conversation 空闲且新 Context Segment 已建立后，要求 Adapter 回收旧段的 Pi 进程；下一次执行启动全新 Session。
- **进程生命周期指令：** Host Runtime 决定创建、保留、回收或关闭 Pi RPC 进程。

### 输出

- **流式 delta：** Pi 生成的临时内容，交给 Host 实时转发，不由 Adapter 持久化。
- **最终响应：** Pi 完成后的 Agent 响应或结果错误，交回 Host Runtime 保存。
- **运行信号：** Pi 的接受、运行、完成、取消或失败信号，仅用于 Host 当前进程的临时状态。

### 核心实体

- **Pi Session：** Pi 拥有并保存的 Coding Agent 对话上下文；Host 为 Conversation 的每个已使用 Context Segment 分别保存 Session 引用。

Pi RPC Process 是 Adapter 管理的运行资源，不是独立业务实体。一个进程只有一个当前活动 Session；不同 Session 并发执行时，Adapter 管理各自的 RPC 进程，并保留近期使用的进程。

### 进程与协议所有权

每个活动 Context Segment 对应一个受管运行时：子进程监督者负责启动、退出和回收；单一 stdin writer 顺序写命令；stdout reader 持续解析 JSONL；stderr reader 独立排空诊断输出。所有任务、通道、待应答请求和退出通知都由该运行时持有并在结束时等待，不让进程或读写任务脱离 Host 生命周期。

Rust 通过子进程 API 以分离参数启动预装 Pi CLI，不拼接 Shell 命令，也不经 Tauri Shell 插件让 WebView 管理 Pi。先解析可执行文件的绝对路径，不能只依赖 macOS GUI 进程的 `PATH`；找不到时返回可操作的 `PiNotFound`。工作目录设为 Agent 的 `work_dir`，但它不限制 Pi 工具的系统权限。阻塞 I/O、解析和进程等待不占用 Tauri/UI 线程；Adapter 不调用 Host SQLite 或客户端网络层。

stdin 每条 JSON 命令完整编码并以 LF 结束，写入时处理背压。stdout 只含协议记录，按 LF 字节边界切分，兼容 CRLF；不能按 Unicode 行分隔符切分 JSON 字符串。stderr 不与 stdout 合并，也不能放任管道填满。stdout reader 不等待移动端或桌面端消费 delta；Host 对客户端使用有界发送队列，慢连接可断开，再从持久化消息读取最终结果。[Pi RPC 协议](https://pi.dev/docs/latest/rpc) 明确规定了这些 stdio 与 JSONL 边界。

### Session 新建与恢复

新段首次执行时启动 `pi --mode rpc`，读取 `get_state` 的 `sessionFile`、`sessionId`，核对得到可持久化的 Session 路径，再由 Host 将路径写入该 Context Segment，随后发送 prompt。已有段使用 Host 保存的文件路径启动 `pi --mode rpc --session <path>`，再以 `get_state` 核对实际打开的 Session；路径不存在、状态不匹配或恢复失败都显式报错，不静默新建，也不使用 `--continue` 猜测最近 Session。若所装 Pi 版本在首次 prompt 前不提供可持久化路径，这个“先保存引用再执行”的顺序必须先经真实 Pi 验证并调整，不能假定已成立。[Pi CLI Session 参数](https://pi.dev/docs/latest/cli)、[RPC `get_state`](https://pi.dev/docs/latest/rpc-commands)。

进程异常退出后，用户下次主动操作时可以从已保存路径重新启动；Adapter 不接管失联的旧进程，也不自动重放中断的 prompt。Agent 角色指令和记忆通过启动参数中的追加系统提示传入，见[数据存储](04-data-storage.md#agent-记忆文件)。

### RPC 命令与事件

- Adapter 为需要应答的命令分配 request ID，以 ID 关联 `response`；命令成功仅表示被接受、排队或处理，不代表 Agent 工作完成。发 prompt 前先建立该运行时的事件订阅，以免漏掉很快结束的事件。
- Host 保证同一 Session 一次只有一个活动 prompt；其余用户消息留在 Host 队列，不使用 Pi 的 `steer` 或 `follow_up` 作为产品队列，也不向 UI 提供原始 RPC 转发。
- `message_update.assistantMessageEvent.type = text_delta` 只生成实时内容。完成的 assistant `message_end.message` 是最终内容依据；可能有多轮工具调用或重试，必须等 `agent_settled` 再判定整个执行完成，不能在 `agent_end` 或第一条 `message_end` 时提前落最终结果。[Pi 事件流](https://pi.dev/docs/latest/json)、[RPC 生命周期](https://pi.dev/docs/latest/rpc)。
- 已知事件转换成 Host 的运行开始、文本增量、完成、取消与失败信号；格式有效的未知事件可以忽略或限速记录类型名，不能使解析器崩溃。原始 Pi JSON、工具轨迹和 stderr 不成为客户端消息契约。

### 错误、取消与关闭

Adapter 至少区分 `PiNotFound`、`SpawnFailed`、`StdioUnavailable`、`RpcRejected`、`RpcTimeout`、`InvalidJsonl`、`SessionUnavailable` 和 `ProcessExited`。对客户端只暴露 Host 定义的稳定错误码；日志和错误不包含密钥、环境变量、完整 prompt、协议正文或原始 stderr。

Pi 退出时，监督者结束全部待应答请求，并且只向 Host 报告一次退出或运行失败。已接受的 prompt 若未到 `agent_settled` 就退出，结果属于中断/未知，不能从已收到的 delta 推断成功或自动重试。RPC 超时后若无法确认 Pi 是否仍在执行，先终止该进程并将本轮标为中断，不能在同一 Session 继续提交下一条 prompt。用户取消活动执行时，先清除 Pi 内部待处理队列，再发 `abort` 并有界等待其变为空闲；超时则终止进程、清理请求与任务。Host 自己尚未提交给 Pi 的排队消息在 Host 队列中取消，不借 Pi 的内部队列处理。[Pi `abort` 与 `clear_queue`](https://pi.dev/docs/latest/rpc-commands)。

显式退出应用时，Host 先停止接收新执行，再关闭每个子进程的 stdin 请求有序退出；超过期限才终止进程，并等待所有读写与监督任务收尾。窗口隐藏不触发这条退出路径。[Pi RPC 关闭流程](https://pi.dev/docs/latest/rpc)。

`clear` 不把旧 Session 的消息复制进新 Session。Host 保留旧文件引用以标识历史上下文，Adapter 关闭旧进程；新段第一次执行时启动新进程并把 Pi 返回的 Session 路径交回 Host。Pi 官方 RPC 虽支持 `new_session`，首发采用进程回收和按需启动，使数据库中的上下文切换先确定，再建立新 Session。[Pi RPC 命令文档](https://pi.dev/docs/latest/rpc-commands)。

后续群聊中，一个 Conversation 可以有多个 Agent 的独立 Session；Adapter 仍只执行 Host 指定的 Agent、输入文本和 Session。Host 负责把共享时间线里该 Agent 尚未看到的人类及其他 Agent 消息按序组装进本轮输入；`@all` 也不让多个 Agent 共用一个 Pi Session。群聊 `clear` 后，Adapter 回收该群所有 Agent 的旧进程，后续分别创建新 Session。目标映射见[数据存储](04-data-storage.md#群聊扩展v2-目标设计)。

Pi RPC 通过受管子进程的 stdio 通信；Host 失去该连接后，本设计仅从 Pi 保存的 Session 文件重新启动，不尝试重新接管旧进程。[Pi RPC 文档](https://pi.dev/docs/latest/rpc)、[Pi Session 文档](https://pi.dev/docs/latest/sessions)。

## 关键流程

```text
Host 为 Conversation 当前 Context Segment 取得对应 Pi Session
  → Pi Runtime Adapter 启动或复用该 Session 的 RPC 进程并校验 get_state
  → Adapter 先订阅事件，再发送 prompt，将 delta 与最终结果交回 Host
  → Host 保存最终响应；Adapter 按进程保留策略继续保留或回收 RPC 进程
```

## 实现验收

- 用假 Pi 子进程覆盖 JSONL 分帧、交错 response/event、request ID、未知事件、stderr 大量输出、异常退出与超时；验证 stdout reader 不受慢客户端阻塞。
- 验证 prompt 接受后仍须等 `agent_settled`，并从最终 assistant `message_end` 提取内容；同一 Session 不并发提交两个 prompt。
- 在 macOS 桌面进程中验证 GUI 环境发现 Pi、Session 首次持久化与 `--session` 恢复、流式输出、取消、隐藏窗口后继续执行和显式退出回收进程。真实 Pi 与模型供应商相关的验证单独记录环境限制。

## 设计决策与权衡

| 决策问题 | 选择 | 放弃的替代方案 | 理由 | 变更条件 |
|---|---|---|---|---|
| 如何把 Pi 集成到 Rust Host？ | Host 调用用户预装的 Pi CLI RPC 子进程。 | 在桌面应用中直接嵌入 TypeScript SDK、由 AgentChat 安装 Pi、接入自研 Agent Runtime。 | RPC 适合 Rust Host 的语言边界与子进程隔离；Pi SDK 需要 Node/Bun 运行时。 | 官方 RPC 能力不足或维护成本高于 SDK 方案时。 |
| 模型和认证配置由谁管理？ | 复用本机 Pi CLI 的现有配置；AgentChat 不复制供应商密钥。 | 在 AgentChat 中重新实现模型供应商和凭据管理。 | 避免维护两套模型配置与凭据事实源。 | AgentChat 面向非技术用户并要求开箱即用配置时。 |
| Pi Session 与产品对话如何关联？ | 首发每个 Agent 只有一条长期 Conversation；其中每个已使用的 Context Segment 关联一个 Pi Session，`clear` 开启新段。群聊目标按参与 Agent 分段。 | 一个 Pi Session 被多个段共享、每条消息启动全新 Session、Host 复制完整 Pi 历史。 | 聊天历史持续保留，同时让用户明确重置 Pi 上下文。 | 需要不同上下文重组时。 |
| Pi 进程何时运行？ | 活跃执行期间运行；完成后保留近期使用的少量 Pi 进程；应用显式退出时关闭所有受管进程。 | 每条消息都新建后立即退出、所有会话进程永久驻留、脱离 Host 运行 Pi RPC。 | 兼顾会话复用与本机资源回收；RPC 没有脱离后重新连接的协议。 | 进程资源实测或后台执行要求改变时。 |
| 如何解释“工作区限制”？ | Agent 工作目录只作为 Pi 的默认上下文；Pi 工具以当前 macOS 用户权限运行，不提供工作区外访问的强制阻断。 | 将 `cwd` 视为沙箱、首发实现 OS 级隔离、默认逐工具审批。 | Pi 官方安全说明明确工作目录不限制 Bash 对其他可访问路径的访问；用户接受本机用户权限模型。 | 安全承诺要求 Pi 无法触及工作目录外的文件或资源时。 |

Pi 安全模型的事实边界见 [Pi Security 文档](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/security.md)：Pi 的工作目录不是 OS 权限边界，Pi 工具继承启动进程的系统权限。
