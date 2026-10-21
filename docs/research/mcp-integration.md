# AgentChat 阶段三 MCP 接入研究

> 研究与实现记录：2026-10-20。SDK、Runner 源码和锁文件已接入；本文保留一手资料和边界记录。桌面进程退出行为仍待实机验证。

## 结论

MCP 已接入 Node Runner：Runner 持有 Pi Harness、Registry、SDK Client 与 stdio 子进程；Bot 用已保存的 `agent.extensions` / `agent.tools` 选择可用能力。配置权威为 runner.json 的可选 mcpServers 数组，设置页显示连接和发现状态。动态发现不自动给 Bot 增加 Tool。

实现使用官方 TypeScript SDK v2 客户端 `@modelcontextprotocol/client@2.3.1` 和本机 stdio transport。远程 Streamable HTTP、OAuth 与自动重连未接入。Pi Tool 参数使用 TypeBox schema；Runner 将受支持的 MCP JSON Schema 子集转换为 TypeBox，无法转换的工具会跳过并计数。

本方案**不包含逐次 Tool 调用审核或审批**。能力边界继续由 Bot 的显式 Extension/Tool 配置决定；MCP Server 的连接与可用状态不能绕过该配置。

## 官方 MCP TypeScript SDK

### 包与版本

- v2 是官方 SDK 的稳定主线，按能力拆分包。客户端依赖使用 `@modelcontextprotocol/client`，不应把 v1 的聚合包 `@modelcontextprotocol/sdk` 当作新接入的默认选项。官方 [v2 客户端包说明](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/packages/client/README.md) 与 [v2 迁移指南](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/migration/upgrade-to-v2.md)记录了包拆分。
- 截至 2026-10-20，官方 [releases](https://github.com/modelcontextprotocol/typescript-sdk/releases) 最新稳定发布为 `@modelcontextprotocol/client` 2.3.1。官方 [v2 roadmap](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/ROADMAP.md)说明 v2 面向 2026-07-28 协议修订；v1.x 仍按迁移政策维护，但新协议修订进入 v2。版本与支持窗口可能变化，真正添加依赖时再核对 release 与 lockfile。
- AgentChat 在 [`runner/package.json`](../../runner/package.json#L10-L15) 声明 `@modelcontextprotocol/client@2.3.1` 为直接依赖，并已更新 bun.lock。锁文件中的旧 `@modelcontextprotocol/sdk@1.32.1` 仍是其他依赖的 peer 解析项，不是本集成使用的包。

### Client 与 transport API

官方 [Client 连接指南](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/clients/connect.md) 给出的 v2 形态是创建 `Client({ name, version })`，选择并连接 transport，再在生命周期结束时 `close()`。工具调用指南中的客户端操作为 `listTools()` 与 `callTool({ name, arguments })`；`listTools()` 返回工具描述和 JSON Schema，调用结果需检查 `isError`。协议错误会以异常报告。Pi 侧适配器可以把这些操作包在 Pi Tool 的 `execute` 中，而无须让业务组件直接调用 MCP SDK。

| Transport | 官方 API                                                                                            | 本研究建议                                                                               |
| --------- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| 本机进程  | `StdioClientTransport`，从 `@modelcontextprotocol/client/stdio` 导入；SDK 启动子进程并以 stdio 传输 | 已接入首阶段。命令和参数来自严格解析的配置；正常关闭会关闭连接，桌面进程树行为仍待验证。 |
| HTTP      | `StreamableHTTPClientTransport`，从 `@modelcontextprotocol/client` 导入                             | 后续单独确认。涉及远端来源、认证、网络边界和重连策略。                                   |
| 旧式 SSE  | `SSEClientTransport`                                                                                | 不作为初始支持面；仅在确认目标 Server 无法使用 Streamable HTTP 时再评估兼容性。          |

API 和 transport 选择参见官方 [连接指南](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/clients/connect.md)、[首个客户端教程](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/get-started/first-client.md)及 [工具调用指南](https://ts.sdk.modelcontextprotocol.io/v2/clients/calling)。SDK 连接指南列出的协议协商模式也会随协议版本变化，AgentChat 是否启用新版本协商应在实施时明确，不应从示例默认值推断产品要求。

## AgentChat 当前接入边界

### Runner、配置与能力解析

- 实际 Runner 是由 Tauri Host 启动的 **Node 子进程**：[`transport.rs`](../../src-tauri/src/runner/transport.rs#L14-L50) 解析 Node runtime 并启动 Runner entry；[`runner/src/main.ts`](../../runner/src/main.ts#L1-L21) 装配 Runner。Bun 是仓库工具链及构建器，不是运行中的 Runner 子进程。
- Runner 配置有严格解析边界；`mcpServers` 是可选字段，缺省为空数组，兼容现有 `schemaVersion` 1/2。Server 的 `id`、`name`、`command`、参数数组和可选工作目录均有字段/长度校验，不接受自定义 `env`。`cwd` 非空时按 Node `resolve(dataDir, cwd)` 解析：相对路径以数据目录为基准，绝对路径保持原位置，`..` 可以离开数据目录，`~` 不做展开。它只设置本机 MCP 子进程的工作目录，不构成路径授权或 OS 沙箱；命令本身也按用户权限运行。Bot 保存 Extension/Tool 的精确名称列表。见 [`schema.ts`](../../runner/src/config/schema.ts) 与 [`mcp.ts`](../../runner/src/harness/mcp.ts)；配置权威仍是 Runner 解析的 runner.json。
- 当前 [`registry.ts`](../../runner/src/harness/registry.ts#L1-L11) 创建 Pi Registry 并安装随包的 `coding-tools` 与 `work-goal`。[`agent.ts`](../../runner/src/harness/agent.ts#L15-L52) 按 Bot 的名称解析具体 Extension 和 Tool，并验证 Tool 所属 Extension 已选择；不可用能力会被报告，已有执行路径对缺失能力失败关闭，见 [`shared.ts`](../../runner/src/harness/operations/shared.ts#L31-L50)。架构文档也明确：新注册能力不自动进入已有 Bot，当前不动态加载任意代码，Skill/MCP 需要独立适配，见 [`01-pi-durable.md`](../architecture/01-pi-durable.md#L124-L126) 和 [Extension 边界](../architecture/01-pi-durable.md#L205-L211)。

### pi-durable 1.3.0 的动态注册面

仓库锁定的版本为 [`@earendil-works/pi-durable@1.3.0`](../../bun.lock#L200-L200)，Runner 直接依赖声明见 [`runner/package.json`](../../runner/package.json#L10-L14)。我检查了当前安装包的 v1.3.0 TypeScript 声明（`node_modules` 内容不是源码控制文件，实施时应以锁定包/API 再确认）：`Extension` 是包含名称、Tools、sections、hooks、wraps、tasks 等能力的具名对象；Registry 提供快照、订阅、`install` 和按名称 `uninstall`。安装同名 Extension 会替换旧对象；快照不可变，Tools 可以跨 Extension 重名。声明位置为 [`types.d.ts`](../../runner/node_modules/@earendil-works/pi-durable/dist/harness/types.d.ts#L305-L345)；`ToolRegistration` 的 `parameters`、`execute` 等字段见 [`types.d.ts`](../../runner/node_modules/@earendil-works/pi-durable/dist/harness/types.d.ts#L238-L270)。

Runner 已为每个已配置 Server 构造稳定命名的 Extension，并把发现的 Tool 包成 `ToolRegistration`。启动、配置保存或重载时由 Runner 管理 Registry 的安装、替换和移除；不能把 Extension 名称当成动态代码加载入口。Pi Agent resolver 仍以 Bot 已保存的名称选择能力，因此发现或重新连接不会自动扩大现有 Bot 的能力。

参数桥接已实现：根 `inputSchema` 必须显式声明 `type: "object"`；`const`/`enum` 值必须与声明类型兼容，否则工具会跳过，避免生成互相矛盾的参数约束。转换器支持对象及必需/可选属性、数组、字符串/数字边界、枚举、常量、正则和嵌套对象；为避免正则回溯阻塞 Runner，`pattern` 不支持分组、择一或反向引用，含重复量词时必须以 `^` 开始且最多一个量词。未知关键字、超出资源限制或不受支持的结构会使该工具跳过。Harness 在执行前验证 TypeBox 参数，随后将同一参数对象交给 MCP `callTool`。工具内部名以 Server id、原始名称摘要命名，显示名保留 Server 名和 MCP 原名。调用结果最多传递 32 KiB UTF-8 文本；图片、结构化数据和其他非文本块不透传，但会在模型可见的工具结果中明确提示。

### Rust Host、NativeAdapter 与 Tauri IPC

- Runner 与 Tauri 之间已有基于 stdin/stdout 的请求/响应通道。Rust [`transport.rs`](../../src-tauri/src/runner/transport.rs#L288-L335) 读取 Runner 发起的 Native 请求；Runner 的 [`NativeAdapter`](../../runner/src/communication/native.ts#L7-L13) 当前提供 provider credential 读写/删除、环境变量读取与文件存在性检查。Rust [`credentials.rs`](../../src-tauri/src/credentials.rs#L15-L21) 区分 Keyring、环境变量和文件来源；[`credentials.rs`](../../src-tauri/src/credentials.rs#L54-L103) 当前只实现对应 Native 操作，并非通用 MCP OAuth/token 管理接口。MCP 凭据模型、按 Server 隔离方式、授权生命周期和删除语义仍需确认；不得写进 Runner 配置、前端持久状态或日志，这也符合阶段计划的要求 ([feature alignment](../plans/feature-alignment.md#L27-L31))。
- 当前 Tauri 暴露的自定义命令由 [`lib.rs`](../../src-tauri/src/lib.rs#L49-L58) 集中注册，`runner_request` 是 [`commands/mod.rs`](../../src-tauri/src/commands/mod.rs#L20-L27) 的类型化边界。Runner 请求以 tagged union 定义，见 [`protocol.rs`](../../src-tauri/src/runner/protocol.rs#L1-L19)；前端统一由 [`runner-client.ts`](../../src/app/runner-client.ts#L132-L160) 调用，业务视图不应散落 `invoke`。
- 设置页直接使用现有 initialize 响应展示 MCP 状态；配置继续由既有 Configuration Editor 编辑 runner.json，没有新增 Tauri Command、Capability 或前端任意调用 MCP 的 IPC。Tool 调用只通过 Harness 和 Bot 已选能力发生。
- `StdioClientTransport` 子进程由 Runner 管理器持有。配置保存/重载会同步 Server，单个连接失败会隔离，正常 Runner 关闭会关闭 Client 和 transport。Rust Host 异常终止 Runner 时的后代进程回收，以及 macOS/Windows 的进程树行为，尚未做桌面验证。

## Lorca 产品行为参考

参考 [`mcp-servers.md`](/Users/zhuxining/Code/lorca/docs/architecture/mcp-servers.md)，但 Lorca 是产品行为参考，不是 AgentChat 架构规范。AgentChat 已采用显式配置、连接状态和工具发现状态呈现；配置保存或重载会触发同步。连接失败时设置页显示状态，Bot 保留已选能力名称，但不可用能力不会被解析为可执行工具。

不宜直接复制其多应用配置归一化/导入、命令插件 API、tool exposure/hide 管理、配置目录约定、OAuth UX、旧式 SSE 兼容面或其他产品的命令范围（L3-L5、L13、L19-L25、L29-L42）。AgentChat 已有 Runner 配置权威、Bot 显式能力清单和 NativeAdapter/Host 生命周期；MCP Server 数据应接入这些边界，而不是平行引入另一套全局配置系统。Lorca 文档 L42 提及的命令自动审核不属于本研究方案；不设计逐次调用审核或审批。

## 分阶段建议

### 已落地的 v1 契约

本轮已确认：MCP Tool 只由 Bot 的 Extension/Tool 清单控制，不增加逐次调用审核、审批或确认。

| 项目        | 当前实现                                                                                                                                        |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Transport   | 本机 stdio；未接 HTTP、SSE、OAuth 或自动重连。                                                                                                  |
| 配置        | runner.json 可选 mcpServers；缺省为空数组，schemaVersion 1/2 均兼容。字段严格校验，不允许自定义 env。                                           |
| Server 标识 | 稳定 id；Extension 名称按 id 生成，改显示名不改变 Bot 的能力引用。                                                                              |
| 进程启动    | 命令与参数数组分别传给 SDK，不经 shell；SDK 默认只继承其安全变量白名单。由 Runner 关闭 Client/transport。                                       |
| 凭据        | 未支持凭据字段与 MCP 专用系统凭据存储；需凭据的 Server 暂不纳入 v1。                                                                            |
| 能力命名    | Tool 内部名含 Server id、原始名称 slug 和摘要；UI 显示 Server 名与原始 Tool 名，避免跨 Server 重名。                                            |
| 发现与刷新  | Runner 启动、配置保存和重载时连接/同步；失败状态单独显示，Bot 仅执行已选能力。没有逐次调用审核。                                                |
| 参数 Schema | 转换保守子集为 TypeBox；不支持 Schema 的 Tool 跳过并计数，Harness 在调用前校验参数。                                                            |
| 诊断        | 设置页显示状态、工具数、跳过数和安全摘要；不显示 stderr、调用参数或原始错误。工具结果最多保留 32 KiB UTF-8 文本；被忽略的非文本内容会明确提示。 |

实现沿用现有配置编辑器、Runner Registry 和 Bot 能力选择，不新增 Tauri 命令或前端直接调用 MCP 的 IPC。

### 阶段 0：已完成的契约选择

1. 配置权威定为 runner.json；mcpServers 可选，不变更 schemaVersion。
2. JSON Schema 转换子集和拒绝行为已落到 Runner 适配器。
3. v1 不接凭据；配置没有 env 字段，命令与参数分开传递且不经 shell。
4. Runner 启动、配置保存和重载时同步连接；连接状态显示在设置页。
5. Bot 选择控制调用，不添加逐次工具调用审核、审批或确认。

### 阶段 1：本机 stdio Server 生命周期（源码已接入，桌面退出验证待完成）

- 已固定官方 v2 Client 2.3.1；Runner 管理每个 Server 的 Client、transport 和状态。
- 配置保存/重载同步 Server；连接失败、协议错误和退出不会影响其他 Server。无自动重试。
- 每个 Server 形成稳定 Extension；工具变更写入 Registry；Bot 保持显式能力选择。
- 工具调用错误输出固定摘要，不包含远端错误和参数；仅文本输出且限长。
- 正常 Runner 关闭会关闭 Client/transport；待真实桌面验证退出与进程树回收。凭据仍未接入。

### 阶段 2：远程与后续体验（单独确认后）

只有明确用户场景后再支持 `StreamableHTTPClientTransport`，并分别设计服务来源信任、HTTPS/主机限制、认证存储与续期、连接恢复和凭据失效状态。MCP 官方 [本机 Server 安全指南](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/docs/2026-07-28/tutorials/security/local-server-security.mdx)提醒 stdio Server 与客户端进程共享本机用户权限，SDK 本身不是沙箱；因此本机命令配置也需要清楚呈现其启动效果。远程 URL 与凭据同样是安全边界。上述风险应由配置和连接策略解决，不引入每次工具调用审批。

## 后续范围与主要风险

| 范围           | 当前处理                                                                             | 后续风险                                                                          |
| -------------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| 远程 transport | 暂不支持 HTTP、SSE、OAuth                                                            | 后续需确定远端来源信任、HTTPS/主机限制、认证生命周期和连接恢复策略。              |
| 配置权威       | 已定为 runner.json 的可选 `mcpServers`，无 schemaVersion 迁移                        | Server 配置以本机用户权限启动进程，配置体验需让启动行为清楚可见。                 |
| 进程清理       | Runner 正常关闭时关闭 Client/stdio transport                                         | Runner 异常退出后的后代进程回收及 macOS/Windows 实际行为尚未桌面验证。            |
| 凭据           | v1 不支持自定义环境变量或凭据字段                                                    | 需凭据的 Server、OAuth/token 和按 Server 隔离的系统安全存储仍待单独设计。         |
| Schema 与命名  | 已实现受限 JSON Schema 到 TypeBox 转换；内部名称包含稳定 Server id 和原工具名摘要    | 不支持的结构或关键字会跳过工具并计数；工具改名或消失会使 Bot 已保存的引用不可用。 |
| 发现与重试     | 启动、配置保存和重载时发现；无后台自动重试                                           | Server 运行中断后需用户重载配置触发再次连接；工具目录变化只在同步时更新。         |
| 状态与错误     | 设置页显示连接、可用工具数、跳过数和安全摘要；调用错误固定摘要，结果限为 32 KiB 文本 | 不呈现原始 stderr、远端错误正文、调用参数或非文本结果，故障诊断信息有限。         |

## 主要来源

### 官方一手资料

- [TypeScript SDK Releases](https://github.com/modelcontextprotocol/typescript-sdk/releases)
- [v2 Roadmap](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/ROADMAP.md)
- [Client package README](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/packages/client/README.md)
- [Connect to a server](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/clients/connect.md)
- [First MCP client](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/get-started/first-client.md)
- [Calling tools](https://ts.sdk.modelcontextprotocol.io/v2/clients/calling)
- [Upgrade to v2](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/migration/upgrade-to-v2.md)
- [MCP local server security](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/docs/2026-07-28/tutorials/security/local-server-security.mdx)

### 仓库与产品参考

- [阶段三计划](../plans/feature-alignment.md#L27-L31)
- [pi-durable 架构边界](../architecture/01-pi-durable.md#L205-L211)
- [AgentChat 当前 Runner/IPC/Host 源码](../../runner/src/harness/registry.ts#L1-L11)、[配置 schema](../../runner/src/config/schema.ts#L202-L277)、[NativeAdapter](../../runner/src/communication/native.ts#L7-L13)、[Tauri Runner transport](../../src-tauri/src/runner/transport.rs#L14-L50)
- [Lorca MCP servers 架构参考](/Users/zhuxining/Code/lorca/docs/architecture/mcp-servers.md#L3-L48)
