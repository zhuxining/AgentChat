import { useQueries } from "@tanstack/react-query";

import type { Bot, ConversationSnapshot, ConversationSummary } from "@/app/runner-client";
import { snapshotOptions, useRunnerLifecycle } from "@/app/runner-queries";
import { useWorkspaceResources } from "@/app/workspace-provider";

export type BotSummary = { latestMessage: string; executing: boolean };
function selectSummary(snapshot: ConversationSnapshot): BotSummary {
  return {
    latestMessage: snapshot.messages.filter((message) => message.text).at(-1)?.text ?? "",
    executing: snapshot.activeTasks.some((task) => task.status === "running"),
  };
}

// Summary and transcript observers share the same snapshot cache and in-flight request.
export function useBotSummaries(
  bots: Bot[],
  conversations: ConversationSummary[],
): Map<string, BotSummary> {
  const { client } = useWorkspaceResources();
  const { paused } = useRunnerLifecycle();
  const targets = bots.map((bot) => ({
    botId: bot.id,
    conversationId:
      conversations
        .filter((item) => item.botId === bot.id)
        .sort((left, right) => right.createdAt - left.createdAt || right.id - left.id)[0]?.id ??
      null,
  }));
  const queries = useQueries({
    queries: targets.map((target) => ({
      ...snapshotOptions(client, target.conversationId),
      enabled: target.conversationId !== null && !paused,
      select: selectSummary,
    })),
  });
  const summaries = new Map<string, BotSummary>();
  if (paused) return summaries;
  targets.forEach((target, index) => {
    const summary = queries[index]?.data;
    if (summary) summaries.set(target.botId, summary);
  });
  return summaries;
}
