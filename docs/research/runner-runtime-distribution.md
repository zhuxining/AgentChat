# Runner 运行时分发调研：Node、Bun 与 Tauri 集成

调研日期：2026-10-16。范围：AgentChat 当前原生后台宿主、独立 Runner、`pi-durable` 1.2.0；只调研，不改变实现或已确认的产品边界。官方资料优先引用版本固定的源码，滚动文档单独标明。实验只使用临时目录，不读取用户数据库或凭据，不调用真实模型。

后续方向：用户在本报告之后明确希望“本机有合适环境则复用，缺失时通过脚本辅助安装”。下文的随包优先结论属于初次研究建议，并非最终产品决策；WorkBuddy 的实证和面向该偏好的设计见 [WorkBuddy 环境初始化调研](workbuddy-runtime-bootstrap.md)。本报告中的“当前实现”是调研时的历史快照；后续 runtime 与 IPC 状态以 [各平台 Node 实现与验收记录](agentchat-runtime-platform-plan.md) 为准。

实现进度（2026-10-16 后续更新）：策略为复用系统 Node 24+、不自动升级；缺失时先走 Homebrew/winget/apt，包管理器失败后下载 Node 私有回退，不携带 Node、不修改 PATH。官方 Node 源与 npmmirror 发行包回退已有代码，Windows named pipe IPC 已接入代码。macOS Rust 检查通过；Node 安装流程未在目标机执行，Windows 目标编译因开发机缺少 MinGW 未完成。

## 结论与建议

**桌面正式发行优先继续随安装包携带经过验证、固定版本的 Node；不建议默认“发现任何 Node/Bun 就复用，否则安装全局环境”。** 这样用户不需要安装开发工具，首次启动可离线完成，后台恢复也不依赖 UI 或交互式 shell 的环境。现有工程已经实现随包 Node，当前任务主要是完善版本、目标平台、校验、许可和发布验证，而不是从零解决运行环境。[P1–P4]

**Bun 1.4.3 是有实际依据的候选，不能用“不支持 node:sqlite”排除。** 固定版本官方文档标记 `node:sqlite` 已实现；当前 Runner 的 Bun 直接执行与 `bun build --compile` 都通过了 macOS arm64 的配置、SQLite、创建执行上下文、关闭和重开冒烟。编译产物比本次随包 Node 加 JS 的原始体积小约 37.6%，但工具子进程、模型流、中断恢复、签名公证与其他平台仍未验证，暂不足以直接替换正式运行时。[B1][B2][E1]

建议的发行策略：

1. 普通桌面发行：随包一种受支持的运行时，首选 Node；应用升级同时升级该运行时。
2. 高级或开发模式：允许用户显式指定兼容 Node 的绝对路径，运行前探测；自动发现仅用于诊断和候选建议，不默认抢占随包运行时。
3. Bun 验证分支：先验证 `bun entry.js`，再验证独立编译产物；完成本文验收矩阵后再决定替换。
4. 若必须压缩安装器：另做“轻量在线安装”版本，下载应用私有运行时；不让每个离线安装用户都承担下载失败路径。

以上是本次研究建议，不是对现有配置协议或产品决策的修改。

## 当前工程基线

| 事实         | 当前实现与影响                                                                                                                 |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| Runner 产物  | `bun build ... --target=node --outfile=dist/entry.js`；Bun 是构建工具不意味着部署必须使用 Bun。[P1]                            |
| 运行时       | optional dependencies 固定 Node 22.19.0 的平台包；stage 脚本拷贝当前构建机平台的可执行文件。[P1][P2]                           |
| Tauri 集成   | `bundle.resources` 将 `entry.js`、`runtime/node` 映射为 `runner/entry.js`、`runner/node`，目前不是 `externalBin` sidecar。[P3] |
| 宿主选择     | `AGENTCHAT_NODE` → 随包 Node → 开发用 Node → debug 下 PATH Node；release 不自动采用任意系统 Node。[P4]                         |
| 数据库       | 使用官方 `openNodeSqliteStorage`；不是手写 Bun SQLite 驱动。[P5][D1]                                                           |
| 后台生命周期 | 原生宿主独立于 UI 存活；更换 JS 运行时不会自动解决实例发现、本机 IPC、关闭和重连问题。[P4]                                     |

`stage-runtime.ts` 依赖 `process.platform/process.arch`，不是最终 Tauri cross-target。原样在 arm64 主机交叉构建 x64 安装包，会选错运行时；当前脚本也统一输出文件名 `node`，Windows 后缀与启动路径必须专项验证。不要把已有 macOS 打包成功推广成所有目标平台已支持。[P2][P4]

## Node 与 SQLite 的真实要求

`pi-durable` 1.2.0 声明 **Node >=22.19.0**。不能把“Node 存在”或“Node >=18”作为启动条件；这既是包的支持边界，也涉及 `node:sqlite` 等实际 API。[D1]

官方 Node adapter 使用 `DatabaseSync(path, { timeout })`、prepared statements、`BEGIN IMMEDIATE`、WAL、`synchronous=NORMAL`、事务串行队列和关闭 checkpoint。Bun 兼容性必须覆盖这些行为，不只是能 import 或运行一次 SELECT。[D2]

**Node 22.19.0 不需要额外的 `--experimental-sqlite` 启用标志，但 SQLite API 仍是实验性演进中的接口。** Node 22 文档记录 v22.13.0 移除启用标志要求、仍属 experimental；22.19.0 固定版本文档标记 Stability 1.1（Active development）。`timeout` 在 v22.16.0 加入，22.18.0 又增加数据库选项。本文实测 Node 22.19.0 无启用标志完成实际存储生命周期。[N1][N2][E1]

22.19.0 是当前最低支持线，不应永久成为发行版本。Node 官方计划中，22.x 于 2027-04-30 结束支持；24.x 于 2028-04-30 结束支持。应为应用选择受支持 LTS 的经过验证的 patch，定期接收安全更新，不能只检查 `>=22.19.0` 就认可未来任意 major。[N3]

## Bun：SQLite 支持、编译能力与限制

### 官方支持与当前项目的对应关系

Bun **1.4.3 tag** 的官方 Node 兼容文档标记 `node:sqlite` 为 Fully implemented，同时列出差异：`backup()` 同步阻塞；Buffer 路径必须是有效 UTF-8；macOS 使用系统 `libsqlite3.dylib`，旧系统上的 session/changeset 与扩展加载可能需要完整 SQLite 构建。[B1]

当前 durable Node adapter 不调用 backup/session/changeset，但这不消除不同 SQLite 版本、锁等待、错误类型和关闭行为的回归风险。**不能假设 Bun 所有平台都内置与 Node 完全相同版本的 SQLite。** 应记录实际 `sqlite_version()` 并测试平台行为。[B1][D2]

本地 `pi-durable` 1.2.0 exports 没有 `storage/sqlite/bun`，源码没有 `src/storage/sqlite/bun.ts`。官方有可移植 `SqliteDatabase` facade，但不等于已经发布 Bun 专用 adapter。本轮成功路径是 **Bun 实现 Node API，继续使用官方 Node adapter**。若未来改用 `bun:sqlite`，须另做适配并通过官方存储 conformance，不应在此次运行时打包中顺手自建数据库层。[D1–D3]

Bun 中 `process.version` 是 Node 兼容版本，不能据此判断实际运行时。本次 Bun 1.4.3 返回 `v26.3.0`；应检查 `process.versions.bun`，配合显式版本探测和能力测试。[E1]

### 单可执行文件不是预先生成机器码的纯原生程序

`bun build --compile` 将 JS 及 Bun 运行时放进可执行文件；目标机器不用另外安装 Bun。产物仍使用 JavaScriptCore，不能按没有 JS 运行时/JIT 的程序设计签名或资源策略。[B2]

| 核实项        | 官方能力与 AgentChat 的含义                                                                                                                                                                                                              |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 跨平台编译    | 1.4.3 文档支持 macOS/Linux/Windows 的 x64、arm64，以及 Linux musl。支持生成产物不等于在目的系统已运行或通过签名。[B2]                                                                                                                    |
| x64 CPU       | **1.4.3 已统一为 Nehalem/SSE4.2 基线，并在运行时选择 AVX2/AVX-512 路径。** `-baseline/-modern` 仍接受但指向相同类型的二进制；不要沿用旧版本“一定要单独 baseline 包”的建议。低于 SSE4.2 的 x64 CPU 不支持。[B2][B3]                       |
| 嵌入资源      | 支持 `with { type: "file" }` 和 assets，内置路径可通过 Bun/file 或 Node fs 读取；`/$bunfs/` 是虚拟路径，不应当作系统 shell 可直接执行的真实路径。[B2]                                                                                    |
| 可写状态      | 内嵌 SQLite 可以是内存副本，修改在退出后丢失。AgentChat 的配置、数据库、工作区必须继续使用外部数据目录，不能嵌入为持久状态。[B2]                                                                                                         |
| Native addon  | 支持显式嵌入 `.node`，某些 pre-gyp 动态定位不会自动打包；未来依赖需逐个验证，不能推断通用兼容。[B2]                                                                                                                                      |
| 动态加载/拆分 | compile 总是 bundle，不支持 `--no-bundle` 或 `--target=node`。文档支持 `--splitting`，但会生成运行时需要的 chunks，不再是只有一个文件。[B2]                                                                                              |
| 子进程        | `node:child_process` 仍有差异：跨 Node/Bun advanced IPC 不兼容、channel ref/unref 缺失、部分 stdio 转接受限；基本 spawn 支持不能代替工具取消与退出清理验证。[B1]                                                                         |
| Worker        | `worker_threads` 的 resourceLimits 等存在差异；未来 durable/扩展用到时必须重新评估。[B1]                                                                                                                                                 |
| 隐式配置      | compile 默认仍允许 `.env`、`bunfig.toml` 自动加载。若采用，构建时关闭不需要的 autoload，并检查 `BUN_OPTIONS` 等继承变量，避免工作区内容改变后台启动语义。[B2]                                                                            |
| 外部工具      | 单 exe 不附赠 Bash、Git、Python、npm、项目 Node 或 MCP server。compiled `process.execPath` 默认仍运行 Runner；但可在显式子进程中设置 `BUN_BE_BUN=1`，将同一产物作为完整 Bun CLI 使用。它不会把 `bun` 或 `node` 安装到宿主 PATH。[B1][B2] |

### 本轮隔离实测

主 agent 在 **macOS arm64**，使用同一份当前 Runner 源码与临时数据目录，比较以下三条路径。结果记录在 `/tmp/agentchat-runtime-research-results.json`，脚本为 `/tmp/agentchat-runtime-research.py`；本表保存可长期阅读的结论，临时路径不是产品依赖。[E1]

| 路径                                 | 版本         | 已通过                                                                                                         |
| ------------------------------------ | ------------ | -------------------------------------------------------------------------------------------------------------- |
| 当前随包 Node + 现有 entry.js        | Node 22.19.0 | initialize、配置文件、Bot 默认工作区、SQLite 写入、创建执行对话/Agent 配置、快照、graceful close、重开持久状态 |
| Bun 执行现有 entry.js                | Bun 1.4.3    | 同上，无需更换 durable SQLite adapter                                                                          |
| 从当前 main.ts `bun build --compile` | Bun 1.4.3    | 同上，无需目标机另装 Bun                                                                                       |

体积比较（原始文件字节）：

| 产物                |        字节 |    MiB |
| ------------------- | ----------: | -----: |
| 随包 Node           | 110,712,624 | 105.58 |
| entry.js            |   1,720,863 |   1.64 |
| Node + entry.js     | 112,433,487 | 107.22 |
| Bun compiled Runner |  70,208,770 |  66.96 |

建议复现命令（输出和数据均放临时目录，不打开真实用户 Storage）：

```bash
runtime_probe_dir=$(mktemp -d)
bun build --compile runner/src/main.ts --outfile "$runtime_probe_dir/runner-bun"
runner/runtime/node runner/dist/entry.js --data-dir "$runtime_probe_dir/node-data"
bun runner/dist/entry.js --data-dir "$runtime_probe_dir/bun-data"
"$runtime_probe_dir/runner-bun" --data-dir "$runtime_probe_dir/compiled-data"
```

上面后三条分别交互运行，通过标准输入发送有序 JSONL 请求：`initialize` → 使用返回的 `botDefaults` 创建 Bot → 以 Bot ID 创建执行对话 → 查询 snapshot → `close`；进程退出后，以同一个临时数据目录重新运行并查询 `initialize`，核对 Bot 和执行对话仍在。每个请求须等待对应响应，且三个路径使用不同数据目录。

本次 compiled 文件小约 **37.6%**。这不是 DMG/NSIS/AppImage 压缩后比较，也不证明内存、吞吐、启动时延更好。未测真实 Provider、工具进程/取消、执行中强杀恢复、签名公证、Windows 或 Linux。不能称为完整 Runner 兼容验收。[E1]

## 分发选项比较

| 方案                | 宿主准备                    | 离线首次启动   | 版本可控性                    | 主要成本/结论                                                  |
| ------------------- | --------------------------- | -------------- | ----------------------------- | -------------------------------------------------------------- |
| 自动使用宿主 Node   | 必须找到并验证版本与能力    | 已装且兼容才可 | 低：用户/版本管理器可升级删除 | 适合显式高级选项，不建议消费级默认                             |
| 自动使用宿主 Bun    | 同上，还需 Bun 运行兼容验证 | 同上           | 低                            | 同时支持 Node/Bun 扩大测试矩阵，不是零成本 fallback            |
| 首次下载私有 Node   | 网络、可写应用数据目录      | 否，除非有缓存 | 高，可 pin                    | 安装器较小，但需下载恢复、完整性、代理、签名、回滚             |
| 随包 Node + JS      | 无需宿主 JS 环境            | 是             | 高                            | 当前兼容风险最低；体积和安全更新由应用承担                     |
| 随包 Bun + JS       | 无需宿主 JS 环境            | 是             | 高                            | 可行候选；仍需 Bun 兼容、平台和签名验收                        |
| Bun compiled Runner | 无需宿主 JS 环境            | 是             | 高，代码与运行时绑定          | 本次原始体积更小；更新 Runner 就重新编译签名                   |
| Node SEA            | 无需宿主 Node               | 是             | 高                            | 不必要；增加构建注入、模块与签名约束，不保证明显减小 Node 体积 |

离线只指 Runner 能启动及本地工具能工作；云模型请求仍需要其网络与凭据。

### 为什么 GUI 自动检测比终端 `which node` 难

nvm 是按用户、按 shell 加载的管理器；fnm 要在 shell 配置中求值 `fnm env`；Bun 安装文档也通过 shell profile 增加 `~/.bun/bin`。这些步骤不保证由 Finder、系统服务或另一个进程启动的应用继承相同 PATH。因此“终端 node 可用”不能作为后台 GUI 宿主可用的证据。[H1–H3]

系统模式建议：先接受显式绝对路径，再在受控候选目录/PATH 中查找，解析实际可执行文件，并以无 shell 方式进行有超时的版本、平台、架构和 `node:sqlite` 能力探测；将选定路径、实际 runtime/version 记录为诊断。版本管理器 shim 可能随 cwd 或项目配置选择不同版本，应在固定的后台启动 cwd 验证实际执行结果。[H1][H2]

不建议为探测执行用户交互式 shell、自动 source profile、运行 `nvm install` 或修改全局 PATH。它们可能执行任意用户初始化逻辑、阻塞/输出污染协议，并改变用户开发环境。检测失败可回到随包运行时；损坏、权限和不兼容须返回明确诊断，不能把每个错误都视为“没有安装”。这是工程建议。

**运行 Runner 的解释器与 Agent 工具用到的解释器要分开。** 私有 Node 可让后台运行，不代表已为项目安装 npm/Bun/Git。是否把私有 runtime 加入工具 PATH、是否附带包管理器应独立设计；不要为节省首次启动步骤而改变整个宿主机环境。[P2][P4]

### 若选择首次启动下载，如何初始化

推荐下载到应用私有的版本目录，例如 `<data-dir>/runtimes/node-v24/`。这是后续决策采用的实现路径：Node 检测、官方源到镜像源的下载回退与私有目录发布已进入代码；目标平台安装仍待验收。

流程：确定平台/架构/libc → 获取应用发行清单中固定版本 → 临时下载 → 校验可信清单和归档 hash → 限制解包路径与符号链接 → 私有目录原子发布 → 探测可执行文件 → 宿主启动。需要下载失败重试、代理/企业网络、磁盘不足、并发初始化锁、离线导入和诊断；清理运行中版本必须等待宿主退出。

Node 官方发行提供签名 `SHASUMS256.txt.asc`，README 给出可信 release keyring、`gpgv` 和 hash 校验步骤。Bun 1.4.3 release 同样提供 `SHASUMS256.txt` 与 `.asc`；不能声称 Bun 没有官方校验文件，但其 key 的可信分发方式本轮未完整验证。客户端也可以验证 AgentChat 自己签名的 runtime manifest 中预先固定的 hash。只从同一未验证服务器下载归档与 hash，不构成独立的信任根。[N4][B4]

若以 npm 平台包作为构建输入，需要验证该包的来源、版本、实际 Node binary 和许可证；锁文件只固定解析结果，不能替代应用发布签名和 runtime 来源审查。[P1][P2]

## Tauri：resources、sidecar 与签名

### 打包路径与目标选择

`bundle.resources` 支持显式源→目标映射，运行时应通过 Resource 路径解析 API 或有明确平台依据的宿主路径发现资源，不依赖用户工作目录；独立后台宿主还需要在没有 AppHandle 的场景定位资源。[T1][P3][P4]

`bundle.externalBin` 专为独立二进制分发；构建输入必须带 `-<target-triple>`，例如 `runner-aarch64-apple-darwin`、`runner-x86_64-pc-windows-msvc.exe`，Tauri 按目标选择。官方文档明确按主机 rustc tuple 重命名的简单脚本不适用于交叉构建。[T2]

继续将 Node+JS 作为 resources 或改成 Bun sidecar 都可设计；**不需要为使用 resources 增加前端任意 Shell 权限**。原生宿主可以管理精确路径的程序，UI 保持通过既有命令连接后台。如果采用 JS shell sidecar API，才同时评估具体 execute/spawn 权限与参数 scope。[T1][T2]

Bun 的 target（如 `bun-darwin-arm64`）与 Rust/Tauri triple（如 `aarch64-apple-darwin`）不同，需要显式映射。universal macOS 包必须覆盖两种架构，而不能只装一份当前机器架构 runtime；跨平台能“生成文件”不等于能完成目的平台签名、打包和运行。[B2][T2]

### macOS 签名与公证

公开分发需要验证整个 `.app` 内嵌代码：原生宿主、Node/Bun 或 compiled Runner、动态库与其他 helper。构建成功或 ad-hoc 签名成功不是 Developer ID、公证与干净机器 Gatekeeper 验收。Tauri 文档明确 Developer ID Application 分发需要 notarization，并支持相应 Apple 凭据配置。[T3]

Bun 官方说明 compiled 文件可 codesign（需要 Bun >=1.2.4），并给出 JIT entitlement 示例。但示例包含 disable-library-validation 等较宽权限，**不应直接把整份示例授予 UI 和所有子进程**；应对实际运行时逐项验证需要的 entitlement。先完成编译/注入，再签内嵌代码，最后签外层 app；之后修改可执行文件会破坏签名。[B2][T4]

Apple 的嵌套代码规则还区分标准代码位置与 Resources。当前把 Mach-O runtime 放在 Resources 的布局需要正式签名/公证实测，不能因为 Tauri 能复制资源就认为发布签名已正确覆盖。只读检查当前 release 产物时，内嵌 Node 带有 Node.js Foundation 的 Developer ID 签名；AgentChat 本体目前是 ad-hoc/linker-signed，尚无应用的 Developer ID 签名和公证验收。采用标准 helper/sidecar 布局时也要验证后台脱离 UI 后的启动与更新路径。[T4]

首次启动下载到用户目录也不免除平台信任、来源校验和运行检查；不要为安装后“补运行时”改写已签名 `.app`。长期运行的后台在软件升级时可能仍持有旧 runtime 和旧资源，应先显式收尾/重启，再切换成套的宿主、Runner 与 runtime。这是应用更新策略，不能交给单纯的文件复制处理。

### Node SEA 是否值得

Node 22.19.0 SEA 文档仍标记 Stability 1.1，仅支持单个 CommonJS 内嵌主脚本；需要生成 blob、复制 Node、注入和重新签名。当前 Runner 是 ESM bundle，不能原样当作该版本 SEA main。最新 Node 文档有更新的 API/能力，不能反套给 22.19.0。[N5]

SEA 主要减少分发文件数，不去掉 Node 运行时本身。已有 Tauri resources 能同时分发 Node 和 entry.js，因此当前没有必要引入 SEA；只有单文件部署本身有明确需求时再评估模块转换、资源加载和目标版本。

## 许可证、维护与安全成本

| 方案               | 需要随发行处理的事项                                                                                                                                                                                                                                                        |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Node               | Node 主许可证为宽松授权，发行 LICENSE 同时包含所集成第三方组件的条件；保留匹配版本的完整许可/版权说明，不只写一行 MIT。[N6]                                                                                                                                                 |
| Bun 或 Bun compile | Bun 本体 MIT，但官方 LICENSE 明确说明静态链接 JavaScriptCore/WebKit 的 LGPL-2 及可修改重链接要求，并列出其他组件许可。随包 Bun 和 compile 均不能只保留 Bun 的 MIT 文本；需确认具体产物的 notice、对应源码/重链接材料安排。本文不据此断言 AgentChat 的应用源码必须公开。[B5] |
| Node SEA           | 仍分发 Node 与依赖；打成一个文件不会消除原有许可证义务。[N5][N6]                                                                                                                                                                                                            |
| 系统 runtime       | 安装包少带组件，但需要承担更多未知版本、用户升级、路径变化、不可重现问题；不能用自动采用系统 runtime 来取代自己的支持与安全策略。                                                                                                                                           |

随包 runtime 的优点是可重现，代价是 AgentChat 必须跟踪 runtime/SQLite/TLS 安全更新；Bun 编译后每次 runtime 升级也必须重编 Runner。建议发行清单记录应用、Runner、runtime、durable 版本、目标、来源 hash 和 notices；runtime 更新应与应用一起受签名保护，不让后台自行执行 `bun upgrade` 或全局包更新。

## 平台与支持矩阵

以下是上游能力与本项目证据的区分，不是 AgentChat 的新兼容性承诺。

| 目标                  | Node 22.19.0 上游范围                  | Bun 1.4.3 上游范围                                   | AgentChat 本次证据                                                           |
| --------------------- | -------------------------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------- |
| macOS arm64           | macOS >=11                             | macOS >=13                                           | 三条运行路径均完成基本存储生命周期；未签名公证                               |
| macOS x64             | macOS >=11                             | macOS >=13，SSE4.2                                   | 未实测                                                                       |
| Windows x64           | Win10/Server2016 等，详见版本 BUILDING | Win10 >=1809，SSE4.2                                 | 下载型 Node x64 资产已映射；本机 IPC 代码已实现，均未在 Windows 目标平台验证 |
| Windows arm64         | Node 标为 Tier 2                       | Bun 有 arm64 target/assets                           | 下载型 Node arm64 资产已映射；Tauri、Node 与 IPC 均未在 Windows arm64 验证   |
| Linux x64/arm64 glibc | kernel >=4.18、glibc >=2.28            | 文档 glibc >=2.17；建议 kernel >=5.6，可向旧内核降级 | 未实测；还需 Tauri/WebKitGTK 等系统依赖                                      |
| Linux musl            | Node 该版本属 Experimental             | Bun 有 musl targets                                  | 不作为当前桌面发行支持声明                                                   |

Node 行来源固定版本 BUILDING；Bun 行来源固定版本安装/编译文档。应用最低版本是 Rust/Tauri、runtime、数据库/API 和系统工具的共同交集；采用 Bun 可能把 macOS 下限提高，不能只比较文件大小。[N7][B2][B3]

## 决策前的最小验收

采用私有 Node 下载回退后续需要：验证目标平台安装与架构、源校验信任根、许可、签名和更新/回滚联动。Node 下载实现已存在，但不等同于发行验收。

将 Bun 升为默认前，至少补齐：

- 真实 Provider 的流式请求、重试、超时与取消；无 UI 时持续运行。
- coding tools 的读写、Bash/子进程、退出码、stdout/stderr、取消与进程树回收。
- SQLite 锁等待、事务失败、WAL 关闭，以及执行中强杀后恢复；工具副作用不能靠一次 reopen 冒烟证明。
- 支持范围内 macOS Intel/ARM、Linux、Windows 的实际安装与后台集成；Windows IPC 先补齐。
- Developer ID/Hardened Runtime、公证、干净机器 Gatekeeper；若分发 Windows 则验证签名和后台无控制台行为。
- 压缩安装包体积、内存、启动与模型/工具延迟的同条件比较；不把 raw binary 节省等同用户体验收益。
- LGPL/第三方许可材料与 runtime 安全升级、回滚流程。

## 来源与复核位置

### 当前项目与 durable

- **[P1]** [runner/package.json](../../runner/package.json)：构建目标、依赖、Node 平台包版本。
- **[P2]** [stage-runtime.ts](../../runner/scripts/stage-runtime.ts)：当前主机平台选择、输出位置。
- **[P3]** [tauri.conf.json](../../src-tauri/tauri.conf.json)：resources 映射。
- **[P4]** [Node 进程管理](../../src-tauri/src/runner.rs)与[原生后台宿主](../../src-tauri/src/host.rs)：运行时选择、资源定位、后台生命周期。
- **[P5]** [harness/open.ts](../../runner/src/harness/open.ts)：Storage/Harness 装配。
- **[D1]** 本地一手 ` /Users/zhuxining/Code/pi/packages/durable/package.json`（1.2.0），`engines`、`exports`；[官方对应源码](https://github.com/earendil-works/pi/blob/main/packages/durable/package.json)为滚动版本。
- **[D2]** 本地 ` /Users/zhuxining/Code/pi/packages/durable/src/storage/sqlite/node.ts`；[官方 Node adapter](https://github.com/earendil-works/pi/blob/main/packages/durable/src/storage/sqlite/node.ts)。
- **[D3]** 本地同目录 `database.ts` 和包 README 的 portable SQLite/conformance 说明；[官方 README](https://github.com/earendil-works/pi/blob/main/packages/durable/README.md)。
- **[E1]** 本轮主 agent 隔离实验 `/tmp/agentchat-runtime-research-results.json`、`/tmp/agentchat-runtime-research.py`，结果完整摘录于本文；临时文件可能在会话后清理。

### Node 官方

- **[N1]** [Node 22.19.0 SQLite API](https://nodejs.org/download/release/v22.19.0/docs/api/sqlite.html)，[固定源码](https://github.com/nodejs/node/blob/v22.19.0/doc/api/sqlite.md)。
- **[N2]** [Node 22 SQLite 历史](https://nodejs.org/docs/latest-v22.x/api/sqlite.html)：v22.13.0 移除启用 flag，仍 experimental；滚动 patch 文档。
- **[N3]** [官方 Release schedule](https://github.com/nodejs/Release/blob/main/schedule.json)。
- **[N4]** [Node 22.19.0 README：Verifying binaries](https://github.com/nodejs/node/blob/v22.19.0/README.md#verifying-binaries)。
- **[N5]** [Node 22.19.0 SEA 固定文档](https://github.com/nodejs/node/blob/v22.19.0/doc/api/single-executable-applications.md)。
- **[N6]** [Node 22.19.0 LICENSE](https://github.com/nodejs/node/blob/v22.19.0/LICENSE)。
- **[N7]** [Node 22.19.0 BUILDING：Supported platforms](https://github.com/nodejs/node/blob/v22.19.0/BUILDING.md#supported-platforms)。

### Bun 官方（固定 1.4.3）

- **[B1]** [Node compatibility](https://github.com/oven-sh/bun/blob/bun-v1.4.3/docs/runtime/nodejs-compat.mdx)，含 SQLite、child_process、Worker 差异；[在线版本](https://bun.com/docs/runtime/nodejs-compat)。
- **[B2]** [Standalone executables](https://github.com/oven-sh/bun/blob/bun-v1.4.3/docs/bundler/executables.mdx)，target/CPU、assets、SQLite、签名、autoload、splitting；[在线版本](https://bun.com/docs/bundler/executables)。
- **[B3]** [Installation](https://github.com/oven-sh/bun/blob/bun-v1.4.3/docs/installation.mdx)，OS/CPU/libc 要求；[在线版本](https://bun.com/docs/installation)。
- **[B4]** [Bun 1.4.3 release](https://github.com/oven-sh/bun/releases/tag/bun-v1.4.3)，[官方 assets 元数据 API](https://api.github.com/repos/oven-sh/bun/releases/tags/bun-v1.4.3)，含 SHASUMS256.txt/.asc。
- **[B5]** [Bun 1.4.3 LICENSE.md](https://github.com/oven-sh/bun/blob/bun-v1.4.3/LICENSE.md)，含 JavaScriptCore/WebKit 与其他组件许可。

### Tauri、Apple 与版本管理器

- **[T1]** [Tauri resources](https://v2.tauri.app/develop/resources/)。
- **[T2]** [Tauri sidecar](https://v2.tauri.app/develop/sidecar/)。
- **[T3]** [Tauri macOS code signing / notarization](https://v2.tauri.app/distribute/sign/macos/)。
- **[T4]** [Apple TN2206：macOS Code Signing In Depth](https://developer.apple.com/library/archive/technotes/tn2206/_index.html)，Nested Code、签名后修改与资源位置。
- **[H1]** [nvm README](https://github.com/nvm-sh/nvm#intro)：per-user/per-shell、profile 加载。
- **[H2]** [fnm README：Shell setup](https://github.com/Schniz/fnm#shell-setup)：求值 fnm env。
- **[H3]** Bun 安装文档 [B3] 的 Add Bun to PATH。
