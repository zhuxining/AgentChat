import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite-plus";

const host = process.env.TAURI_DEV_HOST;

const ignorePatterns = [
  "**/routeTree.gen.ts",
  ".agents/skills",
  "**/dist/**",
  "**/node_modules/**",
  "**/.tanstack/**",
  "**/.vite/**",
  "**/out/**",
];

export default defineConfig(() => ({
  plugins: [react({ compiler: true }), tailwindcss()],
  lint: {
    ignorePatterns,
    jsPlugins: [
      { name: "vite-plus", specifier: "vite-plus/oxlint-plugin" },
      { name: "shadcn", specifier: "@shadcn/lint" },
    ],
    rules: { "vite-plus/prefer-vite-plus-imports": "error" as const },
    options: { typeAware: true, typeCheck: true },
    plugins: [
      "eslint",
      "typescript",
      "react",
      "import",
      "promise",
      "node",
      "vitest",
    ] satisfies Array<"eslint" | "typescript" | "react" | "import" | "promise" | "node" | "vitest">,
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
    "*.{rs}": "cargo fmt --check",
  },
  resolve: { tsconfigPaths: true },

  // Tauri integration settings.
  clearScreen: false,
  envPrefix: ["VITE_", "TAURI_ENV_*"],
  build: {
    target: process.env.TAURI_ENV_PLATFORM === "windows" ? "chrome105" : "safari13",
    minify: !process.env.TAURI_ENV_DEBUG,
    sourcemap: Boolean(process.env.TAURI_ENV_DEBUG),
  },
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
