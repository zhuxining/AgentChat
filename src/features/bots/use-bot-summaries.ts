import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";

import type { Bot, BotListSummary, ConversationSummary } from "@/app/runner-client";
import {
  botSummariesOptions,
  snapshotOptions,
  useRunnerCatalog,
  useRunnerLifecycle,
} from "@/app/runner-queries";
import { useWorkspaceResources } from "@/app/workspace-provider";
import { selectLatestConversation } from "@/features/bots/bot-conversations";

export type BotSummary =
  | { status: "empty" }
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; latestMessage: string; executing: boolean };

function toSummary(summary: BotListSummary): BotSummary {
  return summary.conversationId === null
    ? { status: "empty" }
    : {
        status: "ready",
        latestMessage: summary.latestMessage,
        executing: summary.executing,
      };
}

export function useBotSummaries(
  bots: Bot[],
  conversations: ConversationSummary[],
): Map<string, BotSummary> {
  const { client } = useWorkspaceResources();
  const cache = useQueryClient();
  const catalog = useRunnerCatalog();
  const lifecycle = useRunnerLifecycle();
  const supportsBatch = catalog.data?.queryCapabilities?.botSummaries === true;
  const targets = bots.map((bot) => ({
    botId: bot.id,
    conversationId: selectLatestConversation(conversations, bot.id)?.id ?? null,
  }));
  const batchQuery = useQuery({
    ...botSummariesOptions(client, cache, targets, true),
    enabled: supportsBatch && targets.length > 0 && !lifecycle.paused,
    refetchInterval: lifecycle.paused ? false : 1_500,
  });
  const snapshotQueries = useQueries({
    queries: targets.map(({ conversationId }) => ({
      ...snapshotOptions(client, conversationId),
      enabled: catalog.isSuccess && !supportsBatch && conversationId !== null && !lifecycle.paused,
    })),
  });
  const values = new Map(
    (supportsBatch ? (batchQuery.data ?? []) : []).map((summary) => [
      summary.botId,
      toSummary(summary),
    ]),
  );
  targets.forEach(({ botId, conversationId }, index) => {
    if (values.has(botId)) return;
    if (conversationId === null) {
      values.set(botId, { status: "empty" });
      return;
    }
    if (lifecycle.paused) {
      values.set(botId, { status: "error" });
      return;
    }
    const snapshot = snapshotQueries[index];
    if (snapshot?.data) {
      values.set(botId, {
        status: "ready",
        latestMessage: snapshot.data.messages.filter((message) => message.text).at(-1)?.text ?? "",
        executing: snapshot.data.activeTasks.some((task) => task.status === "running"),
      });
    } else if ((supportsBatch && batchQuery.isError) || snapshot?.isError) {
      values.set(botId, { status: "error" });
    } else {
      values.set(botId, { status: "loading" });
    }
  });
  return values;
}
