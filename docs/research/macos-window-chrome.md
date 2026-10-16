# macOS 窗口标题栏与交通灯规划研究

调查日期：2026-10-16。范围：当前 Tauri 2.12 / macOS 窗口配置、Apple 最新窗口与工具栏设计资料、标题栏拖动与双击缩放。

## 当前实现

- `src-tauri/tauri.conf.json` 当前全平台配置为 `decorations: false`、`titleBarStyle: "Transparent"`。
- React 页面各自绘制 64px 高的 header；`data-tauri-drag-region` 只加在部分标题文字上，没有统一的窗口 chrome，也没有双击处理。
- Tauri 官方配置说明：`trafficLightPosition` 使用 `LogicalPosition`，且**要求** `titleBarStyle: "Overlay"` 和 `decorations: true`。当前配置不满足条件，因此不应假定现在可配置原生红绿灯位置。
- Tauri 区分 `Transparent` 与 `Overlay`：`Transparent` 只让标题栏显示窗口背景，适用于不需要 HTML 覆盖标题栏的情形；`Overlay` 让标题栏叠在页面内容之上，但标题栏高度因 OS 版本而异，要求自定义拖动区域，且文档记录非活动窗口的自定义拖动有限制。

## Apple 资料支持的约束

1. 交通灯是窗口原生标准控制，应保留系统控件，不用 CSS/SVG 仿造。Apple HIG 将关闭、最小化和缩放作为窗口标准控制介绍；WWDC26 的 AppKit 资料强调系统窗口框架、统一工具栏与更一致的窗口圆角。
2. Apple 没有发布可供跨 macOS 版本硬编码的标题栏固定高度、交通灯直径/间距或窗口外圆角数值。AppKit 提供运行时窗口布局与标准按钮几何信息；应让系统提供尺寸，或测量当前窗口，而非复制网上某张截图的像素值。
3. macOS Tahoe 26 起，窗口圆角由系统统一收紧；使用原生 window decorations 能让系统控制窗口轮廓。页面内容的圆角应与窗口容器协调，不能用 `border-radius` 伪装原生窗口边缘。
4. Tauri 自定义标题栏示例用 `data-tauri-drag-region` / `startDragging()`，并在双击时调用 `toggleMaximize()`；这满足产品明确要求的拖动与双击放大。拖动区不能盖住按钮或输入控件。

## 建议方案

### 窗口框架

macOS 单独启用原生 decorations，并采用 Tauri `titleBarStyle: "Overlay"`，保留原生交通灯，让应用操作按钮进入同一顶部区域。通过 `tauri.macos.conf.json` 覆盖平台配置，不改变 Windows/Linux 当前无边框行为。取消对外窗口圆角的 CSS 仿制，让 AppKit 决定窗框、阴影、交通灯尺寸和系统 hover 状态。

不在第一步设置 `trafficLightPosition`：先沿用 AppKit 默认位置和尺寸。若产品布局必须挪动红绿灯，再使用 Tauri 的逻辑位置配置；该值是位置 inset，不是按钮大小设置，并必须在支持的 macOS 版本实机核对。

### 顶部区域与内容布局

引入单一共享 `WindowChrome`，由 App shell 放在路由内容之上，替代 Bot 列表、聊天、详情和设置页面各自管理窗口拖动区的做法。只把无交互的空白/标题区域标记为拖动区；返回、详情、设置、Bot 新建等操作控件独立于拖动区域。

Tauri 文档明确提醒 Overlay 的标题栏高度会随 OS 版本变化。不要把当前 64px 页面 header 直接当成系统标题栏高度，也不要用 CSS 猜 28/32/40px。实现前先确定是否采用：

- **首选（确需融合顶部操作时）**：在 macOS Rust 边界读取公开 AppKit 窗口布局/标准按钮 frame，转换为 CSS 逻辑像素变量，供共享 `WindowChrome` 预留安全区并排列 app controls；随窗口状态、系统外观和窗口变化重新取值。
- **简化备用**：若暂不实现原生几何查询，保留系统标题栏作为独立区域，app 工具栏放在其下方；不声称两者融合为固定高度的自定义标题栏。

顶部操作按钮采用现有 React / Lucide UI，放在交通灯安全区之外。右侧放应用级操作，页面标题居中/按 Apple toolbar 规则布局需以实际使用场景决定；不把 app 自有操作绘制成交通灯。

### 拖动与双击

在空白标题区使用 Tauri 提供的 drag region；如使用同一个区域处理双击，按官方手动方案区分单击拖动与双击 `toggleMaximize()`。保留 macOS 全屏作为独立系统动作，不把“放大”映射成 fullscreen。验收时确认第一次点击不会误触发拖动、双击在空白区生效、按钮双击不触发窗口操作、输入控件可正常选择文字。

### 圆角和窗口背景

保持原生 decorations 与系统阴影/窗框，不在 webview 根元素上绘制假外圆角。内容背景延伸至 Overlay 下方时，使用应用主题背景；最上沿的工具栏/侧栏遵循 macOS 26 Liquid Glass 的层级原则，避免一条不透明的 64px 色带遮住原生标题栏。若透明背景导致 macOS 26 窗框/边缘异常，先使用原生 decorated window 回退对比，不以 `decorations: false` 加 CSS 圆角掩盖。

## 验收矩阵

- OS：当前 macOS（项目开发机）与最低支持 macOS 版本；浅色/深色；窗口激活/非激活。
- 尺寸：默认窗口、最小尺寸、最大化（Zoom）、全屏、拖到不同显示器；检查 traffic lights、顶部按钮、内容安全区和窗口圆角。
- 操作：原生关闭/最小化/缩放；标题区拖动；双击空白标题区放大/还原；按钮、标题文本、输入框可交互且不启动拖动。
- 回归：macOS 保留系统原生 decorations；Windows/Linux 仍保持现有自定义无边框；页面内导航 header 不重复占用窗口标题栏高度。

## 当前原型实现

- `tauri.macos.conf.json` 仅在 macOS 开启原生 decorations、Overlay 和隐藏系统标题文字；交通灯位置与尺寸保持 AppKit 默认值。
- 共享 `App` 处理所有 `data-window-titlebar` 空白区域的拖动与双击最大化，并排除按钮、链接、输入框等交互控件。返回、详情、新建等按钮不会触发窗口拖动。
- 现有页面 header 暂保留 64px 高度；这只是 AgentChat 的工具栏高度，不代表原生标题栏高度。当前 84px 左侧避让值按开发机窗口中原生交通灯默认位置做了视觉核对，属于本轮效果稿的 CSS 留白，尚未改为 AppKit 动态几何查询。
- `window-state` 插件不再恢复 `decorations` 标志，避免用户此前保存的无边框状态覆盖 macOS 配置；窗口尺寸、位置、最大化和全屏状态仍照常恢复。

本轮目标是让用户检查 Overlay 的视觉融合方向；不同 macOS 版本、窗口缩放和显示器缩放比例仍需复核后再决定是否引入动态几何查询。

## 来源

- Apple Human Interface Guidelines — Windows（窗口移动、系统窗口控制）：https://developer.apple.com/design/human-interface-guidelines/windows
- Apple WWDC26 — Keynote（macOS 窗口统一圆角、顶部工具栏层级）：https://developer.apple.com/videos/play/wwdc2026/101/?time=2015
- Apple WWDC26 — Modernize your AppKit app（窗口与工具栏、系统圆角/容器同心度）：https://developer.apple.com/videos/play/wwdc2026/289/
- Apple AppKit — `NSWindow.contentRect(forFrameRect:)`（按当前 window/frame/style 查询内容区，不以固定高度推算）：https://developer.apple.com/documentation/appkit/nswindow/contentrect%28forframerect%3A%29
- Apple AppKit — `NSWindow.standardWindowButton(_:)`（查询系统标准窗口按钮）：https://developer.apple.com/documentation/appkit/nswindow/standardwindowbutton%28_%3A%29
- Tauri v2 — Window Customization（decorations、拖动区、双击 `toggleMaximize`、Transparent 标题栏）：https://v2.tauri.app/learn/window-customization/
- Tauri v2 — Configuration / `WindowConfig`（`titleBarStyle`、`trafficLightPosition` 前置条件与逻辑坐标）：https://v2.tauri.app/reference/config/#windowconfig
- Tauri v2 — Platform-specific config（`tauri.macos.conf.json` 与主配置合并）：https://v2.tauri.app/reference/config/#platform-specific-configuration

注：Apple HIG/WWDC 描述平台视觉与行为，不给交通灯尺寸、位置偏移或标题栏固定高度的跨版本常量；本文不把示例截图中的像素值当成规范。
