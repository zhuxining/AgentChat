# 目标目录结构

> **Status**: `proposed`。以下是首发目标结构，不代表目录或功能已经实现；实现时按实际消费者逐步创建。

本文将[架构总览](00-overview.md)确定的桌面 Host、Pi Runtime Adapter 和 Device Access 映射到单仓单 Tauri 工程。目录按产品功能和运行边界组织，不按依赖库名称组织。

## 目标结构

```text
src/                           React 界面与前端状态
  main.tsx                     前端启动入口
  app/
    desktop/                   macOS 窗口界面与平台组合
    mobile/                    iOS/Android 客户端界面与平台组合
  features/
    agents/                    角色发现、创建与配置界面
    conversations/             会话、消息、在线执行反馈
    pairing/                   桌面配对入口与移动端配对流程
  platform/
    desktop/                   调用同进程 Host 的类型化 Tauri IPC 适配
    mobile/                    调用移动端 Rust 网络能力的类型化 IPC 适配
  components/
    assistant-ui/              已有助手交互组件，供业务界面组合
    ui/                        已有共享基础 UI 组件
  hooks/                       有实际复用需求的 React Hooks
  lib/                         前端通用工具
  index.css                    主题与全局样式

src-tauri/                     共用的 Tauri 工程
  src/
    main.rs                    桌面应用入口
    lib.rs                     Builder、插件、平台模块与应用生命周期装配
    commands/                  桌面 Host 与移动端网络操作的薄 IPC 边界
    desktop/                   菜单栏、窗口关闭与显式退出等 macOS 宿主行为
    host_runtime/              Agent、独立记忆、长期聊天、上下文段、Message、SQLite 与执行队列
    pi_runtime/                Pi CLI 进程、JSONL RPC、Session 与事件转换
    device_access/
      server/                  Host 的配对、设备认证、HTTPS/SSE 与发现服务
      client/                  移动端的发现、证书信任、连接与只读缓存
  capabilities/                按平台、窗口及实际命令收窄的 Tauri 权限
  tauri.conf.json              应用、窗口、构建与打包配置

tests/                         前端行为测试，随功能按需创建
src-tauri/tests/               Rust 跨模块与 IPC 契约测试，随功能按需创建
public/                        原样复制的静态资源
docs/                          产品与架构文档
```

树中只固定职责目录和关键入口，不预定每个模块的文件清单。`host_runtime/`、`pi_runtime/` 和 `device_access/` 是架构边界；内部文件在实现对应流程时依实际职责拆分。SQLite 的模式、存取代码及每个 Agent 的 Markdown 记忆归 Host Runtime，Pi Session 文件仍由 Pi 管理。运行数据放在平台应用数据目录，不在源码树内；具体位置见[数据存储](04-data-storage.md)。

`pi_runtime/` 实现 Pi 专用的进程监督、stdin/stdout/stderr 管理、JSONL 协议与事件转换；Tauri Command、前端和 Device Access 不持有子进程或原始 Pi RPC。当前没有第二个执行 Provider，不建立无消费者的通用 Driver trait。进程与协议约束见[Pi Runtime Adapter](02-pi-runtime.md#进程与协议所有权)。

## 依赖与状态边界

- 桌面界面经 `platform/desktop/` 和 Tauri Command 调用同进程 Host Runtime；移动界面经 `platform/mobile/`、移动端 Rust 网络能力及已认证的 Device Access 服务访问 Host。共享业务界面不直接散落 `invoke` 字符串或网络请求。
- `commands/` 只处理 IPC 参数、授权、调用及结果转换；`device_access/server/` 只处理局域网协议和设备身份。两者调用 Host Runtime 的产品操作，不各自实现会话规则，也不绕过 Host Runtime 直接读写 SQLite。
- Host Runtime 持有产品消息、最终结果及运行期间的队列状态，调用 Pi Runtime Adapter 执行消息；Pi Runtime Adapter 不依赖客户端或 Host 存储。移动端近期消息缓存仅供离线只读展示，不覆盖 Host 数据。
- 桌面专属 Host、Pi 和菜单栏代码仅在 macOS 构建中装配；移动端只装配客户端连接能力。平台差异集中在入口和模块装配处，避免散布在业务逻辑中。

## 落地约束与当前状态

现有仓库主要是欢迎页、共享 UI 和 Tauri 插件装配：`src/` 尚无上述 `app/`、`features/` 或 `platform/` 业务目录；Rust 侧 `commands/` 仅有模块声明，尚无自定义 Command。目标目录应随功能落地创建，不提前建立空模块、通用 Provider 层或中央 `models` 目录。路由目录只在实际启用路由时建立。

已有 `assistant-ui` 中的附件相关组件只是可复用 UI，不表示首发支持附件。首发结构不规划独立 Task、持久化 Run、云中继或跨 Agent 编排；这些能力若经产品验证后加入，再调整目录和职责。构建输出、依赖安装目录与 Tauri 生成目录不属于维护的源结构。
