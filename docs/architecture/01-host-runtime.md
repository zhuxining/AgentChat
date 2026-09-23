# Host Runtime

> **Status**: `active`

## 职责定位

Host Runtime 负责 AgentChat 的会话、消息、最终结果、本地持久化与执行队列，不负责 Pi 推理、移动端界面或工具的 OS 级隔离。

## 核心原则

- **只持久化产品结果：** Host 保存用户消息和 Agent 最终响应，不复制 Pi 的工具调用轨迹与 token delta。
- **顺序由 Host 管理：** 同一 Conversation 的输入按序进入 Pi；跨 Conversation 的并发由 Host 限制，超出容量的输入等待执行。
- **不假装恢复运行状态：** Host 不持久化 Run 状态；启动后没有最终响应的用户消息只表示结果未知，不触发自动重跑。

## 边界与实体

### 输入

- **消息提交：** 客户端请求在指定 Conversation 中发送用户消息。
- **会话查询：** 客户端请求读取 AgentChat 持久化的 Conversation 与 Message。
- **Pi 执行结果：** Pi Runtime Adapter 返回流式 delta、最终响应或运行错误。
- **设备上下文：** Device Access 提供已认证设备身份，供 Host 校验访问范围。

### 输出

- **消息结果：** 返回 Host 保存的用户消息和最终 Agent 响应。
- **实时内容：** 将执行中的 delta 与临时状态交给 Device Access 推送，不作为持久化历史。
- **Pi 执行命令：** 将消息、Conversation 对应的 Pi Session、取消请求交给 [Pi Runtime Adapter](02-pi-runtime.md)。

### 核心实体

- **Agent：** 用户配置的角色，拥有产品身份、Pi 工作上下文及模型选择所引用的 Pi 配置。
- **Conversation：** 归属于一个 Agent 的持续对话，映射到该 Agent 的一个 Pi Session。
- **Message：** 用户输入或 Agent 最终响应，由 Host 持久化并按 Conversation 展示。

Host 使用 SQLite 保存上述产品消息和最终结果。必要的用户、Agent、Conversation 与设备关联信息仅用于识别和授权数据，不保存完整 Run 状态、逐 token delta 或工具调用历史。Host 不实现应用层静态加密、备份或导出。

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

## 设计决策与权衡

| 决策问题 | 选择 | 放弃的替代方案 | 理由 | 变更条件 |
|---|---|---|---|---|
| 产品消息用何种本地存储？ | SQLite 作为 AgentChat 消息与结果的持久化存储。 | 以 JSON 文件或 Pi 会话文件作为产品历史主存储。 | SQLite 支持本机多客户端共享消息读取与事务写入；Pi 会话格式继续由 Pi 管理。 | 产品数据需要独立数据库服务或多 Host 写入时。 |
| Host 是否持久化 Run、Task 和完整事件？ | 首发不创建 Task 实体，不保存 Run 状态或完整执行事件；只保存用户消息和最终响应/结果。 | 持久化所有 Run 状态与事件、复制 Pi 工具明细、每个执行创建 Task。 | 减少重复事实源与恢复状态机；异常后通过无结果消息提示用户判断，不自动重放。 | 需要后台任务追踪、审计或精确恢复时。 |
| 流式 delta 是否写入存储？ | delta 仅实时传输；Host 持久化最终结果。 | 逐 token 持久化或定期批量保存 delta。 | 重连展示最终消息即可，不需要回放生成过程。 | 产品需要精确回放或训练分析流式轨迹时。 |
| 桌面 UI 关闭后 Host 如何运行？ | Tauri 窗口隐藏后 Host 留在同一应用进程的菜单栏后台；显式退出终止 Pi 进程。 | 关闭窗口时终止 Host、单独安装系统服务。 | 后台任务和局域网连接需要 Host 存活；首发不需要独立 daemon。 | Host 需要独立于桌面应用更新、部署或长期运行时。 |
| 并发消息如何调度？ | Host 串行处理同一 Conversation 的输入，对不同 Conversation 采用有界并发，超出容量时排队。 | 无界启动 Pi 进程、拒绝超额消息、同一 Conversation 并行执行。 | Pi Session 是单一活动上下文；队列保持对话顺序并限制本机资源消耗。 | 实测资源使用或交互需求要求调整调度策略时。 |
| 如何保护本地消息内容？ | AgentChat 不提供应用层静态加密、备份或导出。 | 首发引入应用密钥、加密数据库、备份和恢复流程。 | 用户选择先保存本机消息与最终结果，不承担密钥恢复和备份产品复杂度。 | 用户要求设备间安全迁移或应用层数据保护时。 |
