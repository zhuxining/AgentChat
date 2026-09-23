# Pi Runtime Adapter

> **Status**: `active`

## 职责定位

Pi Runtime Adapter 负责启动和管理 Pi CLI RPC、关联 Conversation 与 Pi Session 并转换执行结果，不负责 AgentChat 消息存储、桌面 UI 或 OS 级沙箱。

## 核心原则

- **Pi 保有执行历史：** Pi Session 文件由 Pi 创建和恢复；Host 只使用对应 Session，不复制工具调用明细。
- **每个 Conversation 使用独立上下文：** 一个 RPC 进程只承载一个当前 Pi Session；不同 Conversation 并发时使用不同 RPC 进程。
- **失败不自动重放：** Host 进程重启后可重新打开已持久化 Pi Session，但不把尚未完成的执行当作可恢复任务自动续跑。

## 边界与实体

### 输入

- **Pi 执行请求：** Host Runtime 提供用户消息、Agent 工作上下文和 Conversation 对应的 Pi Session 引用。
- **取消请求：** Host Runtime 请求终止当前 Pi 执行。
- **进程生命周期指令：** Host Runtime 决定创建、保留、回收或关闭 Pi RPC 进程。

### 输出

- **流式 delta：** Pi 生成的临时内容，交给 Host 实时转发，不由 Adapter 持久化。
- **最终响应：** Pi 完成后的 Agent 响应或结果错误，交回 Host Runtime 保存。
- **运行信号：** Pi 的接受、运行、完成、取消或失败信号，仅用于 Host 当前进程的临时状态。

### 核心实体

- **Pi Session：** Pi 拥有并保存的 Coding Agent 对话上下文；Host 为每个 AgentChat Conversation 关联一个 Pi Session。

Pi RPC Process 是 Adapter 管理的运行资源，不是独立业务实体。一个进程只有一个当前活动 Session；不同 Conversation 并发执行时，Adapter 管理各自的 RPC 进程，并保留近期使用的进程。

Pi 官方资料确认 RPC 支持命令、事件流、Session 切换和从持久化 Session 恢复；RPC 不支持重新连接到一个已脱离 Host 的活动进程。参见 [Pi RPC 文档](https://pi.dev/docs/latest/rpc) 与 [Pi Session 文档](https://pi.dev/docs/latest/sessions)。

### 错误边界

Pi Runtime Adapter 将进程启动、退出和 RPC 协议错误转换为 Host 可处理的运行错误；模型供应商错误和 Pi 原始协议内容不直接成为客户端 API 契约。

## 关键流程

```text
Host 为 Conversation 取得对应 Pi Session
  → Pi Runtime Adapter 启动或复用该 Session 的 RPC 进程
  → Adapter 转发用户消息并将 delta 与最终结果交回 Host
  → Host 保存最终响应；Adapter 按进程保留策略继续保留或回收 RPC 进程
```

## 设计决策与权衡

| 决策问题 | 选择 | 放弃的替代方案 | 理由 | 变更条件 |
|---|---|---|---|---|
| 如何把 Pi 集成到 Rust Host？ | Host 调用用户预装的 Pi CLI RPC 子进程。 | 在桌面应用中直接嵌入 TypeScript SDK、由 AgentChat 安装 Pi、接入自研 Agent Runtime。 | RPC 适合 Rust Host 的语言边界与子进程隔离；Pi SDK 需要 Node/Bun 运行时。 | 官方 RPC 能力不足或维护成本高于 SDK 方案时。 |
| 模型和认证配置由谁管理？ | 复用本机 Pi CLI 的现有配置；AgentChat 不复制供应商密钥。 | 在 AgentChat 中重新实现模型供应商和凭据管理。 | 避免维护两套模型配置与凭据事实源。 | AgentChat 面向非技术用户并要求开箱即用配置时。 |
| Pi Session 与产品对话如何关联？ | 每个 Conversation 关联一个 Pi Session；Pi 保存详细执行上下文，Host 持久化产品消息与最终结果。 | 一个 Pi Session 被多个 Conversation 共享、每条消息启动全新 Session、Host 复制完整 Pi 历史。 | 保持对话上下文连续且互相隔离，同时明确两侧的数据所有权。 | 需要多 Agent 同聊、跨对话共享上下文或独立执行记录时。 |
| Pi 进程何时运行？ | 活跃执行期间运行；完成后保留近期使用的少量 Pi 进程；应用显式退出时关闭所有受管进程。 | 每条消息都新建后立即退出、所有会话进程永久驻留、脱离 Host 运行 Pi RPC。 | 兼顾会话复用与本机资源回收；RPC 没有脱离后重新连接的协议。 | 进程资源实测或后台执行要求改变时。 |
| 如何解释“工作区限制”？ | Agent 工作目录只作为 Pi 的默认上下文；Pi 工具以当前 macOS 用户权限运行，不提供工作区外访问的强制阻断。 | 将 `cwd` 视为沙箱、首发实现 OS 级隔离、默认逐工具审批。 | Pi 官方安全说明明确工作目录不限制 Bash 对其他可访问路径的访问；用户接受本机用户权限模型。 | 安全承诺要求 Pi 无法触及工作目录外的文件或资源时。 |

Pi 安全模型的事实边界见 [Pi Security 文档](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/security.md)：Pi 的工作目录不是 OS 权限边界，Pi 工具继承启动进程的系统权限。
