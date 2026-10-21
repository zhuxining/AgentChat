import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";

import type { InitializeResult } from "@/app/runner-client";
import {
  captureRunnerSession,
  runnerKeys,
  useConversationSnapshot,
  useRunnerCatalog,
  useRunnerLifecycle,
} from "@/app/runner-queries";
import { useChatDraft, useWorkspaceResources } from "@/app/workspace-provider";
import { selectLatestConversation } from "@/features/bots/bot-conversations";

export function useRouteBotId() {
  return useParams({ strict: false }).botId ?? "";
}

export function useBotSelection(botId: string) {
  const { client } = useWorkspaceResources();
  const cache = useQueryClient();
  const catalog = useRunnerCatalog();
  const lifecycle = useRunnerLifecycle();
  const selectedBot = catalog.data?.bots.find((bot) => bot.id === botId && !bot.archived);
  const pendingSubmission = useChatDraft((state) => state.pendingSubmission);
  const conversations = (catalog.data?.conversations ?? [])
    .filter((item) => item.botId === botId)
    .sort((left, right) => left.createdAt - right.createdAt || left.id - right.id);
  const conversationId =
    pendingSubmission?.botId === botId
      ? pendingSubmission.conversationId
      : (selectLatestConversation(catalog.data?.conversations ?? [], botId)?.id ?? null);
  // Chat and the details pane share this request. Runner also reuses an existing
  // conversation so retries after a lost response cannot create another one.
  const opening = useQuery({
    queryKey: [...runnerKeys.all, "bot-conversation", botId, lifecycle.generation],
    queryFn: async ({ signal }) => {
      const assertCurrent = captureRunnerSession(cache);
      const current = cache.getQueryData<InitializeResult>(runnerKeys.catalog);
      const existing = selectLatestConversation(current?.conversations ?? [], botId);
      const conversation = existing ?? (await client.createConversation(botId, "", ""));
      signal.throwIfAborted();
      assertCurrent();
      cache.setQueryData<InitializeResult>(runnerKeys.catalog, (current) =>
        current
          ? {
              ...current,
              conversations: current.conversations.some((item) => item.id === conversation.id)
                ? current.conversations
                : [...current.conversations, conversation],
            }
          : current,
      );
      return conversation;
    },
    enabled:
      Boolean(selectedBot) &&
      catalog.isSuccess &&
      catalog.data.configuration.ready &&
      conversationId === null &&
      !lifecycle.paused &&
      !lifecycle.stopped &&
      !lifecycle.failed,
    staleTime: Infinity,
    retry: false,
    retryOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const query = useConversationSnapshot(conversationId);
  // A paused Runner's old snapshot is retained in cache but cannot be presented as live.
  const snapshot = lifecycle.paused ? null : (query.data ?? null);
  return {
    conversationId,
    selectedBotId: botId,
    selectedBot,
    activeBot: selectedBot,
    snapshot,
    botConversations: conversations,
    snapshotError: query.error,
    openingConversation: opening.isFetching,
    openConversationError: conversationId === null ? opening.error : null,
    retryOpenConversation: opening.refetch,
  };
}
