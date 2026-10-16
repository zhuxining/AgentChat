# AgentChat 各平台 Node 检测与安装方案

状态：核心代码已实现，目标平台验收未完成。本文记录当前行为、直接下载来源与待验证边界；具体实现以 `src-tauri/src/runtime.rs` 和 `src-tauri/src/host/windows.rs` 为准。

## Node 运行时策略

- AgentChat 复用检测到的稳定 Node 24+，不因版本不是最新而自动升级。`pi-durable` 1.2.0 的 engine 下限是 `>=22.19.0`，这是库要求；产品运行门槛仍为 Node 24+。
- 检测 `AGENTCHAT_NODE`、GUI 进程 PATH、平台常见位置和 AgentChat 私有 runtime；通过绝对路径探测版本、`node:sqlite`、平台及架构。Runner 启动时使用已验证的绝对路径。
- 找不到 Node 时先尝试平台包管理器。安装失败、候选版本低于 24 或安装后仍未就绪时，转为应用私有归档安装。不兼容的系统 Node 不会被替换或卸载。
- 私有 Node 安装在数据目录 `runtimes/node-v24`（默认 `~/.agentchat/runtimes/node-v24`），不修改用户 PATH、shell profile 或环境变量。Tauri 包只包含 `runner/entry.js`，不携带 Node。
- 不自动选用 Bun；验证范围之外的系统 runtime 不作为候选。

## 平台包管理器流程

| 平台    | 首选流程                                                                              | 回退条件                                               |
| ------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| macOS   | Homebrew；源顺序为 TUNA → USTC → 官方。缺少 Homebrew 时在 Terminal 引导官方 bootstrap | 安装失败或重新探测仍没有合格 Node                      |
| Windows | winget 安装 `OpenJS.NodeJS`；缺少 winget 时打开 Microsoft Store 的 App Installer 页面 | winget 安装失败或重新探测仍没有合格 Node               |
| Linux   | 查询 `apt-cache policy nodejs`，只在 Candidate >=24 时请求 apt 安装                   | 无 apt、候选低于 24、安装失败或重新探测仍没有合格 Node |

Linux apt 不会添加第三方软件源。包管理器可能按自己的规则请求系统授权；安装后的 Runner 必须重新探测并使用实际绝对路径。

## Node 发行包回退

官方源优先使用 `https://nodejs.org/dist/latest-v24.x/`。官方 manifest 或归档不可用时，镜像版本索引位于 `https://cdn.npmmirror.com/binaries/node/index.json`；解析其中最高的稳定 Node 24 版本，再从对应 `vX.Y.Z/` 目录读取 `SHASUMS256.txt` 和归档。应用不会使用 npm registry 下载 Node，也不会修改 npm registry 设置。

本次只读核实发现旧路径 `https://npmmirror.com/mirrors/node/...` 不可用。当前 CDN 路径 `https://cdn.npmmirror.com/binaries/node/` 的索引可读取；本次返回的最高 Node 24 版本是 `v24.22.0`，其版本目录的 checksum manifest 存在并列出目标平台归档。镜像可能落后于官方，因此按其版本索引选择镜像实际提供的最高 Node 24，而不使用过时的 `latest-v24.x` 镜像别名。

当前资产映射：

- macOS x64/arm64：对应 Darwin `.tar.gz`；
- Windows x64/arm64：对应 Windows `.zip`；
- Linux x64 glibc/musl：对应 `linux-x64` / `linux-x64-musl` `.tar.gz`；
- Linux arm64 glibc：对应 `linux-arm64` `.tar.gz`；Linux arm64 musl 暂无支持的官方资产。

下载有大小上限，先把归档写入私有暂存目录，用同一发行源的 `SHASUMS256.txt` 校验 SHA-256；解包前确认所有成员留在预期顶层目录，并拒绝越界链接和特殊文件。解包后探测版本、架构与 `node:sqlite`，最后原子发布至私有 runtime 目录。探测后初始化页启动 Runner 并调用 `initialize`。校验清单和归档来自同一 HTTPS 来源，不是独立签名校验，仍需评估发行版签名或内置受信 manifest。

## Windows 本机 IPC

Windows 使用 Tokio named pipe，管道名由规范化数据目录派生。服务端启用 first-instance 保护、拒绝远程客户端并限制并发客户端；start、send、stop、restart 和宿主连接已接入现有请求协议。IPC 不开放网络端口。

Unix 继续使用本机 socket。Windows named pipe 设置当前所有者、SYSTEM 与管理员 ACL，并拒绝远程客户端；`host.rs` 的 Windows 生命周期分支与 `host/windows.rs` 已在隔离 Tokio harness 上通过 `x86_64-pc-windows-gnu` 编译；完整 Tauri 应用交叉检查因开发机缺少 `x86_64-w64-mingw32-gcc` 停止，Windows IPC 仍无目标机运行验证。

## 当前验证与待验收

- 已完成：`cargo fmt`；macOS 原生 `cargo check`；Node 官方发行源、镜像索引和镜像版本 checksum 路径只读核实；`host.rs` Windows 生命周期分支与 `host/windows.rs` 在隔离 Tokio harness 上通过 Windows GNU 目标编译。
- 未执行：自动化测试、Node 归档下载/安装、Homebrew/winget/apt 实际安装、完整 Tauri Windows 交叉编译或 Windows 运行验证。
- 仍需目标平台验证：系统授权和错误恢复、压缩包结构、下载/解压失败清理、安装后 Runner 启动，以及重启后复用私有 runtime。
- SHA-256 来源与归档同源，若来源本身被替换，checksum 不能提供独立信任根。

本轮没有在开发机安装 Node，也没有手工修改 PATH 或环境变量。参考资料与安装体验调研见 [初始化建议](agentchat-runtime-initialization-proposal.md)、[Pi 安装脚本调研](pi-installer-bootstrap.md) 和 [WorkBuddy runtime 调研](workbuddy-runtime-bootstrap.md)。
