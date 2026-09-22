# AGENTS.md

This file provides guidance to Code Agents (claude.ai/code、codex、qwen) when working with code in this repository.

<!-- effect-solutions:start -->

## Effect Best Practices

**IMPORTANT:** Always consult effect-solutions before writing Effect code.

1. Run `effect-solutions list` to see available guides
2. Run `effect-solutions show <topic>...` for relevant patterns (supports multiple topics)
3. Search `~/.local/share/effect-solutions/effect` for real implementations

Topics: quick-start, project-setup, tsconfig, basics, services-and-layers, data-modeling, error-handling, config, testing, cli.

Never guess at Effect patterns - check the guide first.

## Local Effect Source

The Effect v4 repository is cloned to `~/.local/share/effect-solutions/effect` for reference.
Use this to explore APIs, find usage examples, and understand implementation
details when the documentation isn't enough.

<!-- effect-solutions:end -->

## Project Overview

AgentChat is a Tauri 2.0 desktop application combining a React 19 + TypeScript frontend with a Rust backend. Package manager is **Bun**.

> Full architecture docs: `docs/architecture/README.md`

**NOTICE**: When editing code, refer to architecture documents and update them if needed.

## Commands

```bash
bunx tauri dev          # Full desktop app dev mode (Rust + frontend HMR)
bun run dev             # Frontend only (Vite on port 1420)
bun run build           # Type-check + production build (frontend)
bunx tauri build        # Build distributable desktop app
bun run check           # Biome lint + format
bun run check-types     # TypeScript type-check
```

## Architecture

### Layer Principles

> Details: `docs/architecture/reference/dependencies.md`

- **Web (React)** = thin client: render UI, collect input, call `invoke()`. No HTTP requests, no persistence, no business logic.
- **Tauri (Plugins)** = glue: bridge OS capabilities only. Use Plugin JS API for clipboard/dialog/notification/fs. Never use plugins for HTTP, WebSocket, KV storage, or shell execution.
- **Rust (Services)** = core: all business logic lives here, must NOT `use tauri::*` in Services. Three command tiers (Web/Agent/CLI) share the same Services layer.
- **Data flow**: `Command (thin) → Service (thick) → Storage (thin)`.
- **Secrets**: stored in Stronghold (`tauri-plugin-stronghold`), never in plaintext.

### Frontend Stack

- **UI**: shadcn/ui (based on **Base UI**, not Radix). Add components via `bunx shadcn@latest add <name>`.
- **Editor**: Milkdown (Crepe) for Markdown WYSIWYG editing.
- **State**: Zustand for UI state, TanStack Query for server state (invoke caching).
- **Routing**: TanStack Router.
- **Anti-patterns**: No `asChild` (Base UI uses `render` prop). No `@radix-ui/*` packages.

### IPC Pattern

- All frontend-to-backend calls go through Tauri `invoke()`.
- New Rust commands must be registered in `lib.rs` via `tauri::generate_handler![...]`.
- Commands return `Result<T, AppError>` (`error.rs`, implements `Serialize`).

### Key Locations

| Path                            | Purpose                                    |
| ------------------------------- | ------------------------------------------ |
| `src/App.tsx`                   | Root React component                       |
| `src/components/ui/`            | shadcn/ui generated components             |
| `src-tauri/src/lib.rs`          | Tauri Builder: plugin/command registration |
| `src-tauri/src/main.rs`         | Rust binary entry                          |
| `src-tauri/tauri.conf.json`     | App config (identifier, window, bundle)    |
| `src-tauri/capabilities/`       | Tauri permission grants                    |
| `docs/blueprint/00-overview.md` | Blueprint docs                             |
| `docs/prd/`                     | Product Requirements Document              |
| `docs/architecture/`            | Full architecture design docs              |
| `docs/ui/`                      | UI design documents                        |

### Directory Structure

> Details: `docs/architecture/reference/directory-structure.md`

Describes the current state of the codebase directory. Keep it in sync when adding or removing modules and files.

### Security / Permissions

- Tauri 2.0 capabilities-based model. New plugins/APIs must be declared in `src-tauri/capabilities/`.
- CSP should restrict to `'self'` + `https://api.anthropic.com`.
