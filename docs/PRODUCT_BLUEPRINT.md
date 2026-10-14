# AgentChat 产品蓝图

版本：v0.5
状态：已确认的方向与设计基线，尚未实现

## 产品定位

AgentChat 是支持多端聊天和工作管理的本机 Agent 工作台。用户选择具名 Bot，通过 Conversation 持续协作、提交输入、查看执行过程并跟进工作目标；Agent 运行在用户的桌面 Runner 上。

桌面端和 iOS/Android 客户端通过 Relay 同步，可跨网络访问，无需手机与桌面处于同一局域网。每台 Device 保有本地展示数据与待发送输入；手机不运行 Agent。

类似 Grok bot 的持续对话是交互目标。Telegram、Discord 等外部消息渠道、定时触发与主动推送为后续方向；联网搜索未来通过 Skill/MCP 扩展，本轮不设计其实现。

## 实现原则

所有 Agent 执行围绕 pi-durable 的公开能力构建。应用负责 Bot、工作目标、界面、多端通信和平台装配；模型循环、输入接纳、会话排队、Task 调度、检查点、取消与恢复全部交给 Harness。

承载进程只是运行库并连接应用入口，不实现另一套 runtime。库缺少的能力先验证公开 API 或降低首发承诺，不自建执行引擎、持久化调度器或通用恢复框架。

## 统一概念

以[术语表](../GLOSSARY.md)为准：Agent 是 Conversation 执行配置；Bot 是应用档案；Task 专指 pi-durable 的持久化状态机。Identity、Device、Runner 和 Relay 是多端应用概念，不声称由 pi-durable 提供。

聊天入口和工作管理入口组织同一批 Conversation。原“产品任务”表达为带工作目标的 Conversation，目标说明和用户确认的状态保存为 Document。

## Bot 与 Conversation

Bot 独立设置 model、thinkingLevel、instructions、Extension/Tool 选择与默认 cwd，并绑定 Runner。首发只有一个桌面 Runner，所有 Bot 共用该 Runner 的 Harness；不引入跨 Runner 调度或迁移。

Provider 配置集中管理，Bot 引用 Provider。凭据集中留在 Runner 安全存储中，不进入 Bot 快照或同步到手机。移动端显示连接状态与可选模型；首发凭据配置入口在桌面。

一个 Bot 可以创建多个 Conversation。创建时复制默认 Agent 配置与 Bot 版本，允许覆盖 cwd；已有 Conversation 不自动跟随配置编辑。空闲时可显式应用最新配置。

归档 Bot 阻止从它创建新 Conversation，保留已有 Conversation 和恢复关联。配置变更由所属 Runner 确认，客户端同步其结果。

## 多端聊天

任一已配对 Device 可查看已同步历史并保存输入。发送过程明确区分：

1. 本机已保存，等待上传。
2. 已交给 Relay，等待 Runner 接纳。
3. Runner 已接纳为 Submission，排队或正在运行。
4. 已得到回答，或显示未回答原因。

前两步不是 Submission，也不显示为 Agent 已运行。网络恢复或 Runner 上线后自动继续投递；重试保持稳定 ID，避免创建重复输入。客户端可以在展示中先显示待发送行，Runner 接纳后与对应 Entry 合并。

同一 Conversation 的多端输入通过 submit 进入 Runner 上同一个 pi.inbox，不按设备时钟假定执行顺序。不同 Conversation 的执行由 Harness 调度；首发不自建总并发调度器。全局执行上限待库公开能力验证，不视为已实现保证。

正在生成的回复和工具状态通过 Projection 同步。断线不停止 Run，重连拉取更新；最后同步的“运行中”状态需同时标注 Runner 的在线状态，不能当作当前存活证明。

## 工作目标与控制

用户可直接创建带目标的 Conversation 并开始运行，也可为已有 Conversation 添加目标。工作管理入口展示目标、状态和相关执行视图。

Submission done、Run 结束或 Task completed 不自动意味着目标完成；首发由用户确认。

已接纳工作使用 Submission.abort 或 Conversation.abort。停止请求送达 Runner 后按库的当前状态与作用范围返回结果；Runner 离线时不宣称停止生效，也不把迟到的停止请求自动作用到新的工作。

客户端仅能直接移除尚未上传的本机输入；输入上传或被接纳后，按实际提交状态查询和控制，不承诺应用自建的跨网络回滚。

## 离线与生命周期

Relay 可达而 Runner 离线时，客户端仍可同步历史并提交待执行输入。网络不可用时，输入保存在本机 Outbox，恢复连接后上传；已经下载的历史仍可阅读，未同步内容不能假装可用。

保留已确认的生命周期：关闭桌面应用窗口进入退出路径，不维持托盘常驻；Runner 停止本机执行与同步。Relay 和其他 Device 不随它退出。桌面重新启动后恢复已接纳的持久化工作，并接收等待中的请求。

退出关闭 Harness，不等同于主动 abort 全部工作。手机退到后台或退出只影响它的同步，具体后台能力受系统限制；不承诺后台常驻或首发推送。

## 扩展与目录

不另建逐 Bot 工具审批体系；采用启用的 Extension/Tool 及其执行约定。设备认证与远程请求校验仍是多端访问必需边界。

cwd 仅是默认工作目录，不提供目录外访问阻断或 OS 沙箱。Skill/MCP 接入需要适配，不能因依赖存在而声称已有能力。

## 验收范围

- 两个不同配置的 Bot 可以分别创建多个 Conversation，配置快照与归档语义正确。
- 桌面和手机跨网络查看同一 Conversation，提交结果最终一致。
- 客户端断网、Runner 离线及 Relay 重启后，输入可继续投递且不重复成为 Submission。
- 回复、工具和目标状态可同步；慢设备和断线不阻塞执行。
- 退出后停止执行，重启后恢复；覆盖 safe replay 与 interrupted 工具。
- 设备配对、撤销、请求签名校验与凭据不进入聊天 Projection 可验证。
- 停止与撤回状态真实；目标完成仍由用户确认。

## 后续范围

首发不承诺多 Runner 调度/迁移、群聊、外部消息渠道、独立常驻服务、调度、主动推送、OS 隔离、独立长期记忆系统或跨 Bot 自动协作。

具体工程边界与待验证项见[架构总览](architecture/00-overview.md)。多端和离线投递是应用目标；端到端导出可靠性、迟到控制请求和打包需验证，不因使用 pi-durable 就宣称全部网络能力现成。
