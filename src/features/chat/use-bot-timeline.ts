import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

import type {
  ConversationSnapshot,
  ConversationSummary,
  ProjectedMessage,
} from "@/app/runner-client";
import { captureRunnerSession, useRunnerLifecycle } from "@/app/runner-queries";
import { useWorkspaceResources } from "@/app/workspace-provider";

type TimelineMessage = ProjectedMessage & { conversationId: number };

type HistoryRefreshObservation = {
  conversationId: number | null;
  latestMessageId: number | null;
  active: boolean;
  completion: number;
  lastRefreshKey: string | null;
};

function rowId(conversationId: number, messageId: number) {
  return `${conversationId}:${messageId}`;
}

function isInvalidHistoryCursor(error: unknown) {
  return error instanceof Error && error.message.includes("历史游标无效");
}

export function useBotTimeline(
  conversations: ConversationSummary[],
  selectedConversationId: number | null,
  selectedSnapshot: ConversationSnapshot | null,
) {
  const { client } = useWorkspaceResources();
  const cache = useQueryClient();
  const { paused } = useRunnerLifecycle();
  const selectedIndex = conversations.findIndex(
    (conversation) => conversation.id === selectedConversationId,
  );
  const selectedConversation = conversations[selectedIndex];
  const history = useInfiniteQuery({
    queryKey: ["runner", "chat-history", selectedConversationId],
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam, signal }) => {
      if (selectedConversationId === null) throw new Error("缺少 Conversation");
      signal.throwIfAborted();
      const assertCurrent = captureRunnerSession(cache);
      const page = await client.chatHistory(selectedConversationId, pageParam);
      signal.throwIfAborted();
      assertCurrent();
      return page;
    },
    getNextPageParam: (page) => page.cursor ?? undefined,
    enabled: selectedConversationId !== null && !paused,
    staleTime: Infinity,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const latestSnapshotMessage = selectedSnapshot?.messages.findLast(
    (message) => message.text && (message.role === "user" || message.role === "assistant"),
  );
  const latestSnapshotMessageId = latestSnapshotMessage?.id ?? null;
  const snapshotIsActive = Boolean(selectedSnapshot?.activeTasks.length);
  const refreshObservation = useRef<HistoryRefreshObservation>({
    conversationId: null,
    latestMessageId: null,
    active: false,
    completion: 0,
    lastRefreshKey: null,
  });
  const historyRefreshPending = useRef(false);

  useEffect(() => {
    if (selectedConversationId === null || selectedSnapshot === null) return;

    const previous = refreshObservation.current;
    const switchedConversation = previous.conversationId !== selectedConversationId;
    const completedTask = !switchedConversation && previous.active && !snapshotIsActive;
    const newStableMessage =
      !switchedConversation &&
      !snapshotIsActive &&
      previous.latestMessageId !== latestSnapshotMessageId;
    const completion = switchedConversation
      ? 0
      : previous.completion + (completedTask ? 1 : 0);
    const refreshKey = `${latestSnapshotMessageId ?? "none"}:${completion}`;

    refreshObservation.current = {
      conversationId: selectedConversationId,
      latestMessageId: latestSnapshotMessageId,
      active: snapshotIsActive,
      completion,
      lastRefreshKey: switchedConversation ? null : previous.lastRefreshKey,
    };
    if (switchedConversation) historyRefreshPending.current = false;

    const firstPageHasLatestMessage =
      latestSnapshotMessageId === null ||
      history.data?.pages[0]?.messages.some((message) => message.id === latestSnapshotMessageId);
    if (
      !snapshotIsActive &&
      latestSnapshotMessageId !== null &&
      history.data?.pages.length &&
      !firstPageHasLatestMessage &&
      previous.lastRefreshKey !== refreshKey
    ) {
      historyRefreshPending.current = true;
    }
    if (completedTask || newStableMessage) historyRefreshPending.current = true;

    if (historyRefreshPending.current && history.data?.pages.length && !history.isFetching && !paused) {
      historyRefreshPending.current = false;
      refreshObservation.current.lastRefreshKey = refreshKey;
      void history.refetch();
    }
  }, [
    history.data,
    history.isFetching,
    history.refetch,
    latestSnapshotMessageId,
    paused,
    selectedConversationId,
    selectedSnapshot,
    snapshotIsActive,
  ]);

  const invalidCursorNeedsRefresh = useRef(false);
  const requestSequence = useRef(0);
  const inFlightRequest = useRef<number | null>(null);
  const activeConversationRef = useRef(selectedConversationId);
  if (activeConversationRef.current !== selectedConversationId) {
    activeConversationRef.current = selectedConversationId;
    invalidCursorNeedsRefresh.current = false;
    requestSequence.current += 1;
    inFlightRequest.current = null;
  }

  const messagesById = new Map<string, TimelineMessage>();
  for (const page of [...(history.data?.pages ?? [])].reverse()) {
    for (const message of page.messages) {
      messagesById.set(rowId(message.conversationId, message.id), {
        ...message,
        truncated: false,
      });
    }
  }

  if (selectedConversation && selectedSnapshot) {
    const isStreaming = selectedSnapshot.activeTasks.length > 0;
    for (const message of selectedSnapshot.messages) {
      if (
        !message.text ||
        (message.role !== "user" && message.role !== "assistant")
      ) {
        continue;
      }
      const key = rowId(selectedConversation.id, message.id);
      if (!messagesById.has(key) || isStreaming) {
        messagesById.set(key, { ...message, conversationId: selectedConversation.id });
      }
    }
  }

  const conversationOrder = new Map(
    conversations.map((conversation) => [conversation.id, conversation]),
  );
  const messages = [...messagesById.values()].sort((left, right) => {
    const leftConversation = conversationOrder.get(left.conversationId);
    const rightConversation = conversationOrder.get(right.conversationId);
    const byConversation =
      (leftConversation?.createdAt ?? 0) - (rightConversation?.createdAt ?? 0) ||
      left.conversationId - right.conversationId;
    return byConversation || left.id - right.id;
  });

  function loadOlder() {
    if (
      selectedConversationId === null ||
      paused ||
      (!history.hasNextPage && !history.isError) ||
      history.isFetching ||
      inFlightRequest.current !== null
    ) {
      return;
    }
    const currentRequest = ++requestSequence.current;
    inFlightRequest.current = currentRequest;
    const recoverExpiredCursor = invalidCursorNeedsRefresh.current;
    invalidCursorNeedsRefresh.current = false;
    const request = recoverExpiredCursor || history.isError
      ? history.refetch()
      : history.fetchNextPage();
    void request
      .then((result) => {
        if (currentRequest !== requestSequence.current) return;
        if (result.isError && isInvalidHistoryCursor(result.error)) {
          invalidCursorNeedsRefresh.current = true;
        } else if (result.isError && recoverExpiredCursor) {
          invalidCursorNeedsRefresh.current = true;
        }
      })
      .catch(() => {
        if (currentRequest === requestSequence.current) {
          invalidCursorNeedsRefresh.current = true;
        }
      })
      .finally(() => {
        if (currentRequest === requestSequence.current) inFlightRequest.current = null;
      });
  }

  return {
    messages,
    historyLoading: history.isFetching,
    historyError: history.isError,
    historyHasPages: Boolean(history.data?.pages.length),
    loadOlder,
  };
}
