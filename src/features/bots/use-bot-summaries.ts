import { useQueries } from "@tanstack/react-query";

import type { Bot, ConversationSummary } from "@/app/runner-client";
import { runnerClient } from "@/app/runner-client";

export type BotSummary = { latestMessage: string; executing: boolean };

type LiveSummary = { conversationId: number | null; latestMessage: string; executing: boolean };

// The selected Bot already streams through the workspace poll. Every other Bot is read
// once per stale window so the list can show its latest line without N live polls.
export function useBotSummaries(
  bots: Bot[],
  conversations: ConversationSummary[],
  live: LiveSummary,
): Map<string, BotSummary> {
  const targets = bots.map((bot) => {
    const conversationId =
      conversations
        .filter((conversation) => conversation.botId === bot.id)
        .sort((left, right) => right.createdAt - left.createdAt)[0]?.id ?? null;
    return { botId: bot.id, conversationId };
  });
  const queries = useQueries({
    queries: targets.map((target) => ({
      queryKey: ["bot-summary", target.conversationId],
      enabled: target.conversationId !== null && target.conversationId !== live.conversationId,
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      queryFn: async (): Promise<BotSummary> => {
        const snapshot = await runnerClient.snapshot(target.conversationId as number);
        return {
          latestMessage: snapshot.messages.filter((message) => message.text).at(-1)?.text ?? "",
          executing: snapshot.activeTasks.some((task) => task.status === "running"),
        };
      },
    })),
  });
  const summaries = new Map<string, BotSummary>();
  targets.forEach((target, index) => {
    if (target.conversationId === null) return;
    if (target.conversationId === live.conversationId) {
      summaries.set(target.botId, {
        latestMessage: live.latestMessage,
        executing: live.executing,
      });
      return;
    }
    const summary = queries[index]?.data;
    if (summary) summaries.set(target.botId, summary);
  });
  return summaries;
}
