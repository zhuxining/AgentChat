# AgentChat 工程规范

本文件定义 AgentChat 仓库的工程边界和协作规则。实际行为以当前源码、`package.json`、`src-tauri/Cargo.toml`、Tauri 配置及测试为准；文档与实现冲突时，先核对实现并同步修正文档，不凭假设扩展架构。

## 工作原则

- 始终使用简体中文沟通；优先给出结论、依据、改动范围和可验证结果。
- 修改前读取相关源码、配置和测试。复杂改动先明确目标、边界与验收标准；涉及产品行为、安全权限或持久化格式的歧义必须说明取舍。
- 保持改动聚焦，修复根因，不顺手重构无关代码，不覆盖用户已有改动。
- 优先标准库和仓库已采用的依赖、组件与模式。新增依赖必须有明确消费者，并说明其替代的职责、维护状态、安全影响和原生构建成本。
- 不为未来需求预建通用层、空模块、无消费者的 trait 或抽象；出现稳定的重复边界后再提取。
- 当前项目仍处于早期阶段：前端主要是欢迎页和共享 UI，Rust 侧尚无自定义 Tauri Command，不能把已安装依赖或预留目录描述成已实现功能。

## 项目结构与边界

```text
src/                         React 前端
  components/ui/             共享 UI 基础组件
  hooks/                     通用 React Hooks
  lib/                       前端通用工具
src-tauri/                   Rust/Tauri 宿主
  src/lib.rs                 Builder、插件和应用启动组合
  src/commands/              自定义 IPC Command（当前为空）
  capabilities/              窗口、平台与插件权限
  tauri.conf.json            应用、窗口、安全与打包配置
public/                      原样复制的静态资源
tests/                       Vitest 测试，匹配 **/*.test.ts（按需创建）
```

- 前端负责视图、交互和前端状态；系统访问、敏感操作、密钥及可信持久化应留在 Rust/Tauri 边界。
- `src/components/ui/` 是共享基础层。优先组合已有组件；业务组件放入对应功能目录，不把业务状态和副作用塞入基础组件。
- `src-tauri/src/lib.rs` 只承担应用装配。业务逻辑应下沉到职责明确的模块，Command 保持为参数校验、授权、调用用例和结果转换的薄边界。
- `src-tauri/src/main.rs` 保持为桌面入口；移动端兼容代码使用 Tauri 的条件编译约定，不在业务代码中散布平台判断。
- 使用 `@/` 导入 `src/` 下模块。新增目录应按功能聚合，不建立笼统的 `common`、`helpers` 或中央 `models` 堆积职责。

## 工具链与常用命令

仓库使用 Bun 1.4.2、Vite+、React 19、TypeScript、Rust 和 Tauri 2。前端依赖以 `bun.lock` 为准，不新增 npm、pnpm 或 Yarn 锁文件；Rust 依赖以 `src-tauri/Cargo.lock` 为准。

```bash
vp install          # 按 bun.lock 安装依赖
vpr dev             # 仅启动前端开发服务器，固定端口 1420
vpr build           # TypeScript 检查并构建前端
vpr test            # 运行 Vitest
vpr check           # 自动修复前端问题，再检查 Rust 格式
vpr tauri dev       # 启动完整桌面应用
vpr tauri build     # 构建并打包桌面应用
```

- `vpr dev` 无法验证窗口、插件、Capability 或 IPC；涉及这些内容时必须使用 `vpr tauri dev` 或对应的 Rust 检查。
- 不绕过 `tauri.conf.json` 中的 `beforeDevCommand`、`beforeBuildCommand` 和固定端口约定。
- 更改依赖清单后使用对应包管理器解析锁文件，禁止手工编辑锁文件。

## React 与 TypeScript

- 遵循严格 TypeScript；不使用无依据的 `any`、双重类型断言或 `@ts-ignore` 绕过边界。外部输入先视为不可信数据并进行运行时校验。
- 组件定义在模块顶层，优先组合和 `children`；React 19 中将 `ref` 作为普通 prop 使用，不为兼容旧模式新增 `forwardRef`。
- 基于旧状态更新时使用函数式 `setState`；可在渲染期间推导的值不要复制进 state，也不要用 Effect 同步派生状态。
- Effect 只用于与外部系统同步；订阅、定时器和 Tauri 事件必须返回清理函数，并处理异步订阅在卸载前尚未完成的情况。
- React Compiler 已启用。不要仅凭习惯添加 `memo`、`useMemo` 或 `useCallback`；仅在身份稳定具有语义要求或性能测量证明必要时使用。
- 服务端数据使用 TanStack Query 管理缓存和异步生命周期；跨组件客户端状态仅在确有共享需求时使用 Zustand，不重复维护同一事实源。
- 当前尚未接入 TanStack Router。真正启用路由后再建立路由目录和生成文件规则，不为未使用依赖编造结构。
- 使用不可变更新、提前返回和可辨识联合类型表达互斥状态；异步界面明确区分 idle、loading、success、empty 和 error。

## UI 与样式

- 优先复用 `src/components/ui/`、Base UI 和现有组合模式，避免重复实现 Button、Dialog、Tooltip 等基础组件。
- 使用 Tailwind 4、`src/index.css` 中的主题 Token 和 `cn`；不要硬编码重复色值、随意引入内联样式或破坏明暗主题。
- 图标统一使用 `lucide-react`；仅在其无法表达品牌或产品专属图形时新增 SVG，并说明原因。
- 保留桌面窗口最小尺寸、无边框窗口和透明标题栏的交互约束；自定义拖拽区不得覆盖按钮、输入框和其他交互控件。
- 新交互必须支持键盘操作、可见焦点、合理的语义标签和必要的 ARIA；动画应尊重 `prefers-reduced-motion`。

## Rust 与 Tauri 实现

- 使用稳定 Rust 的惯用写法，明确所有权与资源生命周期；可恢复错误使用 `Result`、`Option` 和 `?`，避免在运行路径使用 `unwrap`、`expect` 或静默忽略错误。
- 库/业务错误保留结构和 source，跨 IPC 转换成稳定、可序列化且不泄露敏感信息的错误契约；不要把整个底层错误链直接暴露给前端。
- Command 的参数和返回值必须可序列化、命名稳定且边界清晰。异步 Command 优先接收拥有所有权的数据；耗时 I/O 使用 async，阻塞文件或 CPU 工作使用有界阻塞任务，不能冻结主线程。
- Tauri managed state 只保存真正的应用级资源。普通短临界区优先 `std::sync::Mutex`；只有需要跨 `await` 持有 I/O 资源时才使用异步锁。不得跨 `await` 持有同步锁 guard。
- 任务必须有所有者负责等待、取消和错误处理；窗口关闭或组件卸载后不得遗留失控后台任务。
- 注释解释不变量、平台差异和非显然取舍，不逐行复述代码；先测量再做性能优化。

## IPC、事件与状态同步

当前仓库没有自定义 Command、`invoke_handler` 或前端 Tauri API 封装。新增 IPC 时必须同时完成：

1. 在 `src-tauri/src/commands/` 中实现并测试 Command；
2. 在 Builder 的单个 `tauri::generate_handler![...]` 中注册；
3. 在前端建立集中、类型化的 IPC 适配模块，业务组件不散落字符串形式的 `invoke`；
4. 审查调用来源、输入校验、业务授权、错误契约及 Capability/Permission；
5. 为成功、拒绝、异常和关键边界补充测试。

- 请求—响应操作使用 Command；低频、单向生命周期通知可使用 Event；有序、高吞吐或流式数据使用 Channel。
- Event 载荷不适合大数据，也缺少 Command 的强类型和细粒度 Capability 控制。事件名和载荷需要集中定义，前端监听必须在卸载时执行 `unlisten`。
- 不使用 `WebviewWindow#eval` 拼接不可信数据；确需执行脚本时必须安全序列化并经过专项安全审查。
- Capability 只约束 IPC 暴露面，不能替代 Command 内的路径、参数、权限和业务规则校验。

## 安全、Capability 与插件

- 默认最小权限。Capability 应按窗口、WebView、平台和功能拆分，只授予实际使用的命令与 scope；避免宽泛的 `*:default`、全局窗口通配符和不受限文件路径。
- 当前 `default.json` 与 `desktop.json` 对主窗口有重复且较宽的授权，前端尚未实际使用这些插件。后续改动应逐步收窄，不得因为依赖已安装就继续扩大权限。
- 当前 `cli`、`updater` 权限已声明，但对应 Rust 插件尚未初始化。新增、移除或启用插件时必须同步检查：
  - `package.json` 与 `bun.lock`；
  - `src-tauri/Cargo.toml` 与 `src-tauri/Cargo.lock`；
  - `src-tauri/src/lib.rs` 的插件初始化；
  - `src-tauri/capabilities/*.json` 的权限和 scope；
  - `tauri.conf.json` 与平台差异。
- `tauri.conf.json` 当前 `csp` 为 `null`。引入远程内容、富文本、外链资源或发布版本前必须配置并验证尽可能严格的 CSP；不要用 `unsafe-eval`、任意远程源或关闭校验来临时绕过问题。
- 默认不允许远程页面获得本地 Capability。若业务确需远程来源，必须限定 HTTPS 域名、窗口和权限，并进行单独威胁建模。
- 文件系统路径必须规范化并限制在批准的 scope 内，防止目录穿越和符号链接越界；Shell/Sidecar 参数使用精确 allow 规则，不接受任意命令或任意参数。
- 密钥、令牌、签名私钥和敏感内容不得进入前端 bundle、源码、日志、错误、提交或 `.env` 示例值。敏感持久化使用 Stronghold 或操作系统安全存储。
- Stronghold 的生产密钥不得使用 `DefaultHasher` 等非密码学哈希直接派生；相关初始化变更必须采用审查过的 KDF、盐和参数，并考虑迁移与恢复。
- Updater 必须使用 HTTPS 和签名校验；私钥只保存在 CI Secret 或安全密钥设施中，不能提交仓库。发布产物按目标平台完成代码签名，macOS 外部分发还需公证。

## 测试与验证

- 前端测试放在 `tests/<area>/<name>.test.ts`，以用户可观察行为和回归为中心，不镜像实现细节。当前 Vitest 默认为 Node 环境；需要 DOM 时先显式配置测试环境和测试工具。
- Rust 单元测试放在对应模块内；跨模块与 IPC 契约测试放在 `src-tauri/tests/`。文件系统测试使用临时目录，不依赖用户真实目录、网络或执行顺序。
- Bug 修复先添加能复现问题的最小失败测试，再修复根因。重点覆盖输入校验、错误映射、取消、路径安全、权限拒绝和持久化迁移。
- 对纯函数、业务逻辑和 Command 内核优先做自动化测试；窗口、托盘、快捷键、通知和系统集成需要在支持的平台做桌面冒烟测试。不得只在浏览器中验证 Tauri 功能。
- 当前仓库没有 CI 和既有测试，不得声称 CI 或测试已通过。新增 CI 时，本地和 CI 的检查命令必须一致，并按目标平台安装 Tauri 系统依赖。

按改动范围执行最小充分验证：

- 仅文档：检查链接、命令、当前状态和 `git diff --check`。
- 前端：`vp check`、`vpr build`；有相关测试时运行 `vpr test`。
- Rust/Tauri：Rust format、check、Clippy 和 test；涉及集成行为时再运行 `vpr tauri dev`。
- 权限、插件、窗口或打包：除上述检查外，核对生成 schema、实际 Capability 和至少一个目标平台的构建/冒烟结果。

若因环境、平台、签名凭据或现有失败无法执行某项检查，必须明确列出未验证内容和原因，不能用“应该通过”代替结果。

## 配置、生成文件与提交

- 不手工编辑或提交 `src-tauri/gen/schemas/`、`dist/`、`src-tauri/target/`、`node_modules/` 等生成产物。
- `.env*` 保持本地且不得包含真实凭据；允许提交的 `.env.example` 只记录变量名和无敏感示例。
- 不提交无意生成的模板资源、调试输出、系统文件或本地 IDE 配置。
- 使用 Conventional Commits：`feat`、`fix`、`refactor`、`docs`、`test`、`chore`，可使用 `frontend`、`tauri`、`ipc`、`ui` 等明确 scope。
- 只修改和暂存当前任务文件，保留用户无关改动与既有暂存边界；未获明确请求不自动提交、不推送、不创建发布。
