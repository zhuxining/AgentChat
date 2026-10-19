import { useQueries } from "@tanstack/react-query";

import type { Bot, ConversationSnapshot, ConversationSummary } from "@/app/runner-client";
import { snapshotOptions, useRunnerLifecycle } from "@/app/runner-queries";
import { useWorkspaceResources } from "@/app/workspace-provider";
import { selectLatestConversation } from "@/features/bots/bot-conversations";

export type BotSummary =
  | { status: "empty" }
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; latestMessage: string; executing: boolean };

function selectSummary(snapshot: ConversationSnapshot): BotSummary {
  return {
    status: "ready",
    latestMessage: snapshot.messages.filter((message) => message.text).at(-1)?.text ?? "",
    executing: snapshot.activeTasks.some((task) => task.status === "running"),
  };
}

// Summary and transcript observers share the same snapshot cache and in-flight request.
// A summary distinguishes loading and failure from an actually empty conversation so the
// list never claims a Bot has no history while its snapshot is still unknown.
export function useBotSummaries(
  bots: Bot[],
  conversations: ConversationSummary[],
): Map<string, BotSummary> {
  const { client } = useWorkspaceResources();
  const { paused } = useRunnerLifecycle();
  const targets = bots.map((bot) => ({
    botId: bot.id,
    conversationId: selectLatestConversation(conversations, bot.id)?.id ?? null,
  }));
  const queries = useQueries({
    queries: targets.map((target) => ({
      ...snapshotOptions(client, target.conversationId),
      enabled: target.conversationId !== null && !paused,
      select: selectSummary,
    })),
  });
  const summaries = new Map<string, BotSummary>();
  targets.forEach((target, index) => {
    if (target.conversationId === null) {
      summaries.set(target.botId, { status: "empty" });
      return;
    }
    // A paused Runner's cached snapshot is not presented as the Bot's current state.
    const query = paused ? undefined : queries[index];
    if (query?.data) {
      summaries.set(target.botId, query.data);
    } else if (paused || query?.isError) {
      summaries.set(target.botId, { status: "error" });
    } else {
      summaries.set(target.botId, { status: "loading" });
    }
  });
  return summaries;
}
