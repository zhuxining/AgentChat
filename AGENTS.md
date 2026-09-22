# 仓库指南

## 项目结构

AgentChat 是一个基于 Tauri 2 的桌面应用，前端使用 React 19 和 TypeScript。

- `src/`：前端入口、React 组件、Hooks、工具函数和样式。
- `src/components/ui/`：共享 UI 基础组件；新增组件前应优先复用这里的组件。
- `src-tauri/`：Rust/Tauri 宿主代码、命令、权限配置、图标和应用配置。
- `public/`：原样复制到构建产物中的静态资源。
- `tests/`：匹配 `tests/**/*.test.ts` 的 Vitest 测试；新增测试时按需创建该目录。
- `vite.config.ts`：Vite Plus、Lint、格式化、暂存文件处理和测试配置。

## 开发命令

使用 `vp`/`vpr` 执行项目工具链，并依据已提交的 `bun.lock` 解析依赖：

```bash
vp install       # 安装依赖
vpr dev          # 启动 Vite 开发服务器
vpr build        # 执行类型检查并构建前端
vpr check        # 执行ts与rust的 lint、格式化和类型检查
vpr test         # 运行 Vitest
```

验证完整桌面应用时使用 `vpr tauri dev`。

## 编码风格

React 遵循 React 19 的推荐实践：组件定义在模块顶层，组合优先使用 `children`，`ref` 作为普通 prop 传递，不使用 `forwardRef`；基于当前状态的更新使用函数式 `setState`，派生值在渲染期间计算，避免用 Effect 同步状态。项目已启用 React Compiler，不要为了手动记忆化随意添加 `memo`、`useMemo` 或 `useCallback`。优先使用提前返回和不可变数组操作。使用 Tailwind 主题 Token 和 `lucide-react`；不要添加临时颜色、内联 SVG 或重复的 UI 基础组件。

Rust 遵循当前稳定版 Rust 的惯用实践：明确表达所有权和借用关系，优先使用 `Result`、`Option` 与 `?` 进行错误处理，避免在可恢复路径使用 `unwrap` 或 `expect`；仅在边界条件明确且有理由时使用 `unsafe`。保持函数职责单一，使用迭代器和模式匹配表达数据处理。

## 测试

编写聚焦的 Vitest 测试，路径格式为 `tests/<area>/<name>.test.ts`。测试应以行为为中心，覆盖回归问题和重要边界，而不是为每个文件机械地补充测试。

## Commit 与 Pull Request

使用 Conventional Commits，例如 `feat(frontend): add ...`、`fix(tauri): ...`、`refactor: ...` 或 `docs: ...`。提交前运行`vpr check` 完成代码和样式校验

## 配置与生成文件

将密钥保存在本地环境文件中，绝不要提交到仓库。谨慎检查 Tauri 权限配置变更，因为它们会影响桌面应用权限。不要手动编辑生成的路由树或构建产物，也不要提交 `dist/` 或依赖目录。
