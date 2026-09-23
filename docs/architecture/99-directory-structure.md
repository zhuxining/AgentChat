# 当前目录结构

> **Status**: `active`

本文记录仓库当前目录结构，不描述目标架构实现。代码重组后同步更新。

```text
src/                         React 前端入口、视图与共享组件
  assets/                    前端静态资源
  components/                assistant-ui 与共享 UI 组件
    assistant-ui/            助手交互界面组件
    ui/                      通用基础 UI 组件
  hooks/                     React Hooks
  lib/                       前端通用函数
src-tauri/                   Tauri 宿主工程
  capabilities/              WebView 命令权限配置
  src/                       Rust 应用入口与命令模块
  tauri.conf.json            Tauri 应用、窗口、构建和打包配置
public/                      静态 Web 资源

docs/                        产品与架构文档
  architecture/              架构总览、主题设计与参考资料
```

当前 Rust 源码入口为 `src-tauri/src/main.rs` 与 `src-tauri/src/lib.rs`；`src-tauri/src/commands/` 包含命令模块声明，当前没有自定义 IPC Command 实现。构建输出、依赖安装目录和 Tauri 生成目录不属于维护的源结构。
