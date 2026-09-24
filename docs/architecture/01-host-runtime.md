# Host Runtime

> **Status**: `active`（架构决策；Host Runtime 尚未落地）。

## 职责定位

Host Runtime 负责 AgentChat 的角色配置、独立记忆、会话、消息、最终结果、本地持久化与执行队列，不负责 Pi 推理、移动端界面或工具的 OS 级隔离。

## 核心原则

- **执行记录最小化：** 执行过程只保存用户消息、Agent 最终响应或结果错误，不复制 Pi 的工具调用轨迹与 token delta。
- **顺序由 Host 管理：** 首发同一单聊 Conversation 的输入按序进入 Pi；最多同时运行两个 Pi 执行，超出容量的输入留在 Host 队列等待。该数值是初始资源上限，后续按实测调整。
- **不假装恢复运行状态：** Host 不持久化 Run 状态；启动后没有最终响应的用户消息只表示结果未知，不触发自动重跑。

## 边界与实体

### 输入

- **消息提交：** 客户端请求在指定 Conversation 中发送用户消息。
- **清理上下文：** 客户端对该 Agent 的唯一 Conversation 执行 `clear`，保留聊天消息并切换到新 Context Segment。
- **会话查询：** 客户端请求读取 AgentChat 持久化的 Conversation 与 Message。
- **Pi 执行结果：** Pi Runtime Adapter 返回流式 delta、最终响应或运行错误。
- **设备上下文：** Device Access 提供已认证设备身份，供 Host 校验访问范围。

### 输出

- **消息结果：** 返回 Host 保存的用户消息和最终 Agent 响应。
- **实时内容：** 将执行中的 delta 与临时状态交给 Device Access 推送，不作为持久化历史。
- **Pi 执行命令：** 将消息、当前 Context Segment 对应的 Pi Session、取消与回收旧进程的请求交给 [Pi Runtime Adapter](02-pi-runtime.md)。

### 核心实体

- **Agent：** 用户配置的角色，拥有产品身份、Pi 工作上下文、独立 Markdown 记忆及模型选择所引用的 Pi 配置。
- **Conversation：** 归属于一个 Agent 的唯一长期聊天；`clear` 不删除产品消息。
- **Context Segment：** Conversation 内按 `clear` 分隔的上下文段，记录对应的 Pi Session 引用。
- **Message：** 用户输入或 Agent 最终响应，由 Host 持久化并按 Conversation 展示。

Host 使用 SQLite 保存 Agent 配置、唯一 Conversation、各 Context Segment、用户消息、最终响应、结果错误与设备登记；每个 Agent 的长期记忆保存在 Host 管理的独立 Markdown 文件。Context Segment 保存 Pi Session 引用，Message 归属到其发送时的段，客户端请求 ID 用于提交重试去重。移除 Agent 时隐藏其聊天并保留历史与文件关联。具体数据归属见[数据存储](04-data-storage.md)。Host 不保存完整 Run 状态、逐 token delta 或工具调用历史，也不实现应用层静态加密、备份或导出。

### 错误边界

Host Runtime 校验会话与消息操作，并将存储、队列和 Pi Adapter 错误映射为稳定的产品错误；底层 SQLite 和 Pi 协议错误不直接作为客户端契约。

## 关键流程

```text
客户端提交消息
  → Host 保存用户消息并将其加入 Conversation 顺序队列
  → Pi Runtime Adapter 执行消息并实时返回 delta
  → Host 仅保存最终响应或结果错误，并返回给客户端
```

Host 运行期间维护 Run 状态和并发队列。应用崩溃后，Host 不恢复 Run 状态；若用户消息没有对应的最终响应，客户端显示“可能未完成”，由用户决定是否重新发送。

Host 在用户消息入库后排队，并由全局两个执行槽调度。每个 Context Segment 同时只发送一个 prompt；Host 不把待执行消息交给 Pi 的 `steer` 或 `follow_up` 队列。Pi 的 `prompt` 成功应答只是接受信号，最终结果必须等 Adapter 报告 `agent_settled` 后提交。已入库但尚未提交给 Pi 的消息被用户取消时，Host 将其从内存队列移除并写入稳定的取消结果；活动执行交由 Adapter 有界取消。Pi 进程或 Host 意外中断后，不自动恢复或重放没有结果的消息。Adapter 的协议与取消边界见[Pi Runtime Adapter](02-pi-runtime.md#rpc-命令与事件)。

`clear` 仅在该 Conversation 没有运行中或排队消息时可执行；Host 在同一事务中关闭旧 Context Segment 并开启新段，旧消息仍按原顺序展示。用户须等待队列空闲或先取消相关执行。新段的 Pi Session 在下一条消息到来时创建，旧 Session 文件保留。

后续群聊扩展中，Host 为每条群聊维护共享消息序列，并为被 `@` 的 Agent 建立独立 Dispatch；`@all` 在发送时展开为所有活跃成员。每个 Agent 的 Pi 上下文各自推进，但全局两个执行槽仍由 Host 统一分配。群聊 `clear` 是整条 Conversation 的操作：只在所有 Dispatch 空闲时统一开启新一代上下文。具体目标表、补读游标与迁移见[数据存储](04-data-storage.md#群聊扩展v2-目标设计)。

## 设计决策与权衡

| 决策问题 | 选择 | 放弃的替代方案 | 理由 | 变更条件 |
|---|---|---|---|---|
| 产品消息用何种本地存储？ | SQLite 作为 AgentChat 消息与结果的持久化存储。 | 以 JSON 文件或 Pi 会话文件作为产品历史主存储。 | SQLite 支持本机多客户端共享消息读取与事务写入；Pi 会话格式继续由 Pi 管理。 | 产品数据需要独立数据库服务或多 Host 写入时。 |
| Host 是否持久化 Run、Task 和完整事件？ | 首发不创建 Task 实体，不保存 Run 状态或完整执行事件；只保存用户消息和最终响应/结果。 | 持久化所有 Run 状态与事件、复制 Pi 工具明细、每个执行创建 Task。 | 减少重复事实源与恢复状态机；异常后通过无结果消息提示用户判断，不自动重放。 | 需要后台任务追踪、审计或精确恢复时。 |
| 流式 delta 是否写入存储？ | delta 仅实时传输；Host 持久化最终结果。 | 逐 token 持久化或定期批量保存 delta。 | 重连展示最终消息即可，不需要回放生成过程。 | 产品需要精确回放或训练分析流式轨迹时。 |
| 桌面 UI 关闭后 Host 如何运行？ | Tauri 窗口隐藏后 Host 留在同一应用进程的菜单栏后台；显式退出终止 Pi 进程。 | 关闭窗口时终止 Host、单独安装系统服务。 | 后台任务和局域网连接需要 Host 存活；首发不需要独立 daemon。 | Host 需要独立于桌面应用更新、部署或长期运行时。 |
| 并发消息如何调度？ | 首发单聊按 Conversation 串行，初始全局最多两个 Pi 执行，超出容量时排队；群聊目标按参与 Agent 串行。 | 无界启动 Pi 进程、拒绝超额消息、同一 Pi Session 并行执行。 | Pi Session 是单一活动上下文；队列保持对话顺序并限制本机资源消耗。 | 实测资源使用或交互需求要求调整调度策略时。 |
| 如何保护本地消息内容？ | AgentChat 不提供应用层静态加密、备份或导出。 | 首发引入应用密钥、加密数据库、备份和恢复流程。 | 用户选择先保存本机消息与最终结果，不承担密钥恢复和备份产品复杂度。 | 用户要求设备间安全迁移或应用层数据保护时。 |
