# AgentChat 系统架构文档（已废弃）

> **Superseded by**: [架构总览](../00-overview.md)

本文档保留为历史记录，不代表当前架构决策。当前设计以架构总览及其专题文档为准。

版本：v0.1
状态：设计稿
适用范围：个人 Agent 通讯中心、多端访问、后台任务

## 1. 文档目的

本文描述 AgentChat 如何实现《产品蓝图》定义的目标。产品蓝图回答“做什么、为谁做、创造什么价值”；本文回答“由哪些系统组成、状态归谁、如何通信、如何演进”。

本文不定义具体视觉设计，也不把未来的团队协作、Agent 市场和公共社交网络作为第一阶段架构前提。

## 2. 架构原则

1. **Local-first：** 用户数据、Agent 状态和任务记录默认归本地 Host 管理。
2. **Host 是事实来源：** 所有客户端都访问同一份会话、消息和任务状态；客户端缓存不可作为最终事实来源。
3. **Agent 与会话分离：** Agent 是长期身份，会话是交互容器，任务是可独立运行的执行单元。
4. **事件优先：** 消息、工具调用、任务进度和错误都以可追踪事件表达。
5. **配置时确定信任：** Agent 在配置阶段确定系统上下文、能力和资源范围；聊天过程按既定配置执行，不建立独立的交互确认工作流。
6. **可恢复：** 长任务、断线、多端重连和模型失败不能破坏已有消息与执行记录。
7. **先简单后分布式：** 第一阶段优先单机进程和局域网访问，产品验证后再引入远程中继或云端服务。

## 3. 总体架构

```text
┌─────────────────────────────────────────┐
│              Agent Host                 │
│                                         │
│  Host API / Session Gateway             │
│  Conversation & Event Store             │
│  Pi Agent Adapter ───────────────┐      │
│  Task Scheduler / Run Manager    │      │
│  Auth / Policy / Audit           │      │
│  Secret Store                    │      │
└────────────────────┬────────────┼──────┘
                     │            │
          ┌──────────┼──────────┐ │
          │          │          │ │
     Desktop UI   Mobile UI   Web UI
                                  │
                          ┌───────▼────────┐
                          │   Pi Runtime   │
                          │  Coding Agent  │
                          └────────────────┘
```

### 3.1 Host

Host 是运行在用户本地电脑上的长期进程，负责：

- 保存用户、设备、Agent、会话、消息和任务
- 编排 Pi Agent Runtime 的会话
- 保存 Pi 运行状态和 AgentChat 领域状态
- 处理设备身份、访问策略和必要的操作限制
- 向已关联设备推送事件
- 在客户端断开后继续执行后台任务

Host 不应绑定某一个 UI 窗口。桌面窗口关闭后，Host 是否继续运行应由产品生命周期策略决定；第一阶段可与桌面应用同进程，后续再拆为独立后台进程。

### 3.2 客户端

客户端负责展示和交互：

- 会话列表与消息流
- Agent 状态
- 任务进度
- 文件选择和上传
- 工具交互和必要的用户补充输入
- 本地草稿与临时缓存

客户端不能直接写入核心数据库，也不能绕过 Host 直接调用 Agent 工具。

### 3.3 当前项目映射

当前项目使用 Tauri 2、React 19、TypeScript 和 Rust。建议保留 Tauri 作为桌面客户端和本地 Host 的宿主边界：

- React：桌面 UI、会话交互和状态展示
- Rust/Tauri：窗口、系统能力、生命周期、密钥和本地 Host 启动
- Host Domain：会话、消息、Agent、任务和访问策略等产品领域逻辑
- Pi Adapter：连接外部 Pi Agent Runtime；AgentChat 不重新实现 Coding Agent
- AgentChat Domain：只负责产品层的 Agent、会话、任务、访问策略和多端状态

## 4. 领域模型

```text
User
 ├── Device
 ├── Agent
 ├── Conversation ── Message / Event
 └── Task ── Run ── ToolCall
```

### 4.1 核心实体

- **User：** 本地安装实例的用户身份；第一阶段默认单用户。
- **Device：** 已配对的客户端，拥有设备身份、名称、最后在线时间和访问范围。
- **Agent：** 身份、系统指令、能力声明、记忆范围、工具权限和生命周期的集合；上下文与权限在配置 Agent 时确定。
- **Conversation：** 用户与一个或多个 Agent 的长期交互容器。
- **Message：** 用户消息、Agent 消息、系统消息和事件消息的统一载体。
- **Task：** 从对话中产生的可跟踪工作，拥有状态、进度、输入和输出。
- **Run：** Agent 对一次消息或任务的执行实例。
- **ToolCall：** 一次具体工具调用及其输入、结果和错误。
- **AuditEvent：** 重要状态变化和安全相关行为的可追溯记录。

### 4.2 状态归属

| 状态       | 归属            | 客户端职责           |
| ---------- | --------------- | -------------------- |
| Agent 配置 | Host            | 展示和编辑           |
| 消息历史   | Host            | 展示、分页和本地缓存 |
| Run 状态   | Host            | 展示实时状态         |
| Task 状态  | Host            | 展示、取消和重试     |
| 输入草稿   | 客户端          | 本地保存和恢复       |
| 已读位置   | Host 按设备记录 | 上报和展示           |

## 5. Pi Agent Runtime 集成

AgentChat 不自研 Coding Agent。Pi 是 Coding Agent 的执行核心，负责推理、代码理解、文件修改、命令执行和工具调用；AgentChat 通过 Pi Adapter 使用 Pi，并将其运行过程映射为自己的会话、任务和事件。

### 5.1 职责边界

Pi 负责：

- Coding Agent 的推理和上下文处理
- Plan / Act 等执行模式
- 代码和工作区理解
- 文件编辑与命令执行
- Coding Agent 工具调用
- Pi 自身的会话恢复和执行细节

AgentChat 负责：

- Agent 的产品身份和配置
- 会话、消息和任务
- 多端访问和通知
- 产品级访问策略和工具边界
- Pi 会话与 AgentChat 会话的映射
- 统一的状态展示、审计和错误反馈

AgentChat 不在 UI 组件、Tauri command 或领域服务中重新实现 Agent Loop、代码编辑器 Agent 或工具执行器。

### 5.2 Pi Adapter

Pi Adapter 是 AgentChat 与 Pi 之间唯一的集成边界。它负责：

- 启动、连接和关闭 Pi Runtime
- 创建、恢复和销毁 Pi 会话
- 将 AgentChat 用户消息转换为 Pi 请求
- 将 Pi 的流式输出转换为 AgentChat 事件
- 转换 Pi 的工具调用、进度、完成和错误事件
- 将取消、继续和用户补充输入传回 Pi
- 保存 AgentChat Run 与 Pi Session 的关联

Pi 的具体接入方式应以所选 Pi 版本提供的稳定接口为准，可以是 RPC、SDK、子进程协议或其他 Agent 接口；架构层只依赖 Pi Adapter，不让产品领域模型绑定 Pi 的内部数据结构。

### 5.3 AgentChat Run 生命周期

AgentChat 维护自己的统一 Run 生命周期：

```text
accepted
  → preparing
  → generating
  → tool_calling
  → running_task
  → completed / failed / cancelled
```

每个 Run 必须具备：

- 唯一 ID
- 所属会话或任务
- 触发来源
- Agent Runtime 类型和版本信息
- Pi Session 引用
- 输入消息引用
- 产生的事件序列
- 当前状态和错误信息
- 取消与恢复能力

Pi 不直接操作 AgentChat UI；Pi Adapter 将 Pi 事件转换为 AgentChat 领域事件，再由 Host API 分发给客户端。

## 6. 消息与事件模型

消息和执行事件应统一进入有序事件流。事件类型至少包括：

- message.created
- message.delta
- message.completed
- run.started
- run.status_changed
- tool.call_started
- tool.call_completed
- interaction.requested
- interaction.resolved
- task.progressed
- task.completed
- task.failed

客户端连接后先获取指定游标之后的历史事件，再订阅实时事件。这样可以覆盖客户端短暂断线、手机切换网络、桌面端重启和流式回复中断。

实时事件只负责及时传递，最终状态以 Host 持久化结果为准。

## 7. Host API 与连接方式

### 7.1 第一阶段

第一阶段采用本机 Host 加局域网访问：

- 桌面端内部通过 Tauri command 或本地 IPC 访问 Host
- 手机端通过局域网安全连接访问 Host
- Host 提供请求响应接口和实时事件通道
- 新设备通过二维码完成配对

协议层需要支持：

- 会话和消息查询
- 发送消息
- 流式事件
- 创建、暂停、取消任务
- 提交用户交互结果
- 文件上传和下载
- 设备心跳和连接状态

具体协议实现可以在实现阶段选择 HTTP + SSE；若双向实时需求增加，再统一切换为 WebSocket。协议抽象不应暴露数据库结构。

### 7.2 远程访问演进

远程访问不应直接把 Host 端口暴露到公网。后续可增加独立的安全中继或加密隧道，但不改变 Host 内部领域模型和客户端 API。

## 8. 数据存储

第一阶段建议使用本地 SQLite 作为结构化事实存储，文件和大对象使用独立的本地存储目录，数据库只保存引用和元数据。

建议的逻辑表：

- users
- devices
- agents
- conversations
- conversation_members
- messages
- events
- tasks
- runs
- tool_calls
- memories
- audit_events

设计要求：

- 消息和事件采用追加为主的方式保存
- 任务和 Run 保存当前状态，同时保留状态变化事件
- 删除优先采用可审计的软删除语义
- 数据库备份和导出必须不依赖 UI
- Agent 记忆必须标记来源、范围和更新时间

## 9. 多端同步

同步以“Host 事件游标”为基础，而不是以客户端时间戳猜测差异：

```text
客户端连接
  → 提交 device_id + last_event_cursor
  → Host 返回缺失事件
  → 客户端应用事件
  → Host 推送后续实时事件
```

冲突处理原则：

- 消息由 Host 分配顺序和 ID
- 同一消息的发送请求必须支持幂等键
- 任务取消等命令必须返回最终状态
- 客户端重复提交不能产生重复任务
- 客户端只允许修改自己可访问范围内的字段

## 10. 身份与安全

安全策略以 Agent 配置为主要入口，只保留产品确实需要的边界：

```text
设备身份与配对凭据
  → 访问 Host 和会话数据
Agent 配置（上下文 / 能力 / 权限）
  → 约束 Agent / Tool 可访问的资源范围
```

第一阶段需要保护：

- 本地数据库
- 模型供应商密钥
- 外部连接器凭据
- 文件访问范围
- 工具可访问的资源范围
- 设备配对凭据

聊天场景不设置独立的确认队列、确认实体或确认状态机。Agent 已在配置阶段获得所需的上下文和权限，聊天过程直接按配置执行；如果需要用户补充信息或选择参数，使用普通交互消息表达，并由当前会话继续处理。Host 只负责校验既定配置、限制路径和资源范围、保护凭据，不在每次工具调用前重新发起授权流程。

密钥不进入前端状态、不写入普通日志、不随消息同步到其他设备；桌面端使用系统安全存储能力保存本地凭据。

## 11. 文件与附件

文件处理分为三类：

1. 会话附件：用户主动发送给 Agent 的文件。
2. Agent 产物：Agent 生成的报告、导出文件或中间结果。
3. 工具资源：Agent 在 Host 允许的资源范围内访问的本地文件。

文件应有独立的资源 ID、来源、所属会话或任务、访问范围和删除状态。消息中只引用文件资源，不直接承载大文件内容。

## 12. 技术选型边界

| 领域                 | 第一阶段建议                          | 选择理由                                       |
| -------------------- | ------------------------------------- | ---------------------------------------------- |
| 桌面容器             | Tauri 2                               | 当前项目基础，适合系统能力和低资源桌面应用     |
| UI                   | React 19 + TypeScript                 | 当前项目基础，适合复杂会话交互                 |
| 产品 Host            | Rust 宿主内的 AgentChat 领域模块      | 承载身份、会话、任务、访问策略和多端状态       |
| Coding Agent Runtime | Pi                                    | 复用成熟的 Coding Agent，不重复研发 Agent Loop |
| Pi 集成              | Pi Adapter                            | 隔离 Pi 的 RPC、SDK 或进程协议变化             |
| 结构化存储           | SQLite                                | 单机可靠、可备份，适合 local-first             |
| 实时事件             | HTTP + SSE 起步                       | 服务端单向事件流足以覆盖消息和任务更新         |
| 文件存储             | 本地应用数据目录                      | 避免把大文件塞入消息数据库                     |
| 密钥存储             | 系统安全存储 / Tauri Stronghold       | 不让密钥进入普通配置和前端状态                 |
| 前端缓存             | React Query + Zustand 按职责使用      | 区分服务端数据与 UI 瞬时状态                   |
| 测试                 | Vitest、Rust 单元测试、协议级集成测试 | 覆盖领域逻辑、状态机和跨端契约                 |

这些是第一阶段的实现建议，不是对未来云端架构的永久限制。

## 13. 进程与生命周期

第一阶段可以采用：

```text
Tauri Application
├── React Renderer
├── Tauri Commands / Events
├── Host Domain Services
├── Pi Adapter
└── SQLite / File Store / Secret Store
             │
             └── Pi Agent Runtime
```

Pi Runtime 可以作为由 Host 管理的独立进程或外部 Agent 服务运行。AgentChat 不把 Pi 的内部执行模块复制进 Tauri；当后台任务、远程访问或资源隔离成为明确需求后，可以将 Pi Runtime 与 Host 进一步隔离：

```text
Desktop UI ── Host API ── AgentChat Host
                         ├── Product Domain
                         ├── Pi Adapter ── Pi Runtime
                         ├── Scheduler
                         └── Data Store
```

拆分的触发条件应是可观测的产品需求，而不是预先为分布式架构增加复杂度。

## 14. 分阶段实施

### A. 单机闭环

- Agent 配置
- 会话和消息持久化
- Pi Adapter 最小接入
- Pi 会话创建和消息发送
- Pi 流式回复转换
- Run 状态
- Pi 工具事件和交互事件展示

### B. 任务化

- Task 和 Run 模型
- 后台任务
- 取消、重试和失败恢复
- 任务通知
- 事件回放
- Pi Session 恢复和生命周期管理

### C. 局域网多端

- Host API
- 设备配对
- 事件游标同步
- 手机端基础客户端
- 多设备已读和连接状态

### D. 远程与共享

- 安全远程访问
- 多用户和工作区
- Agent 共享与访问范围隔离
- 更细粒度审计

## 15. 架构验收标准

第一阶段架构完成后，至少应验证：

1. 关闭并重新打开桌面端后，会话、消息和任务状态可恢复。
2. Agent 回复流中断后，客户端可以通过事件游标补齐最终状态。
3. 同一发送请求重试不会生成重复消息或重复任务。
4. Agent 调用工具时只能访问 Host 明确允许的资源范围。
5. 桌面端退出后，已启动的任务是否继续运行有明确且可验证的策略。
6. 第二个设备可以配对、查看历史并继续发送消息。
7. 多端同时操作时，Host 能提供一致的最终状态。
8. 重要操作可以从审计记录中追溯到用户、设备、Agent 和 Run。

## 16. 关键未决问题

以下问题会影响后续详细设计，但不阻塞产品架构成立：

- Host 是否必须在桌面窗口关闭后继续运行
- 第一阶段是否只支持局域网，还是同时需要远程访问
- 模型调用是否支持本地模型
- Agent 工具是否运行在 Host 内，还是隔离为独立 Worker
- Pi 当前版本提供哪一种稳定集成接口，以及其会话、事件和交互能力
- Pi Session 是否由 Pi 持久化、由 AgentChat 持久化，还是采用双向引用
- AgentChat 的资源边界如何映射为 Pi 的工具授权
- 文件和记忆是否需要用户可见、可编辑、可导出
- 何时从单用户模型演进到家庭或团队工作区

## 17. 架构结论

AgentChat 的核心不是“重新实现一个 Coding Agent”，而是建立一个本地优先的 Agent Host，并通过 Pi Adapter 使用 Pi：

```text
客户端负责交互
Host 负责产品事实与安全边界
Pi 负责 Coding Agent 执行
Pi Adapter 负责协议转换
事件流负责同步与恢复
任务系统负责持续工作
审计系统负责可追溯性
```

只要这些边界保持稳定，桌面端、手机端、网页端以及未来的远程 Host 都可以逐步增加，而不会改变产品的核心模型。
