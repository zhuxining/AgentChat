# AgentChat

所有执行机制直接采用 pi-durable，应用不自建 runtime。执行领域沿用库术语，多端通信新增概念单独标记。英文名称作为文档、类型和接口的统一名称，中文用于解释。

## 执行领域

**Harness（执行器）**：打开一份 Storage 并驱动其中 Conversation 与 Task 的执行资源。关闭并重新打开 Harness 不会将持久化工作变为新的工作。
_Avoid_：Bot 进程、设备身份

**Session（持久化会话集合）**：一份 Storage 中的持久化范围，包含多个 Conversation、Document 与 Task。
_Avoid_：聊天、账户、跨设备共享数据库

**Conversation（对话）**：由不可变 Entry 组成的交互记录，具有自己的 Agent 配置。它可以承载自由对话或带目标的持续工作。
_Avoid_：Context Segment、每个 Bot 唯一聊天

**Agent（执行配置）**：一个 Conversation 使用的模型、thinking level、Extension、Tool、instructions 和 cwd 等执行选择。
_Avoid_：Bot、数字分身、进程

**Entry（记录）**：Conversation 中的一条不可变记录，可表示用户输入、模型响应、工具结果或其他已提交内容。
_Avoid_：客户端待发送输入、独立 Message 事实源

**Document（状态文档）**：与执行记录共同持久化的类型化 JSON 状态，可属于 Session、Conversation 或 Task。
_Avoid_：Entry、客户端全部本地数据

**Commit（原子提交）**：一组共同生效的执行持久化更改，可包含追加 Entry、修改 Document 和创建 Task。
_Avoid_：跨设备事务、先展示后保存

**Submission（输入提交）**：被 Conversation 接纳的输入或待写 Entry，具有可跟踪的结算结果。
_Avoid_：传输请求、尚未到达 Runner 的输入、Task

**Turn（轮次）**：一次模型响应及其工具调用。
_Avoid_：Run、目标完成

**Run（运行）**：从一个输入到最终回答所经历的 Turn 序列。Run 结束不代表用户的工作目标已经完成。
_Avoid_：Job、网络投递

**Task（持久化执行任务）**：具有检查点和所有者的持久化状态机，用于模型生成、工具调用或自定义执行工作。
_Avoid_：待发送请求、目标说明、工作清单

**TaskRuntime（任务调用接口）**：Harness 在一个 Task 阶段执行时提供的提交、读取、等待、子任务和环境能力接口。其生命周期属于该次调用。
_Avoid_：独立服务、应用自建 runtime、Node 进程

**Task Graph（任务图）**：Session 中存活 Task 的状态与所有权关系视图。
_Avoid_：全部历史任务列表、用户工作清单

**Extension（扩展）**：具名的 Tool、提示词 section、hook、wrapper 和 Task 定义集合。
_Avoid_：Skill 或 MCP 的自动同义词

**Registry（扩展注册表）**：当前执行进程安装的 Extension 集合；Conversation 按名称选择其中的能力。
_Avoid_：持久化扩展代码、Bot 配置

**ExecutionEnv（执行环境）**：执行文件和进程操作的环境；cwd 是工作目录，不代表文件系统隔离。
_Avoid_：目录沙箱、工作区权限

## 应用与多端领域

**Bot（应用概念）**：有稳定身份、名称和默认 Agent 配置的档案，指定创建其 Conversation 的 Runner。归档 Bot 保留既有 Conversation 的关联。
_Avoid_：Agent、Harness、独立进程

**工作目标（应用概念）**：Conversation 所承载工作的目标说明和由用户确认的完成状态。
_Avoid_：Task、Run outcome、Submission status

**Identity（应用概念）**：一组已配对 Device 的共同身份与加密信任范围。
_Avoid_：Session、单台宿主

**Device（应用概念）**：持有独立设备身份、本地同步数据和发送能力的已配对设备。
_Avoid_：只读远程窗口、独立 Agent

**Runner（应用概念）**：承载 pi-durable Harness 的 Device。首发使用一个桌面 Runner，手机仅作为 Device，Runner 不代表另一套执行引擎。
_Avoid_：每个 Bot 一个进程、Relay

**Device Core（应用模块）**：Device 的身份、本地展示数据、投递与同步能力集合。
_Avoid_：Harness、Agent runtime

**Relay（应用模块）**：存储与投递设备加密数据、提供同步通知与在线状态的服务。
_Avoid_：Agent 云执行器、桌面局域网 API

**Request Envelope（应用概念）**：发往指定 Runner 的签名加密操作请求，可在执行接纳之前排队。
_Avoid_：Submission、Run、Job

**Projection（应用概念）**：从所属 Runner 的已提交状态生成的、供客户端展示的可同步数据。
_Avoid_：另一份执行事实源、完整 Storage 副本

**Outbox（应用概念）**：Device 持久化保存的待上传数据与 Request Envelope。
_Avoid_：pi.inbox、模型 follow-up 队列
