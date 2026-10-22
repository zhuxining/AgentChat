# AgentChat 功能完善路线

## 目标与边界

以 AgentChat 与 pi-durable 的实际能力为基础，逐步补齐本机 Agent 工作台的关键体验。每阶段先确认事实来源、权限边界、恢复行为和验收条件，再进入实现。Lorca 文档用于参考产品行为与实现取舍；AgentChat 源码、pi-durable 公开接口和本仓库安全约束仍是最终依据。

Bot 的 Tool 列表定义它可用的能力。附件只作为本次输入上下文，不扩大 Tool 列表，也不改变工作目录权限。MCP Server 和自动化采用显式配置；Tool 是否可用由 Bot 的能力清单决定，不增加逐次工具调用审核。

## 阶段一：文件附件

**状态：选择、预览、移除、按 Conversation 隔离草稿、同 requestId 重试、总量限制、提交前拒绝恢复，以及 Runner 暂停/重启时清理未发送附件已接入源码；桌面真实发送、丢失响应后的重试、会话切换恢复及失效附件等验收仍待完成。**

为聊天输入增加本机文件选择和清晰的附件预览。首版支持常见文本与图片格式，限制每条消息最多 3 个附件、单个文本文件 4 MiB、单张图片 3 MiB、总量 8 MiB。Rust 使用系统文件选择器，将文件复制到应用私有暂存目录并返回不透明 ID；Runner 只接收 ID 与显示名称，并在读取时重新校验类型、大小、文件类型和暂存目录边界。

附件文件名在选择、Runner 入口与消息投影处统一拒绝控制字符、双向文本控制符和 Unicode 行/段落分隔符，避免文件名伪装或注入附件提示标签的结构；Rust 与 Runner 都按 Unicode 码点限制 255 个字符，避免 JavaScript UTF-16 长度对非 BMP 字符产生额外拒绝。

pi-durable 会把完整用户消息写入持久化 Conversation Entry，以便上下文重建和执行恢复；文本附件正文和图片数据（Base64）因此会保存在本机 `runner.sqlite`，不能视为仅用于单次请求的临时内容。聊天快照通过应用 Entry 元数据投影用户输入与附件文件名/类型，不返回文本附件正文或图片字节。旧版 `pi.user` 附件记录在发现文本附件标记时会隐藏该消息剩余部分，避免历史正文继续进入 UI 快照。选择附件时，输入框会说明这项持久化行为。

系统文件选择器支持一次多选，并按当前消息剩余名额限制所选数量；用户也可以分多次添加，前端仍会统一检查附件总大小。

草稿按 Conversation 隔离并仅保存在内存。发送重试复用同一 requestId 和附件引用；确认 Runner 接纳后清理暂存文件。选择、移除、发送和清理失败都要给出明确状态。

Runner 停止或重启时，未发送附件从草稿移除并清理暂存文件，聊天文本保留；结果尚未确认的提交保留其附件引用供同 requestId 重试。系统文件选择器若在 Runner 生命周期切换期间返回，所选文件会被丢弃，不会重新写入草稿。

多次选择时，前端把已有草稿和新暂存附件合并计算 8 MiB 上限；超限会清理本次新暂存项并保留原草稿。Runner 在调用 Harness 接纳前完成配置与附件校验；含图片的输入还会核对当前会话模型是否声明支持图片，明确拒绝时保留可编辑草稿；只有接纳调用本身发生异常时才保留待确认提交和原 requestId。

验收：选择、移除、附件单独发送、重试和会话切换行为一致；大文件、失效 ID、目录穿越、符号链接越界和不支持格式都明确失败；应用退出或 Runner 重启后，不会误用上次未发送的附件。

## 阶段二：运行用量与执行观测

**状态：Conversation 级及按模型聚合的 Token 与可用模型计价已接入。研究确认当前 pi-durable 公开契约不提供准确模型请求次数或 Task 级用量明细；调用次数继续显示为暂不可用，桌面验收待完成。**

会话快照从 pi-durable 的 `UsageDoc` 读取输入、输出、缓存读写和累计 Token，并在模型价格数据完整时展示 USD 模型计价；用量弹层也按 `provider/model` 展示 Token 和可用计价。该金额来自模型元数据的计价，不代表订阅的实际账单；只要有 Token 用量的模型缺少正向价格数据，就不汇总显示金额。`UsageDoc` 按 Conversation 聚合且没有请求记录或 Task 归属；助手消息数、Task 数和 Provider 包装层调用数都不能替代准确请求数。当前页面单独展示模型调用次数暂不可用，执行中的 Task 状态仍由已有任务快照展示。准确次数和 Task 用量须先有可持久化、可恢复的单次模型调用记录，具体边界见[用量可观测性研究](../research/pi-durable-usage-observability.md)。

验收：累计值与底层 Usage 文档一致；Provider 未返回用量和模型价格缺失都能表达；按模型展示时与 UsageDoc 分桶一致。代码已接入，桌面流程验收仍待完成。若后续加入单次请求记录，再验证重试、取消和 Runner 恢复的计数幂等性。

## 阶段三：MCP 与外部工具

**状态：Runner 已接入官方 MCP TypeScript SDK 2.3.1 的本机 stdio Client。runner.json 可选配置 mcpServers；Runner 在启动、配置保存和重载时同步 Server 进程及 Registry。发现的工具出现在 Bot 能力选择器中，Bot 只执行已选 Extension/Tool。设置页显示连接状态、可用工具数和被跳过的工具数，并提示本机进程权限与隔离边界。没有逐次工具调用审核流程。**

配置字段经过严格解析，不支持环境变量注入；首版不接远程 transport 或凭据型 Server。MCP JSON Schema 的受支持子集会转换成 Harness TypeBox 参数校验；根 `inputSchema` 必须显式声明 `type: "object"`，与声明类型矛盾的 `const`/`enum` 及其他不支持结构会使工具跳过并计数。内部工具名使用 Server 与原始工具名共同生成，并限制在 64 字符内以适配 provider 函数名约束。为避免正则回溯阻塞 Runner，`pattern` 不支持分组、择一或反向引用；含重复量词时必须以 `^` 开始且最多一个量词。调用结果最多返回 32 KiB UTF-8 文本，截断和被忽略的非文本/结构化内容提示均计入上限；不会切断多字节字符。Runner 响应通道关闭时，Unix 按独立进程组清理 Runner 及 MCP stdio 子进程，Windows 通过带 `KILL_ON_JOB_CLOSE` 的 Job Object 清理；正常关闭超时也会清理进程树。该回收逻辑尚未在桌面环境做崩溃/退出冒烟，Windows 交叉编译还受本机缺少 MinGW 编译器阻塞。

验收：配置错误不会启动任意参数拼接命令；单个 Server 启动失败不影响其他 Server；Bot 能力选择仍约束工具执行；连接状态和不支持的 Schema 可见；配置重载与正常关闭能同步并清理子进程。凭据读写、远程 Server 和跨平台崩溃回收不在本阶段实现范围。

## 阶段四：Bot 共享记忆与例行任务

**Bot 共享记忆首片已接入源码；Runner 的隔离、冲突、脱敏、长度限制和清空注入测试通过，UI 的冲突草稿恢复与清空流程测试通过，类型检查与打包通过。查看、编辑和清空的桌面流程尚未验收。暂停 Runner 时，缓存记忆会标明可能过期；已打开的编辑器保留草稿并禁用重读、保存和清空。例行任务继续暂缓。**

- 记忆以稳定 Bot ID 跨该 Bot 的 Conversation 共享，存放于 pi-durable Session keyed document family；Runner 校验 Bot 存在并用 Bot ID 寻址。
- 用户可以查看、编辑和清空单份 Bot 记忆。内容、revision、来源和更新时间由 Runner 持久化；保存要求携带预期 revision，避免旧编辑覆盖新内容。清空也递增 revision。
- 目前记忆只由用户维护，每次模型请求最多注入 2,000 个 Unicode 字符。Runner 保存时遮蔽常见 API key、token、Bearer、密码和凭据格式，也会遮蔽 PEM、OpenSSH 与 PGP 私钥块；界面说明不要记录密钥或密码。
- 记忆是提示词中的参考上下文，不是新的 Tool，也不改变 Bot 显式选择的 Extension/Tool 能力边界。当前没有自动记忆写入、事件日志、检索或例行任务。
- pi-durable 没有产品级 interval/cron 例行任务 API。持久 Task + `TaskRuntime.sleep()` 虽可复用 Harness 执行和持久化，但仍要求 AgentChat 实现周期调度、到期判断、漏跑、暂停/恢复与取消语义，因此属于应用自建 scheduler；这与[架构总览](../architecture/00-overview.md)当前边界不符，暂不实现定时触发。只有上游提供公开产品级触发 API，或用户明确批准架构边界变更后，再重新评估。例行任务运行始终沿用 Bot 已显式选择的 Extension/Tool 能力，不增加逐次工具调用审核。详见[长期记忆与例行任务研究](../research/long-term-memory-routines.md)。

Lorca 的 Bot 记忆设计提供了稳定 Bot ID、受限注入、用户检查/编辑、并发编辑保护和写入脱敏等参考要求；AgentChat 不照搬其 Markdown 存储、自动日记或压缩前记忆整理。研究记录见[长期记忆与例行任务研究](../research/long-term-memory-routines.md)。

pi-durable 公开接口和 Lorca routine 设计的核对记录见[长期记忆与例行任务研究](../research/long-term-memory-routines.md)。例行任务即使获准推进，仍沿用 Bot 已显式选择的 Extension/Tool 能力，不增加逐次工具调用审核。

验收：代码需验证记忆跨对话共享及跨 Bot 隔离、并发编辑冲突、脱敏、长度限制和清空后的注入行为；桌面流程需检查查看、编辑和清空。定时任务重启后行为确定、重复触发可去重、取消与正在执行的 Run 语义清楚后再单独评估。

## 阶段五：共享与多端协作

**状态：Bot 模板导入和导出已移除，当前不提供模板文件分享。**

**2026-10-22 实施更新：** iOS 模拟器宿主已完成构建和启动，当前移动端仍是说明页，Device Core、Relay、配对与业务同步尚未实现。用户明确手机只发送和展示会话，任何密钥或令牌不落盘，每次冷启动重新验证，因此取消移动安全存储前置并撤回探针，见 [P0 验证记录](../verification/multi-device-p0-ios.md)。下方 2026-10-20 工具链记录保留为历史证据，不作为当前设备状态。

以[多端设计基线](../architecture/02-multi-device.md)为边界，任务、依赖及验收标准统一记录在 [多端实施计划 #9](https://github.com/zhuxining/AgentChat/issues/9)：

| 阶段           | 实施任务                                                                                                                                                                                                                                                                                                 | 验收门禁                                                                                                    |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| M0：平台与协议 | [P0 宿主与临时会话协议 #10](https://github.com/zhuxining/AgentChat/issues/10)                                                                                                                                                                                                                            | 核验实际目标平台，收敛密码学、邀请、撤销、恢复、版本及保留契约；未决项不默认批准                            |
| M1：配对与只读 | [P1 Device Core #11](https://github.com/zhuxining/AgentChat/issues/11) → [P2 Relay 与配对 #12](https://github.com/zhuxining/AgentChat/issues/12) → [P3 后台 Runner 投影 #13](https://github.com/zhuxining/AgentChat/issues/13) → [P4 手机只读同步 #14](https://github.com/zhuxining/AgentChat/issues/14) | 桌面批准手机临时会话后可查看同一 Runner 的 Bot 和连续聊天；同一会话断线和前后台恢复，冷启动重新验证后取快照 |
| M2：文本首版   | [P5 Outbox 与文本提交 #15](https://github.com/zhuxining/AgentChat/issues/15) → [P7 跨端验收 #17](https://github.com/zhuxining/AgentChat/issues/17)                                                                                                                                                       | 同一会话重试复用 requestId；手机进程丢失后先对账，不自动重发未知请求；多端消息不重复，实际设备验收          |
| M3：控制与编辑 | [P6 定向控制和 Bot 编辑 #16](https://github.com/zhuxining/AgentChat/issues/16)，依赖 P5                                                                                                                                                                                                                  | 迟到控制不影响新工作，编辑有版本冲突保护；逐项核验公开接口，不阻塞只读/文本首版                             |

首个用户可见里程碑是 M1，只读验收通过后才开放手机输入。当前仅 P0 的研究与平台验证标为可执行；下游任务须待相关协议决策冻结并复核后再进入实现。配对确认只授权新设备加入，不审核 Agent 的工具调用。

桌面后台 Host 持有网络生命周期与唯一写入权，手机不运行 Node/Harness，也不取得 Provider 凭据或 Runner Storage。首发不含附件服务、推送、多副本、云执行或多 Runner 调度/迁移；本计划不承诺手机后台常驻连接，也不自动部署或发布。

移动首版仅开放会话展示与文本发送，Projection、游标和 Outbox 暂仅存内存，进程结束会丢失未上传内容；M3 不随手机首版开放。既有 Issues 中的移动持久身份、持久 Outbox 要求以本次边界为准，尚未同步修改远端 Issues。

每段验收必须覆盖错误签名、撤销设备、重复投递、断线恢复和敏感数据不出边界；临时会话协议和凭据不落盘须在目标平台验证，不能只凭文档或桌面构建推断移动端可用。手机冷启动重新验证后取快照，同一会话重试复用 requestId；进程丢失后先对账，不以新身份自动重发未知结果请求。

2026-10-20 本机工具链复核：通过显式 `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer` 使用已安装的 Xcode 27.1，`aarch64-apple-ios` 的 `cargo check` 与完整 `cargo build` 均通过；`iphoneos` SDK 可用。这仅验证 Rust target 编译，不代表 Tauri iOS 项目已初始化或宿主可启动。`tauri ios init --ci --skip-targets-install` 因缺少 `xcodegen` 尝试经 Homebrew 安装，但被另一既有 `brew reinstall xcodegen` 进程占用的下载锁阻塞，等待 180 秒后退出；本轮未改动该既有进程。当前没有可用 iOS Simulator runtime 或设备，因此尚未验证 Tauri iOS 构建、启动和平台安全存储。Android Studio、SDK/NDK、`adb` 和 Android Rust targets 仍未安装。Tauri 官方也要求 iOS 使用完整 Xcode，Android 使用 Android Studio、SDK/NDK 与相应 Rust targets，见[移动端前置条件](https://v2.tauri.app/start/prerequisites/)。Tauri 插件支持表将 Stronghold 在 iOS/Android 标为未知、未测试或计划中，故在目标平台验证前不把它选定为移动端密钥存储，见[官方插件平台支持表](https://github.com/tauri-apps/plugins-workspace/tree/v2)。下一步需完成 Tauri iOS 项目初始化，并在可用模拟器或设备上验证宿主构建/启动与安全存储，再决定是否进入身份协议和 Device Core 实现。

2026-10-20 后续验证：在隔离副本中使用校验过 SHA-256 的官方 XcodeGen 2.46.0 完成 `tauri ios init --ci --skip-targets-install`，成功生成 Xcode 工程；为绕过 CLI 对真机日志与 CocoaPods 命令的“存在性”检查，隔离副本提供了若被执行就会失败的占位命令，因此这一步只证明项目生成。副本中的前端与 Runner `bun run build` 通过。本工作树另执行 `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer cargo check --manifest-path src-tauri/Cargo.toml --target aarch64-apple-ios-sim`，239 个 crate 编译通过；这验证 Rust/Tauri 依赖的模拟器目标编译，不等同于 Xcode 宿主构建或运行。Tauri 的 iOS build 随后因 `simctl list runtimes` 为空而停止；Xcode 27.1 已有 iOS 与 Simulator SDK，但没有 Simulator runtime。尝试用 `xcodebuild -downloadPlatform iOS -architectureVariant arm64` 安装 runtime 时，Apple 下载连接在 TLS 握手后失败，已停止本次下载；没有改动仓库生成目录或旧的初始化/Homebrew 进程。源码核对还发现凭据模块、Keychain `keyring` 依赖和相应 IPC 均限定在 desktop，当前没有 iOS 安全存储实现；Android 工具链仍缺失。因此本里程碑尚未通过宿主构建/启动及平台安全存储验收，先不进入身份与配对协议。

2026-10-20 Xcode 宿主编译：在上述隔离副本中，由 `tauri ios build --debug --no-sign --target aarch64 --ci --open` 提供 Tauri CLI 构建配置，再执行 `xcodebuild -project gen/apple/agentchat.xcodeproj -scheme agentchat_iOS -configuration Debug -sdk iphoneos -destination 'generic/platform=iOS' CODE_SIGNING_ALLOWED=NO build`，结果为 `BUILD SUCCEEDED`。Rust 的 `agentchat` iOS target、资源目录和 Xcode App 宿主均完成编译；构建未签名，未安装或启动应用，也未操作 Keychain。CLI 在非 `--open` 模式会因缺少 Simulator runtime 而提前退出；该分支及 `--open` 配置服务行为可见 [Tauri iOS CLI 源码](https://github.com/tauri-apps/tauri/blob/dev/crates/tauri-cli/src/mobile/ios/mod.rs) 和 [iOS build 源码](https://github.com/tauri-apps/tauri/blob/dev/crates/tauri-cli/src/mobile/ios/build.rs)。本次由 `--open` 提供配置服务，并由 Xcode 编译通用真机目标。宿主运行、设备 Keychain 往返和 Android 工具链仍未验收；下一步需要可用模拟器 runtime 或在线 iPhone，完成安装启动及最小安全存储读写验证后再评估身份协议。

2026-10-20 Android 环境复核：`ANDROID_HOME`、`ANDROID_SDK_ROOT`、`NDK_HOME`、`JAVA_HOME` 均未设置；本机没有 Android SDK、`sdkmanager`、`adb` 或 Rust Android targets。Homebrew 提供的 `/opt/homebrew/bin/android` 在 `--help` 检查中持续无响应，已停止本次检查进程。数据盘仅余 9.4 GiB，因此本轮没有安装 SDK/NDK 或接受其许可；Android 宿主构建与启动仍待补齐工具链、可用设备及足够磁盘空间后验证。iOS Simulator runtime 仍为空，已连接 iPhone 仍不可用。多端当前继续停留在“移动端宿主与密钥存储验证”，不实现身份/配对协议，也不增加逐次工具调用审核。

验收：工具执行受该 Bot 的 Extensions/Tools 清单约束，不增加逐次工具调用审核。多端验收按上面的里程碑推进：配对与撤销可验证；离线命令明确显示待发送、已接纳、已完成或已拒绝；重复、迟到和失去权限的命令不会产生意外副作用。

## 阶段推进顺序

附件、用量、MCP stdio 与 Bot 共享记忆首片已接入源码；各自的桌面验收仍按阶段列出的范围推进。例行任务定时触发在当前“不自建 scheduler”边界下暂缓，除非上游提供公开产品级 API 或用户批准架构边界变更。群组和多设备分享放在权限及恢复模型稳定之后。每阶段完成后更新本文状态、产品蓝图和实际验收记录；实现前若发现 pi-durable 契约不足，优先确认上游公开接口，不复制运行时内部状态机。

## 阶段一至三的既有源码验证记录

- `vpr build` 通过，包含前端 TypeScript 检查、Vite 构建、Runner TypeScript 检查和 Runner 打包；Vite 提示部分 JavaScript chunk 超过 500 kB。
- Runner 目录执行 `bun run typecheck` 与 `bun run test` 均通过；测试共 10 个文件、78 项。MCP Schema 正则测试覆盖受支持的锚定重复规则和不支持的分组、择一、反向引用、多量词、非锚定重复及无效范围；附件测试覆盖文本/图片输入、无效引用、格式与大小限制、暂存符号链接，以及新旧附件正文在消息投影中的隐藏。
- `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`、`cargo check --manifest-path src-tauri/Cargo.toml`、`cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets` 与 `cargo test --manifest-path src-tauri/Cargo.toml --lib` 均通过，Rust 库测试共 26 项；附件暂存测试覆盖格式与内容校验、私有权限和符号链接拒绝。新增 Runner 子进程边界实现可在当前 macOS 目标编译。
- `git diff --check` 通过。
- Windows `cargo check --target x86_64-pc-windows-gnu` 因缺少 `x86_64-w64-mingw32-gcc` 在 `ring` 构建脚本处失败，尚未验证 Windows Job Object 分支。
- 附件、用量和 MCP 的真实桌面交互，以及 Runner 崩溃后的进程树回收仍未冒烟验收。本轮 CUA 按应用 ID 获取 AgentChat 窗口返回 `cgWindowNotFound`，无法进行真实 UI 验收；运行中的进程不能作为界面验收通过的依据。
- 2026-10-20 另以 `/tmp/agentchat-codex-ui-acceptance-20261020` 启动打包验证版；应用进程启动，但 CUA 仍返回 `cgWindowNotFound`。已终止本次专用 Runner 宿主及 Node 子进程，未触碰默认数据目录；桌面流程仍待可访问窗口后验收。
- 2026-10-20：Runner 暂停/重启时清理未发送附件，并保留待确认提交的附件引用；`vpr build` 与 `git diff --check` 通过。未运行测试；本次按应用 ID 读取桌面窗口仍返回 `cgWindowNotFound`。

## 阶段四本轮源码验证记录

- `runner` 目录执行 `bun run typecheck` 通过；`vp test --config vite.config.ts tests/bot-memory.test.ts` 通过，3 项覆盖跨 Conversation 共享与跨 Bot 隔离、过期 revision 冲突、清空后的提示注入、凭据脱敏及 Unicode 码点长度边界；`bun run build` 通过。
- `vp test tests/ui/bot-memory.test.ts` 通过，2 项覆盖冲突时保留草稿并载入最新 revision，以及按当前 revision 清空记忆。
- `git diff --check` 通过。真实桌面查看、编辑和清空流程仍未验证；本轮桌面窗口服务对 AgentChat 与验证版均返回 `cgWindowNotFound`，不能据此标记 UI 验收通过。

## 阶段五本轮源码验证记录

以下为移除模板导入和导出功能前的历史验证记录，不代表当前版本已重新运行测试；模板入口、解析与生成代码及对应测试现已删除。

- `vp check` 对模板契约、脱敏工具和相关 Bot 页面共 7 个文件通过；`vp test tests/ui/bot-template.test.ts` 通过，4 项覆盖导出字段排除与凭据遮蔽、格式和未知字段拒绝、导入指令遮蔽、本机默认配置保留及不可用能力过滤。
- `bun run build` 通过，包含根 TypeScript 检查、前端构建、Runner 类型检查和打包；构建提示部分 JavaScript chunk 超过 500 kB。
- `git diff --check` 通过。文件选择、预览、下载和新建 Bot 的真实桌面流程仍待验收。

## 2026-10-20 记忆编辑器暂停状态

- Runner 在编辑或清空确认弹窗打开期间暂停时，弹窗提示编辑草稿会保留，并禁用重读、保存和清空，避免发起必然会被生命周期检查拒绝的操作。
- `vpr build` 与 `git diff --check` 通过；未运行测试。该交互仍待真实桌面验收。

## 2026-10-20 全仓回归

- `vpr test` 通过：前端 10 个测试文件、83 项；Runner 11 个测试文件、81 项。
- 本轮只校正 UI 测试与现有界面的标签、内联连接列表、折叠区及模型编辑按钮行为；没有改变 Provider 或主题产品逻辑。
- 附件、用量、MCP、Bot 记忆和模板的桌面验收仍未完成；例行任务 scheduler 边界仍待产品决策。

## 2026-10-20 附件文件名边界

- Runner 文件名长度改为按 Unicode 码点计数，与 Rust 暂存入口一致；UTF-16 代理对不再被算作两个字符。
- `vpr build` 与 `git diff --check` 通过；未运行测试。真实桌面附件流程仍待验收。

## 2026-10-20 敏感文本脱敏边界

- 公共脱敏器现在完整消费带转义引号的 JSON/JS 凭据字段与 Bearer 值，并遮蔽 URL authority 中的密码；该逻辑目前用于 Bot 记忆保存。
- 本轮执行 `vpr build` 与 `git diff --check`；未运行测试。桌面流程验收状态不变。

## 2026-10-20 开发版桌面验收复核

- 使用隔离目录 `AGENTCHAT_DATA_DIR=/tmp/agentchat-codex-active-ui-20261020 vpr tauri dev` 启动当前源码；Runner bundle、Vite 1420 和 macOS Tauri 宿主均完成编译并运行。
- CUA 应用清单没有暴露新窗口，按 `com.agentchat.app` 与 `agentchat` 读取都返回 `cgWindowNotFound`。开发命令在 Ctrl-C 后以 130 退出，但其 Runner 宿主与 Node 子进程仍存活；随后按本轮唯一临时数据目录定位并向宿主发送 SIGTERM，复查确认这组进程已退出。另一个使用不同临时目录的既有验证宿主保持运行。该结果只验证本机开发构建和进程启动，不构成可见界面或桌面流程验收。

## 2026-10-21 提交前评审修复

- Rust Runner 请求协议补齐 Bot 记忆读取和保存操作，校验 Bot ID、JavaScript 安全整数版本及 2000 字符上限。
- 消息重试先在 Pi durable 事务中按会话和 requestId 查询已接纳记录，返回原提交 ID；配置变更或临时附件失效不再将已接纳请求误判为拒绝。查询失败保留不确定状态，前端继续复用原 requestId。
- 已移除手动新建对话入口及模板导入、导出，保留每个 Bot 的持续对话。
- `bun run check`、`bun run build`、Rust `cargo check`、Clippy（`-D warnings`）及 `git diff --check` 通过。构建仍提示部分前端 chunk 超过 500 kB；本轮未运行测试或桌面交互验收。
