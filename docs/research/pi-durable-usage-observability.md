# AgentChat 阶段二用量可观测性研究

> 研究日期：2026-10-20。依据仓库锁定并安装的 `@earendil-works/pi-durable@1.3.0`、`@earendil-works/pi-ai@1.3.0` 契约和 Lorca 文档进行核对；本文只记录可观测边界，不改运行时依赖或执行路径。

## 结论

当前可可靠展示 Conversation 级及按 `provider/model` 聚合的 Token 与模型元数据计价。pi-durable 的 `UsageDoc` 保存按模型聚合的用量，但不保存请求次数或调用清单；Task 公开记录也没有完整模型调用用量。不能用助手消息数、活跃 Task 数或 Provider 包装层调用数推算准确请求数。

当前 UI 将调用次数显示为“暂不可用”是符合契约的；按模型聚合展示已从 `UsageDoc.models` 接入。精确调用次数与 Task 用量归属应等待一个能持久记录每次模型调用及其 Task 关联的公开接口，或先明确只统计哪一种较窄的调用语义。

## pi-durable 提供的数据

- `UsageState.models` 的键为 `provider/modelId`，`UsageState.tools` 的键为 Tool 名称。模型桶聚合助手消息和压缩摘要请求的 Usage；已失败或中止的模型尝试也可能计入。`tools` 桶是 Tool 返回的 Usage，没有 provider/model 身份；当前聊天页展示的是“累计模型用量”，因此不将它并入按模型 Token 或模型计价。若后续要展示 Tool 用量，应单独定义其来源、语义和金额可信度。该文档没有 request count、调用阶段、尝试 ID 或 Task ID 字段。
- Generation 通过 `Models.streamSimple()` 发起模型流；恢复和重试可以再次请求。Compaction 通过 `Models.completeSimple()` 生成摘要并有自己的重试。两类用量最终都写入同一个 Conversation `UsageDoc`，因此累计值无法区分它们。
- `Harness.inspect()` 与 `Harness.taskGraph()` 是活跃任务和提交的即时视图。Storage 虽可扫描历史 `TaskRecord`，但终态记录没有内置模型调用明细；内置 `GenerationResult` 只返回最终 `entryId`，不足以代表该 Task 的所有请求、压缩和重试。
- `GenerationHooks.beforeRequest` 会在每次请求尝试（包括恢复）前运行，`HookApi` 有 `taskId`；但 HookApi 不提供事务提交能力。`CompactionHooks.beforeCompact` 在摘要请求前运行，没有对应的请求完成钩子。仅在 Hook 或内存 Map 中计数，不能保证与响应、UsageDoc 和 Task 终态原子持久化，也无法自然覆盖 Runner 崩溃恢复。

## 为什么 Provider 包装层计数不够

pi-ai 的 Provider 接口有 `streamSimple` 等调用入口，但其签名没有 pi-durable `taskId`。在 AgentChat 现有 runtime 中包装这些入口，最多能统计“进入了 Provider 适配器多少次”：这不等于 HTTP 线上请求数，因部分 API 适配器可以在适配器内部重试；也不天然具备 Task 归属、跨 Runner 恢复后的去重或持久化语义。

即使借 `AbortSignal` 将 Hook 上下文与 Provider 调用临时关联，也属于 Host 自建的相关性约定；它没有 pi-durable 的持久提交点，不能单独成为可恢复、幂等的产品事实来源。

## 与 Lorca 文档的产品行为对照

Lorca 的 `docs/agent/harness.md` 将 `Harness.stats()` 描述为累计 Usage/Cost，并定义 `usage` 事件为一次模型调用的用量及累计值；`docs/architecture/runtime.md` 也描述完成的 Turn 会将 Usage 发给 Chat。这个参考表明“单次调用事件 + Conversation 汇总”是可用的产品形态，但 AgentChat 不能仅通过汇总 `UsageDoc` 复刻单次事件。Lorca 文档是行为参考，不代表应复制其运行时实现。

## 后续实现边界

1. **已接入：**`runner/src/harness/views.ts` 从 `UsageDoc.models` 投影各模型的 Token 与可用计价，聊天用量弹层逐模型展示；Conversation 汇总仍遵循价格数据不完整时不显示总金额的规则。
2. 精确模型调用数至少需要为每个逻辑请求持久记录稳定的调用 ID、Conversation/Task ID、阶段（生成或压缩）、provider/model、尝试序号、Usage 和结束状态，并定义取消、进程崩溃与恢复重放时的计数语义。
3. 若产品所说的“请求次数”指实际上网的 HTTP 次数，还需在 Provider transport 层定义重试与 deferred polling 的计数范围；单纯的 pi-durable Task 事件未必等于 wire request。
4. 在上述契约成立前，不从助手消息数、`TaskGraph`、时间差或 Provider 包装层推导精确次数，也不声称存在 Task 级费用拆分。

## 核对来源

- 安装包声明：`runner/node_modules/@earendil-works/pi-durable/dist/harness/usage.d.ts`、`harness/types.d.ts`、`harness/generation.d.ts`、`harness/compaction.d.ts`、`types.d.ts`。
- 执行入口：`runner/node_modules/@earendil-works/pi-durable/dist/harness/generation.js`、`harness/compaction.js`；Provider 契约：`runner/node_modules/@earendil-works/pi-ai/dist/models.d.ts`、`types.d.ts`。
- Lorca 产品参考：`/Users/zhuxining/Code/lorca/docs/agent/harness.md` 的 Stats/Events；`/Users/zhuxining/Code/lorca/docs/architecture/runtime.md` 的 Agent loop。
- AgentChat 当前投影：`runner/src/harness/views.ts` 与 `src/features/chat/chat-view.tsx`。
