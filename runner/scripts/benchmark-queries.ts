import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { setTimeout as delay } from "node:timers/promises";

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createSession } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";

import { createNativeStdio, type NativeAdapter } from "../src/communication/native.js";
import { serveStdio } from "../src/communication/stdio.js";
import { openRunner } from "../src/harness/open.js";

// Synthetic data only: no host adapter, real credentials, submissions or network.
function nativeFixture(latency: number) {
  let reads = 0;
  const adapter: NativeAdapter = {
    async readCredential() {
      reads++;
      if (latency) await delay(latency);
      return { type: "api_key", key: "benchmark-synthetic-only" };
    },
    async writeCredential() {},
    async deleteCredential() {},
    async env() {
      return null;
    },
    async fileExists() {
      return false;
    },
  };
  return { adapter, reads: () => reads };
}

const samples = process.argv.includes("--assert-query-budget") ? 3 : 30;
async function measure(name: string, action: () => Promise<unknown>, reads?: () => number) {
  for (let index = 0; index < 3; index++) await action();
  const initialReads = reads?.() ?? 0;
  const timings: number[] = [];
  let bytes = 0;
  for (let index = 0; index < samples; index++) {
    const start = performance.now();
    const value = await action();
    timings.push(performance.now() - start);
    bytes = Buffer.byteLength(JSON.stringify(value));
  }
  timings.sort((a, b) => a - b);
  const result = {
    name,
    samples,
    p50Ms: Number(timings[Math.ceil(samples * 0.5) - 1]!.toFixed(2)),
    p95Ms: Number(timings[Math.ceil(samples * 0.95) - 1]!.toFixed(2)),
    resultBytes: bytes,
    ...(reads ? { credentialReadsPerSample: (reads() - initialReads) / samples } : {}),
  };
  console.log(JSON.stringify(result));
  return result;
}

async function main() {
  console.log(
    JSON.stringify({
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      samples,
    }),
  );
  const directory = await realpath(await mkdtemp(join(tmpdir(), "agentchat-perf-")));
  try {
    const fixtureNative = nativeFixture(0);
    const initial = await openRunner({ dataDir: directory, native: fixtureNative.adapter });
    const ids: number[] = [];
    const historyIds: number[] = [];
    try {
      for (let index = 0; index < 20; index++) {
        const bot = await initial.createBot({ name: `Synthetic ${index}` });
        const conversation = await initial.createConversation({ botId: bot.id, cwd: "", goal: "" });
        ids.push(conversation.id);
        if (index === 0) {
          historyIds.push(conversation.id);
          for (let older = 0; older < 19; older++) {
            historyIds.push(
              (await initial.createConversation({ botId: bot.id, cwd: "", goal: "" })).id,
            );
          }
          ids[0] = historyIds.at(-1)!;
        }
      }
    } finally {
      await initial.close();
    }
    // Seed passive entries through the public Session API while Runner is closed.
    const storage = await openNodeSqliteStorage(join(directory, "state", "runner.sqlite"));
    const session = createSession(storage);
    try {
      const conversations = await storage.scanConversations({}, 100, undefined, BACKGROUND_CONTEXT);
      for (const count of [50, 1000]) {
        const id = count === 50 ? ids[1] : ids[0];
        const conversation = conversations.items.find((item) => item.id === id);
        assert(conversation);
        await session.commit(async (tx) => {
          for (let index = 0; index < count; index++) {
            await tx.appendEntry(conversation.id, {
              kind: "benchmark.message",
              model: [
                {
                  role: "user",
                  content: `Synthetic message ${index}: ${"x".repeat(500)}`,
                  timestamp: index,
                },
              ],
            });
          }
        }, BACKGROUND_CONTEXT);
      }
    } finally {
      await session.close(BACKGROUND_CONTEXT);
    }
    if (!process.argv.includes("--native-only")) {
      for (const latency of [0, 15]) {
        const native = nativeFixture(latency);
        const runner = await openRunner({ dataDir: directory, native: native.adapter });
        try {
          const baseline = await measure(
            `direct/empty/auth-${latency}ms`,
            () => runner.snapshot(ids[2]!),
            native.reads,
          );
          await measure(
            `direct/50-entries/auth-${latency}ms`,
            () => runner.snapshot(ids[1]!),
            native.reads,
          );
          const snapshot = await runner.snapshot(ids[0]!);
          assert.equal(snapshot.messages.length, 50);
          assert.equal(snapshot.hasMoreMessages, true);
          await measure(
            `direct/1000-entries/auth-${latency}ms`,
            () => runner.snapshot(ids[0]!),
            native.reads,
          );
          const fanout = await measure(
            `direct/20-bot-summaries/auth-${latency}ms`,
            () => Promise.all(ids.map((id) => runner.snapshot(id))),
            native.reads,
          );
          await measure(
            `direct/20-history-conversations/auth-${latency}ms`,
            () => Promise.all(historyIds.map((id) => runner.snapshot(id))),
            native.reads,
          );
          // This asserts query completion, not a desktop paint deadline.
          if (latency && process.argv.includes("--assert-query-budget")) {
            assert(
              fanout.p95Ms <= 200,
              `20 snapshots p95 ${fanout.p95Ms}ms > 200ms; single ${baseline.p95Ms}ms`,
            );
          }
        } finally {
          await runner.close();
        }
      }
      for (const latency of [0, 15]) {
        const child = spawn(
          process.execPath,
          [import.meta.filename, "--serve", directory, String(latency)],
          {
            stdio: ["pipe", "pipe", "inherit"],
            env: { PATH: process.env.PATH },
          },
        );
        const exited = once(child, "exit");
        const lines = createInterface({ input: child.stdout });
        let sequence = 0;
        const pending = new Map<
          number,
          { resolve(value: unknown): void; reject(error: Error): void }
        >();
        child.on("exit", () => {
          for (const waiter of pending.values()) waiter.reject(new Error("Benchmark child exited"));
          pending.clear();
        });
        lines.on("line", (line) => {
          const response = JSON.parse(line) as {
            id: number;
            ok: boolean;
            result?: unknown;
            error?: string;
          };
          const waiter = pending.get(response.id);
          if (!waiter) return;
          pending.delete(response.id);
          if (response.ok) waiter.resolve(response.result);
          else waiter.reject(new Error(response.error ?? "Benchmark request failed"));
        });
        const request = (op: string, conversationId?: number): Promise<unknown> => {
          const id = ++sequence;
          return new Promise((resolve, reject) => {
            pending.set(id, { resolve, reject });
            child.stdin.write(
              `${JSON.stringify({ id, op, ...(conversationId === undefined ? {} : { conversationId }) })}\n`,
            );
          });
        };
        const timer = setTimeout(() => child.kill(), 30_000);
        try {
          await request("initialize");
          await measure(`jsonl/empty/auth-${latency}ms`, () => request("snapshot", ids[2]!));
          await measure(`jsonl/1000-entries/auth-${latency}ms`, () => request("snapshot", ids[0]!));
          await measure(`jsonl/20-bot-summaries/auth-${latency}ms`, () =>
            Promise.all(ids.map((id) => request("snapshot", id))),
          );
          await request("close");
          assert.deepEqual(await exited, [0, null]);
        } finally {
          clearTimeout(timer);
          lines.close();
          if (child.exitCode === null && child.signalCode === null) {
            child.kill();
            await exited;
          }
        }
      }
    }
    if (process.env.BENCH_NATIVE) {
      for (const latency of [0, 15, 100]) {
        const child: ChildProcess = spawn(
          process.env.BENCH_NATIVE,
          [directory, JSON.stringify(ids)],
          {
            stdio: ["ignore", "inherit", "inherit"],
            env: {
              PATH: process.env.PATH,
              BENCH_NODE: process.execPath,
              AGENTCHAT_RUNNER_ENTRY: import.meta.filename,
              BENCH_CREDENTIAL_DELAY_MS: String(latency),
            },
          },
        );
        assert.deepEqual(await once(child, "exit"), [0, null]);
      }
    }
  } finally {
    // Verify the resolved target before removing the fixture directory.
    assert.equal(await realpath(directory), directory);
    assert(directory.startsWith(join(await realpath(tmpdir()), "agentchat-perf-")));
    await rm(directory, { recursive: true, force: true });
  }
}

if (process.argv[2] === "--native-rpc") {
  const dataDir = process.argv[process.argv.indexOf("--data-dir") + 1];
  assert(dataDir && process.argv.includes("--data-dir"));
  const transport = createNativeStdio();
  const runner = await openRunner({ dataDir, native: transport.adapter });
  serveStdio(runner, transport);
} else if (process.argv[2] === "--serve") {
  const dataDir = process.argv[3];
  assert(dataDir);
  const native = nativeFixture(Number(process.argv[4]));
  const runner = await openRunner({ dataDir, native: native.adapter });
  serveStdio(runner);
} else {
  await main();
}
