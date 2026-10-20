import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vite-plus/test";

import { createRequestHandler } from "../src/communication/handlers.js";
import { localNativeAdapter } from "../src/communication/native.js";
import { openRunner, type Runner } from "../src/harness/open.js";

const fixtures: { dataDir: string; runner: Runner }[] = [];
afterEach(async () => {
  for (const fixture of fixtures.splice(0)) {
    await fixture.runner.close();
    const path = await realpath(fixture.dataDir);
    if (!path.startsWith(join(await realpath(tmpdir()), "agentchat-query-test-")))
      throw new Error(`拒绝清理测试目录之外的路径: ${path}`);
    await rm(path, { recursive: true, force: true });
  }
});

async function fixture() {
  const dataDir = await mkdtemp(join(tmpdir(), "agentchat-query-test-"));
  const native = localNativeAdapter({});
  const source = { type: "keyring" as const, entry: "deepseek-api-key" };
  await native.writeCredential(source, { type: "api_key", key: "synthetic-query-test" });
  let reads = 0;
  const runner = await openRunner({
    dataDir,
    native: {
      ...native,
      async readCredential(source) {
        reads++;
        return native.readCredential(source);
      },
    },
  });
  fixtures.push({ dataDir, runner });
  const conversations = [];
  for (let index = 0; index < 3; index++) {
    const bot = await runner.createBot({ name: `Query ${index}` });
    const conversation = await runner.createConversation({ botId: bot.id, cwd: "", goal: "" });
    conversations.push({ bot, conversation });
  }
  return { dataDir, runner, conversations, native, source, reads: () => reads };
}

describe("Runner display queries", () => {
  it("shares one authentication read across simultaneous and repeated conversation snapshots", async () => {
    const { runner, conversations, reads } = await fixture();
    const before = reads();
    const snapshots = await Promise.all(
      conversations.map(({ conversation }) => runner.snapshot(conversation.id)),
    );
    expect(snapshots.every((snapshot) => snapshot.apiKeyConfigured)).toBe(true);
    expect(reads() - before).toBe(1);
    await runner.snapshot(conversations[0]!.conversation.id);
    expect(reads() - before).toBe(1);
  });

  it("invalidates cached authentication when credentials are deleted through the Runner", async () => {
    const { runner, conversations, reads } = await fixture();
    const id = conversations[0]!.conversation.id;
    expect((await runner.snapshot(id)).apiKeyConfigured).toBe(true);
    await runner.providerRequest({ action: "deleteCredential", instanceId: "deepseek" });
    const before = reads();
    expect((await runner.snapshot(id)).apiKeyConfigured).toBe(false);
    expect(reads() - before).toBe(1);
  });

  it("reloads authentication after explicit configuration reload even when provider settings are unchanged", async () => {
    const { runner, conversations, native, source } = await fixture();
    const id = conversations[0]!.conversation.id;
    expect((await runner.snapshot(id)).apiKeyConfigured).toBe(true);
    await native.deleteCredential(source);
    expect((await runner.reloadConfiguration()).apiKeyConfigured).toBe(false);
    expect((await runner.snapshot(id)).apiKeyConfigured).toBe(false);
  });

  it("serves one credential-free batch for latest Bot summaries and advertises that capability", async () => {
    const { runner, conversations, reads } = await fixture();
    const first = conversations[0]!;
    const newest = await runner.createConversation({ botId: first.bot.id, cwd: "", goal: "" });
    const emptyBot = await runner.createBot({ name: "No conversation" });
    expect(await runner.initialize()).toMatchObject({ queryCapabilities: { botSummaries: true } });
    const before = reads();
    const summaries = await createRequestHandler(runner)({ op: "botSummaries" });
    expect(summaries).toEqual([
      { botId: first.bot.id, conversationId: newest.id, latestMessage: "", executing: false },
      ...conversations.slice(1).map(({ bot, conversation }) => ({
        botId: bot.id,
        conversationId: conversation.id,
        latestMessage: "",
        executing: false,
      })),
      { botId: emptyBot.id, conversationId: null, latestMessage: "", executing: false },
    ]);
    expect(reads()).toBe(before);
    expect(JSON.stringify(summaries)).not.toContain("synthetic-query-test");
  });
});
