# 多端 P0：iOS 宿主与凭据边界

日期：2026-10-22。首轮目标为 iOS 模拟器，不代表真机或业务多端验收完成。

## 产品决定

- 手机只发送和展示会话，Provider/API Key 留在桌面 Runner。
- 移动端任何密钥或令牌均不落盘，每次冷启动重新验证；移动安全存储不再是实施前置。
- 手机临时会话、Relay、同步与文本提交尚未实现，当前移动界面仍为说明页。

## 已完成的宿主验证

使用 Xcode 27.1、iOS 27.1 的 iPhone Duo 模拟器，通过 `tauri ios dev 'iPhone Duo'` 完成 Xcode 构建、安装与原生进程启动。须同时设置 `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer` 并将该 Xcode 的 `usr/bin` 放在 PATH 前端；没有修改全局 xcode-select。

模拟器采用本地签名，不代表真机签名、发布签名或公证通过。

## 已撤回的存储实验

本轮曾创建仅用于诊断的随机 Keychain 项，验证创建、重复创建和重启后读取；该项未用于登录、配对或 Provider。用户确定不落盘边界后，已撤回插件、依赖、IPC、Capability、测试与开发入口。

经用户明确授权，仅删除 service `com.syneju.agentchat.device-probe.v1`、account `diagnostic-secret` 的诊断项；没有清空 Keychain 或模拟器。电脑操作工具连接失败后，使用临时原生清理逻辑执行精确删除并立即读取确认。模拟器原生日志在 2026-10-22 13:44:48 返回 `delete=deleted verify=absent`。清理逻辑也随探针删除，不保留生产入口。

该实验仅说明已撤回版本的诊断读写行为，不能作为临时认证、端到端加密或业务多端的验收证据。

## 清理后验证

- Cargo 自动更新锁文件后，应用源码和依赖清单均恢复到本轮修改前，不再包含探针插件、权限或前端入口。
- `bun run build:frontend` 通过，仍有既有的 chunk 大小警告。
- Rust format、check、Clippy（`-D warnings`）及 test 通过，26 项测试通过。
- 清理后重新执行完整 `tauri ios dev 'iPhone Duo'`，`BUILD SUCCEEDED`，安装并启动原生进程成功。电脑操作工具连接失败，因此清理后版本未完成可视交互冒烟。
- 本轮四份文档格式检查及 `git diff --check` 通过。

## 剩余验收

临时授权握手、Relay 与 Runner 双重校验、内存凭据生命周期、冷启动重新验证、过期与撤销、同一会话重试，以及新会话对未知结果的历史对账均待实现。真机、锁屏、前后台生命周期与 Android 尚未验收。

前端现有聊天历史测试 `tests/ui/submission.test.ts:599` 缺少“加载更早对话”按钮；在未修改 HEAD 的隔离副本中复现相同失败，未修改无关聊天实现。全仓格式检查也存在既有失败；本轮仅格式化交付文档，不修改生成工程或无关源码。
