# WorkBuddy 的本机运行环境与初始化

调研日期：2026-10-16。对象为腾讯 WorkBuddy；结论限定于官方文档与本机 macOS 5.7.7 安装产物，不代表所有历史版本。

## 结论与证据等级

**WorkBuddy 支持检测系统 Node，但其已验证的环境管理策略是“已有托管版本优先，系统版本回退，缺失再安装”，并非始终系统优先。**
它还随 macOS 安装包携带 Node、Python 资源，由应用启动阶段释放为托管环境；不能将其描述为“机器没有 Node 时才运行脚本全局安装 Node”。

| 等级                | 来源                             | 能证明什么                                                   |
| ------------------- | -------------------------------- | ------------------------------------------------------------ |
| A：官方契约         | 腾讯官网连接器文档               | runtime 声明、私有 npm/pip 目录、PATH、init/status/auth 流程 |
| B：发行代码静态证据 | 本机 WorkBuddy 5.7.7 的 app.asar | 候选排序、系统检测、版本范围、下载与解包路径、随包资产       |
| C：建议             | 本文 AgentChat 方案              | 用户期望的 system-first/script-install，不是 WorkBuddy 现状  |
| 未验证              | 未启动应用、未执行安装脚本       | 实际网络回退成功率、运行中权限提示、各平台完整行为           |

三个层次应分别理解：

1. 桌面主程序及 Agent/daemon 的 JS 宿主。
2. Agent 执行工具、连接器、MCP、Skill 需要的 Node/Python 和包环境。
3. 单独发行的 CLI 安装方式。

连接器文档和 BinaryManager 主要证明第二层，不能直接套作主 Agent 的运行时选择规则。

## 官方原始来源与原文

- 产品入口：[https://workbuddy.qq.com](https://workbuddy.qq.com)，重定向至 [https://www.codebuddy.cn/work/](https://www.codebuddy.cn/work/)。
  页面 description：“WorkBuddy 是腾讯云代码助手推出的 AI Agent 办公工具”。
- 连接器开发文档：[https://open.workbuddy.cn/docs/connector](https://open.workbuddy.cn/docs/connector)，重点为“运行时托管与安装位置”“CLI + Skill 接入”。
  原文：“WorkBuddy 会准备对应运行时并注入命令环境，用户无需预先安装”。
  原文：“npm 与 pip 的安装位置和缓存会隔离到 WorkBuddy 管理目录，不会污染用户系统环境”。
  对 `runtime.type: "node"`：“准备托管 Node.js，将 npm 全局安装目录与缓存指向 WorkBuddy 管理目录，并把 bin 目录加入 PATH”。
  对未声明 runtime：“沿用用户系统环境和 PATH”。
  原文：“安装路径由 WorkBuddy 管理，开发者不应在命令中写死绝对路径”。
- CLI 文档入口：[https://www.workbuddy.ai/docs/zh/cli/installation](https://www.workbuddy.ai/docs/zh/cli/installation)。
  本文未用 CLI 安装说明推断桌面应用的环境初始化；其单可执行文件与 npm 安装路线须另行区分。

官方 `cli.json` 示例声明 `runtime: { "type": "node", "version": "20" }`，各平台 `init` 使用 `npm install -g your-cli`。
这里的 `-g` 指向 WorkBuddy 管理的 prefix，不能理解为写入系统 `/usr/local` 或用户已有 npm 的全局目录。

官方连接流程原文：“检查安装（未安装则执行 init）、执行 status 判断登录态；未登录时执行 auth”。
`init` 超时 5 分钟且要求非交互；`status` 10 秒且要求幂等、无副作用；文档另规定授权轮询时限。
这说明它支持为外部 CLI 声明安装命令，不证明主引擎需要先经脚本安装 Node。

## 本机样本与静态检查边界

样本路径：`/Applications/WorkBuddy.app`。
`Info.plist`：版本 **5.7.7**、标识 `com.tencent.workbuddy.mac`、入口 `Electron`、最低 macOS 11。
仅读取应用自身发行文件，没有启动应用、执行其中脚本或二进制，没有读取 `~/.workbuddy` 或任何用户配置、凭据、日志。

主要静态证据来自 `Contents/Resources/app.asar` 内：

| 文件                        | 关键符号                                                                        |
| --------------------------- | ------------------------------------------------------------------------------- |
| `main/index.js`             | `VENDOR_ASSETS`、`VendorExtractService`、`ensureVendorAssets`、`extractArchive` |
| `main/code-cache.js`        | `BinaryManagerImpl`、`BinaryDetectorImpl`、`BinaryResolverImpl`、`nodeConfig`   |
| `main/tar.js`               | `NodeRuntimeEnv` 日志、`cM` / `sM` 环境装配函数                                 |
| `main/module.app-server.js` | `buildCommandEnv`、`runtime.type` 分支                                          |

这些是发行代码，不是公开源仓库；没有可提供的上游源码 URL。可按路径、符号及下列 SHA-256 复核：

```text
main/index.js       67f5bbaf27c8c0f92162de9eb238dedafd764d54896fa1a7457bac2b7980dc5f
main/code-cache.js  bd50cca17ec76dcb8063cdc45719d0df18887a7bc5a4559e48cc947cd0fd1f17
main/tar.js         faaf8242cf7b5157e45d4b16bd80833f3b6e216021f8934928f851454601d91b
```

## 随包环境：不是只有下载逻辑

`Contents/Resources/vendor/node.dat` 为 41,338,083 字节；`python.dat` 为 17,751,064 字节。
扩展名本身不证明内容；代码给出了明确解包规则：`n[1]=139`，随后写临时 `.tar.gz` 并调用 `tar -xzf`。
原始文件的前两字节为 `1f 9b`；代码恢复为 gzip 的 `1f 8b`。本次没有执行这个解包函数。

`VENDOR_ASSETS` 明确列出：

```text
macOS node.dat   version=22.22.2 variant=6 managed=true verifyPath=bin/node
macOS python.dat version=3.13.12           managed=true verifyPath=bin/python3
Windows node.zip / python.zip（另有 packaged runtime 布局分支）
Linux node.tar.gz / python.tar.gz
```

启动阶段 `_p1EnsureVendorAssets` 调用 `ensureVendorAssets` → `VendorExtractService.ensureAll`。
`ensureOne` 按托管目标及版本标记判断是否已释放；没有“系统已有 Node 则跳过释放”的条件。
macOS 由代码推导的目标为：

```text
~/.workbuddy/binaries/node/versions/22.22.2-6/bin/node
~/.workbuddy/binaries/python/versions/3.13.12/bin/python3
```

配置根可被 `WORKBUDDY_CONFIG_DIR` / `CODEBUDDY_CONFIG_DIR` 覆盖，默认 `.workbuddy`。
解包使用 `.extracting.<name>.<pid>.<uuid>` 临时目录，校验必要文件后替换目标，并写版本标记。
静态代码包含旧目录备份及替换失败恢复逻辑；不能由此声称任意故障下都能完整回滚。

## 系统发现、候选排序与版本选择

`BinaryDetectorImpl.detectSystem` 先 `which`（Windows 为 `where`），再尝试预设位置。
查找命令超时 3 秒，版本探测超时 5 秒，已安装环境验证超时 10 秒；版本通过 `<executable> --version` 解析。

| 平台    | Node 额外搜索位置                                                                                                                      |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| macOS   | `/usr/local/bin/node`、`/opt/homebrew/bin/node`                                                                                        |
| Windows | `C:\Program Files\nodejs\node.exe`、`%PROGRAMFILES%\nodejs\node.exe`、`%APPDATA%\nvm\v*\node.exe`、`%USERPROFILE%\.volta\bin\node.exe` |
| Linux   | `/usr/local/bin/node`、`/usr/bin/node`                                                                                                 |

托管候选从 `binaries/<type>/versions/` 发现，跳过 `.installing` 等中间目录。
`BinaryResolverImpl` 的直接证据为：`SOURCE_PRIORITY={managed:0,system:1}`。
先过滤已验证且满足版本范围的候选，再按来源优先级、版本从高到低排序。
其提供给 Agent 的指令原文：“always prefer the (managed) version over the (system) version”。

`BinaryManagerImpl.ensure` 先 resolve；有匹配候选直接复用；没有才解析版本、下载、安装。
因此，没有托管候选而系统满足条件时可以复用系统；两者都满足时优先托管。
本版本随包托管环境又在启动阶段准备，不能归纳成纯 system-first。

版本范围使用 semver；`20` 规范化为 `>=20.0.0 <21.0.0`。
内置下载清单与随包资产不是同一份版本表：清单推荐 Node 22.12.0，随包资产为 22.22.2-6。
代码存在精确版本缺失时选同 major 版本、范围无匹配时回退推荐版的逻辑。
安装失败还会回退系统版本，日志明确写“may not meet requirement”；这是应避免照搬的行为。

## 下载、隔离目录与 PATH

Node 下载来源顺序由 `nodeConfig.downloadSources` 给出：腾讯 COS 预置源 → npmmirror → `nodejs.org` 官方源。
每源最多两次尝试；HTTP 空闲超时 120 秒；下载临时文件带 `.downloading`，失败删除。
下载缓存为 `~/.workbuddy/binaries/.cache/downloads/`，安装目标为 `binaries/node/versions/<version>/`。
下载器有条件 SHA-256 校验：只有 manifest 的 `sha256` 非空才验证；本机内置 Node 清单的 hash 值为空。
不能据此宣称所有下载都做了可信哈希或签名验证，也不能据此断言线上清单一定为空。

连接器 Node 环境（`main/tar.js`）使用：

```text
npm_config_prefix = ~/.workbuddy/binaries/node/cli-connector-packages
npm_config_cache  = ~/.workbuddy/binaries/node/cli-connector-cache
PATH 前置 prefix/bin、平台 npmGlobalBin、选中 Node 的目录
```

Windows 合并 `Path` / `PATH` 等同名键并进行忽略大小写的路径去重；macOS 用 `PATH` 和 `:`。
这些设置注入命令环境，不能等同于修改用户 shell 配置或系统全局 PATH。
此路径下的安装步骤没有使用 sudo/UAC 的证据；用户私有目录通常不需要管理员权限。
这不代表整个 WorkBuddy 的沙箱、防火墙或所有外部 CLI 安装流程均无提权操作。
本次已检查的运行环境注册表只有 Node/Python，未找到 Bun 类型注册或 Bun bootstrap 证据。

## 主执行引擎及尚未验证之处

桌面入口是 Electron。daemon 启动代码可见 `processExecPath ?? process.execPath` 和 `ELECTRON_RUN_AS_NODE=1`。
这些是使用内置 Electron Node 能力的线索，但本次没有完整追踪所有调用点的参数，因此不作最终宿主归属断言。
已证明的托管环境装配在 connector/工具链中，不能据此断言主 Agent 首次运行依赖系统 Node。

未知包括：主 Agent 各进程最终选择的 executable、实际下载 manifest 的远程更新与签名信任、Windows 安装器实际布局、系统权限弹窗、完整失败回滚、全部 shell 初始化行为。
macOS GUI/后台进程对 nvm/fnm 的 PATH 继承也未实测；已有搜索路径只能证明相应探测逻辑存在。

## AgentChat 可采用的用户期望策略（设计建议）

**system-first / script-install 是 AgentChat 可以主动选择的策略，和 WorkBuddy 已验证的 managed-first 有区别。**

1. 原生宿主在打开执行数据库前，探测系统 Node/Bun 或用户指定绝对路径；校验真实运行时、支持版本及 `node:sqlite` 等必要能力。
2. 合格则固定本次后台生命周期使用的绝对路径，展示来源和版本；Bun 使用 `process.versions.bun`，不只看 `process.version`。
3. 无合格环境则展示可审阅的平台安装脚本、版本、来源、目标目录和是否需要权限；用户运行后重新探测。
4. 建议脚本默认安装到用户私有版本目录，保留用户已有环境；如要成为终端全局命令，另行明确 PATH 设置与刷新方式。
5. 安装需可信哈希/签名、临时下载、原子发布和失败清理；不回退到不满足版本的环境，不在数据库失败后切换 runtime 盲目重试。
6. Runner 宿主与工具/MCP/Skill 依赖分别诊断；不要因为 Runner 可运行就报告 Git/npm/Python 或某个 CLI 已安装。

本次只新增调研文档；没有修改 AgentChat 启动实现、安装软件或执行远程脚本。
