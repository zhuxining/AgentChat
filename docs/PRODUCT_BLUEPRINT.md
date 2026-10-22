# AgentChat 产品蓝图

版本：v0.7

状态：独立后台 Runner、文件配置、Node 24+ runtime 初始化、Bot 共享记忆首片已接入；记忆的桌面流程尚未验收。macOS 本机后台与桌面临时目录冒烟通过。Node 安装流程尚未在目标平台验收。Windows 命名管道（含当前用户 ACL）与宿主生命周期分支在隔离 Tokio harness 上通过 `x86_64-pc-windows-gnu` 编译；完整 Tauri 应用交叉编译因缺少 MinGW 未完成，Windows 运行验证仍缺。群组、多端与 Relay 尚未实现。

## 产品定位

AgentChat 是支持持续对话与工作管理的本机 Agent 工作台。用户选择具名 Bot，提交输入、查看执行过程并跟进工作目标。桌面 UI 是控制端，独立后台 Runner 管理配置、工作区与执行状态；关闭或退出 UI 不停止工作。

产品 Conversation 是连续聊天窗口，可以在同一消息流中容纳多个会话。它不默认等同于 pi-durable Conversation，也不决定 Runner 的执行结构。执行术语与产品术语见[术语表](../GLOSSARY.md)，界面结构、自适应规则与状态归属见 [UI 结构](architecture/03-ui-structure.md)。

每个 Bot 只有一个持续对话入口，用户直接发送消息，不提供新建或切换会话操作。首次打开时自动初始化底层执行上下文，之后继续使用已有上下文；初始化失败可以重试，重复请求不得创建额外会话。已有多段历史仍在同一消息流中保留。

未来桌面与 iOS/Android 客户端通过独立 Relay 跨网络同步。手机只发送和展示会话，不打包 Runner、不安装 Node，也不运行 Harness；任何移动端密钥和令牌仅存内存，每次冷启动重新验证，不使用安全存储或其他方式持久化凭据。Provider/API Key 只留在 Runner，多端通信不改变 Runner 对执行状态的权威归属。

## 执行与宿主边界

所有 Agent 执行围绕 pi-durable 公开能力构建，模型循环、输入接纳、排队、Task 调度、检查点及恢复由 Harness 提供。Runner 是独立后台运行单元，不是另一套自建执行引擎。

原生后台宿主管理进程、本机连接和系统凭据；Node Runner 装配 Harness、加载配置并提供类型化操作。UI 启动先连接已有实例，未运行时再启动。Unix 使用当前用户权限保护的 socket；Windows 使用拒绝远程连接且 ACL 限制为当前所有者、SYSTEM 与管理员的命名管道。后台不开放远程网络端口。

停止 Runner 是显式操作：停止接收新请求、调用 Harness.close 并收尾，保留可恢复工作。取消工作与撤回输入是独立操作，按库公开接口的作用范围执行。再次启动重新装配能力、打开 Storage 并恢复，不从 UI 历史重放输入。开机自启不在本轮范围。

## 配置所有权

Runner 的期望配置以 `runner.json` 和 `bots/<id>/bot.json` 为权威来源，UI 与独立编辑器修改同一份文件。UI 自己拥有主题、窗口和本地选择等偏好，不保存另一份权威 Bot 配置。Provider 密钥保存在安全凭据设施，JSON 只保存引用。

默认数据目录为 `~/.agentchat`，允许 `AGENTCHAT_DATA_DIR` 指定绝对路径；不迁移旧目录、格式或数据库。若系统未提供 Node 24+，初始化先尝试 Homebrew、winget 或满足版本要求的 apt；包管理器失败时将校验后的 Node 发行包安装到该数据目录下的 `runtimes/node-v24`，不修改用户 PATH，也不替换已有系统 Node。目录和字段见[配置集成设计](architecture/01-pi-durable.md#配置文件)。

- 启动或显式重载读取文件，第一阶段不做文件监听。
- UI 保存需携带读取时的内容版本；发现外部修改拒绝覆盖，Runner 原子写入。
- 无效重载保留已加载的有效配置并报告未生效内容；冷启动无效 Bot 单独禁用，必要 Runner 配置无效时保持可诊断而不执行。
- Harness 动态 settings 与 Agent 持久选择分开；Provider 声明等进程资源变化需重启。

## Bot 与工作区

Bot 拥有稳定 ID、名称、归档状态、默认模型、思考级别、指令、能力选择和工作区。创建时将 `botDefaults` 具体化写入 Bot 文件；后续修改默认模板不影响已有 Bot。

Agent 指令选择内联 `instructions` 或独立 `instructionsFile`，两者排他；显式重载时读取内容，创建执行时保存有效内容。已有执行不自动追随 Bot 文件变化，空闲时才能显式应用新配置。快照保存选择和内容，不冻结能力代码、凭据或全局 settings。

每个 Bot 自动分配稳定默认工作区，也可以使用外部项目目录。同一 Bot 的多个执行默认共享文件，没有自动目录副本或并发隔离。cwd 不构成路径权限或 OS 沙箱；修改默认目录不隐式移动既有执行。

Bot 记忆按稳定 Bot ID 跨该 Bot 的对话共享，保存在 Runner 的 pi-durable Session 文档中。用户可以查看、编辑和清空；每次保存带 revision 以拒绝过期编辑。每次模型请求最多注入 2,000 个 Unicode 字符，记忆由用户维护且来源与更新时间可见；首版不自动写入或检索历史。

归档或配置缺失禁止从 Bot 新建执行上下文；删除或移动 `bot.json` 不删除历史、不清理工作区、不取消已接纳工作。归档、取消、删除历史与清理各自独立。

## 输入、目标与多端

Runner 通过库 Conversation.submit 接纳输入，稳定 requestId 用于重试查找 Submission；网络超时不能推断未接纳。Submission、Run、Task 与工作目标完成状态不同，目标完成由用户确认。

附件输入的完整用户消息由 pi-durable 持久化在本机 `runner.sqlite` 的 Conversation Entry 中，包含文本附件正文和图片数据，用于上下文重建与执行恢复；因此附件不能视为只在当前请求中存在。聊天快照另用应用 Entry 元数据投影用户输入及附件文件名/类型，不包含文本文件正文或图片字节。选择附件时，UI 会告知这一持久化行为。

未来客户端明确区分本机待发送、Relay 等待、Runner 已接纳及回答/拒绝状态。网络 Outbox 只负责投递，不替代 pi.inbox。多个执行的调度由 Harness 提供，不自建全局调度器，也不承诺尚未验证的总执行上限。

UI 断线不停止执行；Runner 真正离线时，未来 Relay 可以保存请求等待接纳。手机退出或进入后台只影响自身同步，后台行为受移动系统限制。多端可靠性、配对、撤销和迟到控制仍需专项设计与验证，见[多端与 Relay](architecture/02-multi-device.md)。

## 扩展与验收范围

Runner 装配随包 Extension，并支持在 `runner.json` 中显式配置本机 stdio MCP Server。MCP 发现的 Tool 只会进入能力选择器，不自动授予已有 Bot；只有 Bot 已选择的 Extension/Tool 才能执行。MCP 首版不支持远程 Server 或凭据型 Server，也没有逐次工具调用审核。模型通过可配置的供应商接入实例提供，默认可选内置 pi 供应商；不纳入计划模式。暂不支持任意脚本插件装载、多租户或服务端部署，也不把 MCP 子进程视为 OS 沙箱。

本机验收需覆盖文件初始化与重载、冲突保护、无效配置修复、指令快照、Bot 缺失、共享工作区、独立后台连接与重复启动排除。生命周期验收需分别验证 UI 退出后继续执行、显式停止、重开恢复以及独立取消；safe replay 和 interrupted 工具遵循库契约。此前 macOS arm64 release `.app`（当时随包 Node）完成了构建和临时目录冒烟；当前版本已移除随包 Node，并实现 Node 24+ 检测和安装回退，但新初始化/安装流程仍需在目标平台验收。真实 Provider、interrupted 工具和其他平台结果仍需独立报告，不从旧测试推导。

多端、外部消息渠道、定时触发、主动推送、多 Runner 调度/迁移、自动记忆整理与检索、自动跨 Bot 协作仍为后续范围。
