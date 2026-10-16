import { mkdir } from "node:fs/promises";

import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";

export function executionEnvironment(shellEnv: NodeJS.ProcessEnv) {
  return ({ cwd }: { readonly cwd?: string }) => {
    if (!cwd) throw new Error("执行配置缺少工作目录");
    return new NodeExecutionEnv({ cwd, shellEnv });
  };
}

export async function prepareWorkspace(cwd: string) {
  await mkdir(cwd, { recursive: true });
}
