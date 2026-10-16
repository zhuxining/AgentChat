import { chmodSync, copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const runnerRoot = resolve(scriptDir, "..");
const platform = process.platform === "win32" ? "win" : process.platform;
const architecture = platform === "win" && process.arch === "ia32" ? "x86" : process.arch;
const prefix = platform === "darwin" && architecture === "arm64" ? "node-bin" : "node";
const platformPackage = `${prefix}-${platform}-${architecture}`;
const candidates = ["node", "node.exe"].flatMap((binary) => [
  resolve(runnerRoot, "node_modules", platformPackage, "bin", binary),
  resolve(runnerRoot, "../node_modules", platformPackage, "bin", binary),
]);
const source = candidates.find((path) => existsSync(path));
if (!source) {
  throw new Error(
    `找不到当前目标的 Node runtime（${platformPackage}）；请在目标平台执行 bun install。`,
  );
}

const runtimeDir = resolve(runnerRoot, "runtime");
const destination = resolve(runtimeDir, "node");
mkdirSync(runtimeDir, { recursive: true });
copyFileSync(source, destination);
if (process.platform !== "win32") chmodSync(destination, 0o755);
process.stdout.write(`Node runtime staged at ${destination}\n`);
