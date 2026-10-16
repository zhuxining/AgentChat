# pi-durable 应用集成

> **Status**: active（本地桌面切片已实现，并通过当前 macOS arm64 `.app` 启动/退出冒烟；未完成执行的跨进程恢复、真实 Provider 和其他平台仍待验证）。

## 装配与执行模型

桌面 Runner 的 TypeScript 入口初始化 models、Registry、ExecutionEnv 和官方 Storage 适配，打开一个长期持有的 Harness。Harness 管理同一 Session 中多个独立配置的 Conversation；Bot 不对应独立进程、Harness 或唯一聊天。移动端和 Relay 不装配执行功能，平台分工见[总览](00-overview.md)。

应用直接使用公开导出，不调用私有 TaskScheduler，不手改 Storage 表。普通聊天由内置 GenerationTask、ToolTask 和 CompactionTask 推进；承载进程没有另一套 Agent loop、输入接纳或恢复机制。

Conversation 由不可变 Entry 组成，Agent 选择保存在 pi.agent。submit 接纳输入并返回 Submission，内置 Task 推进 Run。Commit 可原子追加 Entry、修改 Document 和创建 Task；界面读取已提交状态。Turn 是一次模型响应及其工具调用，Run 是从输入到回答的轮次序列。

## 应用动作与公开 API

| 应用动作                 | 使用的 pi-durable 能力                              |
| ------------------------ | --------------------------------------------------- |
| 创建 Conversation        | createConversation；init 保存应用来源/目标 Document |
| 发送输入                 | Conversation.submit，传递稳定 requestId             |
| 查询提交结果             | Submission、Submission.wait、Harness.submission     |
| 更新会话配置             | configure；应用仅在空闲时开放                       |
| 撤回已排队输入           | Submission.abort                                    |
| 停止当前 Conversation    | Conversation.abort，按库定义的作用范围              |
| 显示回复与工具状态       | viewState/watch，必要时 watchEvents                 |
| 展示执行任务             | taskGraph/watchTaskGraph                            |
| Bot 档案、工作目标与归档 | defineDoc 和公开 Commit/tx API                      |
| 关闭与恢复               | Harness.close、Harness.open、resume                 |

输入来源、Conversation 归属和产品参数由应用校验；通过校验后调用库接口，不重新定义 Submission/Run 的状态流转。底层 tx.createSubmission 不用于绕过 submit 的 busy/inbox 规则。跨设备的签名与重试规则见[多端请求](02-multi-device.md#操作信封与接纳)。

## Bot 配置快照

Bot 是应用 Document，独立提供 model、thinkingLevel、instructions、extensions、tools 与默认 cwd，并绑定 Runner。桌面当前实现 OpenAI Provider；密钥由 Tauri 原生命令保存到系统凭据库，通过私有 Runner IPC 交给 Node Runner，并保存在 Provider 认证闭包中。Runner 不把密钥放进 shell 工具继承的环境、Bot 快照或 Projection。内置 pi.provider 的 provider session identity 也不是密钥。

创建 Conversation 时具体化 Bot 默认值，写入 pi.agent，并在 createConversation.init 所属 Commit 中保存来源 Bot ID、配置版本及工作目标等应用字段。允许新 Conversation 覆盖 cwd；运行中不自动跟随 Bot 的目录变化。

extensions/tools 使用显式列表表达精确选择；需要继承的字段必须明确语义，避免遗漏字段无意跟随变化后的默认值。instructions 是会话指令，完整 system prompt 由所选 Extension sections 与 instructions 共同生成，不增加隐含配置源。

编辑 Bot 只影响新 Conversation；已有 Conversation 在空闲时通过显式操作应用最新配置，运行期间不切换。归档 Bot 阻止创建新 Conversation，保留已有记录、稳定关联和恢复所需配置。权威变更由所属 Runner 完成，其他端发送操作请求，不用整份旧快照覆盖新状态。

配置快照保存配置值与扩展名称，不冻结 Registry 代码、动态 section 输出、Provider 凭据或全局 settings。重启必须重建 Registry；扩展缺失或版本不兼容需要展示，不能静默替换能力。

## Document 与执行 Storage

| 数据                                  | 归属                                  |
| ------------------------------------- | ------------------------------------- |
| Conversation、Entry、Submission、Task | Runner 的 Harness/Storage             |
| Agent、运行进度、inbox、usage         | pi.agent、pi.live、pi.inbox、pi.usage |
| Bot 默认配置与非敏感 Provider 选择    | 应用 Session Document                 |
| 来源 Bot、目标、标题与归档            | 应用 Conversation Document            |
| Provider 密钥                         | Runner 平台安全存储                   |

应用用 defineDoc 定义 app.* kind，区别于内置 pi.*；scope、version、history 和 fork 行为按实际业务选择。目标状态由用户确认，Submission done、Run 结束或 Task completed 均不自动表示目标完成。

修改通过公开 Commit/tx 完成，事务回调只使用 tx 读写，不在其中等待网络或重新调用 Session 读取。库维护 Task、Submission 和 Run 结果，应用不建立替代执行日志或 receipt 事实源。Bot 等应用变更的业务版本校验也使用公开事务能力；远程重试保证需按操作验证，不能从 submit 的去重推导所有修改都恰好执行一次。

一份执行 Storage 同时只由一个 Harness/进程持有；Rust、手机和 Relay 不读写内部表，不复制检查点执行工作。其他端的 Projection 和网络 Outbox 属于[应用通信数据](02-multi-device.md#projection-与应用存储)。

当前 Runner 使用 openNodeSqliteStorage。1.2.0 声明 Node ≥22.19.0，官方适配使用 node:sqlite；根 Bun Workspace 锁定目标平台 Node 22.19.0 二进制，构建时将其与 Runner 入口一起加入 Tauri resources。桌面开发也使用暂存的该 Node runtime，不要求依赖 PATH 中的 Node。MemoryStorage 不用于需要重启保留的生产数据；当前 macOS arm64 `.app` 的资源路径与 Runner 启动已验证，其他平台尚未验证。

SQLite WAL/synchronous=NORMAL 对进程崩溃与断电的保证不同，不承诺零丢失。运行数据保存在平台应用数据目录，不提交数据库或真实密钥。

## Submission、排队与控制

本地和远程输入经同一应用入口调用 submit({ type: "input", content, requestId })。同一 Conversation 的稳定 requestId 用于找到已有 Submission；网络超时不代表未接纳。网络确认丢失时复用原 requestId 重试，或凭已知 Submission ID 查询，不能生成新 ID 或重新提交历史 Entry。操作 ID、来源与内容约束详见[多端篇](02-multi-device.md#操作信封与接纳)。

busy Conversation 的默认输入为 follow-up；steer 在当前工具轮次后进入正在执行的工作，reject 可拒绝忙时输入。pi.inbox 是已接纳待处理输入的事实来源，网络 Outbox 不复制 follow-up 调度。

Submission done 表示输入已得到回答，unanswered 包含未回答原因；二者不是 Task outcome 或目标完成状态。取消 Submission.wait 的 Context 只取消等待，不取消执行。

Submission.abort 撤回排队输入；Conversation.abort 停止当前工作并撤回排队输入，排队 write 和 background 所有权边界按库契约处理，不能宣称一次 abort 必然停止所有后台工作。跨网络迟到停止和未送达输入的控制另见[控制边界](02-multi-device.md#传输状态与控制边界)。

不同 Conversation 使用 Harness 内置调度和 settings。1.2.0 没有通用 maxConcurrentRuns，toolExecution 只决定库支持的工具执行模式；全局执行上限不作首发保证，也不通过私有 scheduler 或 submit 外的 semaphore 冒充完整限制。

## 生命周期与恢复

桌面启动依次加载应用身份和通信数据、启动承载进程、初始化 Registry/models/ExecutionEnv、打开 Storage/Harness、重新获取 handles，再调用 resume 恢复已接纳工作并接收请求。submit 或等待也可启动调度，应用不扫描历史后重发已完成输入。

关闭桌面窗口进入退出路径，不维持托盘常驻：停止新应用请求，保存通信层待同步数据，调用 Harness.close 并等待资源收尾，最后结束进程。close 不写 Task outcome，不等同于 abort 全部 Conversation；取消 close 的等待不停止关闭过程。

旧 Harness 关闭完成后才能重开同一 Storage，旧 handle 必须重新获取。Storage 错误由库触发 Harness 失败和关闭，应用等待收尾并展示错误，再决定是否重新打开，不盲目重试所有错误。

重启由 Harness 从持久化状态恢复，不从 UI 历史或 Relay Projection 重建 Run。Session 与 Task 检查点不跨 Device 同步执行，首发不自动迁移 Runner 或让手机接管 Harness。

工具意图在 execute 前提交。中断工具只有声明 replay: "safe" 才允许重放，否则产生 interrupted 结果。safe 不提供外部副作用 exactly-once 保证，工具作者仍负责幂等。忽略取消信号的代码可能拖延 close，需验证有界退出；不能宣称强制终止不会影响工具副作用。

Runner 退出后 Relay 和其他 Device 仍存在。手机退出或退到后台仅影响自身同步，不取消 Runner 已接纳工作；前台恢复、后台限制和离线投递见[多端篇](02-multi-device.md#离线保留与失败处理)。

## Extension、TaskRuntime 与执行环境

薄应用入口用 Registry 安装 Extension；Extension 可提供 Tool、section、hook、wrapper 和 Task。首发普通聊天复用内置 Task，只有实际业务需要持久化步骤时才使用 defineTask；TaskRuntime 是 Harness 在阶段调用时提供的提交、读取、等待、子任务与环境能力，不是应用要启动的服务。

首发无需完整 Chord Host 框架或另一套进程监督者，Registry 在进程内装配即可。Skill/MCP 是后续能力来源，需要适配，不能等同于 Extension 已自动接入。

不新增逐 Bot 工具权限体系，使用启用的能力、输入校验与工具约定；这不表示 pi-durable 自动加载 Pi CLI 配置或审批机制。ExecutionEnv 供工具和 section 使用，NodeExecutionEnv 的 cwd 是默认目录，允许绝对路径与目录外访问，不是路径 scope 或 OS 沙箱。

## 公开状态与展示

viewState/watch 提供 Entry 及 pi.live、pi.inbox、pi.agent、pi.usage 等 Document 的已提交视图。taskGraph/watchTaskGraph 仅展示 Session 中存活 Task 的状态与所有权；终态节点离开图，不能用作完整历史或据此推断目标完成。

watchEvents 是实验性的 Commit 派生事件接口，可用于本地展示，不另存完整原始执行事件日志。subscribeCommits 仅用于非阻塞变更提示，不等待网络、不调用 Session API；订阅与等待要在 UI 卸载及进程退出时清理。

这些通知不构成可回放的 Relay Outbox。跨存储补齐、快照对账及 Projection 的版本规则集中在[多端同步](02-multi-device.md#projection-与应用存储)，应用不得假定存在公开源 Commit 序号或 scanCommits(afterSeq) 接口。

## 验证与依据

单机先验证独立 Agent 配置、Document 原子修改、Bot 快照/更新/归档、submit 去重及响应丢失后重查、follow-up/steer、wait 与 abort 区别、公开视图与订阅清理。然后验证真实模型、safe/interrupted 工具、Registry 重建、close/reopen/resume、Storage 失败和桌面进程退出。

目前已实现本地 Bot/Conversation 管理、配置快照、工作目标 Document、Extension/Tool 选择、Submission 操作和 Task Graph 投影。Runner 使用 Node 22.19.0 与持久 SQLite；目标平台 Tauri 包含 Node runtime 和 Runner 入口。系统凭据库接入及打包启动路径已落地，当前 macOS arm64 `.app` 的 Runner 启动和正常退出已冒烟验证；实际桌面进程重启时恢复未完成工作、真实 Provider 与 Windows/Linux 仍待验证。总执行上限仍以公开能力为准，不自建调度器。多端可靠性不能由本地链路推导，验收另见[多端篇](02-multi-device.md#待验证与验收)。

- [官方 README](https://github.com/earendil-works/pi/blob/main/packages/durable/README.md)
- [官方 spec](https://github.com/earendil-works/pi/blob/main/packages/durable/docs/spec.md)

上游 main 可能与安装版本不同，所有具体签名以锁定版本的文档和类型复核。
