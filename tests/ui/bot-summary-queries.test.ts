import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vite-plus/test";

import type { BotListSummary, ConversationSnapshot } from "@/app/runner-client";
import { runnerClient } from "@/app/runner-client";
import { botSummariesOptions, runnerKeys } from "@/app/runner-queries";

const targets = [
  { botId: "bot-a", conversationId: 10 },
  { botId: "bot-b", conversationId: null },
];
const response: BotListSummary[] = [
  { botId: "bot-a", conversationId: 10, latestMessage: "hello", executing: true },
  { botId: "bot-b", conversationId: null, latestMessage: "", executing: false },
];
const snapshot: ConversationSnapshot = {
  conversation: {
    id: 10,
    botId: "bot-a",
    botName: "Bot A",
    botConfigVersion: "v1",
    agent: {
      model: { provider: "test", modelId: "test-model" },
      thinkingLevel: "medium",
      instructions: "",
      cwd: "",
      extensions: [],
      tools: [],
    },
  },
  goal: { description: "", status: "open", updatedAt: 0, completedAt: null },
  messages: [{ id: 1, role: "user", text: "legacy", truncated: false }],
  hasMoreMessages: false,
  activeTasks: [],
  submissions: [],
  configurationErrors: { missingExtensions: [], missingTools: [] },
  apiKeyConfigured: true,
};

describe("Bot summary query", () => {
  it("uses one batch request when the Runner advertises support", async () => {
    const batch = vi.fn<typeof runnerClient.botSummaries>(async () => response);
    const client = { ...runnerClient, botSummaries: batch };
    const cache = new QueryClient();
    await expect(
      cache.fetchQuery(botSummariesOptions(client, cache, targets, true)),
    ).resolves.toEqual(response);
    expect(batch).toHaveBeenCalledTimes(1);
    cache.clear();
  });

  it("falls back to snapshot cache only for an unsupported operation", async () => {
    const batch = vi.fn<typeof runnerClient.botSummaries>(async () => {
      throw new Error("不支持的 Runner 操作");
    });
    const readSnapshot = vi.fn<typeof runnerClient.snapshot>(async () => snapshot);
    const client = { ...runnerClient, botSummaries: batch, snapshot: readSnapshot };
    const cache = new QueryClient();
    const summaries = await cache.fetchQuery(botSummariesOptions(client, cache, targets, true));
    expect(summaries).toEqual([
      { botId: "bot-a", conversationId: 10, latestMessage: "legacy", executing: false },
      { botId: "bot-b", conversationId: null, latestMessage: "", executing: false },
    ]);
    expect(batch).toHaveBeenCalledTimes(1);
    expect(readSnapshot).toHaveBeenCalledTimes(1);
    expect(cache.getQueryData(runnerKeys.snapshot(10))).toEqual(snapshot);
    cache.clear();
  });

  it("does not hide errors from a supported summary operation", async () => {
    const error = new Error("Runner 数据读取失败");
    const batch = vi.fn<typeof runnerClient.botSummaries>(async () => {
      throw error;
    });
    const readSnapshot = vi.fn<typeof runnerClient.snapshot>(async () => snapshot);
    const client = { ...runnerClient, botSummaries: batch, snapshot: readSnapshot };
    const cache = new QueryClient();
    await expect(cache.fetchQuery(botSummariesOptions(client, cache, targets, true))).rejects.toBe(
      error,
    );
    expect(readSnapshot).not.toHaveBeenCalled();
    cache.clear();
  });

  it("uses the snapshot cache when an older Runner lacks the capability", async () => {
    const batch = vi.fn<typeof runnerClient.botSummaries>(async () => response);
    const readSnapshot = vi.fn<typeof runnerClient.snapshot>(async () => snapshot);
    const client = { ...runnerClient, botSummaries: batch, snapshot: readSnapshot };
    const cache = new QueryClient();
    const summaries = await cache.fetchQuery(botSummariesOptions(client, cache, targets, false));
    expect(summaries[0]?.latestMessage).toBe("legacy");
    expect(batch).not.toHaveBeenCalled();
    expect(readSnapshot).toHaveBeenCalledTimes(1);
    cache.clear();
  });
});
