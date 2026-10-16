# pi-durable 应用集成

> **Status**: active。文件配置与独立后台 Runner 已实现，macOS 本机后台和桌面临时目录冒烟通过；安装包、真实模型和其他平台的验证边界见文末。

## 装配与执行模型

原生后台宿主独立于 UI 管理 Node Runner、本机连接和系统凭据。Node 入口加载配置，装配 models、Registry、settings、ExecutionEnv 与官方 SQLite Storage，然后打开一个长期持有的 Harness。所有 Bot 共用 Harness；Bot 不对应独立进程或独立执行数据库。平台分工见[总览](00-overview.md)。

结构对齐 pi-durable 示例 `06-harness`、`07-configuration`、`26-coding-agent`：运行资源是 Harness 装配依赖，Agent 保存模型和能力名称等持久选择。`21-late-join` 与 `31-reload-and-restart` 提示客户端可执行中加入，重启必须重新注册代码再绑定已保存选择；这些示例不代表应用已实现完整网络订阅或远程恢复协议。

普通执行由库内置生成、工具与压缩 Task 推进。应用直接使用公开导出，不自建 Agent loop、接纳、排队、调度或恢复框架，也不读写内部 Storage 表。产品聊天窗口可以包含多个会话，与库 Conversation 的映射由产品适配明确，不默认一一对应。

## 配置文件

默认数据根目录为 `~/.agentchat`，宿主允许环境变量 `AGENTCHAT_DATA_DIR` 指定绝对路径。新项目不迁移旧配置、数据库或目录；切换路径是打开另一套数据，不会自动停止旧路径的实例。

```text
<data-dir>/
├─ runner.json
├─ bots/
│  └─ <bot-id>/
│     ├─ bot.json
│     └─ instructions.md       # 可选
├─ workspaces/<bot-id>/
├─ state/runner.sqlite
├─ logs/host.log
└─ run/                       # Unix socket 与实例锁；Windows 使用命名管道
```

首次初始化生成默认 Runner 配置；已有无效文件不覆盖，初始化后的文件缺失按错误处理。JSON 文件是期望配置的权威来源；数据库仅保存执行事实和已确定的执行配置，不再持有另一份权威 Bot 默认配置。

### runner.json

以下示例对应当前 `runner/src/config/schema.ts`：

```json
{
  "schemaVersion": 1,
  "name": "本机 Runner",
  "workspace": {
    "root": "workspaces"
  },
  "providers": {
    "deepseek": {
      "type": "deepseek",
      "credentialRef": "provider/deepseek"
    }
  },
  "botDefaults": {
    "model": {
      "provider": "deepseek",
      "modelId": "deepseek-chat"
    },
    "thinkingLevel": "medium",
    "instructions": "",
    "extensions": ["coding-tools"],
    "tools": ["bash", "edit", "read", "write"]
  },
  "harness": {}
}
```

| 字段             | 当前契约                                                                           |
| ---------------- | ---------------------------------------------------------------------------------- |
| `schemaVersion`  | 必须为 `1`；未知版本、未知字段或错误类型拒绝加载                                   |
| `name`           | Runner 展示名称，不充当稳定身份                                                    |
| `workspace.root` | 自动工作区的根路径；相对路径基于数据根目录，改变后不迁移已有目录                   |
| `providers`      | Provider 声明；当前只实现键名和类型均为 `deepseek`，引用固定为 `provider/deepseek` |
| `botDefaults`    | 创建 Bot 的模板；写入具体 Bot 后不再动态继承，当前默认指令为空                     |
| `harness`        | 可省略或为 `{}`，未覆盖项沿用锁定库版本默认值                                      |

Provider 结构为未来多个已实现类型保留表达空间，**当前不支持任意 Provider ID/别名、任意凭据引用、baseUrl、自定义 Header 或通用 Provider 配置**。模型通过 `provider/modelId` 解析，当前模型适配提供 `deepseek-chat` 与 `deepseek-reasoner`。模型不可解析会显示配置诊断并阻止受影响的新建或显式应用，不静默改用其他模型。

密钥保存在原生宿主访问的系统凭据库中，引用不是密钥内容。开发时允许宿主读取 `DEEPSEEK_API_KEY`，随后通过私有通信供给 Provider 认证闭包；Node 工具环境剔除模型密钥。凭据更新与轮换是独立操作，不复制进快照；宿主环境变量改变需重启后台才能重新读取。

### bots/<bot-id>/bot.json

Bot ID 取目录名，不在 JSON 中重复保存。下面以 `developer` 为示例 ID：

```json
{
  "schemaVersion": 1,
  "name": "开发助手",
  "archived": false,
  "workspace": {
    "path": "workspaces/developer"
  },
  "agent": {
    "model": {
      "provider": "deepseek",
      "modelId": "deepseek-chat"
    },
    "thinkingLevel": "medium",
    "instructionsFile": "instructions.md",
    "extensions": ["coding-tools"],
    "tools": ["bash", "edit", "read", "write"]
  }
}
```

这个示例需要同时创建 `bots/developer/instructions.md`。也可以删除 `instructionsFile` 并改为 `"instructions": ""` 或内联指令。两字段必须且只能出现一个，不隐式拼接。

| 字段                               | 当前契约                                                                                    |
| ---------------------------------- | ------------------------------------------------------------------------------------------- |
| `name` / `archived`                | 名称与归档标记；归档禁止新建执行，保留已有工作                                              |
| `workspace.path`                   | 相对数据根目录解析；绝对路径可指向外部项目；不迁移既有执行                                  |
| `agent.model`                      | 明确的 `provider` 与 `modelId`；检查 Provider 声明与模型可用性                              |
| `agent.thinkingLevel`              | schema 接受 `minimal`、`low`、`medium`、`high`、`xhigh`；具体模型的效果以 Provider 能力为准 |
| `agent.instructions`               | 内联指令，可为空；与独立文件排他                                                            |
| `agent.instructionsFile`           | 相对 Bot 目录解析，仅接受 Bot 目录内可读取的受限文件；不扫描工作区或上级目录                |
| `agent.extensions` / `agent.tools` | 精确名称列表，`[]` 表示不启用用户选择项；Tool 所属 Extension 必须启用                       |

创建 Bot 时将模板具体化，默认自动分配稳定工作区，可显式覆盖。新注册能力不自动进入已有 Bot；工作目标所需的应用 Extension 由 Runner 管理，不是用户可重复选择的能力。

同一 Bot 的多个执行默认共享工作区。不复制目录、不自动创建 worktree，也不承诺并发隔离。ExecutionEnv 的 cwd 仅是默认位置，既非路径 scope 也非 OS 沙箱。

### Harness settings

配置采用库的字段名，只暴露已有消费者需要的子集：

| 配置                            | 支持内容                                                           |
| ------------------------------- | ------------------------------------------------------------------ |
| `toolExecution`                 | `parallel` / `sequential`，默认沿用库的 `parallel`                 |
| `followUpMode` / `steeringMode` | `all` / `one-at-a-time`，默认均为 `one-at-a-time`                  |
| `stream`                        | `timeoutMs`（正整数）、`maxRetries`（非负整数）                    |
| `retry`                         | `enabled`、`maxRetries`、`baseDelayMs`                             |
| `compaction`                    | `enabled`、`reserveTokens`、`keepRecentTokens`、`backgroundTokens` |

其他数值字段为非负整数。`stream.maxRetries` 是 Provider/SDK 请求层重试，`retry` 是 Harness 持久生成重试，两层可能叠加。`all` 表示输入选取方式，不表示并行创建多个 Agent；工具并行也不提供文件隔离。进度落盘间隔、内存保留等内部调优项目前不公开。

### 保存、重载与生效

| 操作或配置类型                   | 生效规则                                                                |
| -------------------------------- | ----------------------------------------------------------------------- |
| 手工编辑                         | 启动或显式 `reloadConfiguration` 时读取，不监听文件变化                 |
| UI 保存                          | 携带内容版本，校验后原子替换同一文件，并重载配置                        |
| `botDefaults`                    | 只影响后续创建的 Bot                                                    |
| Bot Agent 默认选择与独立指令内容 | 更新有效默认值；后续创建执行使用，已有执行空闲时显式 `applyBotSettings` |
| `harness`                        | settings 在库下一次读取时使用新值，不为每次执行冻结一份全局策略         |
| `providers`                      | 标记 `restartRequired`，重启后台后生效；不将重载等同资源重建            |
| 数据根目录与 Storage             | 进程资源，停止旧实例并启动目标目录，不运行中切换                        |

UI 版本来自文件内容；Bot 配置版本包含所引用指令文件内容。保存前再次检查，发现外部编辑拒绝覆盖并要求刷新。原子替换减少半写入；不遵循协调的外部编辑器仍可能在同一瞬间覆盖，版本保护不是跨任意进程的事务。

无效重载保留当前有效值并返回路径、Bot ID 和错误；磁盘修改不会静默生效。无效 Bot、缺失指令、不可用模型或 Extension/Tool 可通过设置诊断，受影响的创建/应用被拒绝；冷启动无效 Bot 单独禁用，必要 Runner 配置无效时允许诊断连接但不启动执行。修复文件后显式重载。

删除或移动 `bot.json` 标记配置缺失、禁止新建，不删除历史、不自动取消已接纳工作。已保存执行配置仍用于历史和恢复，能否继续还取决于可用模型、能力代码和凭据；文件恢复后可修复关联。归档、取消、删除历史与清理目录分别处理。

## 执行配置与持久化

创建库 Conversation 时使用解析后的 Bot 选择与显式覆盖，写入 `pi.agent`，并在初始 Commit 保存来源 Bot、配置版本和目标等应用状态。指令文件的有效内容进入持久配置，执行不持续读磁盘指令。已有执行在空闲时通过 configure 显式更新，运行或排队期间拒绝切换。

快照保存选择与内容，不冻结 Registry 代码、动态 section 输出、Provider 凭据或全局 settings。重启必须重新注册随包实现；缺失或不兼容能力不能被静默忽略。当前提交入口检查已保存模型和能力是否仍可用。

| 数据                                             | 权威归属                                      |
| ------------------------------------------------ | --------------------------------------------- |
| Runner 默认值、Provider 非敏感声明、Bot 默认配置 | JSON 配置文件                                 |
| Conversation、Entry、Submission、Task            | Harness/Storage                               |
| Agent、进度、inbox、usage                        | `pi.agent`、`pi.live`、`pi.inbox`、`pi.usage` |
| 来源 Bot、目标、产品关联                         | 应用 Document                                 |
| Provider 密钥                                    | 系统凭据库 / 可信宿主凭据入口                 |

Document 是类型化持久状态，不是配置目录中的普通文档。应用状态与扩展状态使用 `defineDoc`，通过公开 Commit/tx 修改；目标由用户确认，Submission done 或 Task completed 不代表目标完成。Bot 默认值不再使用应用 Document 作为另一份事实源。

一份 Storage 只由一个 Harness/进程持有。Rust、UI、手机和 Relay 不打开内部表，也不复制检查点执行工作。生产使用 `openNodeSqliteStorage` 和经宿主验证的 Node 24+；MemoryStorage 用于测试。SQLite 的崩溃与断电保证不同，不承诺断电零丢失。

## Submission、排队与控制

| 操作             | 公开能力                                  |
| ---------------- | ----------------------------------------- |
| 创建执行会话     | `createConversation` 与初始 Commit        |
| 输入接纳         | `Conversation.submit`，传稳定 `requestId` |
| 查询输入         | Submission 与 Harness 公开查询            |
| 更新空闲执行配置 | `configure`                               |
| 撤回输入         | 公开 Submission 中止接口                  |
| 取消当前工作     | `Conversation.abort`，按库定义的范围      |
| 读取状态         | 公开 view/watch 与 taskGraph              |
| 关闭与恢复       | `Harness.close`、`Harness.open`、`resume` |

同一库 Conversation 的 requestId 重试查找已有 Submission；响应超时不能推断未接纳，不以新 ID 重发。busy 时 follow-up 与 steer 使用 pi.inbox 的公开规则，不另建执行队列。取消等待只停止等待，不取消执行。

Conversation.abort 的后台任务所有权范围按库契约处理，不能宣称必然取消所有后台工作。总执行上限也不由 toolExecution 表达；未获公开能力支持的并发保证不通过私有 scheduler 或额外队列冒充实现。网络投递与迟到控制另见[多端篇](02-multi-device.md#传输状态与控制边界)。

## 生命周期与恢复

宿主先检查实例与本机连接，再启动 Node。Node 重建 models、Registry 和环境，读取文件、打开 Storage/Harness，重新取得 handles 并 resume。客户端可在执行中重新连接，不成为工作的所有者。冷启动配置无效时仍可保持通信以诊断修复。

退出 UI 不发送 close；显式停止 Runner 才拒绝新请求、调用 close 并等待收尾。close 不等于 abort，不写入所有工作已取消的结果。旧 Harness 关闭完成才能重新打开同一 Storage，旧 handles 不复用。

工具意图在 execute 前提交，中断后只有声明 `replay: "safe"` 的工具允许重放；否则按库产生 interrupted 结果。safe 不保证外部副作用恰好一次，工具作者仍需幂等。强制终止、忽略取消或关闭超时的副作用风险需验证，不能把保留恢复状态写成无条件恢复成功。

## Extension、视图与传输

Registry 安装随包 Extension，Bot 按名称选择。Extension 可集中提供 Tool、section、hook、wrapper 与 Task，持久状态放在对应能力旁。普通聊天使用内置 Task；有实际持久业务步骤时才使用 defineTask。TaskRuntime 是库调用接口，无须另启服务。

当前编码工具和工作目标按此装配，不纳入计划模式。不动态加载任意代码；Skill/MCP 未来分别接入，不因依赖存在就声称支持。没有额外逐 Bot 审批体系，远程身份授权仍是独立边界。

`harness/views.ts` 等读取公开状态并转换展示结果；`communication/` 校验请求并处理私有 stdio。当前 UI 使用快照刷新，不把库的 watch 能力描述为已实现完整客户端流协议。Task Graph 仅包含存活 Task，不是完整历史。未来监听应随连接清理，慢客户端不阻塞 Harness。

watch/subscribeCommits 不构成可回放网络日志，不假定存在源 Commit 序号或 `scanCommits(afterSeq)`。断线对账与网络 Outbox 的事务边界见[Projection 与应用存储](02-multi-device.md#projection-与应用存储)。

## 验证与依据

配置与 Harness 测试覆盖重载、版本冲突、指令内容快照、Bot 缺失、模型/能力拒绝和 close/reopen/resume。原生宿主测试覆盖实例排他、连接关联、客户端断开后存活及 stop 仅调用 close。macOS 实际二进制还完成了八客户端请求、重复启动、外部编辑/重载、过期保存拒绝、停止与重开后快照保留；桌面实际读取配置和停止后台，并验证 UI 进程退出不停止后台、重新启动连接已有实例。当前版本不随包携带 Node；runtime 检测、包管理器安装、Node 官方源与 npmmirror 发行包回退已经实现，但新初始化与安装尚未在目标平台上冒烟。

Tauri 打包的 JS/Rust 版本不匹配已修复：`Cargo.toml` 将每个有 JS 对应包的 crate 固定在相同 major.minor，`Cargo.lock` 必须一并保留（Tauri 打包依赖它，且 `tauri-plugin-updater` 的可选 `zip ^4` 已全部 yank，无法重新解析）。

本轮未调用真实 Provider，也未验证有工具副作用的工作跨进程中断恢复。Unix socket 和 Windows named pipe IPC 均已实现；Windows 管道拒绝远程客户端，并通过 ACL 限制为当前所有者、SYSTEM 与管理员。`host.rs` 的 Windows 生命周期分支与 `host/windows.rs` 在最小 Tokio harness（stub Runner）上通过 `x86_64-pc-windows-gnu` 编译，但完整 Tauri 应用交叉编译因开发机缺少 MinGW 编译器而未完成，Windows 尚无运行验证。Linux 与其他平台未完成安装/打包验收。Device Core、Relay 和移动端可靠性仍是后续范围。

- [官方 README](https://github.com/earendil-works/pi/blob/main/packages/durable/README.md)
- [官方 spec](https://github.com/earendil-works/pi/blob/main/packages/durable/docs/spec.md)

上游 main 可能与安装版本不同，具体签名以锁定版本的源码、文档与类型复核。
