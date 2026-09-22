import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite-plus";

const host = process.env.TAURI_DEV_HOST;

const ignorePatterns = [
  "**/routeTree.gen.ts",
  ".agents/skills",
  "docs/refer/**",
  ".zcode/**",
  "**/dist/**",
  "**/node_modules/**",
  "**/.tanstack/**",
  "**/local.db*",
  "**/.vite/**",
  "**/out/**",
  "packages/ui/src/components/**",
  "packages/db/drizzle-platform",
];
// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react(), tailwindcss()],
  lint: {
    ignorePatterns,
    jsPlugins: [
      { name: "vite-plus", specifier: "vite-plus/oxlint-plugin" },
      { name: "shadcn", specifier: "@shadcn/lint" },
    ],
    rules: { "vite-plus/prefer-vite-plus-imports": "error" },
    options: { typeAware: true, typeCheck: true },
    plugins: ["eslint", "typescript", "react", "import", "promise", "node", "vitest"],
  },
  fmt: {
    ignorePatterns,
    sortPackageJson: true,
    sortScripts: true,
    sortImports: true,
    sortTailwindcss: true,
  },
  staged: {
    "*.{js,ts,jsx,tsx,vue,svelte,json,jsonc,css,md}": "vp check --fix",
  },
  resolve: { tsconfigPaths: true },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
  },
}));
