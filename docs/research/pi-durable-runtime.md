# pi-durable runtime 官方依据与 AgentChat 应用建议

研究日期：2026-10-14。
范围：本地安装的 @earendil-works/pi-durable 1.2.0、@earendil-works/chord 1.2.0，以及官方 README/spec 经 Context7 查询的相关段落。上游 main 可能变化，具体签名以本地锁定版本为准。本文是研究结论，不修改已暂存的架构决策。

## 结论

AgentChat 首发建议用受 Tauri 管理的 Node 进程运行 TypeScript 产物，以官方 Node SQLite 适配打开一个长生命周期 Harness。多个 Bot 的默认配置应用到多个 Conversation；不为 Bot 单独创建进程或 Harness。该建议是场景适配，不是官方规定的 Tauri 架构。

Device Core/Relay 负责设备信任、网络投递和展示 Projection；Harness 负责执行接纳、pi.inbox、模型与工具 Task 以及恢复。pi-durable 不提供现成的设备配对、Relay、端到端加密或多端复制协议。[S1][S2]

## 官方明确的契约

### Harness 与 Session

Harness.open(storage, options, context) 打开一个 Storage 上的 Session 并驱动任务。createConversation 和 fork 允许在同一 Harness 中建立多个 Conversation，每个 Conversation 保存自己的 Agent 配置。官方没有要求每个 Bot 对应单独 Harness，也没有把 Bot 定义为内置实体。[S1][S2]

一份 Storage 同时只能由一个进程持有，没有跨进程锁。Session 把 Commit 排在一条原子变更线上，但这不等于全部模型/工具调用只能串行：调度器的 handler 和 join 在该线之外运行。[S1][S4]

AgentChat 的一个共享 Harness 是合理首发选择；多账号隔离、独立资源边界或测量到瓶颈时再评估拆分。不能直接让手机打开数据库副本并恢复同样工作。

### Agent 配置与 Registry

模型、thinkingLevel、Extension、Tool、instructions 和 cwd 按 Conversation 保存到 pi.agent。configure 在 Commit 中改变选择。Registry 属于当前进程，扩展和工具按名称保存；重启需要重新安装定义。[S1][S2]

unset 字段可能跟随 host 默认，显式列表表示精确选择。配置快照不能冻结 Registry 代码、动态 section、Provider 凭据或全局 settings。AgentChat 创建 Conversation 时应具体化 Bot 默认值，在空闲入口执行显式配置更新。

### Submission、排队与取消

submit durably 接纳输入并返回 Submission；同 Conversation 的稳定 requestId 返回已有 Submission。忙时使用 follow-up、steer 或 reject，而不是应用再造执行队列。取消 wait 的 Context 仅取消等待，不取消任务。[S1][S2]

Outbox 是应用网络投递队列，和 pi.inbox 不同；Runner 已接纳之前不得称为 Submission。tx.createSubmission 是底层记录 API，不应用它规避 submit 的 admission、busy 和 inbox 规则；本地类型注释明确其不执行这些规则。[S4]

### 关闭与恢复

resume 启动调度；submit 或等待也会启动它。中断运行保持 pending，重开后继续。[S1]

close 封闭接纳，通知运行中的 invocation，等待已接纳 Commit 和调用代码完成后关闭 Storage，不写 Task outcome。取消 close 的等待不停止关闭。新 Harness 必须等旧关闭完成后才能安全打开相同 Storage；旧 handle 需要重新获取。[S2][S4]

abort 是主动停止，与关闭不同。Storage 错误使 Harness 失败并自行关闭；closed 表示资源收尾完成，随后可重新打开。不能对所有错误盲目重试或把恢复等同于重新提交历史输入。[S1][S2]

replay: "safe" 允许中断工具重放，其他工具产生 interrupted 结果。该声明不提供外部副作用 exactly-once，工具仍需幂等。[S1]

### Node 与 Bun

安装包 engines 声明 Node >=22.19.0。官方提供 openNodeSqliteStorage，其实现使用 node:sqlite DatabaseSync、WAL 和 synchronous=NORMAL；无需为基本 Node SQLite 使用额外的数据库驱动。[S1][S4]

portable SQLite core 可通过异步 SqliteDatabase facade 接入 Bun 或其他环境。本地 1.2.0 exports 未提供专用 storage/sqlite/bun 入口；不能假定 bun:sqlite 可无适配替代 Node 入口。自定义适配需要事务排队、过期句柄与关闭等契约验证，并使用 registerStorageConformance。[S1][S4]

因此建议先以官方 Node 适配验证执行闭环。仓库使用 Bun 管理依赖/开发工具，不强制分发进程必须使用 Bun。Node/Bun 选择与 Tauri sidecar 打包仍需目标平台验证，不承诺现已完成。

### 并发与缓存

公开 HarnessSettings 提供 toolExecution、steeringMode、followUpMode、progress、retry、compaction 和上下文/Document retention 等策略，未提供通用 maxConcurrentRuns 参数。toolExecution: "parallel" 仅决定工具执行模式，不是跨 Conversation 的最大并发数。[S4]

AgentChat 已要求总并发限制；实施点必须覆盖正常提交、恢复和内部延续，不能仅在 Rust 的 submit 调用外套一个 semaphore 就宣称已限制全部执行。具体 Provider/工具资源门控或应用调度方案需单独验证，不修改或依赖私有 TaskScheduler。

### 展示与多端导出

viewState/watch 提供已提交 Conversation 结构；taskGraph 只列存活 Task；watchEvents 是由 Commit 派生的实验性展示接口。subscribeCommits 是同步 post-adoption 通知，官方注释要求不阻塞、不调用 Session API。[S1][S4]

不能在 Commit callback 中调用外部网络或重新等待 Harness 上的读操作：应只使用 tx 读写，避免占用变更线或自我等待。[S2][S4]

subscribeCommits/watch 不是持久化的 Relay Outbox。公开 Storage 类型有记录扫描接口，但未声明一个通用 scanCommits(afterSeq) 接口。跨重启的 Projection 导出不能假定 watch 自动回放历史 Commit；需要权威状态重新对账或经过验证的持久化导出方案。这是应用同步职责，不是 pi-durable 内置承诺。

## Chord 是否必要

官方 pi-durable quick start 直接使用 createRegistry、Harness.open 和 BACKGROUND_CONTEXT，没有启动 Chord Host。Chord 文档描述 replicatedState 可独立于 Host 使用，Durable 用它表达 Document、View 和 Task Graph。[S1][S3]

Chord 的 Durable 集成章节展示把 Harness 作为 eager resource 交给 Host 管理，并用 RegistryReader 读取扩展表；这是插件/热更新组合模式，不是开启 durable execution 的前提。guide 的 durableRegistry 是应用桥接示意，spec 明确 Chord 不直接提供该桥接。[S3]

AgentChat 首发建议使用 createRegistry().install(...)，由 Rust 负责子进程生命周期，不同时增加 Chord Node host manager 作为另一套监督者。需要 TS 插件热更新、契约对象或多个 TS Host 后再考虑完整 Chord Host，需按实际 pi-durable 签名重写示意，不能直接复制 guide 省略 Context 的片段。

## 推荐应用流程

1. Tauri/Rust Device Core 加载身份和本地投递状态，启动唯一 Runner 子进程。
2. Node Runner 初始化 models、Registry 和 ExecutionEnv，打开本地 SQLite/Harness。
3. 重新获取 Conversation handles，恢复展示桥接和来源配置映射，调用 resume。
4. 本地和远程操作通过相同应用入口接纳；输入使用稳定 requestId 调用 submit。
5. UI/Relay 投影从已提交状态导出；网络故障不阻塞 Commit 或执行。
6. 应用退出停止接纳，关闭 Harness，确认退出，未同步数据保持可恢复。

首个实现验证应先覆盖单机真实模型 submit/watch/abort/reopen、工具 replay 和进程关闭，再验证 Relay 重复投递与 Projection 恢复。AgentChat 当前只有依赖和设计，未完成这些集成。

## 本地验证结果与限制

在 Node v26.11.1 上使用安装版本与临时 SQLite，未配置 Provider、未调用模型，验证通过：

- 同一 Harness 创建两个 ownerless Conversation，分别保存 instructions 和 cwd。
- createConversation.init 接收 (tx, conversationId)，在创建 Commit 中保存自定义 Conversation Document。
- 追加应用 Entry 后 close，再打开同一 SQLite 并 resume。
- 重新获取两个 Conversation，读取各自 Document、Agent 配置和已保存 Entry。

此检查只证明存储及配置生命周期，不证明模型流式恢复、Tool replay、总并发限制、Tauri 打包、Relay 或移动端行为已通过。临时数据已清理，未改动源代码或既有暂存文档。

## 来源

- [S1：官方 pi-durable README](https://github.com/earendil-works/pi/blob/main/packages/durable/README.md)，对应本地 node_modules/@earendil-works/pi-durable/README.md 1.2.0。
- [S2：官方 pi-durable spec](https://github.com/earendil-works/pi/blob/main/packages/durable/docs/spec.md)，通过 Context7 查询 Harness、关闭、Document 与 Tx 段落；实际类型以本地版本复核。
- [S3：Chord README](https://github.com/earendil-works/pi/blob/main/packages/chord/README.md)、[guide Durable](https://github.com/earendil-works/pi/blob/main/packages/chord/docs/guide.md#durable)、[spec](https://github.com/earendil-works/pi/blob/main/packages/chord/docs/spec.md)，对应本地 chord 1.2.0 文档。
- S4：安装包一手类型/实现：pi-durable/package.json、dist/harness/types.d.ts、dist/types.d.ts、dist/harness/scheduler.d.ts、dist/storage/sqlite/node.js；可在[已安装 README](../../runner/node_modules/@earendil-works/pi-durable/README.md)旁核对。
