# AgentChat Runner runtime 初始化建议

状态：Node 检测与首次初始化、Homebrew/winget/apt 安装、Node 官方发行源与 npmmirror 回退、Windows named pipe IPC 已进入实现。macOS Rust 检查通过；尚未在目标平台验证安装器或 Windows IPC。本文描述已实现的运行时策略与待验收项。

## 已确认的产品方向

- 宿主机已有 **Node 24+** 时复用，不另外安装。`pi-durable` 1.2.0 的 engine 下限虽为 `>=22.19.0`，AgentChat 采用更高的 Node 24+ 产品门槛。
- 找不到合格 Node 时优先使用平台包管理器：Windows winget、macOS Homebrew、Linux apt（只在候选版本达到 24 时）。包管理器失败、候选低于 24 或安装后仍不合格时，再下载 Node 24 发行包到 AgentChat 私有数据目录。
- 私有归档安装在 `~/.agentchat/runtimes/node-v24`（可由 `AGENTCHAT_DATA_DIR` 改变根目录），不会写入用户 PATH，也不会覆盖不兼容的系统 Node。
- 不保留随包 Node。
- Bun 暂不自动选择，直到兼容矩阵完成。

系统包管理器可能按自身策略安装到共享前缀并请求权限；应用直连下载回退只写 AgentChat 数据目录，不修改 shell profile 或环境变量。

WorkBuddy 可参考其托管目录、版本隔离和工具环境装配，但它已验证的 resolver 是托管 runtime 优先、系统 runtime 回退，且发行包携带 Node/Python。Pi 安装脚本更接近“先检测 Node/npm，缺失后协助安装”，但不同平台对系统包管理器、私有 Node 和 PATH 的处理并不一致；AgentChat 采用系统 Node 优先，并只在直接下载回退时使用应用私有 runtime。

## 候选发现与复用

1. 先检查用户显式配置的 Node 绝对路径；再检查 GUI 进程可见 PATH 和有限的常见安装位置。不要启动交互 shell、source 用户 profile 或执行 nvm/fnm 初始化脚本。
2. 解析实际可执行文件路径，读取版本、平台和架构。AgentChat 仅接受 Node 24 及以上；Node 22.x 即使满足库的 engine 下限也不符合 AgentChat 运行时策略。
3. 对候选执行限时能力检查：确认 `node:sqlite` 可用、Runner bundle 可加载、隔离数据目录中的 initialize/close 协议可完成。检查失败要报告具体原因，不归类为“没安装”。
4. 验证通过后，固定本次 Runner 生命周期使用的绝对路径并记录 runtime 来源、版本、架构和检查结果。已有 Node 24+ 时不因其不是最新版本而自动更新。
5. 缺少合格 Node 才启动相应平台的包管理器安装；包管理器失败时执行私有归档回退。安装成功后重新探测最终可执行文件并重复能力检查；只有验证通过才启动正式 Runner。

截至 2026-10-16，Rust resolver 已通过 `Command::new` 使用验证后的绝对 Node 路径，检查稳定版本至少 24、`node:sqlite` 和平台架构信息；首次运行页面会在缺少合格 Node 时先尝试包管理器，失败后走发行包下载回退，启动 Runner 并用 initialize 验证。直接下载回退写入 AgentChat 私有 runtime，不改 PATH。Windows named pipe IPC 已实现；其模块在最小 Tokio harness 上通过 Windows GNU 目标编译，完整 Tauri 应用交叉编译因缺少 MinGW 未完成，且尚无 Windows 运行验证。

## 当前安装流程实现

- macOS：尝试 TUNA → USTC → 官方 Homebrew 安装/Node 安装；缺少 Homebrew 时由 Terminal 引导官方 bootstrap。
- Windows：使用 winget；缺少 App Installer 时打开 Microsoft Store 对应页面，再继续安装流程。
- Linux：仅在 apt 的 Node 候选版本 >=24 时安装；候选低版本或 apt 失败后进入发行包回退。
- 发行包：官方 Node `latest-v24.x` 优先；失败后从 `https://cdn.npmmirror.com/binaries/node/index.json` 选择最高稳定 Node 24 版本，再取其版本目录下的 `SHASUMS256.txt` 与目标归档。镜像 base 不是 npm registry，也不是旧文档中的 `/mirrors/node`。
- 安全检查：归档下载有大小上限，hash 与该来源的 `SHASUMS256.txt` 比对；解包前检查成员路径和链接不越出预期顶层目录，拒绝特殊文件；解包后探测 Node 版本、架构与 `node:sqlite`，再启动 Runner 并调用 initialize。当前 hash 清单与归档来自同一 HTTPS 来源，不是独立签名校验。
- 私有 runtime 路径：数据目录的 `runtimes/node-v24`；不会更新 PATH 或替换既有系统 Node。

当前未在真实目标平台执行安装或 Node 下载，因此系统权限提示、失败恢复、目标归档解压与重启行为仍需平台验收。

## UI 状态与故障行为

```text
checking → ready(source, version) | needs_install(reason) | failed(reason)
needs_install → installing(progress) → verifying → ready | failed
```

首次启动页会在检查、安装和启动 Runner 期间阻止进入主界面；失败时显示错误并提供重试。当前没有“稍后处理”入口。

区分运行时和 Runner 状态：runtime ready 不等于 Runner 已启动；Runner 启动失败也不自动触发另一个 Node 安装。安装、验证、权限拒绝和后台重启分别提供明确错误与恢复入口。

## 首版建议范围

- Node 24+ 为复用门槛；安装缺失 runtime 时使用包管理器提供的版本，若回退到发行包则使用来源可提供的最新 Node 24。
- 目标平台以真实安装、权限和 Tauri 桌面冒烟验证为准；Windows named pipe IPC 已实现代码，未在 Windows 目标编译/运行，不宣称端到端验收完成。
- 不随包携带 Node。离线设备若没有合格 Node，则 Runner 暂不可用；UI 必须说明网络/安装要求及恢复方式。
- 不自动选择 Bun。发现 Bun 时可在诊断中显示“未验证”，不作为可用 runtime。
- Node runtime 不代表已安装 npm、Git、Bash、Python 或任意 MCP/Skill 工具。

## 实施验收项

1. 候选发现不执行用户 shell 初始化；能报告绝对路径、版本、架构和来源。
2. Node 24+ 可通过 Runner 能力检查；超时能回收子进程和临时数据。
3. 确认发行前的完整性信任根。当前只比对归档与同一 HTTPS 来源提供的 checksum；独立签名或应用内受信 manifest 尚未实现。
4. 覆盖下载失败、校验失败、磁盘不足、并发安装、临时目录清理、路径变化和安装后 Runner initialize 失败。
5. 各平台验证包管理器安装范围与权限、私有目录权限、解包行为和重试/回滚。
6. 每个目标平台完成真实 Tauri 集成冒烟；Windows named pipe 需在 Windows 编译和运行验证。
7. runtime 版本、来源、许可 notices、安全更新与更新责任纳入发行清单。

## 剩余验证项

- checksum 与归档来自同一 HTTPS 来源，无法单独抵御该来源同时被替换；需要评估 Node 官方签名或发行包内置的受信 manifest。
- Node 下载和安装尚未在目标平台实际运行，需验证代理、下载大小上限、跨平台归档结构与临时文件回收。
- 包管理器的安装范围和权限提示需在 Windows、macOS、Linux 分别验证；不手工修改用户 PATH。
- Windows named pipe IPC 需完成 Windows 整体应用编译和 start/request/stop/restart、重复宿主和远程客户端拒绝验证；当前 ACL 限制为当前所有者、SYSTEM 与管理员，`host.rs` 生命周期分支和 `host/windows.rs` 已通过隔离 Tokio harness 的 Windows GNU 目标编译。
- 系统 Node 版本不合格时不会升级或卸载它；私有回退与既有 PATH 中旧 Node 的选择顺序需在真实平台确认。

本次实现更新了 Node 检测、包管理器入口、私有下载回退及 Windows named pipe 代码。开发机没有安装新的 Node，也未手工修改 PATH 或环境变量；Windows 交叉编译因缺少 MinGW 未完成。
