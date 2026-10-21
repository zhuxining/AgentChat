# 阶段四决策门：长期记忆与例行任务

## 范围与结论

本研究核对 AgentChat 当前源码、锁定的 `@earendil-works/pi-durable` 1.3.0 类型/导出、Lorca `docs/architecture`，以及上游 `pi-durable-cloudflare` 示例。依赖锁定版本见 `bun.lock:201`，包版本见 `runner/node_modules/@earendil-works/pi-durable/package.json:2-7`。

- **Bot 级记忆有现成的存储建模方式，但没有原生 Bot 作用域。** `Document` 只定义 Session、Conversation、Task 三种 scope；Session keyed family 可以用稳定 Bot ID 作为 key，形成每 Bot 一份的文档。Bot ID 的有效性、访问隔离和产品语义仍由 AgentChat Runner 负责。
- **技术可行不代表符合当前架构。** Task 可以在 checkpoint 保存下一触发时间，用 `TaskRuntime.sleep(until)` 等待，并通过稳定 `requestId` 的 Conversation Submission 幂等接纳单次运行；但 AgentChat 仍需实现周期调度、到期判断、漏跑、暂停/恢复和取消语义。因此这个路径不符合当前“不自建 scheduler”约束，不能仅凭 pi-durable 提供 `sleep` 就视为获准。
- **按当前架构，例行任务暂不实现。** `docs/architecture/00-overview.md` 明确规定“不自建 ... scheduler”，并指出 `TaskRuntime` 是库的任务调用接口而非后台服务；`docs/architecture/01-pi-durable.md` 也要求不通过私有 scheduler 或额外队列补足公开契约。用持久 Task 保存下次触发点、循环调用 `sleep()` 并接纳重复运行，虽然复用 Harness 的执行和持久化能力，仍由 AgentChat 定义了周期调度、漏跑和恢复行为，因此属于应用自建 scheduler 的一种实现，不符合当前边界。只有上游提供公开产品级触发 API，或用户明确批准架构边界变更后，才重新评估。
- **Lorca 的 routine scheduler 是 Runner 长驻服务的一部分，依赖持久化调度状态、单 Runner 所有权和权限/健康检查。** 它适合作为产品行为参考，不是 AgentChat 可直接复用的实现或授权。
- **不引入逐次工具调用审核。** AgentChat 已确定 Bot 显式选择的 Extension/Tool 清单控制可执行能力；参数仍由工具 schema 校验。例行任务若落地，应沿用该边界，不复制 Lorca 的 Auto-review 队列。

## 1. Bot ID 记忆：Document 可承载，需由 Runner 建立语义

1.3.0 `DocumentSemantics` 的联合类型列出 Session、Conversation 与 Task，没有 Bot；`defineDoc` / `defineDocFamily` 也只提供这三种作用域（`runner/node_modules/@earendil-works/pi-durable/dist/types.d.ts:42-50`; `runner/node_modules/@earendil-works/pi-durable/dist/documents.d.ts:8-31`）。

`defineDocFamily` 是 keyed family，成员不存在时用 seed 初始化（`dist/types.d.ts:68-74`）。Session family 的读取/观察按 `key` 寻址，事务 `tx.doc` 与 `tx.retireDoc` 也接受 Session family key（`dist/session/session.d.ts:71-88`; `dist/types.d.ts:756-767`）。内部地址把 Session owner 设为 null、再把 family key 纳入身份（`dist/documents.js:20-33,41-49`）。因此可用 Session family key = 稳定 Bot ID，使每个 Bot 对应一份、跨 Conversation 共享的文档；这是 AgentChat 的键约定，不是 pi-durable 原生识别或校验 Bot ID。

该做法与当前所有 Bot 共用一个 Harness、一个 `state/runner.sqlite` 的运行形态相容；Bot ID 是 `bots/<bot-id>/` 目录名（`docs/architecture/00-overview.md:5-8`; `docs/architecture/01-pi-durable.md:18-29,89-91`; `runner/src/harness/open.ts:168-184`）。若选择 Conversation 记忆，则已有 Conversation Document 作用域可直接表达（`dist/documents.d.ts:12-15,24-27`）。

Document API 只解决持久化寻址/类型形状，不自动提供产品记忆的查看、编辑、删除界面，事实来源和更新时间、每轮注入长度限制或跨 Bot 授权校验。阶段四计划仍要求这些产品契约（`docs/plans/feature-alignment.md:39,43,46`）。

**决策门：** 可将“稳定 Bot ID 跨 Conversation 共享”定为产品作用域，并在 Runner 中把 Bot ID 作为 Session family key；若产品要求 Conversation 隔离则用 Conversation Document。开始实现前还需落实 Runner 对 Bot ID 的校验、来源/更新时间、inspect/edit/clear 入口和注入长度上限。

## 2. 当前 Harness / TaskScheduler 能做什么

### 2026-10-20 上游示例复核

上游另有 [`pi-durable-cloudflare` 示例](https://github.com/earendil-works/pi-durable-cloudflare)，展示一次性与重复 follow-up。它在应用的 `schedule.ts` 中定义频率、时区、下次触发时间和稳定请求 ID，再由 durable Task 调用 `runtime.sleep(runAt)`；宿主侧使用 Cloudflare Alarm 唤醒。该仓库将自身定位为示例集成，Alarm 是 Cloudflare 的宿主机制，不是 pi-durable 1.3.0 的产品级 interval/cron API（[示例调度实现](https://github.com/earendil-works/pi-durable-cloudflare/blob/main/src/schedule.ts)）。

这说明 durable Task 可以承载应用定义的触发状态，但不能消除 AgentChat 必须选择周期/时区、错过触发、暂停/取消及本机进程唤醒语义的事实。Cloudflare Alarm 也不能直接作为本机 Node Runner 的唤醒机制。因此该示例补充了实现参考，没有改变当前架构结论或例行任务暂缓状态。

公开 `TaskRuntime` 提供 Harness 时钟及 `sleep(until, context)`，在到时后恢复，并在 invocation 或 context 取消时拒绝（`runner/node_modules/@earendil-works/pi-durable/dist/types.d.ts:191-196`）。Task 本身是带版本、初始 checkpoint 和 phase handlers 的持久状态机；Task 创建选项规定 owner 等执行关系，但没有 interval、cron 或 schedule 字段（`dist/types.d.ts:198-255`）。

一条可行的 Task 驱动路径是：在 Conversation 的 `commit()` 中用 `tx.createTask()` 创建 conversation-owned、`background` 的例行 Task；把下一触发时间和周期状态保存在 checkpoint；phase handler 用 `sleep()` 等待，再通过 `runtime.conversation(id).submit()` 写入触发消息。Submission 的稳定 `requestId` 在重试时返回已有 Submission，可用于按“例行 ID + 触发序号”消除重复接纳（`dist/harness/types.d.ts:82-86, 611-612`; `dist/types.d.ts:132-197, 198-228, 238-248`; README `115-123`）。`background` 让 Task 不阻塞普通 idle wait，也意味着普通 Conversation abort 不会自动取消它；删除 Bot 或例行任务时，产品操作必须显式终止对应 Task。关闭时 invocation 会结束；重开后的 Task 恢复依赖保存的 checkpoint 和 `Harness.resume()`，过期触发如何处置仍由 AgentChat 定义。

公开 `Harness.resume()` 的文档是启用 task scheduling；提交、等待、取消等请求也会启用调度，纯只读 viewer 不会（`dist/harness/types.d.ts:639-646`）。它使 Harness 调度已存在的 durable Task，不是创建产品级例行任务或管理周期触发的 API。TaskScheduler 的声明位于包内 `dist/harness/scheduler.d.ts`，描述的是一个 Harness 的内部 scheduler；包根导出列有 `Harness`、Task 类型与 `TaskRuntime`，没有导出 `TaskScheduler`，package export map 也没有 scheduler 子路径（`dist/harness/scheduler.d.ts:41-68`; `dist/index.d.ts:1-23`; `package.json:8-15`）。不能把包内实现当作 AgentChat 的公开产品接口。

内部实现重开时会把仍存活的 `running` Task 退回 `pending`（保留其 checkpoint），随后由 scheduler 恢复推进；此行为描述 durable Task 的执行恢复，不定义周期任务的漏跑/去重产品语义（`dist/harness/scheduler.d.ts:61-67`; `dist/harness/scheduler.js:129-151`）。因此 Task 驱动方式可以复用 Harness 调度和恢复，不需要 AgentChat 再造一个常驻 timer/queue；但 AgentChat 仍创建、持有和管理对应 Task，并实现 schedule 到下次 due time 的转换、暂停/删除与漏跑策略。Harness API 本身不提供 cron 解析或产品级周期实例规则。

AgentChat 架构总览明确“不自建 … scheduler”，并说明 TaskRuntime 是库的任务调用接口而不是后台服务；pi-durable 架构文档也声明应用不自建排队、调度或恢复框架（`docs/architecture/00-overview.md:30`; `docs/architecture/01-pi-durable.md:7-11`）。阶段四的选择应区分三种情况：等上游公开产品调度能力；评估用持久 Pi Task 表达周期触发能否落在现有架构边界内；或另行批准 Runner-owned scheduler 作为架构例外。后两条都需定义持久触发记录、漏跑策略、幂等、暂停/取消及关闭恢复，不能只因 Harness 有 Task scheduler 就推定产品语义已解决。

## 3. Lorca routine scheduler 的参考边界

Lorca 文档描述 routine 由 Bot 所属 Runner 运行；Runner 每 30 秒检查到期项，同一个 routine 正在执行或检查时不再启动第二个。调度覆盖 interval、cron、一次性、事件和日历触发（[routines.md](../../../lorca/docs/architecture/routines.md#L3-L9)；[routine-triggers.md](../../../lorca/docs/architecture/routine-triggers.md#L3-L34)）。

它的运行与恢复不是单独一个 timer：到期时间、健康状态和重试时间持久化到 SQLite 并随加密 roster 传播；开始工作前先保存已领取的 due time；重启时按 `coalesce` 或 `skip` 处理错过的触发，已经中断的 turn 不重跑。Bot 迁移时由新 Runner 接手之后的 routine，原 Runner 完成已开始的一次运行；Runner 离线时不由其他 Runner 接管（[routines.md#L17-L25](../../../lorca/docs/architecture/routines.md#L17-L25)）。Lorca 文档还区分 standalone CLI 与桌面 Runner：standalone CLI 用户可安装 `lorca service`，让 Runner 在 Lorca 关闭后继续运行；桌面 Runner 使用捆绑 CLI，不展示这项安装指引（[routines.md#L39](../../../lorca/docs/architecture/routines.md#L39)）。这些是 Lorca 的产品/运行模型，AgentChat 当前单机 Runner/Harness 不能据此声称已有相同服务或恢复承诺。

Lorca 的预检脚本在独立 sandbox 中运行、限时五分钟，只允许内置读取工具和 manifest 标为只读的插件工具；违规调用会阻断 check。例行任务还受 Bot Access、额度、插件/模型认证及失败退避影响；routine 状态可能进入 blocked、waiting_for_runner 或 failed（[routines.md#L11-L29](../../../lorca/docs/architecture/routines.md#L11-L29)；[routine-triggers.md#L30-L38](../../../lorca/docs/architecture/routine-triggers.md#L30-L38)）。特别是 Lorca 对“无人可询问”的副作用调用会经 Auto-review 暂存，见[routines.md#L13](../../../lorca/docs/architecture/routines.md#L13)。这是 Lorca 的权限与审批设计，不是 AgentChat 阶段四应照搬的能力。

**当前决策：** 保持“不自建 scheduler”的架构边界；Bot 记忆可以继续按已确认的作用域与持久化契约演进，例行任务的定时触发暂缓。持久 Task + `sleep()` 不作为当前落地方案，因为它仍要求 AgentChat 实现周期、到期判断、漏跑、暂停/恢复和取消语义。若后续确有此需求，先等 pi-durable 提供公开产品级触发 API，或由用户明确批准架构边界变更，再定义周期/时区、稳定 requestId、Runner 所有权、运行中关闭/崩溃恢复以及应用退出/系统休眠行为。Lorca 文档只提供产品行为参考，不会改变 AgentChat 的架构授权。

## 4. Lorca Bot 记忆的可迁移产品要求

Lorca 将长期记忆放在 Runner 上，并以稳定 Bot ID 寻址，所以 Bot 改名或工作目录变化不会迁移或混淆记忆。它区分三类数据：每轮注入且有长度上限的摘要、按需读取的主题笔记、只供检索而不注入的按日事件日志；Inspector 可查看和编辑记忆，编辑时检查底层内容是否已变化。写入采用原子更新并经过凭据脱敏。Lorca 还在上下文压缩前提供一次受限的记忆整理机会，并对跨聊天近期工作和历史对话提供检索（[bots.md#L64-L77](../../../lorca/docs/architecture/bots.md#L64-L77)）。

对 AgentChat 有直接参考价值的是稳定 Bot 身份、明确的数据类别、受限注入、用户可检查/编辑、并发编辑保护和敏感值过滤。它们可以作为记忆功能的验收要求，不要求复制 Lorca 的 Markdown 布局或工具接口：AgentChat 应继续以 pi-durable Document 和 `runner.sqlite` 为持久化事实源。

首版可以先实现可审阅的 Bot 记忆文档与受限注入；按日自动日志、压缩前自动整理、跨 Conversation 的近期工作摘要和全文检索会扩大生命周期与隐私范围，可在用户确认首版范围并验证需求后再单独设计。Lorca 的 200 行/24 KB 上限是其产品取舍，不直接作为 AgentChat 的默认值；AgentChat 需按实际 token 预算确定注入限制。

## 5. 逐次工具调用审核边界

AgentChat 功能路线已明确：Bot Tool 列表定义能力，MCP 与自动化显式配置，工具可用性由 Bot 能力清单决定，不增加逐次工具调用审核；阶段三也记载 Bot 只执行已选 Extension/Tool（`docs/plans/feature-alignment.md:5-7,29-33`）。MCP 决策记录再次确认“不设计逐次调用审核或审批”，参数在调用前经支持的 JSON Schema 子集校验（`docs/research/mcp-integration.md:60,64-78,84-88`）；Runner 解析配置时只返回已选 Extension 与 Tool，并拒绝未安装或未启用 Extension 所属的 Tool（`runner/src/harness/agent.ts:26-52`）。

所以本决策门不加入逐次审核、审批或确认队列。定时触发若获准，运行时仍使用该 Bot 的显式能力清单与参数校验；不把“无需逐次审核”解释为允许例行任务绕过 Bot 配置。Lorca 的 Auto-review 是它自己的产品策略，不改变 AgentChat 已确认的调用边界。

## 核对范围

本文件只记录当前仓库文档、源码和锁定依赖类型/导出，以及 Lorca 文档中的事实与可选决策；未修改实现，也未运行测试。
