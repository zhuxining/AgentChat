import { useParams } from "@tanstack/react-router";

import { useRunnerCatalog, useRunnerLifecycle } from "@/app/runner-queries";
import { useConversationSnapshot } from "@/app/runner-queries";

export function useRouteBotId() {
  return useParams({ strict: false }).botId ?? "";
}

export function useBotSelection(botId: string) {
  const catalog = useRunnerCatalog();
  const conversations = (catalog.data?.conversations ?? [])
    .filter((item) => item.botId === botId)
    .sort((left, right) => left.createdAt - right.createdAt || left.id - right.id);
  const conversationId = conversations.at(-1)?.id ?? null;
  const query = useConversationSnapshot(conversationId);
  // A paused Runner's old snapshot is retained in cache but cannot be presented as live.
  const lifecycle = useRunnerLifecycle();
  const snapshot = lifecycle.paused ? null : (query.data ?? null);
  const selectedBot = catalog.data?.bots.find((bot) => bot.id === botId && !bot.archived);
  return {
    conversationId,
    selectedBotId: botId,
    selectedBot,
    activeBot: selectedBot,
    snapshot,
    botConversations: conversations,
    snapshotError: query.error,
  };
}
