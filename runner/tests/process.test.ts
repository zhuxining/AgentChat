import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createInterface } from "node:readline";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vite-plus/test";

type RunnerResponse = {
  id: number;
  ok: boolean;
  result?: unknown;
  error?: string;
};

describe("Runner process protocol", () => {
  it("starts the bundled Node entry, answers requests, and closes cleanly", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "agentchat-runner-process-"));
    const entry = resolve(process.cwd(), "dist/entry.js");
    const child = spawn(process.execPath, [entry, "--data-dir", dataDir], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    const lines = createInterface({ input: child.stdout });
    const responses = lines[Symbol.asyncIterator]();

    const nextResponse = async (): Promise<RunnerResponse> => {
      const next = await responses.next();
      if (next.done) throw new Error("Runner exited before responding");
      return JSON.parse(next.value) as RunnerResponse;
    };
    const send = (id: number, op: string, fields: Record<string, unknown> = {}) => {
      child.stdin.write(`${JSON.stringify({ id, op, ...fields })}\n`);
    };

    try {
      send(1, "setProviderCredential", { apiKey: "runner-protocol-test-key" });
      expect(await nextResponse()).toMatchObject({
        id: 1,
        ok: true,
        result: { configured: true },
      });

      send(2, "initialize");
      expect(await nextResponse()).toMatchObject({
        id: 2,
        ok: true,
        result: { bots: [], conversations: [], apiKeyConfigured: true },
      });

      const exited = once(child, "exit");
      send(3, "close");
      expect(await nextResponse()).toMatchObject({ id: 3, ok: true, result: { closed: true } });
      expect(await exited).toEqual([0, null]);
    } finally {
      lines.close();
      if (child.exitCode === null && child.signalCode === null) child.kill();
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("closes the Harness before rejecting a truncated input frame", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "agentchat-runner-malformed-"));
    const entry = resolve(process.cwd(), "dist/entry.js");
    const child = spawn(process.execPath, [entry, "--data-dir", dataDir], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stderr = "";
    child.stdout.resume();
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });

    try {
      const exited = once(child, "exit");
      child.stdin.end('{"id":1');
      expect(await exited).toEqual([1, null]);
      expect(stderr).toContain("incomplete protocol message");
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill();
      await rm(dataDir, { recursive: true, force: true });
    }
  });
});
